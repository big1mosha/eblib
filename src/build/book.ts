import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildEpub, type BookImage, type BookInput, type BuildResult, type FontInput } from "@epubkit/core";
import { ensureDir, writeAtomic, writeJson } from "../io.ts";
import { EblibError, EXIT } from "../config.ts";
import type { Workspace } from "../store/workspace.ts";
import { resolveCover } from "./cover.ts";
import { buildManifest, type ManifestOptions, type ManifestStats } from "./manifest.ts";

export interface BuildBookOptions extends Omit<ManifestOptions, "cover"> {
  workspace: Workspace;
  outDir: string;
  name?: string;
  cover: string;
  fonts?: FontInput[];
  warn: (message: string) => void;
}

export interface BuildBookResult {
  file: string;
  bytes: number;
  stats: ManifestStats;
  identifier: string;
  warnings: string[];
}

const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

export async function buildBook(options: BuildBookOptions): Promise<BuildBookResult> {
  const { workspace } = options;
  const state = workspace.state;
  const warnings: string[] = [];

  const images = await loadImages(workspace);
  const { cover: _coverMode, fonts: _fonts, workspace: _ws, outDir: _out, name: _name, warn: _warn, ...manifestOptions } = options;
  const manifest = await buildManifest(workspace, { ...manifestOptions, images });
  if (manifest.missing.length > 0 && !options.allowPartial) {
    throw new EblibError(
      `Missing content for ${manifest.missing.length} item(s); rerun with --resume or --allow-partial:\n  ` +
        manifest.missing.slice(0, 10).join("\n  "),
      EXIT.partial,
    );
  }

  const cover = await resolveCover({
    mode: options.cover,
    title: manifest.input.title,
    authors: manifest.input.authors ?? [],
    series: manifest.input.series,
    imprint: imprintOf(state.metadata.source),
    siteCover: state.metadata.coverFile ? workspace.path(state.metadata.coverFile) : undefined,
    warn: (message) => {
      warnings.push(message);
      options.warn(message);
    },
  });

  const input = { ...manifest.input, cover: cover.cover, fonts: options.fonts };
  const result: BuildResult = buildEpub(input);

  await writeJson(workspace.path("manifest.json"), serializeManifest(manifest.input));

  const outDir = resolve(options.outDir);
  await ensureDir(outDir);
  const file = join(outDir, `${options.name ?? slugify(state.metadata.title)}.epub`);
  await writeAtomic(file, result.data);

  return {
    file,
    bytes: result.data.byteLength,
    stats: manifest.stats,
    identifier: result.identifier,
    warnings,
  };
}

async function loadImages(workspace: Workspace): Promise<BookImage[]> {
  const images: BookImage[] = [];
  for (const image of Object.values(workspace.state.images ?? {})) {
    const ext = image.file.split(".").pop()?.toLowerCase() ?? "";
    const mediaType = MEDIA_TYPES[ext];
    if (!mediaType) continue;
    try {
      images.push({
        href: image.file,
        mediaType,
        data: new Uint8Array(await readFile(workspace.path(image.file))),
      });
    } catch {
      // A missing image only costs that illustration.
    }
  }
  return images;
}

function serializeManifest(input: BookInput) {
  return {
    title: input.title,
    authors: input.authors,
    language: input.language,
    series: input.series,
    source: input.source,
    parts: input.parts.map((part) => ({
      title: part.title,
      lessons: part.lessons.map((lesson) => ({
        title: lesson.title,
        topics: (lesson.topics ?? []).map((topic) => topic.title),
      })),
    })),
  };
}

function imprintOf(source: string | undefined): string | undefined {
  if (!source) return undefined;
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Keep Bengali letters and digits; replace runs of other characters. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "book";
}
