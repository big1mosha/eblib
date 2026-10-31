import { EblibError, EXIT } from "./config.ts";
import type { HttpClient } from "./http/client.ts";
import type { Workspace } from "./store/workspace.ts";
import {
  enrichMetadata,
  isMetadataSource,
  METADATA_SOURCES,
  type EnrichmentResult,
} from "./site/metadata.ts";

export interface EnrichOptions {
  /** `openlibrary`, `googlebooks`, or undefined to skip. */
  source?: string;
  /** Re-query even when the workspace was already enriched. */
  refreshMetadata?: boolean;
  refresh?: boolean;
  offline?: boolean;
  warn: (message: string) => void;
}

/**
 * Fill publisher, date, description and subjects from a book database.
 * Existing site values win, except the publication date, which the provider
 * knows better than the article timestamp.
 */
export async function enrichWorkspace(
  workspace: Workspace,
  client: HttpClient,
  options: EnrichOptions,
): Promise<EnrichmentResult | null> {
  if (!options.source || options.source === "site" || options.source === "none") return null;
  if (!isMetadataSource(options.source)) {
    throw new EblibError(
      `Unknown --metadata-source: ${options.source} (site|${METADATA_SOURCES.join("|")}|none)`,
      EXIT.usage,
    );
  }

  const metadata = workspace.state.metadata;
  if (metadata.enrichment && !options.refreshMetadata && !options.refresh) return null;

  const found = await enrichMetadata(client, metadata, {
    source: options.source,
    refresh: (options.refresh || options.refreshMetadata) && !options.offline,
    offline: options.offline,
    warn: options.warn,
  });
  if (!found) return null;

  metadata.publisher ??= found.publisher;
  if (found.date) metadata.published = found.date;
  metadata.description ??= found.description;
  if (metadata.subjects.length === 0 && found.subjects?.length) metadata.subjects = found.subjects;
  metadata.enrichment = {
    source: found.source,
    matchedTitle: found.matchedTitle,
    at: new Date().toISOString(),
  };

  workspace.addWarning(`metadata: matched "${found.matchedTitle}" on ${found.source}`);
  await workspace.save();
  return found;
}
