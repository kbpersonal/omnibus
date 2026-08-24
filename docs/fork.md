# killinit omnibus fork

Local changes carried on top of upstream `hankscafe/omnibus` (GPL-3.0); this fork stays GPL.

Current stack references:

- [Stack evaluation](stack-evaluation.md) — evidence-backed current state, live checks, and follow-up limits.
- [Zero-technical-user guide](user-guide-books-and-comics.md) — how people request and read comics, manga, ebooks, and audiobooks.
- [ADR 0002: acquisition and reader boundaries](adr/0002-acquisition-and-reader-boundaries.md) — why each library tree has one owner and one reader.

What the fork currently carries:

- **Manga via Suwayomi** — per-user manga requests backed by
  [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server) instead of the Rust engine's
  Prowlarr/GetComics path, with Komga serving the result. The largest change, detailed below.
- **Mislabeled-release protection** — an import is refused when the archive inside the payload
  belongs to a different series than the one requested, and the release is blocklisted so the
  monitor cannot re-download it on the next tick.
- **Cluster fixes** — engine retries for node callbacks and pod-relative paths, and admins can
  retry interactive searches.

## Why manga needed a fork

Stock Omnibus has a single `autoApproveRequests` flag covering both comics and manga, plus a global
`manga_requests_enabled` on/off — so "comics need approval, manga are automatic" cannot be
expressed. And its only acquisition path is the Rust engine, which searches comic indexers rather
than scanlation sources.

The goal is zero reviewer work for manga: a user requests a title, Suwayomi acquires it and keeps
acquiring new chapters forever, Komga serves it with the correct reading direction.

## Branch and tag conventions

**`main` on this fork is the development line, and it is what the cluster runs.** The manga work was
merged into it and the `manga` topic branch has been deleted. Build new work on `main`. In the
maintainer checkout, `origin` is the upstream `hankscafe/omnibus` repository and `fork` is the
writable `kbpersonal/omnibus` repository; fetch `origin` for comparisons and push `fork main` for
fork releases. Do not pull upstream directly into the deployed line without checking the fork
features first.

Pushing `main` builds `:latest` and `:v<package.json version>`, cuts a GitHub Release tagged
`v<package.json version>`, and announces it to Discord. The fork uses a four-component build
identifier tied to upstream: upstream `1.4.4` becomes `1.4.4.1`, then `1.4.4.2` for another fork
build on the same upstream base. The third component changes only when a newer upstream release is
merged. Do not flatten fork builds into `1.4.11`: that makes a fork build look newer than a future
upstream `1.4.5` and prevents reliable update ordering.

This format is deliberately not strict SemVer. Treat it as the fork's ordered build identifier and
keep the value identical in `package.json`, `package-lock.json`, the Git tag, both GHCR image tags,
and the pinned Ottawa manifest. The complete release and E2E promotion procedure is recorded in
[ADR 0001](adr/0001-fork-build-and-promotion.md).

`km-<upstream-version>-<n>` (`km` = killinit-manga) tags stay available for builds you want off the
release path, for example `km-1.4.3-2`. A `km-*` tag publishes `type=sha` / `type=ref` images only:
no `:latest`, no GitHub Release, no Discord announcement.

### Current upstream comparison

As of 2026-08-24, upstream `origin/main` is `6c63779` (`v1.4.4`), the fork `main` is `f573552`
(31 commits ahead), and the deployed fork code is `v1.4.4.4` at `088fa08`. The commits after the
deployed code are documentation-only follow-ups, so the Ottawa manifests still pin `088fa08`. There
are no upstream-main commits missing from the fork. Upstream `origin/dev` has three unreleased
v1.4.5 beta commits. They include useful annual-numbering and dependency work, but the annual change
overlaps fork-owned schema/importer/API files; merging the branch wholesale would also remove the
fork's Suwayomi integration, manga statuses, blocklist, and fork documentation. Wait for a stable
upstream release and port compatible changes deliberately after re-running the fork's tests. In
particular, beta.001 introduces the annual-numbering schema and broad parser/reconciler changes,
beta.003 depends on that schema to heal bare rows from ComicInfo, and beta.002 is a security-worthy
dependency refresh that must be applied under the fork's four-component build version rather than
merging its `1.4.5-beta.002` package version into the deployed line.

### Rebasing onto a new upstream release

`git rebase v<version> main`, then re-run `npm ci && npx prisma generate` (the Prisma client has to
be regenerated for `autoApproveManga`) before `npm test`. Check the deployed image tag in the
cluster manifest first — the fork must be rebased onto **at least** the version already running, or
deploying it silently downgrades everything else.

Note that 13 upstream component tests across four files — `library-page`, `smart-match-page-search`,
`comic-grid` and `profile-updates-section` — fail on stock v1.4.3 as well (`localStorage` is
undefined under the suite's default node environment). They are not caused by this fork.

### Workflow changes (`.github/workflows/docker-publish.yml`)

Two edits, both fork-only:

1. `manga` added to `push.branches` and `km-*` to `push.tags`, so the fork can publish from a topic
   branch or a `km-*` tag as well as from `main`. Every release, `:latest`, and Docker Hub step is
   separately gated on `refs/heads/main`, so those two triggers publish `type=sha` and `type=ref`
   images only.
2. The Docker Hub login step and image line are removed. The fork has no `DOCKERHUB_*` secrets, and
   `docker/login-action` fails on an empty username — which would fail the job before the GHCR push.
   GHCR is the only registry this fork publishes to.

`IMAGE_NAME: ${{ github.repository }}` is interpolated, so both the web and `-engine` images
publish to this fork's GHCR automatically with no further edits.

## Where the fork touches upstream

Kept deliberately small so rebasing stays cheap. Almost all of it is TypeScript; the Rust engine
carries one change (`git diff v<upstream-version> main -- omnibus-engine/` lists it).

| Area | Files |
|---|---|
| Per-user manga approval | `prisma/schema.prisma`, `src/lib/db-init.ts`, `src/lib/permission-tiers.ts`, `src/app/api/admin/users/route.ts`, `src/app/admin/users/page.tsx` |
| Request gate | `src/app/api/request/route.ts` |
| Manga acquisition branch | `src/lib/queue.ts`, `src/lib/suwayomi.ts` (new) |
| AniList metadata | `src/lib/manga-detector.ts` |
| Source-priority setting | `src/app/api/admin/suwayomi-sources/route.ts` (new), `src/app/admin/settings/tabs/` |
| Reading direction | `src/lib/komga.ts` (new) |
| New request statuses | the status maps listed in `src/app/**` and `src/components/**` |
| Mislabeled-release guard | `src/lib/importer.ts`, `src/lib/utils/release-match.ts` (new), `src/lib/utils/release-blocklist.ts` (new), `prisma/schema.prisma`, `src/lib/queue.ts`, `src/app/api/request/retry/route.ts` |
| Engine log forwarding and pod paths | `omnibus-engine/src/log_forward.rs`, `omnibus-engine/src/main.rs` |

## Design intent

**Omnibus is a GUI application. Anything the software decides must be visible and reversible in the
UI.** Nobody edits the database to operate this app, so a feature is not finished when its logic
works — it is finished when a user can see what it did, understand why, and undo it without leaving
the interface.

Concretely, for any change:

- State the software creates on its own — a blocked release, a stalled request, a quarantined file —
  gets a view that lists it, the reason it happened, and when.
- Every automatic decision gets a manual override. If the software can refuse something, a user must
  be able to allow it anyway.
- No hidden state. If behaviour changes because of a stored row, that row is inspectable in the UI.
- "Fix it in the database" is never the answer offered to a user, and never the answer built toward.
  If that is the only recourse, the feature is incomplete.

This is why the release blocklist ships with an admin view and an Unblock button rather than a bare
table: the guard that writes those rows can be wrong, and a wrong guess must not become a silent,
permanent hole in someone's library with no visible cause.

## Design notes worth keeping

- **Suwayomi cannot search across sources.** `FetchSourceMangaInput.source` is a single `Long`, and
  the only cross-source function is an unimplemented stub. The fork owns the loop over an
  admin-ordered source list.
- **Source IDs are per-install opaque snowflakes** returned as strings, so the priority list is
  never seeded — it is populated from a live dropdown fed by the `sources` query.
- **Matching is exact-after-normalization, and a source "hits" only on exactly one match.** Zero or
  two-plus matches fall through to the next source; if nothing matches cleanly the request becomes
  `NEEDS_SOURCE` rather than grabbing something wrong. This ambiguity guard is what makes
  auto-approve safe.
- **Reading direction is set via Komga's API with `readingDirectionLock: true`.** Suwayomi writes no
  `<Manga>` element in ComicInfo, so Komga's metadata provider supplies `readingDirection = null` on
  every scan — without the lock, the next scan wipes it. ComicInfo also cannot express webtoon, so
  manhwa/manhua can only get the right direction via the API.
- **No progress polling.** Suwayomi self-maintains ongoing series, so there is no meaningful
  "IMPORTED" moment. `MONITORED_SUWAYOMI` is terminal.

## Environment

| Var | Purpose | Default |
|---|---|---|
| `SUWAYOMI_URL` | Suwayomi GraphQL endpoint | `http://127.0.0.1:4567` |
| `KOMGA_URL` | Komga REST endpoint | `http://127.0.0.1:25600` |
| `KOMGA_API_KEY` | Komga **admin** API key; the series metadata PATCH requires `ROLE_ADMIN` | unset (reading direction is skipped) |
