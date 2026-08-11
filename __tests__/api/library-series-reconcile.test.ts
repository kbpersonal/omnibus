import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/library/series/route';

const mocks = vi.hoisted(() => ({
    libraryFindMany: vi.fn(),
    seriesFindFirst: vi.fn(),
    issueFindMany: vi.fn(),
    issueUpdateMany: vi.fn(),
    issueDeleteMany: vi.fn(),
    issueCreateMany: vi.fn(),
    favoriteFindUnique: vi.fn(),
    followFindUnique: vi.fn(),
    progressFindMany: vi.fn(),
    existsSync: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn(),
    getServerSession: vi.fn(),
    logger: vi.fn(),
}));

vi.mock('next-auth/next', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/app/api/auth/[...nextauth]/options', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/library-access', () => ({
    getAccessibleLibraryPaths: vi.fn().mockResolvedValue('ALL'),
    canAccessPath: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/logger', () => ({ Logger: { log: mocks.logger } }));
vi.mock('fs-extra', () => ({
    default: {
        existsSync: mocks.existsSync,
        promises: { readdir: mocks.readdir, access: mocks.access },
    },
}));
vi.mock('@/lib/db', () => ({
    prisma: {
        library: { findMany: mocks.libraryFindMany },
        series: { findFirst: mocks.seriesFindFirst, findMany: vi.fn(), findUnique: vi.fn() },
        issue: {
            findMany: mocks.issueFindMany,
            updateMany: mocks.issueUpdateMany,
            deleteMany: mocks.issueDeleteMany,
            createMany: mocks.issueCreateMany,
        },
        favorite: { findUnique: mocks.favoriteFindUnique },
        seriesFollow: { findUnique: mocks.followFindUnique },
        readProgress: { findMany: mocks.progressFindMany },
        user: { findFirst: vi.fn() },
    },
}));

describe('API Route: Library Series Scan reconciliation', () => {
    const series = {
        id: 'black-science', name: 'Black Science', folderPath: '/library/Black Science (2013)',
        metadataId: '69537', metadataSource: 'COMICVINE', year: 2013,
    };
    const stale = {
        id: 'issue-32', number: '32', metadataId: '628614', metadataSource: 'COMICVINE',
        filePath: '/library/Black Science (2013)/Black Science #32.cbz', status: 'DOWNLOADED',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } });
        mocks.libraryFindMany.mockResolvedValue([{ id: 'library', path: '/library' }]);
        mocks.seriesFindFirst.mockResolvedValue(series);
        mocks.favoriteFindUnique.mockResolvedValue(null);
        mocks.followFindUnique.mockResolvedValue(null);
        mocks.progressFindMany.mockResolvedValue([]);
        mocks.existsSync.mockReturnValue(true);
        mocks.readdir.mockResolvedValue([]);
        mocks.access.mockRejectedValue(new Error('ENOENT'));
        mocks.issueDeleteMany.mockResolvedValue({ count: 0 });
        mocks.issueCreateMany.mockResolvedValue({ count: 0 });
        mocks.issueUpdateMany.mockResolvedValue({ count: 1 });
        // Lightweight map, pre-repair view, and re-read after the repair.
        mocks.issueFindMany
            .mockResolvedValueOnce([stale])
            .mockResolvedValueOnce([stale])
            .mockResolvedValueOnce([{ ...stale, filePath: null, status: 'WANTED' }]);
    });

    it('clears a matched missing file claim so interactive search is no longer disabled', async () => {
        const response = await GET(new Request('http://localhost/api/library/series?path=/library/Black%20Science%20(2013)'));
        expect(response.status).toBe(200);
        expect(mocks.issueUpdateMany).toHaveBeenCalledWith({
            where: { id: { in: ['issue-32'] } },
            data: { filePath: null, status: 'WANTED' },
        });
        await expect(response.json()).resolves.toMatchObject({
            downloadedIssues: [],
            missingIssues: [expect.objectContaining({ id: 'issue-32', fullPath: null })],
        });
    });
});
