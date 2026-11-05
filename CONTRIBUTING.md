# Contributing

## Requirements

- [Bun](https://bun.sh) (latest). eblib does not run on Node, Deno, npm or pnpm.
- git.

## Setup

```bash
git clone --recurse-submodules https://github.com/big1mosha/eblib.git
cd eblib
bun start
```

Without `--recurse-submodules`, `bun start` prints why epubkit is needed and
asks before fetching it into `vendor/epubkit`. To do it by hand:

```bash
git submodule update --init --recursive
bun run setup
```

In CI, set `EBLIB_FETCH_EPUBKIT=1` to fetch without the prompt. There is no
prompt when stdin is not a terminal, so the build fails with instructions
instead of hanging.

## Scripts

```bash
bun start        # fetch epubkit if missing, install, run the CLI
bun run setup    # fetch epubkit if missing, install
bun run test
bun run typecheck
bun run build    # compiled binary in dist/eblib
```

Pass CLI arguments through `bun start`, for example
`bun start scrape "https://www.ebanglalibrary.com/books/<slug>/"`.

## epubkit is a submodule

[epubkit](https://github.com/big1mosha/epubkit) is an independent repo pinned
by commit at `vendor/epubkit`. eblib consumes `@epubkit/core` from
`vendor/epubkit/packages/core`.

- Make core changes in the epubkit repo, push them there, then move the pointer:
  `git submodule update --remote vendor/epubkit && git add vendor/epubkit`.
- Do not send pull requests that only edit `vendor/epubkit`; the changes would
  be lost on the next submodule update.
- `@epubkit/core` is copied into `node_modules`, so run `bun install` after
  changing it.

## Code

- TypeScript, strict mode, ESM, `.ts` extensions in relative imports.
- Split by feature: `src/cli`, `src/site`, `src/build`, `src/http`, `src/store`.
- Bun APIs are fine (`bun:sqlite`, `Bun.CryptoHasher`). Do not add npm or npx
  commands to scripts.
- Keep functions small and readable; prefer the standard library over new
  dependencies.
- Tests use `bun:test` and live in `test/`.

## Commits

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
Keep the subject short and imperative.

## Scope

Personal use only. Do not add DRM removal, paywall or CAPTCHA bypass, or
anything that redistributes site content. Be gentle with the site: no
aggressive parallelism.

By contributing you agree your changes are licensed under the [MIT License](LICENSE).
