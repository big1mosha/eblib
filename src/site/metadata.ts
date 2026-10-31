import type { BookMetadata } from "./course.ts";
import type { HttpClient } from "../http/client.ts";
import { textOf } from "../http/cache.ts";
import { EblibError, EXIT } from "../config.ts";

export const METADATA_SOURCES = ["openlibrary", "googlebooks"] as const;
export type MetadataSource = (typeof METADATA_SOURCES)[number];

export function isMetadataSource(value: string): value is MetadataSource {
  return (METADATA_SOURCES as readonly string[]).includes(value);
}

export interface Candidate {
  title: string;
  authors: string[];
  publisher?: string;
  date?: string;
  description?: string;
  subjects?: string[];
  /** Open Library work key, used to fetch a longer description. */
  key?: string;
}

export interface EnrichmentResult {
  source: MetadataSource;
  matchedTitle: string;
  publisher?: string;
  date?: string;
  description?: string;
  subjects?: string[];
}

export interface EnrichOptions {
  source: MetadataSource;
  refresh?: boolean;
  offline?: boolean;
  warn: (message: string) => void;
}

/** Ask the chosen provider for a matching edition and keep the useful fields. */
export async function enrichMetadata(
  client: HttpClient,
  metadata: BookMetadata,
  options: EnrichOptions,
): Promise<EnrichmentResult | null> {
  const candidates = await search(client, metadata, options);
  if (candidates === null) return null;
  const best = pickCandidate(metadata, candidates);
  if (!best) {
    options.warn(`${options.source}: no confident match for "${metadata.title}"`);
    return null;
  }

  let description = best.description;
  if (!description && !metadata.description && best.key) {
    description = await openLibraryDescription(client, best.key, options);
  }

  return {
    source: options.source,
    matchedTitle: best.title,
    publisher: best.publisher,
    date: best.date,
    description,
    subjects: best.subjects,
  };
}

async function search(
  client: HttpClient,
  metadata: BookMetadata,
  options: EnrichOptions,
): Promise<Candidate[] | null> {
  const url = options.source === "openlibrary" ? openLibraryUrl(metadata) : googleBooksUrl(metadata);
  let body: string;
  try {
    const response = await client.get(url, { refresh: options.refresh, offline: options.offline });
    if (response.status !== 200) {
      const hint =
        response.status === 429 && options.source === "googlebooks"
          ? " (rate limited; set GOOGLE_BOOKS_API_KEY or retry later)"
          : "";
      options.warn(`${options.source}: HTTP ${response.status}${hint}`);
      return null;
    }
    body = textOf(response);
  } catch (cause) {
    if (cause instanceof EblibError && cause.exitCode === EXIT.offline) {
      options.warn(`${options.source}: not cached (--offline)`);
      return null;
    }
    const message = (cause as Error).message;
    const hint =
      message.includes("429") && options.source === "googlebooks"
        ? " (rate limited; set GOOGLE_BOOKS_API_KEY or retry later)"
        : "";
    options.warn(`${options.source}: ${message}${hint}`);
    return null;
  }

  try {
    const json = JSON.parse(body) as unknown;
    return options.source === "openlibrary" ? parseOpenLibrary(json) : parseGoogleBooks(json);
  } catch (cause) {
    options.warn(`${options.source}: unreadable response (${(cause as Error).message})`);
    return null;
  }
}

export function openLibraryUrl(metadata: BookMetadata): string {
  const params = new URLSearchParams({
    title: metadata.title,
    limit: "5",
    fields: "key,title,author_name,first_publish_year,publisher,subject",
  });
  if (metadata.authors[0]) params.set("author", metadata.authors[0]);
  return `https://openlibrary.org/search.json?${params.toString()}`;
}

export function googleBooksUrl(metadata: BookMetadata): string {
  const terms = [`intitle:${metadata.title}`];
  if (metadata.authors[0]) terms.push(`inauthor:${metadata.authors[0]}`);
  const params = new URLSearchParams({
    q: terms.join(" "),
    maxResults: "5",
    printType: "books",
  });
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (key) params.set("key", key);
  return `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
}

export function parseOpenLibrary(json: unknown): Candidate[] {
  const docs = (json as { docs?: unknown }).docs;
  if (!Array.isArray(docs)) return [];
  return docs.flatMap((doc): Candidate[] => {
    const item = doc as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title : "";
    if (!title) return [];
    return [
      {
        title,
        authors: strings(item.author_name),
        publisher: strings(item.publisher)[0],
        date: yearOf(item.first_publish_year),
        subjects: strings(item.subject).slice(0, 8),
        key: typeof item.key === "string" ? item.key : undefined,
      },
    ];
  });
}

export function parseGoogleBooks(json: unknown): Candidate[] {
  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((entry): Candidate[] => {
    const info = (entry as { volumeInfo?: Record<string, unknown> }).volumeInfo;
    if (!info || typeof info.title !== "string") return [];
    return [
      {
        title: info.title,
        authors: strings(info.authors),
        publisher: typeof info.publisher === "string" ? info.publisher : undefined,
        date: typeof info.publishedDate === "string" ? info.publishedDate : undefined,
        description: cleanDescription(info.description),
        subjects: strings(info.categories).slice(0, 8),
      },
    ];
  });
}

/**
 * Prefer a candidate whose title and author both match. Titles on the site
 * carry subtitles and series names, so containment and token overlap count.
 */
export function pickCandidate(metadata: BookMetadata, candidates: Candidate[]): Candidate | undefined {
  let best: { candidate: Candidate; score: number } | undefined;

  for (const candidate of candidates) {
    const titleScore = similarity(metadata.title, candidate.title);
    if (titleScore < 0.75) continue;

    const authorScore = authorSimilarity(metadata.authors, candidate.authors);
    if (metadata.authors.length > 0 && candidate.authors.length > 0 && authorScore < 0.4 && titleScore < 0.95) {
      continue;
    }

    const score = titleScore * 0.75 + authorScore * 0.25;
    if (!best || score > best.score) best = { candidate, score };
  }

  return best?.candidate;
}

/** 0..1 similarity on normalised text: exact, containment, then token overlap. */
export function similarity(a: string, b: string): number {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return 0.9 * (Math.min(left.length, right.length) / Math.max(left.length, right.length)) + 0.1;
  }
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function authorSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  let best = 0;
  for (const a of left) {
    for (const b of right) best = Math.max(best, similarity(a, b));
  }
  return best;
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function yearOf(value: unknown): string | undefined {
  const year = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(year) && year > 0 ? String(year) : undefined;
}

function cleanDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\s+([।॥,.!?;:])/g, "$1")
    .trim();
  return text || undefined;
}

async function openLibraryDescription(
  client: HttpClient,
  key: string,
  options: EnrichOptions,
): Promise<string | undefined> {
  const url = `https://openlibrary.org${key}.json`;
  try {
    const response = await client.get(url, { refresh: options.refresh, offline: options.offline });
    if (response.status !== 200) return undefined;
    const json = JSON.parse(textOf(response)) as { description?: unknown };
    const description = json.description;
    if (typeof description === "string") return cleanDescription(description);
    if (description && typeof description === "object") {
      return cleanDescription((description as { value?: unknown }).value);
    }
  } catch {
    // A missing description is not worth a warning.
  }
  return undefined;
}
