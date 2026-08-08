// __tests__/lib/suwayomi.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeTitle } from '@/lib/suwayomi';

describe('normalizeTitle', () => {
  it('ignores case, punctuation, and whitespace', () => {
    expect(normalizeTitle('Chainsaw Man')).toBe(normalizeTitle('chainsaw-man'));
    expect(normalizeTitle('Re:ZERO -Starting Life in Another World-')).toBe(
      normalizeTitle('rezero starting life in another world'),
    );
  });

  it('strips diacritics so romanizations compare equal', () => {
    expect(normalizeTitle('Jujutsu Kaisen')).toBe(normalizeTitle('Jūjutsu Kaisen'));
    expect(normalizeTitle('Pokemon')).toBe(normalizeTitle('Pokémon'));
  });

  it('handles empty and nullish input', () => {
    expect(normalizeTitle('')).toBe('');
    expect(normalizeTitle(undefined as unknown as string)).toBe('');
  });

  it('keeps distinct titles distinct', () => {
    expect(normalizeTitle('Chainsaw Man')).not.toBe(normalizeTitle('Chainsaw Man Official Colored'));
    expect(normalizeTitle('Bleach')).not.toBe(normalizeTitle('Bleach Colored'));
  });

  // The ambiguity guard is the reason auto-approving manga is safe, so pin the real-world case it
  // was designed against: a live MangaDex search for "Chainsaw Man" returns the series plus colored
  // editions and six doujinshi. Exactly one result may survive normalization, or the resolver punts.
  it('selects exactly one match from a real MangaDex result set', () => {
    const results = [
      'Chainsaw Man',
      'Chainsaw Man (Official Colored)',
      'Chainsaw Man - The Hayakawa Family (Doujinshi)',
      'Chainsaw Man (Fan Colored)',
      'Chainsaw Man - "Big Smoke" Fami (Doujinshi)',
      'Chainsaw Man - Yoru had ONE job (Doujinshi)',
      'Chainsaw Man - Coffee with Makima-san (Doujinshi)',
      'Chainsaw Man - Nayuta tries the Grimace Shake (Doujinshi)',
      'Chainsaw Man - The Story of Himeno, Aki and Tobacco (Doujinshi)',
      'Tatsuki Fujimoto Short Story Collection',
    ];
    const wanted = new Set([normalizeTitle('Chainsaw Man')]);
    const matches = results.filter(r => wanted.has(normalizeTitle(r)));

    expect(matches).toEqual(['Chainsaw Man']);
  });

  it('treats a parenthesized suffix as a different title, not a match', () => {
    // Guards against loosening normalization to strip brackets: that would make the set above
    // ambiguous (3 matches) and send every Chainsaw Man request to manual review.
    const wanted = new Set([normalizeTitle('Chainsaw Man')]);
    expect(wanted.has(normalizeTitle('Chainsaw Man (Official Colored)'))).toBe(false);
  });
});
