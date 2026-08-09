// src/lib/utils/release-match.ts
import { STOP_WORDS, JUNK_WORDS } from './search-terms';

/** Words that describe the release, not the series — never evidence of a different comic. */
const RELEASE_NOISE = [...STOP_WORDS, ...JUNK_WORDS, 'empire', 'scan', 'scans', 'repack', 'retail', 'complete', 'covers', 'noads', 'now'];

/**
 * Alphabetic name tokens from a release/file label. Numbers, years, bracketed groups and mixed
 * alphanumeric junk (obfuscated usenet names like `a1b2c3d4`) are dropped, so what survives is only
 * words that could actually name a series.
 */
export function nameTokens(label: string): string[] {
    return (label || '')
        .replace(/\.[^/.]+$/, '')
        .replace(/\[.*?\]/g, ' ')
        .replace(/\(.*?\)/g, ' ')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 2 && /^[a-z]+$/.test(t) && !RELEASE_NOISE.includes(t));
}

export type PayloadVerdict = 'match' | 'mismatch' | 'unknown';

/**
 * Decide whether the archive actually delivered belongs to the series that was requested.
 *
 * Only ever returns 'mismatch' when the payload POSITIVELY names a different comic — it has real
 * words and none of them relate to the requested series. Obfuscated, numeric or noise-only names
 * yield 'unknown' so the caller falls back to the release label instead of refusing a good import.
 *
 * Abbreviations are matched two ways so legitimate scene naming survives: concatenated containment
 * ("spiderman" vs "amazing spider man") and the series acronym ("ASM 050").
 */
export function payloadSeriesVerdict(payloadName: string, seriesName: string): PayloadVerdict {
    const seriesWords = nameTokens(seriesName);
    const payloadWords = nameTokens(payloadName);
    if (!seriesWords.length || !payloadWords.length) return 'unknown';

    if (payloadWords.some(t => seriesWords.includes(t))) return 'match';

    const seriesJoined = seriesWords.join('');
    const payloadJoined = payloadWords.join('');
    if (seriesJoined.includes(payloadJoined) || payloadJoined.includes(seriesJoined)) return 'match';

    const acronym = seriesWords.map(t => t[0]).join('');
    if (acronym.length > 1 && payloadWords.includes(acronym)) return 'match';

    return 'mismatch';
}
