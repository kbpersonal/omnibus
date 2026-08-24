// __tests__/lib/suwayomi.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeTitle, resolveAndAdd } from '@/lib/suwayomi';

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

describe('resolveAndAdd', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const source = (id: string, displayName = id) => ({ id, displayName, enabled: true });
  const response = (data: unknown) => new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  it('parks the request without contacting Suwayomi when no sources are enabled', async () => {
    const outcome = await resolveAndAdd([], { fallback: 'One Piece' });

    expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: 'NO_SOURCES' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips a dead source and resolves against the next configured source', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error('source timed out'))
      .mockResolvedValueOnce(response({ fetchSourceManga: { mangas: [{ id: 22, title: 'One Piece', url: '/one-piece', inLibrary: true }] } }))
      .mockResolvedValueOnce(response({ chapters: { nodes: [{ id: 101 }] } }))
      .mockResolvedValueOnce(response({ enqueueChapterDownloads: { clientMutationId: 'enqueue-1' } }));

    const outcome = await resolveAndAdd([source('dead', 'Dead Source'), source('live', 'Live Source')], {
      fallback: 'One Piece',
    });

    expect(outcome).toEqual(expect.objectContaining({ ok: true, sourceId: 'live', chaptersEnqueued: 1 }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).variables.input.source).toBe('live');
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string).variables.input.ids).toEqual([101]);
  });

  it('falls through when a source has ambiguous exact matches', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response({ fetchSourceManga: { mangas: [
        { id: 1, title: 'Bleach', url: '/bleach', inLibrary: false },
        { id: 2, title: 'Bleach', url: '/bleach-alt', inLibrary: false },
      ] } }))
      .mockResolvedValueOnce(response({ fetchSourceManga: { mangas: [] } }));

    const outcome = await resolveAndAdd([source('ambiguous'), source('empty')], { fallback: 'Bleach' });

    expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: 'NO_MATCH' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('adds an exact single match to the library and enqueues its chapters', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response({ fetchSourceManga: { mangas: [{ id: 42, title: 'Jujutsu Kaisen', url: '/jjk', inLibrary: false }] } }))
      .mockResolvedValueOnce(response({ updateManga: { manga: { id: 42, inLibrary: true } } }))
      .mockResolvedValueOnce(response({ chapters: { nodes: [{ id: 7 }, { id: 8 }] } }))
      .mockResolvedValueOnce(response({ enqueueChapterDownloads: { clientMutationId: 'enqueue-2' } }));

    const outcome = await resolveAndAdd([source('source-1')], {
      romaji: 'Jujutsu Kaisen',
      english: 'Jujutsu Kaisen',
      fallback: 'Jujutsu Kaisen #1',
    });

    expect(outcome).toEqual(expect.objectContaining({
      ok: true,
      sourceId: 'source-1',
      chaptersEnqueued: 2,
    }));
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).variables.input.patch).toEqual({ inLibrary: true });
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string).variables.input.ids).toEqual([7, 8]);
  });
});
