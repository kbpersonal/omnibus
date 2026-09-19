import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { inspectArchiveQuality } from '@/lib/utils/archive-quality';

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnibus-archive-quality-'));
});

afterEach(async () => {
    await fs.remove(root).catch(() => {});
});

async function image(width: number, height: number): Promise<Buffer> {
    return sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 20, g: 40, b: 60 }
        }
    }).jpeg().toBuffer();
}

async function buildCbz(name: string, dimensions: Array<[number, number]>): Promise<string> {
    const zip = new AdmZip();
    for (const [index, [width, height]] of dimensions.entries()) {
        zip.addFile(`page_${String(index + 1).padStart(4, '0')}.jpg`, await image(width, height));
    }
    const filePath = path.join(root, name);
    zip.writeZip(filePath);
    return filePath;
}

describe('inspectArchiveQuality', () => {
    it('rejects a valid CBZ with a cut-off tail page', async () => {
        const filePath = await buildCbz('bad-latest.cbz', [
            [800, 1280], [800, 1280], [800, 1280], [800, 1280],
            [800, 660], [1280, 1968]
        ]);

        await expect(inspectArchiveQuality(filePath)).resolves.toMatchObject({
            ok: false,
            issue: expect.objectContaining({
                entryName: 'page_0005.jpg',
                width: 800,
                height: 660
            })
        });
    });

    it('accepts normal pages and intentional double-width spreads', async () => {
        const filePath = await buildCbz('good.cbz', [
            [1988, 3057], [1988, 3056], [3975, 3057], [1988, 3057]
        ]);

        await expect(inspectArchiveQuality(filePath)).resolves.toEqual({ ok: true, checked: true });
    });

    it('does not reject formats that the importer does not inspect here', async () => {
        await expect(inspectArchiveQuality('/comics/book.cbr')).resolves.toEqual({ ok: true, checked: false });
    });
});
