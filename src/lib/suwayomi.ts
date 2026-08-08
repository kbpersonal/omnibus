// src/lib/suwayomi.ts
//
// Suwayomi (Tachidesk) GraphQL client — the acquisition engine for manga requests. Comics still go
// to the Rust engine's indexer path; this is the parallel path for manga, wired in at the
// SEARCH_AND_DOWNLOAD branch in queue.ts.
//
// Suwayomi CANNOT search across sources: FetchSourceMangaInput takes a single `source`, and the only
// cross-source resolver in the server is an unimplemented stub. So the ordered walk over the admin's
// configured source list lives here — nothing downstream provides it.

import { Logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/utils/error';

// Configurable so Node and Suwayomi can run in separate containers; defaults to localhost for
// single-host/dev setups, matching the ENGINE_URL convention in engine.ts.
export const SUWAYOMI_URL = process.env.SUWAYOMI_URL || 'http://127.0.0.1:4567';

/** SystemSetting key holding the ordered source list. Empty/absent = nothing configured yet. */
export const SOURCE_PRIORITY_KEY = 'manga_source_priority';

export interface SuwayomiSource {
    /** Opaque per-install snowflake, serialized as a string (GraphQL Long). Never hardcode one. */
    id: string;
    name: string;
    lang: string;
    isNsfw: boolean;
    displayName: string;
}

/** One entry of the admin-ordered priority list, as persisted in SystemSetting. */
export interface MangaSourceEntry {
    id: string;
    /** Kept for display when Suwayomi is unreachable and the live list can't be fetched. */
    displayName?: string;
    enabled: boolean;
}

export interface SuwayomiMangaHit {
    id: number;
    title: string;
    url: string;
    inLibrary: boolean;
}

async function graphql<T>(query: string, variables?: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${SUWAYOMI_URL}/api/graphql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Suwayomi HTTP ${res.status} ${res.statusText}`);
        const body = await res.json();
        // GraphQL reports failures in a 200 body, so errors must be read out of the payload.
        if (body.errors?.length) throw new Error(body.errors.map((e: any) => e.message).join('; '));
        return body.data as T;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Normalize a title for comparison: strip diacritics, case, and everything that isn't alphanumeric.
 * "Re:ZERO -Starting Life-" and "rezero starting life" collapse to the same key.
 */
export function normalizeTitle(s: string): string {
    return (s || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') // combining marks left behind by NFKD
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/** Live source list for the settings dropdown. Excludes id=0 (Suwayomi's Local source, not a scanlator). */
export async function listSources(): Promise<SuwayomiSource[]> {
    const data = await graphql<{ sources: { nodes: SuwayomiSource[] } }>(
        `{ sources { nodes { id name lang isNsfw displayName } } }`
    );
    return (data.sources?.nodes || []).filter(s => String(s.id) !== '0');
}

async function searchSource(sourceId: string, query: string): Promise<SuwayomiMangaHit[]> {
    const data = await graphql<{ fetchSourceManga: { mangas: SuwayomiMangaHit[] } }>(
        `mutation Search($input: FetchSourceMangaInput!) {
            fetchSourceManga(input: $input) { mangas { id title url inLibrary } }
        }`,
        { input: { source: sourceId, query, type: 'SEARCH', page: 1 } },
        // Source searches hit a third-party scanlation site (sometimes via FlareSolverr), so they are
        // materially slower than a local query.
        60000
    );
    return data.fetchSourceManga?.mangas || [];
}

async function addToLibrary(mangaId: number): Promise<void> {
    await graphql(
        `mutation Add($input: UpdateMangaInput!) { updateManga(input: $input) { manga { id inLibrary } } }`,
        { input: { id: mangaId, patch: { inLibrary: true } } }
    );
}

async function listChapters(mangaId: number): Promise<{ id: number }[]> {
    const data = await graphql<{ chapters: { nodes: { id: number }[] } }>(
        `query Chapters($mangaId: Int!) { chapters(condition: { mangaId: $mangaId }) { nodes { id } } }`,
        { mangaId }
    );
    return data.chapters?.nodes || [];
}

async function enqueueDownloads(chapterIds: number[]): Promise<void> {
    if (chapterIds.length === 0) return;
    await graphql(
        `mutation Enqueue($input: EnqueueChapterDownloadsInput!) {
            enqueueChapterDownloads(input: $input) { clientMutationId }
        }`,
        { input: { ids: chapterIds } }
    );
}

/**
 * Suwayomi populates a manga's chapter list asynchronously after the library add, so an immediate
 * read usually returns an empty list rather than an error. Retry on empty as well as on failure.
 */
async function chaptersWithRetry(mangaId: number, retries = 5, intervalMs = 1000): Promise<{ id: number }[]> {
    let last: { id: number }[] = [];
    for (let i = 0; i < retries; i++) {
        try {
            last = await listChapters(mangaId);
            if (last.length > 0) return last;
        } catch (e) {
            Logger.log(`[Suwayomi] Chapter list attempt ${i + 1}/${retries} failed: ${getErrorMessage(e)}`, 'debug');
        }
        if (i < retries - 1) await new Promise(r => setTimeout(r, intervalMs));
    }
    return last;
}

export type ResolveOutcome =
    | { ok: true; sourceId: string; manga: SuwayomiMangaHit; chaptersEnqueued: number }
    | { ok: false; reason: 'NO_SOURCES' | 'NO_MATCH'; detail: string };

/**
 * Walk the configured sources in order and add the first confident match to Suwayomi's library.
 *
 * A source "hits" only when EXACTLY ONE of its results normalizes-equal to the AniList english or
 * romaji title. Zero matches or two-plus (ambiguous) fall through to the next source. This errs
 * toward punting to a human over grabbing the wrong thing — searching "Chainsaw Man" on MangaDex
 * returns the series plus colored editions and six doujinshi, and only the exact title survives.
 * That guard is what makes auto-approving manga requests safe.
 *
 * Mantium matches on exact source URL instead, but it can: its user pastes the manga's URL. An
 * Omnibus request carries a title and year, so titles are all we have.
 */
export async function resolveAndAdd(
    sources: MangaSourceEntry[],
    titles: { romaji?: string | null; english?: string | null; fallback: string }
): Promise<ResolveOutcome> {
    const active = sources.filter(s => s.enabled && String(s.id) !== '0');
    if (active.length === 0) {
        return {
            ok: false,
            reason: 'NO_SOURCES',
            detail: 'No manga sources configured. An admin must add sources in Settings → Discovery & Filtering.',
        };
    }

    // Match against every title we know: AniList's english/romaji, plus the requested name for
    // titles AniList doesn't carry.
    const wanted = new Set(
        [titles.english, titles.romaji, titles.fallback]
            .filter((t): t is string => !!t)
            .map(normalizeTitle)
            .filter(Boolean)
    );
    // The query text: AniList's romaji is what scanlation sources index under most often.
    const query = titles.romaji || titles.english || titles.fallback;

    const tried: string[] = [];
    for (const source of active) {
        let results: SuwayomiMangaHit[];
        try {
            results = await searchSource(String(source.id), query);
        } catch (e) {
            // One dead source must not sink the request — the next one may well have the title.
            Logger.log(`[Suwayomi] Source ${source.displayName || source.id} search failed: ${getErrorMessage(e)}`, 'warn');
            tried.push(`${source.displayName || source.id}: error`);
            continue;
        }

        const matches = results.filter(r => wanted.has(normalizeTitle(r.title)));
        if (matches.length !== 1) {
            Logger.log(
                `[Suwayomi] ${source.displayName || source.id}: ${results.length} result(s), ${matches.length} exact — ${matches.length === 0 ? 'no match' : 'ambiguous'}, trying next source.`,
                'info'
            );
            tried.push(`${source.displayName || source.id}: ${matches.length === 0 ? 'no match' : `${matches.length} ambiguous matches`}`);
            continue;
        }

        const hit = matches[0];
        Logger.log(`[Suwayomi] Matched "${hit.title}" on ${source.displayName || source.id} (manga id ${hit.id}).`, 'success');

        if (!hit.inLibrary) await addToLibrary(hit.id);
        const chapters = await chaptersWithRetry(hit.id);
        await enqueueDownloads(chapters.map(c => c.id));

        if (chapters.length === 0) {
            // The add succeeded and Suwayomi's own update loop will pick chapters up later; this is
            // worth a log line but not a failure.
            Logger.log(`[Suwayomi] "${hit.title}" added, but no chapters listed yet — Suwayomi will fetch them on its next update.`, 'warn');
        }

        return { ok: true, sourceId: String(source.id), manga: hit, chaptersEnqueued: chapters.length };
    }

    return {
        ok: false,
        reason: 'NO_MATCH',
        detail: `No configured source returned a single confident match for "${query}". Tried — ${tried.join('; ')}.`,
    };
}
