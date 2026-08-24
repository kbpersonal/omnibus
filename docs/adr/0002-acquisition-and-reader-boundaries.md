# Acquisition and reader boundaries

**Status:** accepted

The stack assigns one owner to each library tree and keeps staging paths separate from final library
paths. Omnibus writes western comics to `/media-share/omnibus-comics` and Suwayomi writes manga to
`/media-share/suwayomi-manga`; Komga mounts both read-only and is the sole reader for picture content.
Shelfmark writes ebooks only to the BookOrbit drop path. BookOrbit imports those files into
`/media-share/bookorbit-books` and is both the owner/acquirer and reader of that final ebook tree.
Shelfmark writes organized audiobooks to `/media-share/audiobookshelf-audiobooks`, and Audiobookshelf
is the reader for that tree.

This split is deliberate: it prevents competing scanners and renamers from corrupting files, keeps
reading/listening progress in the service people actually use, and preserves the native client
support that motivated Komga and Audiobookshelf. The BookOrbit drop path is a CIFS staging boundary;
if its filesystem watcher misses a settled file, an administrator can use Book Dock rescan without
changing ownership. BookOrbit’s comics reader and ComicVine provider remain unused, and Audiobookshelf
must never be pointed at the comic or ebook trees.
