import { copyFile, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BookInput, ChapterInput } from "@epubkit/core";
import { EblibError, EXIT } from "../../config.ts";
import { buildManifest } from "../../build/manifest.ts";
import { slugify } from "../../build/book.ts";
import { openWorkspace, resolveCourseId } from "../../scrape.ts";
import { ensureDir, exists, writeAtomic, writeJson } from "../../io.ts";
import {
  authorsFrom,
  cacheDirFor,
  outDirFor,
  outputFor,
  partsModeFrom,
  selectionFrom,
  splitSizeFrom,
  styleFrom,
  type GlobalFlags,
} from "../shared.ts";

interface ManifestChapter {
  title: string;
  file?: string;
  topics?: ManifestChapter[];
}

interface ManifestPart {
  title?: string;
  label?: string;
  lessons: ManifestChapter[];
}

interface PortableManifest {
  title: string;
  authors?: string[];
  language?: string;
  publisher?: string;
  date?: string;
  description?: string;
  subjects?: string[];
  series?: string;
  seriesIndex?: number;
  source?: string;
  rights?: string;
  style?: string;
  splitSizeKb?: number;
  cover?: string;
  fonts?: Array<{ file: string; family: string; weight?: string }>;
  parts: ManifestPart[];
  extraPages?: Array<{ title: string; file: string }>;
}

/**
 * Write the cached book as a portable folder that `epubkit create` can build:
 * `book.json` + `content/*.html` + `images/` + `cover.*` + `fonts/`.
 */
export async function exportCommand(target: string | undefined, flags: GlobalFlags): Promise<void> {
  const out = outputFor(flags);
  if (!target) throw new EblibError("Usage: eblib export <book.json|course-id>", EXIT.usage);

  const cacheDir = cacheDirFor(flags);
  const courseId = await resolveCourseId(target);
  const workspace = await openWorkspace(cacheDir, courseId);

  const manifest = await buildManifest(workspace, {
    selection: selectionFrom(flags),
    skipTopics: flags.skipTopics,
    mergeTopics: flags.mergeTopics,
    parts: partsModeFrom(flags),
    style: styleFrom(flags),
    splitSizeKb: splitSizeFrom(flags),
    allowPartial: flags.allowPartial,
    titleOverride: flags.title,
    authorsOverride: authorsFrom(flags),
  });

  if (manifest.missing.length > 0 && !flags.allowPartial) {
    throw new EblibError(
      `Missing content for ${manifest.missing.length} item(s); rerun with --resume or --allow-partial:\n  ` +
        manifest.missing.slice(0, 10).join("\n  "),
      EXIT.partial,
    );
  }

  const name = flags.name ?? slugify(manifest.input.title);
  const dir = join(outDirFor(flags), name);
  await rm(dir, { recursive: true, force: true });
  await ensureDir(join(dir, "content"));

  let fileNo = 0;
  const writeChapter = async (chapter: ChapterInput): Promise<ManifestChapter> => {
    const file = chapter.html ? `content/${String(++fileNo).padStart(4, "0")}.html` : undefined;
    if (file) await writeAtomic(join(dir, file), chapter.html!);
    const topics = chapter.topics?.length
      ? await Promise.all(chapter.topics.map(writeChapter))
      : undefined;
    return { title: chapter.title, file, topics };
  };

  const parts: ManifestPart[] = [];
  for (const part of manifest.input.parts) {
    parts.push({
      title: part.title,
      label: part.label,
      lessons: await Promise.all(part.lessons.map(writeChapter)),
    });
  }

  const extraPages: Array<{ title: string; file: string }> = [];
  for (const extra of manifest.input.extraPages ?? []) {
    const file = `content/${String(++fileNo).padStart(4, "0")}.html`;
    await writeAtomic(join(dir, file), extra.html ?? "");
    extraPages.push({ title: extra.title, file });
  }

  let images = 0;
  await ensureDir(join(dir, "images"));
  for (const image of Object.values(workspace.state.images ?? {})) {
    const source = workspace.path(image.file);
    if (!(await exists(source))) continue;
    await copyFile(source, join(dir, "images", basename(image.file)));
    images += 1;
  }

  let cover: string | undefined;
  if (workspace.state.metadata.coverFile) {
    const source = workspace.path(workspace.state.metadata.coverFile);
    if (await exists(source)) {
      cover = `cover.${source.split(".").pop() ?? "jpg"}`;
      await copyFile(source, join(dir, cover));
    }
  }

  const fonts: PortableManifest["fonts"] = [];
  const fontsDir = join(cacheDir, "fonts");
  const fontFiles = await readdir(fontsDir).catch(() => [] as string[]);
  if (fontFiles.length > 0) await ensureDir(join(dir, "fonts"));
  for (const font of fontFiles) {
    if (!/\.(woff2?|ttf|otf)$/i.test(font)) continue;
    await copyFile(join(fontsDir, font), join(dir, "fonts", font));
    fonts.push({ file: `fonts/${font}`, family: "Noto Serif Bengali", weight: "400 700" });
  }

  await writePortableManifest(dir, manifest.input, { parts, extraPages, cover, fonts });

  out.info(`Exported ${dir} (${manifest.stats.chapters} chapters, ${images} images)`);
  out.info(`  epubkit create "${dir}" -o "${dir}.epub"`);
  if (flags.json) out.json({ dir, chapters: manifest.stats.chapters, topics: manifest.stats.topics, images });
}

function writePortableManifest(
  dir: string,
  input: BookInput,
  extra: {
    parts: ManifestPart[];
    extraPages: Array<{ title: string; file: string }>;
    cover?: string;
    fonts: PortableManifest["fonts"];
  },
): Promise<void> {
  const manifest: PortableManifest = {
    title: input.title,
    authors: input.authors,
    language: input.language ?? "bn",
    publisher: input.publisher,
    date: input.date,
    description: input.description,
    subjects: input.subjects,
    series: input.series,
    seriesIndex: input.seriesIndex,
    source: input.source,
    rights: input.rights,
    style: input.style,
    splitSizeKb: input.splitSizeKb,
    cover: extra.cover,
    fonts: extra.fonts && extra.fonts.length > 0 ? extra.fonts : undefined,
    parts: extra.parts,
    extraPages: extra.extraPages.length > 0 ? extra.extraPages : undefined,
  };
  return writeJson(join(dir, "book.json"), manifest);
}
