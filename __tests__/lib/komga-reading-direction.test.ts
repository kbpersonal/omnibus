// __tests__/lib/komga-reading-direction.test.ts
import { describe, it, expect } from 'vitest';
import { directionForOrigin } from '@/lib/komga';

describe('directionForOrigin', () => {
  it('maps Japanese manga to right-to-left', () => {
    expect(directionForOrigin('JP')).toBe('RIGHT_TO_LEFT');
  });

  it('maps manhwa/manhua origins to webtoon', () => {
    expect(directionForOrigin('KR')).toBe('WEBTOON');
    expect(directionForOrigin('CN')).toBe('WEBTOON');
    expect(directionForOrigin('TW')).toBe('WEBTOON');
  });

  it('is case-insensitive', () => {
    expect(directionForOrigin('jp')).toBe('RIGHT_TO_LEFT');
    expect(directionForOrigin('kr')).toBe('WEBTOON');
  });

  it('returns null for unknown or missing origins so the field is left alone', () => {
    // Leaving it unset is deliberate: a wrong guess would be locked in and override whatever Komga
    // (or a human) already set correctly.
    expect(directionForOrigin('US')).toBeNull();
    expect(directionForOrigin('')).toBeNull();
    expect(directionForOrigin(null)).toBeNull();
    expect(directionForOrigin(undefined)).toBeNull();
  });
});
