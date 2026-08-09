import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, DELETE } from '@/app/api/admin/blocklist/route';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    getToken: vi.fn(),
    blocklistFindMany: vi.fn(),
    blocklistFindUnique: vi.fn(),
    blocklistDelete: vi.fn(),
    seriesFindMany: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({ getToken: mocks.getToken }));
vi.mock('@/lib/db', () => ({
    prisma: {
        releaseBlocklist: {
            findMany: mocks.blocklistFindMany,
            findUnique: mocks.blocklistFindUnique,
            delete: mocks.blocklistDelete,
        },
        series: { findMany: mocks.seriesFindMany },
    }
}));

const ROW = {
    id: 'blk_1',
    releaseTitle: 'Absolute Superman 006 (2025) (Digital) (Shan-Empire) (cbz)',
    downloadLink: 'nzb_abc',
    volumeId: '160860',
    issueNumber: '6',
    reason: 'Payload "199808 Madman & The Jam 002.cbr" does not belong to series "Absolute Superman"',
    createdAt: new Date('2026-08-09T19:23:14Z'),
};

const req = (url: string, method = 'GET') => new NextRequest(url, { method });

describe('API: admin release blocklist', () => {
    beforeEach(() => {
        mocks.getToken.mockResolvedValue({ role: 'ADMIN', sub: 'user_1' });
        mocks.blocklistFindMany.mockResolvedValue([ROW]);
        mocks.seriesFindMany.mockResolvedValue([{ metadataId: '160860', name: 'Absolute Superman' }]);
        mocks.blocklistFindUnique.mockResolvedValue(ROW);
        mocks.blocklistDelete.mockResolvedValue(ROW);
    });

    it('lists blocked releases with the series name resolved from the volume id', async () => {
        const res = await GET(req('http://localhost/api/admin/blocklist'));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.entries).toHaveLength(1);
        // A raw provider id is meaningless to the user — the view names the series.
        expect(data.entries[0].seriesName).toBe('Absolute Superman');
        expect(data.entries[0].issueNumber).toBe('6');
        expect(data.entries[0].reason).toContain('Madman');
    });

    it('refuses non-admins', async () => {
        mocks.getToken.mockResolvedValue({ role: 'USER' });
        expect((await GET(req('http://localhost/api/admin/blocklist'))).status).toBe(401);
        expect((await DELETE(req('http://localhost/api/admin/blocklist?id=blk_1', 'DELETE'))).status).toBe(401);
        expect(mocks.blocklistDelete).not.toHaveBeenCalled();
    });

    it('unblocks a release so it can be downloaded again', async () => {
        const res = await DELETE(req('http://localhost/api/admin/blocklist?id=blk_1', 'DELETE'));
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(mocks.blocklistDelete).toHaveBeenCalledWith({ where: { id: 'blk_1' } });
    });

    it('rejects an unblock with no id instead of deleting anything', async () => {
        const res = await DELETE(req('http://localhost/api/admin/blocklist', 'DELETE'));
        expect(res.status).toBe(400);
        expect(mocks.blocklistDelete).not.toHaveBeenCalled();
    });

    it('404s an already-removed entry', async () => {
        mocks.blocklistFindUnique.mockResolvedValue(null);
        const res = await DELETE(req('http://localhost/api/admin/blocklist?id=gone', 'DELETE'));
        expect(res.status).toBe(404);
        expect(mocks.blocklistDelete).not.toHaveBeenCalled();
    });
});
