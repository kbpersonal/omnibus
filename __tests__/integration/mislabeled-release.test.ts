// @vitest-environment node
//
// End-to-end regression for the mislabeled-release import (2026-08-09).
//
// A SAB job named "Absolute Superman 006 (2025) (Digital) (Shan-Empire) (cbz)" actually contained
// "199808 Madman & The Jam 002.cbr". The importer took the series from the request, the issue number
// from the file INSIDE the job, wrote "Absolute Superman #02.cbr", converted it to .cbz and destroyed
// the real issue #2 — then did it again on every monitor tick, because nothing blocklisted the release.
//
// Unlike the unit suite this runs the REAL importer against a REAL filesystem and a REAL Prisma
// database, so the fs writes, the Prisma rows and the blocklist round-trip are all genuine. It creates
// its own throwaway SQLite DB by default; OMNIBUS_E2E_DATABASE_URL permits the exact same test against
// an isolated loopback PostgreSQL instance.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const mocks = vi.hoisted(() => ({ searchAndDownload: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/automation', () => ({ searchAndDownload: mocks.searchAndDownload }));

const TMP = path.join(os.tmpdir(), `omnibus-e2e-${Date.now()}`);
const DB_FILE = path.join(TMP, 'e2e.db');
const EXTERNAL_DATABASE_URL = process.env.OMNIBUS_E2E_DATABASE_URL;
if (EXTERNAL_DATABASE_URL) {
    const host = new URL(EXTERNAL_DATABASE_URL).hostname;
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
        throw new Error('OMNIBUS_E2E_DATABASE_URL must point to an isolated loopback database');
    }
}
const DATABASE_URL = EXTERNAL_DATABASE_URL || `file:${DB_FILE}`;
const PRISMA_SCHEMA = process.env.OMNIBUS_E2E_PRISMA_SCHEMA || 'prisma/schema.prisma';
const DOWNLOADS = path.join(TMP, 'downloads');
const LIBRARY = path.join(TMP, 'library');

const RELEASE = 'Absolute Superman 006 (2025) (Digital) (Shan-Empire) (cbz)';
const PAYLOAD = '199808 Madman & The Jam 002.cbr';
const SERIES_FOLDER = path.join(LIBRARY, 'DC Comics', 'Absolute Superman (2025)');
const REAL_ISSUE_2 = path.join(SERIES_FOLDER, 'Absolute Superman #02.cbz');
const REAL_ISSUE_2_BYTES = Buffer.from('PK\x03\x04 the genuine Absolute Superman #2');

process.env.DATABASE_URL = DATABASE_URL;

let prisma: any;
let Importer: any;
let getBlockedReleases: any;

describe('End to end: a correctly-labelled release containing the wrong comic', () => {
    beforeAll(async () => {
        fs.ensureDirSync(TMP);
        execFileSync('node', [
            './node_modules/prisma/build/index.js', 'db', 'push',
            `--schema=${PRISMA_SCHEMA}`, '--skip-generate', '--accept-data-loss'
        ], { env: { ...process.env, DATABASE_URL }, stdio: 'pipe' });

        ({ prisma } = await import('@/lib/db'));
        ({ Importer } = await import('@/lib/importer'));
        ({ getBlockedReleases } = await import('@/lib/utils/release-blocklist'));

        // The job SAB handed over: right name on the folder, someone else's comic inside it.
        const jobFolder = path.join(DOWNLOADS, RELEASE);
        fs.ensureDirSync(jobFolder);
        fs.writeFileSync(path.join(jobFolder, PAYLOAD), Buffer.from('Rar!\x1a\x07\x00 madman payload'));

        // The library already holds the genuine issue #2 — the file the bad import destroyed.
        fs.ensureDirSync(SERIES_FOLDER);
        fs.writeFileSync(REAL_ISSUE_2, REAL_ISSUE_2_BYTES);

        await prisma.systemSetting.createMany({
            data: [
                { key: 'download_path', value: DOWNLOADS },
                { key: 'folder_naming_pattern', value: '{Publisher}/{Series} ({Year})' },
                { key: 'file_naming_pattern', value: '{Series} #{Issue}' }
            ]
        });
        const library = await prisma.library.create({
            data: { name: 'Comics', path: LIBRARY, isDefault: true }
        });
        const series = await prisma.series.create({
            data: {
                metadataId: '160860', metadataSource: 'COMICVINE', matchState: 'MATCHED',
                name: 'Absolute Superman', year: 2025, publisher: 'DC Comics',
                folderPath: SERIES_FOLDER, libraryId: library.id, monitored: true
            }
        });
        await prisma.issue.createMany({
            data: [1, 2, 3, 4, 5, 6, 7].map(n => ({
                seriesId: series.id,
                number: String(n),
                status: n === 6 ? 'WANTED' : 'DOWNLOADED',
                filePath: n === 2 ? REAL_ISSUE_2 : null,
                metadataId: `unmatched_${n}`
            }))
        });
        await prisma.user.create({
            data: { id: 'user_1', username: 'kartik', email: 'kartik@example.com', password: 'x', role: 'ADMIN' }
        });
    }, 120000);

    afterAll(async () => {
        try { await prisma?.$disconnect(); } catch { /* already closed */ }
        fs.removeSync(TMP);
    });

    it('refuses the import, leaves the real issue intact, blocks the release, and queues another candidate', async () => {
        const req = await prisma.request.create({
            data: {
                userId: 'user_1', volumeId: '160860', metadataSource: 'COMICVINE',
                status: 'DOWNLOADING', activeDownloadName: RELEASE, downloadLink: 'nzb_shan_006'
            }
        });

        const imported = await Importer.importRequest(req.id);

        expect(imported).toBe(false);

        // The genuine issue #2 is byte-for-byte untouched, and no bogus file landed beside it.
        expect(fs.readFileSync(REAL_ISSUE_2)).toEqual(REAL_ISSUE_2_BYTES);
        expect(fs.readdirSync(SERIES_FOLDER)).toEqual(['Absolute Superman #02.cbz']);

        // The original release is gone from the request, and the request is immediately re-queued
        // for a different candidate instead of becoming a dead STALLED row.
        const after = await prisma.request.findUnique({ where: { id: req.id } });
        expect(after.status).toBe('PENDING');
        expect(after.downloadLink).toBeNull();
        expect(after.activeDownloadName).toBe('Absolute Superman #6');
        expect(after.rejectedReleaseCount).toBe(1);
        expect(JSON.parse(after.failedLinks)).toEqual(expect.arrayContaining([RELEASE, 'nzb_shan_006']));
        expect(mocks.searchAndDownload).toHaveBeenCalledWith(req.id, 'Absolute Superman #6', '2025', 'DC Comics', false);

        // Issue #6 stays wanted — it genuinely was not delivered.
        const issue6 = await prisma.issue.findFirst({ where: { number: '6' } });
        expect(issue6.status).toBe('WANTED');
        expect(issue6.filePath).toBeNull();

        // The release is blocked persistently and scoped to this volume…
        const row = await prisma.releaseBlocklist.findFirst({ where: { releaseTitle: RELEASE } });
        expect(row).toBeTruthy();
        expect(row.metadataSource).toBe('COMICVINE');
        expect(row.volumeId).toBe('160860');
        expect(row.downloadLink).toBe('nzb_shan_006');

        // …and the search path picks it up for a BRAND-NEW request, which is what the monitor creates
        // every tick. This is the link that turns one bad import into an endless re-download loop.
        const blocked = await getBlockedReleases('160860');
        expect(blocked).toContain(RELEASE);
        expect(blocked).toContain('nzb_shan_006');
    }, 120000);

    it('is idempotent — a second identical failure does not stack duplicate blocklist rows', async () => {
        const req = await prisma.request.create({
            data: {
                userId: 'user_1', volumeId: '160860', metadataSource: 'COMICVINE',
                status: 'DOWNLOADING', activeDownloadName: RELEASE, downloadLink: 'nzb_shan_006'
            }
        });

        await Importer.importRequest(req.id);

        const rows = await prisma.releaseBlocklist.findMany({ where: { releaseTitle: RELEASE } });
        expect(rows).toHaveLength(1);
    }, 120000);

    it('stops after the third rejected release and leaves the request visibly stalled', async () => {
        const req = await prisma.request.create({
            data: {
                userId: 'user_1', volumeId: '160860', metadataSource: 'COMICVINE',
                status: 'DOWNLOADING', rejectedReleaseCount: 2,
                activeDownloadName: RELEASE, downloadLink: 'nzb_shan_006'
            }
        });

        expect(await Importer.importRequest(req.id)).toBe(false);

        const after = await prisma.request.findUnique({ where: { id: req.id } });
        expect(after?.status).toBe('STALLED');
        expect(after?.rejectedReleaseCount).toBe(3);
        expect(after?.downloadLink).toBeNull();
        expect(mocks.searchAndDownload).not.toHaveBeenCalled();
    }, 120000);

    it('makes a terminal write for a deleted request a no-op', async () => {
        // The detached DDL fallback uses this form after a slow hoster attempt. This is deliberately
        // exercised against the real configured Prisma database (SQLite by default, loopback
        // PostgreSQL when OMNIBUS_E2E_DATABASE_URL is supplied), not a mocked Prisma client.
        const req = await prisma.request.create({
            data: {
                userId: 'user_1', volumeId: '160860', metadataSource: 'COMICVINE',
                status: 'DOWNLOADING', activeDownloadName: 'Dawnrunner #5'
            }
        });

        await prisma.request.delete({ where: { id: req.id } });
        const result = await prisma.request.updateMany({
            where: { id: req.id },
            data: { status: 'MANUAL_DDL', progress: 0 }
        });

        expect(result.count).toBe(0);
        expect(await prisma.request.findUnique({ where: { id: req.id } })).toBeNull();
    }, 120000);
});
