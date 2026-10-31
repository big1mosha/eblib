import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { EblibError, EXIT, PATHS, SITE } from "../../config.ts";
import { CookieJar, parseNetscapeCookies } from "../../http/cookies.ts";
import { writeJson } from "../../io.ts";
import { cacheDirFor, outputFor, type GlobalFlags } from "../shared.ts";

interface AuthFlags extends GlobalFlags {
  from?: string;
}

/**
 * Manual authentication only. Playwright opens a headed browser so the user can
 * solve a challenge or log in; the resulting cookies are reused by the scraper.
 */
export async function authCommand(url: string | undefined, flags: AuthFlags): Promise<void> {
  const out = outputFor(flags);
  const cacheDir = cacheDirFor(flags);
  const cookieFile = flags.cookieFile ? resolve(flags.cookieFile) : resolve(cacheDir, PATHS.cookies);

  if (flags.from) {
    const text = await readFile(flags.from, "utf8");
    const cookies = parseNetscapeCookies(text);
    if (cookies.length === 0) throw new EblibError(`No cookies found in ${flags.from}`, EXIT.usage);
    const jar = await CookieJar.load(cookieFile);
    for (const cookie of cookies) jar.add(cookie);
    await jar.save();
    out.info(`imported ${cookies.length} cookie(s) into ${cookieFile}`);
    return;
  }

  const target = url ?? SITE;
  const playwright = await loadPlaywright();
  if (!playwright) {
    throw new EblibError(
      "Playwright is not installed. Install it with:\n  bun add -d playwright && bunx playwright install chromium\nor export cookies and use: eblib auth --from cookies.txt",
      EXIT.usage,
    );
  }

  out.info("Opening a browser. Solve the challenge or log in, then press Enter here.");
  const browser = await playwright.chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120_000 });

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("Press Enter when the page is fully loaded… ");
    rl.close();

    const jar = await CookieJar.load(cookieFile);
    const cookies = await context.cookies();
    for (const cookie of cookies) {
      jar.add({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain.replace(/^\./, ""),
        path: cookie.path,
        expires: Math.floor(cookie.expires ?? 0),
      });
    }
    await jar.save();
    await writeJson(resolve(cacheDir, PATHS.auth), await context.storageState());
    out.info(`saved ${cookies.length} cookie(s) to ${cookieFile}`);
  } finally {
    await browser.close();
  }
}

type PlaywrightModule = {
  chromium: {
    launch(options: { headless: boolean }): Promise<{
      newContext(): Promise<{
        newPage(): Promise<{ goto(url: string, options?: Record<string, unknown>): Promise<unknown> }>;
        cookies(): Promise<Array<{ name: string; value: string; domain: string; path: string; expires?: number }>>;
        storageState(): Promise<unknown>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    const spec = "playwright";
    return (await import(spec)) as unknown as PlaywrightModule;
  } catch {
    return null;
  }
}
