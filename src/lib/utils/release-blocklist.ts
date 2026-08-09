// src/lib/utils/release-blocklist.ts
//
// Persistent bad-release blocklist. Request.failedLinks is the only blocklist the search path had, and
// it lives on the Request row — but the Series Monitor creates a BRAND-NEW request every tick for an
// issue it still considers missing, so that list is empty on every retry and a mislabeled release is
// re-downloaded forever. Rows here outlive request churn and are merged into the engine's failed_links.
//
// The engine matches blocklist entries exactly against a result's title, download URL, GUID or
// info-hash (omnibus-engine/src/main.rs), so both the release title and the download link are stored.

import { prisma } from '@/lib/db';
import { Logger } from '@/lib/logger';

export type BlockReleaseInput = {
    releaseTitle: string;
    downloadLink?: string | null;
    volumeId?: string | null;
    issueNumber?: string | null;
    reason: string;
};

/**
 * Record a release as permanently bad for this series. Idempotent — a repeat block of the same
 * (title, volume, issue) is a no-op. Never throws: a blocklist write must not fail an import path.
 */
export async function blockRelease(input: BlockReleaseInput): Promise<void> {
    const releaseTitle = (input.releaseTitle || '').trim();
    if (!releaseTitle) return;

    const volumeId = input.volumeId && input.volumeId !== '0' ? input.volumeId : null;
    const issueNumber = input.issueNumber || null;

    try {
        const existing = await prisma.releaseBlocklist.findFirst({
            where: { releaseTitle, volumeId, issueNumber }
        });
        if (existing) return;

        await prisma.releaseBlocklist.create({
            data: {
                releaseTitle,
                downloadLink: input.downloadLink || null,
                volumeId,
                issueNumber,
                reason: input.reason
            }
        });
        Logger.log(`[Blocklist] Blocked release "${releaseTitle}"${volumeId ? ` for volume ${volumeId}` : ''}: ${input.reason}`, 'info');
    } catch (e: any) {
        Logger.log(`[Blocklist] Failed to block "${releaseTitle}": ${e.message}`, 'warn');
    }
}

/**
 * Titles and download links blocked for a volume, plus globally-blocked entries (volumeId null).
 * Returned flat so callers can concatenate straight into the engine's failed_links payload.
 */
export async function getBlockedReleases(volumeId?: string | null): Promise<string[]> {
    try {
        const scoped = volumeId && volumeId !== '0' ? [{ volumeId }, { volumeId: null }] : [{ volumeId: null }];
        const rows = await prisma.releaseBlocklist.findMany({
            where: { OR: scoped },
            select: { releaseTitle: true, downloadLink: true }
        });
        const out: string[] = [];
        for (const r of rows) {
            if (r.releaseTitle) out.push(r.releaseTitle);
            if (r.downloadLink) out.push(r.downloadLink);
        }
        return out;
    } catch (e: any) {
        Logger.log(`[Blocklist] Lookup failed: ${e.message}`, 'warn');
        return [];
    }
}
