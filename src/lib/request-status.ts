// src/lib/request-status.ts
//
// Display helpers for the manga request statuses added by the Suwayomi path. Request.status is a
// free-form string rather than a DB enum, so these values need no migration — only the UI has to
// learn to render them.
//
// Isomorphic (no server-only imports) so client pages and server routes can both use it.

/** Terminal success for a manga request: Suwayomi owns it from here and keeps pulling new chapters. */
export const MONITORED_SUWAYOMI = 'MONITORED_SUWAYOMI';

/** No sources configured, or no source produced a single confident match. Needs a human. */
export const NEEDS_SOURCE = 'NEEDS_SOURCE';

/** Statuses that mean "this request is settled" for counting/filtering purposes. */
export const MANGA_TERMINAL_STATUSES = [MONITORED_SUWAYOMI];

/** Human label for a request status. Falls back to the raw value for anything unrecognized. */
export function requestStatusLabel(status: string): string {
    switch (status) {
        case 'PENDING_APPROVAL': return 'Needs Approval';
        case MONITORED_SUWAYOMI: return 'Monitored';
        case NEEDS_SOURCE: return 'Needs Source';
        default: return status;
    }
}

/** Badge classes for a request status, matching the palette already used across the request views. */
export function requestStatusColor(status: string): string {
    if (['IMPORTED', 'COMPLETED'].includes(status)) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800';
    if (status === 'DOWNLOADING') return 'bg-primary/20 text-primary border-primary/30';
    if (status === 'PENDING_APPROVAL') return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800';
    if (status === 'UNRELEASED') return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800';
    // Monitored reads as success — the user's request is fulfilled even though nothing "completed".
    if (status === MONITORED_SUWAYOMI) return 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400 border-sky-200 dark:border-sky-800';
    // Needs Source is an admin to-do, not an error: the request is parked, not failed.
    if (status === NEEDS_SOURCE) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800';
    return 'bg-muted text-foreground border-border';
}
