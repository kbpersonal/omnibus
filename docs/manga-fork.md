# killinit manga fork

This fork adds per-user manga requests backed by [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server)
instead of the Rust engine's Prowlarr/GetComics path. Komga serves the result.

Upstream is `hankscafe/omnibus` (GPL-3.0); this fork stays GPL.

## Why

Stock Omnibus has a single `autoApproveRequests` flag covering both comics and manga, plus a global
`manga_requests_enabled` on/off — so "comics need approval, manga are automatic" cannot be
expressed. And its only acquisition path is the Rust engine, which searches comic indexers rather
than scanlation sources.

The goal is zero reviewer work for manga: a user requests a title, Suwayomi acquires it and keeps
acquiring new chapters forever, Komga serves it with the correct reading direction.

## Branch and tag conventions

The manga work has been merged into this fork's **`main`**, and `main` is the branch the cluster
actually runs: it builds `:latest` and `:v<package.json version>`, and the deployed image is one of
those digests. `manga` is kept as the topic branch the feature landed from and now trails `main`.
Build new work on `main`.

Pushing `main` has two side effects worth knowing before you do it: it cuts a GitHub Release tagged
`v<package.json version>` — the same namespace upstream uses, so bump the version first or the
release step is skipped — and it announces that release to Discord.

`km-<upstream-version>-<n>` (`km` = killinit-manga) tags remain available for builds you want off
the release path entirely, for example `km-1.4.3-2`. A `km-*` tag publishes `type=sha` / `type=ref`
images only: no `:latest`, no GitHub Release, no Discord announcement. The prefix can never collide
with an upstream `v*` tag and it records which upstream release the fork is carrying.

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

Kept deliberately small so rebasing stays cheap. Everything is TypeScript — the Rust engine is
untouched.

| Area | Files |
|---|---|
| Per-user manga approval | `prisma/schema.prisma`, `src/lib/db-init.ts`, `src/lib/permission-tiers.ts`, `src/app/api/admin/users/route.ts`, `src/app/admin/users/page.tsx` |
| Request gate | `src/app/api/request/route.ts` |
| Manga acquisition branch | `src/lib/queue.ts`, `src/lib/suwayomi.ts` (new) |
| AniList metadata | `src/lib/manga-detector.ts` |
| Source-priority setting | `src/app/api/admin/suwayomi-sources/route.ts` (new), `src/app/admin/settings/tabs/` |
| Reading direction | `src/lib/komga.ts` (new) |
| New request statuses | the status maps listed in `src/app/**` and `src/components/**` |

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
