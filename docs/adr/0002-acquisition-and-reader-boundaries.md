# Acquisition and reader boundaries

**Status:** accepted

The stack assigns one writer and one reader to each content tree. Omnibus writes western comics to
`/media-share/omnibus-comics` and Suwayomi writes manga to `/media-share/suwayomi-manga`; Komga mounts
both read-only and is the sole reader for picture content. Shelfmark writes ebooks to the BookOrbit
drop path and audiobooks to the Audiobookshelf path; BookOrbit and Audiobookshelf read their own
trees. This split is deliberate: it prevents competing scanners and renamers from corrupting files,
keeps reading progress in the service people actually use, and preserves the native client support
that motivated Komga and Audiobookshelf. BookOrbit’s comics reader and ComicVine provider remain
unused, and Audiobookshelf must never be pointed at the comic or ebook trees.
