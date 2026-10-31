import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir } from "../io.ts";

export interface CachedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  bytes: Uint8Array;
  fetchedAt: string;
}

interface Row {
  url: string;
  status: number;
  headers: string;
  body_path: string;
  fetched_at: string;
}

/**
 * SQLite index plus one file per body. Bodies are kept on disk so the database
 * stays small and the raw HTML can be inspected with ordinary tools.
 */
export class HttpCache {
  private readonly db: Database;
  private readonly bodyDir: string;

  private constructor(db: Database, bodyDir: string) {
    this.db = db;
    this.bodyDir = bodyDir;
  }

  static async open(cacheDir: string): Promise<HttpCache> {
    await ensureDir(cacheDir);
    const bodyDir = join(cacheDir, "http");
    await ensureDir(bodyDir);
    const db = new Database(join(cacheDir, "http.db"), { create: true });
    db.exec(`
      CREATE TABLE IF NOT EXISTS http (
        url TEXT PRIMARY KEY,
        status INTEGER NOT NULL,
        headers TEXT NOT NULL,
        body_path TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS http_fetched ON http (fetched_at);
    `);
    return new HttpCache(db, bodyDir);
  }

  private bodyPath(url: string): string {
    return join(this.bodyDir, createHash("sha256").update(url).digest("hex"));
  }

  async get(url: string): Promise<CachedResponse | null> {
    const row = this.db.query<Row, [string]>("SELECT * FROM http WHERE url = ?").get(url);
    if (!row) return null;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(row.body_path));
    } catch {
      this.delete(url);
      return null;
    }
    return {
      url: row.url,
      status: row.status,
      headers: safeParse(row.headers),
      bytes,
      fetchedAt: row.fetched_at,
    };
  }

  async put(response: CachedResponse): Promise<void> {
    const path = this.bodyPath(response.url);
    await writeFile(path, response.bytes);
    this.db
      .query(
        `INSERT INTO http (url, status, headers, body_path, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           status = excluded.status,
           headers = excluded.headers,
           body_path = excluded.body_path,
           fetched_at = excluded.fetched_at`,
      )
      .run(response.url, response.status, JSON.stringify(response.headers), path, response.fetchedAt);
  }

  delete(url: string): void {
    this.db.query("DELETE FROM http WHERE url = ?").run(url);
  }

  list(limit = 50): Array<{ url: string; status: number; fetchedAt: string }> {
    return this.db
      .query<{ url: string; status: number; fetched_at: string }, [number]>(
        "SELECT url, status, fetched_at FROM http ORDER BY fetched_at DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => ({ url: row.url, status: row.status, fetchedAt: row.fetched_at }));
  }

  count(): number {
    const row = this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM http").get();
    return row?.n ?? 0;
  }

  /** Drop rows whose body file disappeared and report what was checked. */
  async verify(): Promise<{ checked: number; missing: number }> {
    const rows = this.db
      .query<{ url: string; body_path: string }, []>("SELECT url, body_path FROM http")
      .all();
    let missing = 0;
    for (const row of rows) {
      try {
        await stat(row.body_path);
      } catch {
        this.delete(row.url);
        missing += 1;
      }
    }
    return { checked: rows.length, missing };
  }

  clear(): void {
    this.db.exec("DELETE FROM http;");
  }

  close(): void {
    this.db.close();
  }
}

const decoder = new TextDecoder();

export function textOf(response: CachedResponse): string {
  return decoder.decode(response.bytes);
}

function safeParse(value: string): Record<string, string> {
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return {};
  }
}
