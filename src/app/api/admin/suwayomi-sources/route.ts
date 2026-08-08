// src/app/api/admin/suwayomi-sources/route.ts
//
// Admin-only proxy for Suwayomi's installed source list, used to populate the manga source-priority
// dropdown in Settings.
//
// This is fetched live rather than seeded because source IDs are per-install opaque snowflakes — the
// same source has a different ID on every server — and names alone are ambiguous (MangaDex appears
// once per language). A hardcoded list would be wrong on any other install.
import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { listSources } from '@/lib/suwayomi';
import { getErrorMessage } from '@/lib/utils/error';

export async function GET(req: NextRequest) {
  const token = await getToken({ req });
  if (token?.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sources = await listSources();
    // English first (the stated reading preference), then by display name.
    sources.sort((a, b) => {
      if (a.lang !== b.lang) {
        if (a.lang === 'en') return -1;
        if (b.lang === 'en') return 1;
        return a.lang.localeCompare(b.lang);
      }
      return a.displayName.localeCompare(b.displayName);
    });
    return NextResponse.json({ sources });
  } catch (e) {
    // The caller keeps showing the stored selection and renders this as a banner — a Suwayomi
    // outage must never look like "you have no sources configured".
    return NextResponse.json({ error: getErrorMessage(e), sources: [] }, { status: 502 });
  }
}
