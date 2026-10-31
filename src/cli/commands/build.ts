import { EblibError, EXIT } from "../../config.ts";
import { buildBook } from "../../build/book.ts";
import { resolveFonts } from "../../build/fonts.ts";
import { openWorkspace, resolveCourseId } from "../../scrape.ts";
import { enrichWorkspace } from "../../enrich.ts";
import {
  cacheDirFor,
  clientFor,
  coverModeFrom,
  outDirFor,
  outputFor,
  partsModeFrom,
  selectionFrom,
  splitSizeFrom,
  styleFrom,
  authorsFrom,
  type GlobalFlags,
} from "../shared.ts";

export async function buildCommand(target: string | undefined, flags: GlobalFlags): Promise<void> {
  const out = outputFor(flags);
  if (!target) throw new EblibError("Usage: eblib build <book.json|course-id>", EXIT.usage);

  const cacheDir = cacheDirFor(flags);
  const courseId = await resolveCourseId(target);
  const workspace = await openWorkspace(cacheDir, courseId);
  const client = await clientFor(flags);

  try {
    await enrichWorkspace(workspace, client, {
      source: flags.metadataSource,
      refreshMetadata: flags.refreshMetadata,
      refresh: flags.refresh,
      offline: flags.offline,
      warn: (message) => out.warn(message),
    });

    const fonts = await resolveFonts({
      client,
      cacheDir,
      font: typeof flags.font === "string" ? flags.font : undefined,
      noFont: flags.font === "none",
      offline: flags.offline,
      refresh: flags.refresh,
      warn: (message) => out.warn(message),
    });

    const result = await buildBook({
      workspace,
      outDir: outDirFor(flags),
      name: flags.name,
      cover: coverModeFrom(flags),
      fonts,
      selection: selectionFrom(flags),
      skipTopics: flags.skipTopics,
      mergeTopics: flags.mergeTopics,
      parts: partsModeFrom(flags),
      style: styleFrom(flags),
      splitSizeKb: splitSizeFrom(flags),
      allowPartial: flags.allowPartial,
      titleOverride: flags.title,
      authorsOverride: authorsFrom(flags),
      warn: (message) => out.warn(message),
    });

    out.info(
      `${result.file} (${(result.bytes / 1024 / 1024).toFixed(1)} MB, ${result.stats.chapters} chapters, ${result.stats.topics} topics)`,
    );
    out.event({ event: "built", file: result.file, bytes: result.bytes, stats: result.stats });
    if (flags.json) out.json(result);
  } finally {
    await client.close();
  }
}
