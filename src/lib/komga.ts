// src/lib/komga.ts
//
// Sets a manga series' reading direction in Komga after Suwayomi has downloaded it.
//
// Why this exists at all: Komga derives reading direction from ComicInfo's <Manga> element, and
// Suwayomi never writes that element — so every manga would otherwise read left-to-right. Komga has
// no library-level default to fall back on, so the direction has to be set per series via the API.
//
// Why the API rather than rewriting the CBZ's ComicInfo: ComicInfo can only express
// "no" / "yes-and-right-to-left", so manhwa and manhua could never be marked as webtoon. Going
// through the API also keeps Suwayomi the single writer of its own files (ADR-0001).

import { Logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/utils/error';
import { normalizeTitle } from '@/lib/suwayomi';

export const KOMGA_URL = process.env.KOMGA_URL || 'http://127.0.0.1:25600';

/** Komga's SeriesMetadata.ReadingDirection enum. */
export type ReadingDirection = 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT' | 'VERTICAL' | 'WEBTOON';

/**
 * AniList countryOfOrigin → Komga reading direction.
 * Anything else (or no AniList match) returns null and the direction is left untouched, which is
 * better than guessing wrong on a series Komga may already have set correctly.
 */
export function directionForOrigin(countryOfOrigin: string | null | undefined): ReadingDirection | null {
    switch ((countryOfOrigin || '').toUpperCase()) {
        case 'JP': return 'RIGHT_TO_LEFT';
        case 'KR':
        case 'CN':
        case 'TW': return 'WEBTOON';
        default: return null;
    }
}

function apiKey(): string | null {
    return process.env.KOMGA_API_KEY || null;
}

async function komgaFetch(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
    const key = apiKey();
    if (!key) throw new Error('KOMGA_API_KEY is not set');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(`${KOMGA_URL}${path}`, {
            ...init,
            headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...(init.headers || {}) },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

/** Find a series by title, matching on the same normalization the source resolver uses. */
async function findSeriesId(title: string): Promise<string | null> {
    const res = await komgaFetch(`/api/v1/series?search=${encodeURIComponent(title)}&size=50`);
    if (!res.ok) throw new Error(`Komga series search failed: HTTP ${res.status}`);
    const body = await res.json();
    const wanted = normalizeTitle(title);
    // Komga's search is full-text, so it happily returns near misses — require an exact
    // normalized match rather than trusting the first hit.
    const match = (body.content || []).find(
        (s: any) => normalizeTitle(s.metadata?.title || s.name || '') === wanted
    );
    return match?.id ?? null;
}

/**
 * Poll for the series, then set its reading direction.
 *
 * "Not found yet" is the EXPECTED first answer: Suwayomi still has to finish downloading and the
 * komga-watcher sidecar has to fire a library scan before the series exists. So this retries on a
 * bounded schedule and gives up quietly — by that point the manga is already downloaded and
 * readable, only its direction is wrong, and re-running is harmless.
 */
export async function applyReadingDirection(
    title: string,
    countryOfOrigin: string | null,
    { attempts = 20, intervalMs = 30000 }: { attempts?: number; intervalMs?: number } = {}
): Promise<boolean> {
    const direction = directionForOrigin(countryOfOrigin);
    if (!direction) {
        Logger.log(`[Komga] No reading direction for "${title}" (countryOfOrigin=${countryOfOrigin ?? 'unknown'}); leaving unset.`, 'info');
        return false;
    }
    if (!apiKey()) {
        Logger.log(`[Komga] KOMGA_API_KEY not set — cannot set reading direction for "${title}".`, 'warn');
        return false;
    }

    for (let i = 0; i < attempts; i++) {
        try {
            const seriesId = await findSeriesId(title);
            if (seriesId) {
                const res = await komgaFetch(`/api/v1/series/${seriesId}/metadata`, {
                    method: 'PATCH',
                    // The lock is not optional. Komga's ComicInfo provider re-derives a metadata patch
                    // on EVERY scan, and because Suwayomi writes no <Manga> element that patch carries
                    // readingDirection = null. Komga only applies unlocked fields, so without the lock
                    // the next scan silently reverts what we just set.
                    body: JSON.stringify({ readingDirection: direction, readingDirectionLock: true }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                Logger.log(`[Komga] Set reading direction ${direction} (locked) on "${title}".`, 'success');
                return true;
            }
        } catch (e) {
            Logger.log(`[Komga] Reading-direction attempt ${i + 1}/${attempts} for "${title}" failed: ${getErrorMessage(e)}`, 'debug');
        }
        if (i < attempts - 1) await new Promise(r => setTimeout(r, intervalMs));
    }

    Logger.log(
        `[Komga] "${title}" did not appear in Komga within the retry window; reading direction not set. It reads left-to-right until re-applied.`,
        'warn'
    );
    return false;
}
