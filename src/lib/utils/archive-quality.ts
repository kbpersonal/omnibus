import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { IMAGE_EXT_REGEX } from '@/lib/utils/formats';

const ZIP_ARCHIVE_REGEX = /\.(cbz|zip)$/i;
const MIN_PAGE_HEIGHT_RATIO = 0.8;

export type ArchiveQualityIssue = {
    code: 'undersized-page' | 'unreadable-page' | 'unreadable-archive';
    entryName?: string;
    width?: number;
    height?: number;
    dominantHeight?: number;
    message: string;
};

export type ArchiveQuality =
    | { ok: true; checked: boolean }
    | { ok: false; checked: true; issue: ArchiveQualityIssue };

type PageDimensions = {
    entryName: string;
    width: number;
    height: number;
};

function isPageEntry(entry: any): boolean {
    const name = String(entry.entryName || '');
    const lower = name.toLowerCase();
    return !entry.isDirectory && !lower.includes('__macosx') && IMAGE_EXT_REGEX.test(name);
}

/**
 * Check the cheap, structural image-quality failure that has slipped through GetComics: a valid CBZ
 * whose last few entries include a short strip/partial page. This is deliberately a geometry check,
 * not a fixed-resolution check — normal releases contain double-page spreads and different scanners
 * use different resolutions. RAR/7z are inspected by the engine and are left for that path.
 */
export async function inspectArchiveQuality(filePath: string | null | undefined): Promise<ArchiveQuality> {
    if (!filePath || !ZIP_ARCHIVE_REGEX.test(filePath) || !fs.existsSync(filePath)) {
        return { ok: true, checked: false };
    }

    try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries().filter(isPageEntry);

        // A single page is not enough evidence to infer a dominant page geometry. Leave that case
        // to the reader/importer's existing archive checks rather than inventing a false positive.
        if (entries.length < 2) return { ok: true, checked: true };

        const dimensions: PageDimensions[] = [];
        for (const entry of entries) {
            try {
                const metadata = await sharp(entry.getData()).metadata();
                if (!metadata.width || !metadata.height) {
                    return {
                        ok: false,
                        checked: true,
                        issue: {
                            code: 'unreadable-page',
                            entryName: entry.entryName,
                            message: `page ${entry.entryName} has no readable dimensions`
                        }
                    };
                }
                dimensions.push({ entryName: entry.entryName, width: metadata.width, height: metadata.height });
            } catch (error: any) {
                return {
                    ok: false,
                    checked: true,
                    issue: {
                        code: 'unreadable-page',
                        entryName: entry.entryName,
                        message: `page ${entry.entryName} could not be decoded: ${error?.message || 'unknown image error'}`
                    }
                };
            }
        }

        const heightCounts = new Map<number, number>();
        for (const page of dimensions) heightCounts.set(page.height, (heightCounts.get(page.height) || 0) + 1);
        const dominantHeight = [...heightCounts.entries()]
            .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];

        const undersized = dimensions.find(page => page.height < dominantHeight * MIN_PAGE_HEIGHT_RATIO);
        if (undersized) {
            return {
                ok: false,
                checked: true,
                issue: {
                    code: 'undersized-page',
                    entryName: undersized.entryName,
                    width: undersized.width,
                    height: undersized.height,
                    dominantHeight,
                    message: `page ${undersized.entryName} is ${undersized.width}x${undersized.height}, but this archive's normal page height is ${dominantHeight}px`
                }
            };
        }

        return { ok: true, checked: true };
    } catch (error: any) {
        return {
            ok: false,
            checked: true,
            issue: {
                code: 'unreadable-archive',
                message: `archive could not be inspected: ${error?.message || 'unknown archive error'}`
            }
        };
    }
}
