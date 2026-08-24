# Books and comics stack evaluation

**Audit date:** 2026-08-24
**Scope:** the `omnibus` fork and the Ottawa manifests that deploy it.
**Live image:** `ghcr.io/kbpersonal/omnibus:v1.4.4.3` and its matching engine image.

## Verdict

- **Western comics:** working in production. Omnibus writes comics, Komga reads them, and the live
  Komga watcher has triggered successful scans for newly changed CBZ files.
- **Manga:** the fork’s code path is internally covered and the live Suwayomi, Komga, and source
  configuration are healthy. A real manga acquisition has not been completed yet because the live
  manga directory is empty. The first configured source was slow during a read-only search, so the
  ordered fallback is important.
- **Ebooks:** the wiring is correct and Shelfmark has live destinations configured. BookOrbit has a
  library and is scanning it, but there are currently no files or books to prove the final handoff.
- **Audiobooks:** Shelfmark has a live audiobook destination, but Audiobookshelf currently has zero
  libraries configured. The audiobook reader needs one library pointing at that destination before
  this path can work.

This is an evaluation, not a release promotion. The local fixes described below are not in the
currently deployed `v1.4.4.3` image.

## Ownership model

```text
Omnibus  ──writes──> /media-share/omnibus-comics ──read-only──> Komga
Suwayomi ──writes──> /media-share/suwayomi-manga ──read-only──> Komga
Shelfmark ──writes──> /media-share/bookorbit-bookdrop ──imports──> BookOrbit
Shelfmark ──writes──> /media-share/audiobookshelf-audiobooks ──reads──> Audiobookshelf
```

The shared SMB PVC is 20 TiB and is bound in Ottawa. Komga is the only picture-content reader;
BookOrbit is the ebook reader; Audiobookshelf is the audiobook reader. No reader should be made a
second writer for one of these trees.

## Repository and deployment baseline

- The audit baseline for `omnibus` is `main` at fork build `v1.4.4.3` (`5431e21`). Its configured
  `origin/main` has no commits ahead of the local fork; the local fork is 25 commits ahead of that
  upstream, and `fork/main` points at the local fork HEAD.
- The audit baseline for `kubernetes-manifests` is `main` at `53f96b1a6`, equal to `origin/main`.
- This working session intentionally leaves the new fork code/docs and the pre-existing unrelated
  CLIProxy manifest edits uncommitted for review.
- The six stack deployments—Omnibus, Suwayomi, Komga, Shelfmark, BookOrbit, and Audiobookshelf—are
  ready in Ottawa. Suwayomi and Komga also have ready watcher sidecars.
- Their HTTPRoutes report `Accepted=True` and `ResolvedRefs=True` for the private, tailnet, and
  public parents they use.
- The live Omnibus setup endpoint reports `requiresSetup:false`. The live Omnibus/engine handshake,
  Pi-bridge metadata assertion, and CLIProxy recovery gate were already verified before this audit.

## Omnibus → Komga: western comics

The normal comic request path is:

1. A user requests a comic in Omnibus.
2. Omnibus sends the request through its Rust engine/indexer and downloader path.
3. The importer writes the result under `/media-share/omnibus-comics`.
4. The Komga watcher notices settled CBZ changes and calls the Komga scan API.
5. Komga serves the series and owns reading progress.

Live evidence: `/media-share/omnibus-comics` contains 317 files, and recent watcher logs show scans
triggered successfully for JLA and Absolute Batman files. The live Omnibus database has one `Main
Comics` library at that path and 12 western series. This is the validated path.

The fork also refuses mislabeled releases and persists the rejected release in a blocklist so the
series monitor cannot immediately choose the same bad payload again.

## Omnibus → Suwayomi → Komga: manga

The manga path deliberately avoids comic indexers:

1. Omnibus detects manga and applies the separate `autoApproveManga` permission.
2. The request becomes a Suwayomi queue job rather than a Rust comic search.
3. The worker loads the canonical series title, resolves AniList metadata, and walks the administrator’s
   ordered English Suwayomi sources.
4. A source is accepted only when exactly one result matches the normalized title. A dead source,
   zero matches, or ambiguous matches falls through to the next source.
5. The match is added to Suwayomi and its chapters are enqueued. Suwayomi continues checking for new
   chapters, so `MONITORED_SUWAYOMI` is the terminal request state.
6. Suwayomi writes CBZ files under `/media-share/suwayomi-manga`; its watcher asks Komga to scan them.
7. Omnibus applies the Japanese/webtoon reading direction to Komga with a lock so a later scan does
   not erase it.

Live configuration has manga requests enabled and seven ordered English sources: Comix, Mangadotnet,
Atsumaru, Manga Ball, OniSaga, Aqua Manga, and MangaFire. Suwayomi reports 178 sources, 29 English
sources, and a healthy GraphQL endpoint. The manga storage directory is currently empty, so the
acquisition-to-reader handoff remains a human test step.

A read-only `Chainsaw Man` search against the first configured source (`Comix EN`) timed out at its
upstream WebView. The resolver is designed to continue to later sources; reorder the source after a
real test if it remains slow or unhealthy.

### Local fixes made during this audit

- Manga retries now requeue through Suwayomi instead of entering the generic comic/DDL recovery path.
- A retry uses the stored canonical series title, not an issue label such as `Chainsaw Man #1`.
- `NEEDS_SOURCE` is now visible in the admin queue, includes its reason, and has a source-search retry
  action. The user request page explains the status and provides a dedicated filter.

Regression coverage now includes retry routing, canonical-title worker behavior, no-source handling,
dead-source fallback, ambiguity protection, exact matching, and chapter enqueueing.

## Shelfmark → BookOrbit: ebooks

Shelfmark is the downloader/request screen for both ebooks and audiobooks. Its live configuration is:

- ebook destination: `/media-share/bookorbit-bookdrop`
- audiobook destination: `/media-share/audiobookshelf-audiobooks`
- ebook organization: author/title folders
- audiobook organization: author/title/title folders
- Prowlarr is the default release source for both types
- qBittorrent categories are `books` and `audiobooks`
- OIDC is enabled and onboarding is complete

BookOrbit mounts the same shared media PVC, uses `/media-share/bookorbit-bookdrop` as its book-drop
path, and browses `/media-share`. Its live PostgreSQL state has one watched `Books` library:

```text
library: Books
root:    /media-share/bookorbit-books
scan:    automatic every 300 seconds
books:   0
files:   0
```

The drop folder and the BookOrbit library folder both exist and are empty. Five previous BookOrbit
scans completed without errors and found zero candidates. The handoff is therefore configured but
not content-tested. A real ebook request is needed to verify that BookOrbit’s book dock moves the
download from `bookorbit-bookdrop` into `bookorbit-books` and indexes it.

## Shelfmark → Audiobookshelf: audiobooks

Shelfmark’s audiobook destination exists and is mounted by both applications. Audiobookshelf is
healthy and its database is readable, but its live database contains three users and **zero libraries**,
zero books, and zero podcasts. No audiobook can appear until an administrator creates an
Audiobookshelf library rooted at:

```text
/media-share/audiobookshelf-audiobooks
```

That is an application setup task, not a Kubernetes change. Do it in Audiobookshelf’s Library
settings, then request one audiobook in Shelfmark and confirm the resulting folder appears in the
library. Do not point Audiobookshelf at Shelfmark’s ebook or BookOrbit directories.

## Access and client model

- Shelfmark is a browser app behind the private/tailnet routes and signs users in with tinyauth OIDC.
- BookOrbit’s browser/PWA route uses its own OIDC login. Its Kobo, KOReader, and OPDS endpoints are
  separately exposed because those clients cannot carry a browser cookie; they authenticate
  themselves.
- Audiobookshelf is public/private/tailnet reachable and performs its own OIDC login, including the
  mobile PKCE flow. Do not add an edge cookie gate in front of its native app.
- Komga is the ungated picture reader. Users need a Komga username/password; KOReader uses Komga’s
  OPDS v1 catalog, not OPDS v2.

The full plain-language flow is in [User guide: books and comics](user-guide-books-and-comics.md).

## Open validation items

1. Promote a build containing the local manga retry/title and UI fixes, then perform one real manga
   request and confirm a CBZ appears in Suwayomi’s directory and then in Komga.
2. Test one ebook end to end and confirm BookOrbit’s book-drop import into `/media-share/bookorbit-books`.
3. Create the Audiobookshelf library at the configured audiobook destination, then test one audiobook.
4. Re-test the first Suwayomi source or move it below a responsive source if its WebView timeout persists.
5. `npm test` previously hung after reporting the skipped integration suite and was stopped; targeted
   manga, queue, and retry suites pass. The full-suite open-handle issue still needs separate diagnosis.
