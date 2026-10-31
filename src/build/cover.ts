import { readFile } from "node:fs/promises";
import {
  checkCover,
  coverFromBytes,
  generateCover,
  type CoverAsset,
} from "@epubkit/core";
import { exists } from "../io.ts";

export type CoverMode = "auto" | "site" | "generate" | "none";

export interface CoverOptions {
  mode: string;
  title: string;
  authors: string[];
  series?: string;
  imprint?: string;
  /** Local copy of the site cover, if one was downloaded. */
  siteCover?: string;
  warn: (message: string) => void;
}

export interface CoverResult {
  cover?: CoverAsset;
  note?: string;
}

/**
 * Pick the cover: `auto` keeps a good site cover and generates one otherwise,
 * `site` always uses the downloaded site image, and any other value is a path.
 */
export async function resolveCover(options: CoverOptions): Promise<CoverResult> {
  const mode = options.mode.trim();
  if (mode === "none") return {};

  if (mode !== "auto" && mode !== "site" && mode !== "generate") {
    const data = new Uint8Array(await readFile(mode));
    const asset = coverFromBytes(data);
    if (!asset) throw new Error(`Unsupported cover image: ${mode}`);
    return { cover: asset, note: `cover: ${mode}` };
  }

  const site = options.siteCover && (await exists(options.siteCover))
    ? new Uint8Array(await readFile(options.siteCover))
    : undefined;

  if (mode === "site") {
    if (site) {
      const asset = coverFromBytes(site);
      if (asset) return { cover: asset, note: "cover: site image" };
    }
    options.warn("site cover missing or unreadable; generating one instead");
    return { cover: await generated(options), note: "cover: generated" };
  }

  if (mode === "auto" && site) {
    const check = checkCover(site);
    if (check.ok) return { cover: coverFromBytes(site) ?? undefined, note: "cover: site image" };
    options.warn(`site cover rejected (${check.reason}); generating one instead`);
  }

  return { cover: await generated(options), note: "cover: generated" };
}

function generated(options: CoverOptions): Promise<CoverAsset> {
  return generateCover({
    title: options.title,
    authors: options.authors,
    series: options.series,
    imprint: options.imprint,
  });
}
