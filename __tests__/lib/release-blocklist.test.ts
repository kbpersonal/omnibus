import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    log: vi.fn()
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        releaseBlocklist: {
            findFirst: mocks.findFirst,
            create: mocks.create,
            findMany: mocks.findMany
        }
    }
}));
vi.mock('@/lib/logger', () => ({ Logger: { log: mocks.log } }));

import { blockRelease, getBlockedReleases } from '@/lib/utils/release-blocklist';

describe('release blocklist', () => {
    beforeEach(() => {
        mocks.findFirst.mockResolvedValue(null);
        mocks.create.mockResolvedValue({});
        mocks.findMany.mockResolvedValue([]);
    });

    it('records a bad release under its provider and volume', async () => {
        await blockRelease({
            releaseTitle: 'Absolute Superman 006',
            downloadLink: 'nzb_006',
            metadataSource: 'METRON',
            volumeId: '160860',
            issueNumber: '6',
            reason: 'Wrong payload'
        });

        expect(mocks.findFirst).toHaveBeenCalledWith({
            where: {
                releaseTitle: 'Absolute Superman 006',
                metadataSource: 'METRON',
                volumeId: '160860',
                issueNumber: '6'
            }
        });
        expect(mocks.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ metadataSource: 'METRON', volumeId: '160860' })
        });
    });

    it('returns both title and link only for the requested provider/volume', async () => {
        mocks.findMany.mockResolvedValue([
            { releaseTitle: 'Absolute Superman 006', downloadLink: 'nzb_006' }
        ]);

        await expect(getBlockedReleases('160860', 'METRON')).resolves.toEqual([
            'Absolute Superman 006',
            'nzb_006'
        ]);
        expect(mocks.findMany).toHaveBeenCalledWith({
            where: { OR: [{ volumeId: '160860', metadataSource: 'METRON' }, { volumeId: null }] },
            select: { releaseTitle: true, downloadLink: true }
        });
    });
});
