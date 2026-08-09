// @vitest-environment node
//
// End-to-end regression for the mislabeled-release import (2026-08-09).
//
// A SAB job named "Absolute Superman 006 (2025) (Digital) (Shan-Empire) (cbz)" actually contained
// "199808 Madman & The Jam 002.cbr". The importer took the series from the request, the issue number
// from the file INSIDE the job, wrote "Absolute Superman #02.cbr", converted it to .cbz and destroyed
// the real issue #2 — then did it again on every monitor tick, because nothing blocklisted the release.
//
// Unlike the unit suite this runs the REAL importer against a REAL filesystem and a REAL SQLite
// database, so the fs writes, the Prisma rows and the blocklist round-trip are all genuine. It creates
// its own throwaway DB + temp dirs and removes them afterwards.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const TMP = path.join(os.tmpdir(), `omnibus-e2e-${Date.now()}`);
const DB_FILE = path.join(TMP, 'e2e.db');
const DOWNLOADS = path.join(TMP, 'downloads');
const LIBRARY = path.join(TMP, 'library');

const RELEASE = 'Absolute Superman 006 (2025) (Digital) (Shan-Empire) (cbz)';
const PAYLOAD = '199808 Madman & The Jam 002.cbr';
const SERIES_FOLDER = path.join(LIBRARY, 'DC Comics', 'Absolute Superman (2025)');
const REAL_ISSUE_2 = path.join(SERIES_FOLDER, 'Absolute Superman #02.cbz');
const REAL_ISSUE_2_BYTES = Buffer.from('PK\x03\x04 the genuine Absolute Superman #2');

process.env.DATABASE_URL = `file:${DB_FILE}`;

let prisma: any;
let Importer: any;
let getBlockedReleases: any;

describe('End to end: a correctly-labelled release containing the wrong comic', () => {
    beforeAll(async () => {
        fs.ensureDirSync(TMP);
        execFileSync('node', [
            './node_modules/prisma/build/index.js', 'db', 'push',
            '--schema=prisma/schema.prisma', '--skip-generate', '--accept-data-loss'
        ], { env: { ...process.env, DATABASE_URL: `file:${DB_FILE}` }, stdio: 'pipe' });

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

    it('refuses the import, leaves the real issue intact, and blocks the release for good', async () => {
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

        // The request is parked instead of being closed out as a success.
        const after = await prisma.request.findUnique({ where: { id: req.id } });
        expect(after.status).toBe('STALLED');

        // Issue #6 stays wanted — it genuinely was not delivered.
        const issue6 = await prisma.issue.findFirst({ where: { number: '6' } });
        expect(issue6.status).toBe('WANTED');
        expect(issue6.filePath).toBeNull();

        // The release is blocked persistently and scoped to this volume…
        const row = await prisma.releaseBlocklist.findFirst({ where: { releaseTitle: RELEASE } });
        expect(row).toBeTruthy();
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
});
