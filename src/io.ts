import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { EblibError, EXIT } from "./config.ts";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

export async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      throw new EblibError(`File not found: ${path}`, EXIT.usage);
    }
    throw cause;
  }
}

/** Write through a temp file so a crash never leaves a half-written file. */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, data);
  await rename(temp, path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function bookDir(cacheDir: string, courseId: string): string {
  return join(cacheDir, "books", courseId);
}

export function bookPath(cacheDir: string, courseId: string, ...parts: string[]): string {
  return join(bookDir(cacheDir, courseId), ...parts);
}

export function resolvePath(path: string): string {
  return resolve(path);
}
