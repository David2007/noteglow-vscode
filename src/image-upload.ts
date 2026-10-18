import { MAX_IMAGES, MAX_IMAGE_BYTES, MAX_IMAGE_TOTAL_BYTES } from "./image-attachments.ts";
export interface EncodedImage { name: string; data: string }
/** Base64 只存在于本轮传输；先检查编码长度与解码预算，不接受路径、URI 或自报 MIME。 */
export function parseEncodedImages(raw: unknown): EncodedImage[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_IMAGES) throw new Error("每条消息最多添加 10 张图片。");
  let total = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "data,name" || typeof item.name !== "string" || !item.name || item.name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(item.name) || typeof item.data !== "string") throw new Error("图片传输字段无效，不能提交本机路径。");
    const encoded = item.data;
    if (!encoded.length || encoded.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded)) throw new Error("图片编码无效或超过单张 10 MiB。");
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    if (encoded.slice(0, encoded.length - padding).includes("=")) throw new Error("图片编码无效。");
    const size = encoded.length / 4 * 3 - padding;
    if (size <= 0 || size > MAX_IMAGE_BYTES) throw new Error("图片超过单张 10 MiB。");
    total += size;
  }
  if (total > MAX_IMAGE_TOTAL_BYTES) throw new Error("图片合计超过 20 MiB。");
  return raw as EncodedImage[];
}
export function decodeImage(input: EncodedImage): Uint8Array {
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.toString("base64") !== input.data) throw new Error("图片编码不是规范 Base64。");
  return bytes;
}
