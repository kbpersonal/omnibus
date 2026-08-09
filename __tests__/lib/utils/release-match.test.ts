import { describe, it, expect } from 'vitest';
import { nameTokens, payloadSeriesVerdict } from '@/lib/utils/release-match';

describe('Utils: Release Payload Matching', () => {
    describe('nameTokens', () => {
        it('keeps only alphabetic series words', () => {
            expect(nameTokens('Absolute Superman 006 (2025) (Digital) (Shan-Empire) (cbz)')).toEqual(['absolute', 'superman']);
        });

        it('drops obfuscated alphanumeric usenet names entirely', () => {
            expect(nameTokens('a1b2c3d4e5f6.cbz')).toEqual([]);
            expect(nameTokens('199808.cbr')).toEqual([]);
        });

        it('strips the extension, brackets and release noise', () => {
            expect(nameTokens('Batman 001 [2016] [Webrip] [The Last Kryptonian-DCP].cbr')).toEqual(['batman']);
        });
    });

    describe('payloadSeriesVerdict', () => {
        it('rejects a payload that positively names a different comic', () => {
            // The exact failure: an NZB labelled "Absolute Superman 006" delivering Madman & The Jam.
            expect(payloadSeriesVerdict('199808 Madman & The Jam 002.cbr', 'Absolute Superman')).toBe('mismatch');
        });

        it('accepts the correct series', () => {
            expect(payloadSeriesVerdict('Absolute Superman 002 (2025) (Webrip) (The Last Kryptonian-DCP).cbr', 'Absolute Superman')).toBe('match');
        });

        it('accepts a partial series-name match', () => {
            expect(payloadSeriesVerdict('Superman 010 (2025).cbz', 'Absolute Superman')).toBe('match');
        });

        it('accepts concatenated spellings', () => {
            expect(payloadSeriesVerdict('Spiderman 050.cbz', 'The Amazing Spider-Man')).toBe('match');
        });

        it('accepts the series acronym', () => {
            expect(payloadSeriesVerdict('ASM 050 (2024).cbz', 'Amazing Spider Man')).toBe('match');
        });

        it('returns unknown for obfuscated payloads instead of refusing the import', () => {
            expect(payloadSeriesVerdict('a1b2c3d4e5f6.cbz', 'Absolute Superman')).toBe('unknown');
            expect(payloadSeriesVerdict('001.cbz', 'Absolute Superman')).toBe('unknown');
        });

        it('returns unknown when the series name carries no usable words', () => {
            expect(payloadSeriesVerdict('Madman 002.cbr', '2000')).toBe('unknown');
        });

        it('is not fooled by shared release noise alone', () => {
            expect(payloadSeriesVerdict('Madman & The Jam 002 (Digital) (Webrip).cbr', 'Absolute Superman')).toBe('mismatch');
        });
    });
});
