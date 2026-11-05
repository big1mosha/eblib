import { join } from "node:path";
import type { BookMetadata, PagingInfo, Section } from "../site/course.ts";
import { bookPath, readJson, writeJson, exists, writeAtomic, readText } from "../io.ts";

export type ItemKind = "lesson" | "topic" | "intro";

export interface ItemState {
  status: "pending" | "done" | "failed";
  content?: string;
  hash?: string;
  fetchedAt?: string;
  error?: string;
  images?: number;
}

export interface ImageState {
  /** Path relative to the book directory, e.g. `images/ab12.jpg`. */
  file: string;
  width?: number;
  height?: number;
}

export interface BookState {
  courseId: string;
  source: string;
  metadata: BookMetadata & {
    coverFile?: string;
    coverWidth?: number;
    coverHeight?: number;
  };
  sections: Section[];
  hasSections: boolean;
  paging: PagingInfo;
  items: Record<string, ItemState>;
  images: Record<string, ImageState>;
  introHtml?: string;
  warnings: string[];
  updatedAt: string;
}

export function itemKey(kind: ItemKind, id: string): string {
  return `${kind}:${id}`;
}

export function contentRelPath(kind: ItemKind, id: string): string {
  return `content/${kind}-${id}.html`;
}

export class Workspace {
  readonly cacheDir: string;
  readonly courseId: string;
  readonly dir: string;
  state: BookState;

  private constructor(cacheDir: string, courseId: string, state: BookState, dir?: string) {
    this.cacheDir = cacheDir;
    this.courseId = courseId;
    this.dir = dir ?? bookPath(cacheDir, courseId);
    this.state = state;
  }

  static async open(cacheDir: string, courseId: string): Promise<Workspace | null> {
    const path = bookPath(cacheDir, courseId, "book.json");
    const state = await readJson<BookState>(path);
    if (!state) return null;
    return new Workspace(cacheDir, courseId, state);
  }

  /** Open a workspace folder anywhere, e.g. a copied `.eblib/books/<id>` directory. */
  static async openAt(dir: string): Promise<Workspace | null> {
    const state = await readJson<BookState>(join(dir, "book.json"));
    if (!state?.courseId) return null;
    return new Workspace(dir, state.courseId, state, dir);
  }

  static create(cacheDir: string, courseId: string, state: Omit<BookState, "updatedAt">): Workspace {
    return new Workspace(cacheDir, courseId, { ...state, updatedAt: new Date().toISOString() });
  }

  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  async save(): Promise<void> {
    this.state.updatedAt = new Date().toISOString();
    await writeJson(this.path("book.json"), this.state);
  }

  item(kind: ItemKind, id: string): ItemState | undefined {
    return this.state.items[itemKey(kind, id)];
  }

  async hasContent(kind: ItemKind, id: string): Promise<boolean> {
    const item = this.item(kind, id);
    if (!item?.content) return false;
    return exists(this.path(item.content));
  }

  async writeContent(kind: ItemKind, id: string, html: string, images = 0): Promise<void> {
    const rel = contentRelPath(kind, id);
    await writeAtomic(this.path(rel), html);
    this.state.items[itemKey(kind, id)] = {
      status: "done",
      content: rel,
      hash: hashText(html),
      fetchedAt: new Date().toISOString(),
      images,
    };
  }

  async markFailed(kind: ItemKind, id: string, error: string): Promise<void> {
    const previous = this.state.items[itemKey(kind, id)];
    this.state.items[itemKey(kind, id)] = {
      status: "failed",
      error,
      content: previous?.content,
      fetchedAt: new Date().toISOString(),
    };
  }

  async readContent(kind: ItemKind, id: string): Promise<string | null> {
    const item = this.item(kind, id);
    if (!item?.content) return null;
    try {
      return await readText(this.path(item.content));
    } catch {
      return null;
    }
  }

  addWarning(message: string): void {
    if (!this.state.warnings.includes(message)) this.state.warnings.push(message);
  }
}

export function hashText(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex").slice(0, 16);
}
