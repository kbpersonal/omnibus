# Books and comics: the simple user guide

There are four kinds of content, and each has one place to request it and one place to read it.

| What you want | Ask for it in | Read it in |
|---|---|---|
| Western comics and graphic novels | Omnibus | Komga |
| Manga | Omnibus | Komga |
| Ebooks | Shelfmark | BookOrbit |
| Audiobooks | Shelfmark | Audiobookshelf |

You do not need to choose a download site. The request app does that for you.

## Before your first request

Open the app from the dashboard and sign in with the normal “Sign in with Google”/tinyauth button.
The audiobook app also has its own sign-in screen because phones and tablets cannot use the browser
sign-in cookie.

For Komga, use the username and password from your Komga invite. If you signed in there through the
browser first and do not know a password, set one in your Komga account settings. Phone and reading
apps need that username and password. The audiobook library is already set up; you do not need to
create one.

## Request a western comic

1. Open Omnibus and search for the comic.
2. Open the series, choose the issue or the whole volume, and press Request.
3. Wait while the request moves through searching and downloading.
4. When it says Completed or Ready in Library, open Komga. The new issue will be there.

Komga is the place to read it and remembers your page, even when you switch devices.

## Request manga

1. Open Omnibus and request the manga series or volume.
2. Omnibus sends it to the manga service automatically.
3. When the request says Monitored, the manga is accepted. Open Komga to read it.
4. New chapters will continue to arrive automatically.

Manga may take longer than a comic because the system checks several manga sources. If the request
says Needs Source, nothing is wrong with your account: an administrator needs to add, reorder, or
retry a manga source. You can leave the request there; the admin can resume it after fixing the source.

## Request an ebook

1. Open Shelfmark and search for the book.
2. Choose the ebook format you want and request/download it.
3. Shelfmark places the download in the ebook drop area.
4. BookOrbit checks the book details and normally imports it into the Books library. Open BookOrbit
   to read it.

If the book does not appear after a few minutes, an administrator may need to press BookOrbit's
**Rescan** button and confirm the book details. Some books are not clear enough to file automatically.
If it still does not appear, tell an administrator the book title and that it is missing from
BookOrbit. Do not request the same book repeatedly.

## Request an audiobook

1. Open Shelfmark and search for the book.
2. Choose the audiobook result and request/download it.
3. Shelfmark places it in the audiobook library area and organizes new releases for Audiobookshelf.
4. Open Audiobookshelf and refresh the library. The audiobook should appear with its chapters.

If the app opens but shows no library, report that to an administrator instead of making another
request. If the audiobook is not visible after a refresh, report the title and wait for an
administrator to check it. Do not request the same audiobook repeatedly.

## Where to read on different devices

- **Browser:** open the appropriate reader from the dashboard.
- **Phone/tablet for audiobooks:** install the Audiobookshelf app and sign in with the OIDC button.
- **Phone/tablet for comics or manga:** use Komga-compatible reader apps with your Komga address and
  Komga username/password.
- **Kobo or KOReader for ebooks:** ask the administrator for the BookOrbit device/OPDS setup link.
  Those devices use their own login details, not the browser cookie.

## Statuses in plain language

- **Pending / Searching:** your request is in line.
- **Downloading:** the file is being retrieved.
- **Completed / Ready in Library:** open the reader.
- **Monitored:** manga is connected to Suwayomi and will keep receiving chapters.
- **Awaiting:** the item is not released yet; the system will try later.
- **Needs Source:** an administrator must fix or retry the manga source list.
- **Failed / Stalled:** an administrator needs to retry or choose another result.

If a request is still unchanged after a reasonable wait, send the title and its status to an
administrator. Do not submit the same request repeatedly; that makes it harder to see the original
problem.
