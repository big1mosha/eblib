import { createHash } from "node:crypto";
import { join } from "node:path";
import { imageSize } from "image-size";
import { writeAtomic } from "../io.ts";
import type { HttpClient } from "../http/client.ts";

export interface ImageResult {
  url: string;
  file: string;
  bytes: number;
  width?: number;
  height?: number;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/** Download one image into `<dir>/<sha256>.<ext>` and return its archive path. */
export async function downloadImage(
  client: HttpClient,
  url: string,
  dir: string,
  options: { refresh?: boolean; offline?: boolean } = {},
): Promise<ImageResult> {
  const response = await client.get(url, options);
  const contentType = (response.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = EXT_BY_TYPE[contentType] ?? sniffExtension(response.bytes) ?? "jpg";
  const name = `${createHash("sha256").update(response.bytes).digest("hex").slice(0, 16)}.${ext}`;
  const file = join(dir, name);
  await writeAtomic(file, response.bytes);

  let width: number | undefined;
  let height: number | undefined;
  try {
    const size = imageSize(response.bytes);
    width = size.width;
    height = size.height;
  } catch {
    // Unreadable dimensions are not fatal.
  }

  return { url, file, bytes: response.bytes.byteLength, width, height };
}

function sniffExtension(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return "webp";
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "svg";
  return undefined;
}
