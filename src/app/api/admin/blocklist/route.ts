// src/app/api/admin/blocklist/route.ts
//
// Admin view and unblock for the release blocklist. The importer writes these rows itself when it
// refuses a payload that belongs to a different series, and the search path skips every release
// listed here — permanently, across the fresh Request rows the Series Monitor creates each tick.
//
// That is precisely why it needs a UI. Without one a block is invisible: an issue quietly stops
// being downloadable and the only way to see why, or to undo a false positive, is the database.
import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { Logger } from '@/lib/logger';
import { AuditLogger } from '@/lib/audit-logger';
import { getErrorMessage } from '@/lib/utils/error';

export async function GET(req: NextRequest) {
  const token = await getToken({ req });
  if (token?.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await prisma.releaseBlocklist.findMany({ orderBy: { createdAt: 'desc' } });

    // Resolve volumeId → series name so the list reads as "Absolute Superman #6" rather than a
    // provider ID the user has never seen.
    const volumeIds = [...new Set(rows.map(r => r.volumeId).filter(Boolean))] as string[];
    const series = volumeIds.length
      ? await prisma.series.findMany({
          where: { metadataId: { in: volumeIds } },
          select: { metadataId: true, metadataSource: true, name: true }
        })
      : [];
    const nameByVolume = new Map(series.map(s => [`${s.metadataSource}:${s.metadataId}`, s.name]));

    return NextResponse.json({
      entries: rows.map(r => ({
        id: r.id,
        releaseTitle: r.releaseTitle,
        downloadLink: r.downloadLink,
        metadataSource: r.metadataSource,
        seriesName: r.volumeId ? nameByVolume.get(`${r.metadataSource}:${r.volumeId}`) || null : null,
        volumeId: r.volumeId,
        issueNumber: r.issueNumber,
        reason: r.reason,
        createdAt: r.createdAt
      }))
    });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e), entries: [] }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = await getToken({ req });
  if (token?.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  try {
    const row = await prisma.releaseBlocklist.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.releaseBlocklist.delete({ where: { id } });
    Logger.log(`[Blocklist] Unblocked release "${row.releaseTitle}" via admin UI.`, 'info');
    await AuditLogger.log('ADMIN_UNBLOCKED_RELEASE', { releaseTitle: row.releaseTitle }, token.sub as string).catch(() => {});

    return NextResponse.json({ success: true, message: `"${row.releaseTitle}" can be downloaded again.` });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
