# Books and comics stack evaluation

**Audit date:** 2026-08-24
**Scope:** the `omnibus` fork and the Ottawa manifests that deploy it.
**Live image:** `ghcr.io/kbpersonal/omnibus:v1.4.4.4` and its matching engine image,
promoted from commit `088fa08` and digest-pinned in the Ottawa manifests.

## Verdict

- **Western comics:** working in production. Omnibus writes comics, Komga reads them, and the live
  Komga watcher has triggered successful scans for newly changed CBZ files.
- **Manga:** working end to end in production. A real `Look Back` request resolved through Comix
  (EN), enqueued two Suwayomi chapters, produced two CBZ files, triggered both watcher scans, and
  appeared in Komga with locked right-to-left reading direction.
- **Ebooks:** working end to end, with an administrator action required for the tested CIFS case.
  Shelfmark delivered a real `.mobi` to the drop folder; BookOrbit's supported administrator rescan
  created the Book Dock record, fetched metadata, and the administrator finalized it into the Books
  library. The drop folder is empty and the book is present at its final path. The CIFS watcher did
  not notice the settled file by itself, and the 75% match stayed below the 85% auto-finalize
  threshold, so this is not yet a hands-off automatic-import claim.
- **Audiobooks:** working end to end. Audiobookshelf now has a library rooted at the configured
  destination. A real 48-file audiobook reached that directory and was indexed; that first run
  exposed a Shelfmark organization setting that was fixed live. A second release after the fix was
  placed in an author/title folder and indexed. A new multi-file release after the fix is still a
  useful follow-up test.

This is an evaluation of the promoted build. The remaining gaps are operational caveats and focused
follow-up tests, not missing Omnibus code.

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

- The deployed Omnibus code baseline is fork build `v1.4.4.4` (`088fa08`). The current fork `main`
  is `f573552`, 31 commits ahead of upstream `origin/main` `6c63779` (`v1.4.4`), with no upstream
  `main` commits missing. The additional commits after `088fa08` are documentation-only; the
  manifests still pin the tested build. Upstream `origin/dev` contains three unreleased v1.4.5
  beta commits. Its annual-numbering work overlaps fork files and depends on a schema change, and
  taking the branch wholesale would remove the fork's Suwayomi path and fork documentation. It was
  therefore reviewed but not merged; wait for a stable upstream release and port compatible work
  deliberately.
- The audit baseline for `kubernetes-manifests` is `main` at `ec3bf9649`, equal to `origin/main`.
  The worktree is clean. The latest commit is the separate CLIProxy fallback promotion; it is
  deployed and does not change the books/comics stack.
- The six stack deployments—Omnibus, Suwayomi, Komga, Shelfmark, BookOrbit, and Audiobookshelf—are
  1/1 ready in Ottawa. Suwayomi and Komga also have ready watcher sidecars. Suwayomi has one
  historical container restart from seven days earlier, but is currently 2/2 ready with no active
  failure.
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
Atsumaru, Manga Ball, OniSaga, Aqua Manga, and MangaFire. Suwayomi reports 178 sources and 29
English sources. The first configured source resolved the live test title.

The live `Look Back` evidence is:

- Omnibus logged a Comix (EN) match, two chapters enqueued, and `MONITORED_SUWAYOMI`.
- Suwayomi database row `477` is `in_library=true` with two chapters; the shared manga tree has
  two CBZ files.
- The Suwayomi watcher waited for file settlement and triggered Komga scans for both files.
- Komga reports series `Look Back` with two books and `readingDirection=RIGHT_TO_LEFT` with the
  reading-direction lock enabled.

An earlier read-only `Chainsaw Man` search against Comix (EN) timed out at that source's upstream
WebView. The ordered resolver and fallback remain important; reorder Comix below a responsive source
if that timeout recurs.

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
- ebook organization: author/title (year) folders
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
books:   1
files:   1
```

BookOrbit's Book Dock settings are wired for unattended imports: metadata fetching is enabled,
auto-finalization is enabled at an 85% confidence threshold, and the destination is library 1/folder
1 (`Books` → `/media-share/bookorbit-books`) using safe metadata merging. A high-confidence ebook
can therefore move out of the drop folder automatically; a lower-confidence match remains in Book Dock
for an administrator to review.

The live test deliberately used the supported API because the drop path is a CIFS/SMB mount and the
BookOrbit watcher uses Chokidar with `ignoreInitial:true`. The settled `.mobi` remained in
`/media-share/bookorbit-bookdrop` until an administrator invoked Book Dock **Rescan**. BookOrbit then
created the dock row, fetched metadata at 75% confidence, and produced a valid finalize preview.
Because 75% is below the 85% automatic threshold, an administrator finalized the reviewed item. The
drop folder is now empty and the database contains one `present` book and one `.mobi` file at:

```text
/media-share/bookorbit-books/Lyman Frank Baum/The Wonderful Wizard of Oz (2006)/The Wonderful Wizard of Oz (2006).mobi
```

The Book Dock is empty and six scheduled/watcher scan jobs completed without errors. Do not enable
global `CHOKIDAR_USEPOLLING`: it would also poll a potentially large library tree. A narrow Book Dock
watcher fix would belong in BookOrbit itself, outside this Omnibus fork. BookOrbit's relevant local
code suites pass 318 tests across 15 files, covering the Book Dock watcher, ingestion,
metadata/finalization, work queue, and library scanner; that is supporting code evidence, not a
replacement for the live file handoff.

## Shelfmark → Audiobookshelf: audiobooks

Shelfmark’s audiobook destination exists and is mounted by both applications. Its live settings use
Prowlarr as the audiobook source, direct downloads, and:

```text
FILE_ORGANIZATION_AUDIOBOOK=organize
TEMPLATE_AUDIOBOOK_ORGANIZE={Author}/{Title}/{Title}
```

Audiobookshelf is healthy and has one `Audiobooks` library rooted at:

```text
/media-share/audiobookshelf-audiobooks
```

The first live release was Jim Dale's *Alice's Adventures in Wonderland*: Shelfmark completed it and
copied 48 MP3 files into the destination. At that time the live organization mode was `rename`, so
the files were flat and Audiobookshelf indexed 48 root-level items. The setting was changed to the
recommended `organize` mode. A second real release, *Alice's Adventures in Wonderland and Through the
Looking Glass*, then landed under its own author/title folder as one MP3, and Audiobookshelf indexed
it. The current database has 49 items, zero missing items, and the library points at the correct
root. The original 48 flat test files remain as test data; they should not be used as the model for
new releases. A fresh multi-file release after the setting change should be used to confirm that all
tracks stay together as one Audiobookshelf book.

This is an application configuration state, not a Kubernetes change. Keep Audiobookshelf pointed only
at `/media-share/audiobookshelf-audiobooks`; never point it at Shelfmark’s ebook drop or BookOrbit’s
library.

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

1. Repeat an ebook with a high-confidence match and confirm whether an automatic CIFS import occurs;
   otherwise retain the administrator-rescan instruction for this deployment.
2. Run one fresh multi-file audiobook after the `organize` setting change and confirm Audiobookshelf
   creates one book containing all tracks.
3. Re-test the first Suwayomi source or move it below a responsive source if its WebView timeout persists.
4. Run the full Omnibus suite after repairing the workstation's missing Prisma OpenSSL runtime. On
   2026-08-24, the local Vitest run passed 847 tests and skipped six, with one integration suite
   failing during Prisma setup because the workstation lacks `libssl.so.1.1`; the nine targeted fork
   test files separately passed 83 tests with four integration cases skipped. The Rust engine passed
   all 233 tests and Clippy completed cleanly. GitHub Actions also passed the web, engine, and image
   build jobs for the deployed fork build.
