// src/lib/automation.ts
// The live search path is the Rust engine: searchAndDownload() enqueues a BullMQ
// SEARCH_AND_DOWNLOAD job, and queue.ts forwards it to the engine's /api/automation/search.
// The legacy full-Node search (executeSearchAndDownload) was removed as dead code.

import { randomUUID } from 'crypto';

let nextAvailableSearchTime = Date.now();

export async function searchAndDownload(requestId: string, name: string, year: string, publisher?: string, isManga: boolean = false, skipIndexers: boolean = false) {
  const now = Date.now();
  if (nextAvailableSearchTime < now) {
      nextAvailableSearchTime = now;
  }
  const delayMs = nextAvailableSearchTime - now;
  nextAvailableSearchTime += 5000;

  const { omnibusQueue } = await import('@/lib/queue');
  await omnibusQueue.add('SEARCH_AND_DOWNLOAD', {
    type: 'SEARCH_AND_DOWNLOAD',
    requestId, name, year, publisher, isManga, skipIndexers
  }, {
    // Completed jobs are retained for debugging. Reusing SEARCH_<requestId> made BullMQ return
    // the completed job on a retry, silently discarding the new search.
    jobId: `SEARCH_${requestId}_${randomUUID()}`,
    delay: delayMs
  });
}

export async function processAutomationQueue(items: any[]) {
  for (const item of items) {
    await searchAndDownload(item.id, item.name, item.year, item.publisher, item.isManga, item.skipIndexers);
  }
}
