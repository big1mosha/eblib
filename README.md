# eblib

Scrape an [Ebangla Library](https://www.ebanglalibrary.com/) book into a clean Bengali EPUB.

Personal use only. No redistribution, no DRM removal, no paywall or CAPTCHA bypass.

## Install

```bash
bun install
bun run src/cli.ts --help
```

`eblib` depends on `@epubkit/core` from the sibling `epubkit` repo
(`file:../epubkit/packages/core`). Bun installs that dependency as a copy, so
run `bun install` here after changing the core package.

## Usage

```bash
# scrape and build
eblib scrape "https://www.ebanglalibrary.com/books/<slug>/"

# structure only, no content
eblib info "https://www.ebanglalibrary.com/books/<slug>/"

# fetch content into the cache, no EPUB
eblib scrape "<url>" --fetch-only

# rebuild from cache after changing style or ranges
eblib build 216889 --style minimal

# rebuild from any copied workspace folder
eblib build /mnt/backup/eblib/books/216889 --offline

# export a portable folder for epubkit create
eblib export 216889 -o dist

# list books from the sitemap
eblib list --limit 20 --search kakababu

# cache tools
eblib cache ls
eblib cache verify
eblib cache clear --books

# manual challenge/login
eblib auth "https://www.ebanglalibrary.com/"
eblib auth --from cookies.txt
```

A bare URL works too: `eblib <url>` runs `scrape`.

## What gets built

- EPUB 3 with an NCX fallback.
- Cover, half-title, title page, colophon, contents, part pages, chapters, topics.
- Section heading → part page, lesson → chapter, topic → sub-chapter.
- A lesson with topics and no content becomes a title page; its topics follow.
- A section with one lesson of the same name does not repeat the title.
- Bengali text keeps its ZWJ/ZWNJ and danda; inline styles are reduced to `text-align`.
- Images are downloaded, deduplicated by hash, and embedded.

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `-o, --out <dir>` | `dist` | EPUB output directory |
| `--cache-dir <dir>` | `.eblib` | cache and workspace |
| `--name <slug>` | from title | output file name |
| `--title`, `--author` | site | metadata overrides |
| `--resume` / `--no-resume` | resume | skip finished items |
| `--refresh` | off | ignore the HTTP cache |
| `--refresh-structure` | off | re-parse the course page |
| `--refresh-content` | off | re-fetch content |
| `--offline` | off | cache only |
| `--fetch-only` | off | fetch content and stop before building |
| `--lessons <range>` | all | `1-5,8` |
| `--topics <range>` | all | topics inside selected lessons |
| `--sections <range>` | all | sections |
| `--skip-topics` | off | lessons as single chapters |
| `--merge-topics` | off | topics inside the lesson page |
| `--parts auto\|always\|never` | `auto` | part pages |
| `--split-size <kb>` | `200` | split long chapters |
| `--style classic\|minimal\|none` | `classic` | theme |
| `--font <path\|none>` | Noto Serif Bengali | font control |
| `--cover auto\|site\|generate\|none\|<path>` | `auto` | cover handling |
| `--metadata-source site\|openlibrary\|googlebooks\|none` | `site` | enrich metadata |
| `--refresh-metadata` | off | query the provider again |
| `--allow-partial` | off | placeholders for failed items |
| `--fail-fast` | off | stop on first error |
| `--report <path>` | — | copy the scrape report |
| `--json` | off | NDJSON progress / JSON result |
| `--quiet`, `--verbose`, `--no-color` | | output control |
| `--dry-run` | off | plan only |
| `--delay`, `--jitter`, `--timeout`, `--retries`, `--max-requests` | `2000`, `500`, `30000`, `3`, `1000` | politeness |

## Cache

```text
.eblib/
  http.db                 # URL → status, headers, body file
  http/<sha256>           # raw response bodies
  cookies.json            # cookie jar
  auth.json               # Playwright storage state
  fonts/                  # cached Noto Serif Bengali subsets
  books/<courseId>/
    book.json             # structure, metadata, item state, images
    report.json           # last scrape report
    manifest.json         # clean input for @epubkit/core
    content/              # sanitised lesson and topic XHTML
    images/               # downloaded images
    cover/                # downloaded site cover
```

No URL is fetched twice unless `--refresh` is passed. `book.json` is written after each item, so a crash loses at most one item.

`eblib build <id>` rebuilds from this cache. `eblib build <folder>` reads a
workspace folder copied anywhere. Add `--offline` to keep the build fully local
(fonts, cover and metadata are read from the cache).

## Export

`eblib export <id>` writes a folder that `epubkit create` can build:

```text
dist/<slug>/
  book.json            # manifest: parts, lessons, topics, extra pages
  content/*.html       # sanitised chapters, images as ../images/<name>
  images/              # downloaded images
  cover.jpg            # site cover, when one was cached
  fonts/               # cached Bengali/Latin subsets
```

```bash
eblib export 216889 -o dist
epubkit create "dist/<slug>" -o "dist/<slug>.epub" --validate
```

Unlike `eblib build`, this folder does not depend on `eblib`; keep it or move it
and rebuild the EPUB later with `epubkit`.

## Site quirks

- LearnDash paging on the site is broken (`No Pagination Match`), and LiteSpeed caches the course page without its query string.
- When the course page lists fewer lessons than its own pager reports, `eblib` follows the "Next Lesson" chain from the last visible lesson and appends the rest. Section names for that tail are unavailable; a `structure-truncated` warning is recorded.
- Topics that the course page hides are read from the lesson page.
- Quizzes are not scraped: LearnDash keeps them outside the lesson content tab, so only lessons and topics become chapters.

## Cover

`--cover auto` keeps the site cover only when it is at least 800 px wide and close to 2:3. Otherwise a 1600×2400 typographic cover is generated. `sharp` is optional; without it the cover stays an SVG.

## Metadata enrichment

`--metadata-source openlibrary` or `--metadata-source googlebooks` fills
`publisher`, `published`, `description` and `subjects` from a book database.

```bash
eblib scrape "<url>" --metadata-source googlebooks
eblib build 216889 --metadata-source openlibrary --refresh-metadata
```

- The site's own values win, except `published`: the provider's book year is
  more useful than the article timestamp.
- A candidate must match the title (containment or token overlap) and, when
  both sides list an author, the author too. A wrong match is worse than none,
  so ambiguous results are dropped with a warning.
- Open Library barely indexes Bengali titles; Google Books is the better bet.
  Without `GOOGLE_BOOKS_API_KEY` the public endpoint is often rate limited
  (HTTP 429); set the env var to lift the quota.
- The result is stored in `book.json`, so later builds do not query again
  unless `--refresh-metadata` is passed. `--offline` reads only the cache.

## Auth

Challenges are never solved automatically. `eblib auth` opens a headed Playwright browser, waits for you to finish, then saves cookies. `--from cookies.txt` imports a Netscape cookie file. If a challenge is hit mid-run, the exit code is `3` and the cache is intact for `--resume`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | general error |
| 2 | usage error |
| 3 | auth or challenge required |
| 4 | partial build |
| 5 | offline cache miss |
| 6 | invalid input |

## Development

```bash
bun test
bunx tsc --noEmit
bun build src/cli.ts --compile --outfile dist/eblib
```
