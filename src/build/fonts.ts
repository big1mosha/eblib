import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FontInput } from "@epubkit/core";
import { ensureDir, exists, writeAtomic } from "../io.ts";
import { textOf } from "../http/cache.ts";
import type { HttpClient } from "../http/client.ts";

const CSS_URL =
  "https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;700&display=swap";
const FAMILY = "Noto Serif Bengali";

export interface FontOptions {
  client: HttpClient;
  cacheDir: string;
  /** Explicit font file. */
  font?: string;
  noFont?: boolean;
  offline?: boolean;
  refresh?: boolean;
  warn: (message: string) => void;
}

/**
 * Resolve the embedded font. Explicit files win; otherwise the Bengali and
 * Latin subsets of Noto Serif Bengali are cached under `<cache>/fonts`.
 */
export async function resolveFonts(options: FontOptions): Promise<FontInput[]> {
  if (options.noFont) return [];

  if (options.font) {
    const data = new Uint8Array(await readFile(options.font));
    return [{ data, filename: basename(options.font), family: guessFamily(options.font), weight: "400 700" }];
  }

  const dir = join(options.cacheDir, "fonts");
  const bengaliFile = join(dir, "noto-serif-bengali.woff2");
  const latinFile = join(dir, "noto-serif-latin.woff2");

  const cached = (await exists(bengaliFile)) && (await exists(latinFile)) && !options.refresh;
  if (!cached) {
    if (options.offline) {
      options.warn("font not cached; building without an embedded font (--offline)");
      return [];
    }
    try {
      await ensureDir(dir);
      const subsets = await fetchSubsets(options.client, options.refresh);
      await writeAtomic(bengaliFile, subsets.bengali);
      await writeAtomic(latinFile, subsets.latin);
    } catch (cause) {
      options.warn(`could not download the font: ${(cause as Error).message}`);
      return [];
    }
  }

  return [
    {
      data: new Uint8Array(await readFile(bengaliFile)),
      filename: "noto-serif-bengali.woff2",
      family: FAMILY,
      weight: "400 700",
    },
    {
      data: new Uint8Array(await readFile(latinFile)),
      filename: "noto-serif-latin.woff2",
      family: FAMILY,
      weight: "400 700",
    },
  ];
}

async function fetchSubsets(
  client: HttpClient,
  refresh: boolean | undefined,
): Promise<{ bengali: Uint8Array; latin: Uint8Array }> {
  const css = textOf(await client.get(CSS_URL, { refresh }));
  const urls = new Map<string, string>();
  const pattern = /\/\*\s*(bengali|latin)\s*\*\/\s*@font-face\s*{([^}]*)}/g;
  for (const match of css.matchAll(pattern)) {
    const subset = match[1]!;
    const url = /src:\s*url\(([^)]+)\)/.exec(match[2]!)?.[1];
    if (url && !urls.has(subset)) urls.set(subset, url);
  }
  const bengali = urls.get("bengali");
  const latin = urls.get("latin");
  if (!bengali || !latin) throw new Error("font CSS did not contain the expected subsets");

  const [bengaliResponse, latinResponse] = await Promise.all([
    client.get(bengali, { refresh }),
    client.get(latin, { refresh }),
  ]);
  return { bengali: bengaliResponse.bytes, latin: latinResponse.bytes };
}

function guessFamily(path: string): string {
  const name = basename(path).replace(/\.(ttf|otf|woff2?)$/i, "");
  if (/noto.*serif.*bengali/i.test(name)) return FAMILY;
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
