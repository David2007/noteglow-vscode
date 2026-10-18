import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { inspectImage, isImageAttachment, validateImages, MAX_IMAGE_BYTES, MAX_IMAGES, MAX_IMAGE_TOTAL_BYTES, type ImageAttachment } from "./image-attachments.ts";
export interface PreparedImages { paths: string[]; dispose: () => Promise<void> }
export interface ImageInput { name: string; bytes: Uint8Array }
/** VS Code 私有工作区存储；调用方不得把 Webview 路径当作 storageDirectory。 */
export class ImageStore {
  readonly directory: string;
  private base: string;
  constructor(storageDirectory: string) {
    if (!isAbsolute(storageDirectory)) throw new Error("图片存储需要绝对的工作区私有目录。");
    this.base = resolve(storageDirectory); this.directory = join(this.base, "image-attachments");
  }
  async add(name: string, bytes: Uint8Array): Promise<ImageAttachment> {
    const inspected = inspectImage(bytes), id = randomUUID();
    const extension = inspected.mime === "image/png" ? "png" : inspected.mime === "image/jpeg" ? "jpg" : "webp";
    const image: ImageAttachment = { id, name: name.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 200) || `图片.${extension}`, fileName: `${id}.${extension}`, ...inspected, size: bytes.length, sha256: hash(bytes) };
    await this.checkedDirectory();
    const handle = await open(join(this.directory, image.fileName), "wx", 0o600);
    try { await handle.writeFile(bytes); } catch (e) { await handle.close(); await this.remove(image); throw e; }
    await handle.close(); return image;
  }
  /** 先对整批作头部与预算预检；任何失败只清理本批尚未交给会话的副本。 */
  async addBatch(inputs: readonly ImageInput[], check: () => void = () => {}): Promise<ImageAttachment[]> {
    if (!inputs.length) throw new Error("请选择图片。");
    if (inputs.length > MAX_IMAGES) throw new Error("每条消息最多添加 10 张图片。");
    if (inputs.reduce((total, input) => total + input.bytes.length, 0) > MAX_IMAGE_TOTAL_BYTES) throw new Error("图片合计超过 20 MiB。");
    for (const input of inputs) inspectImage(input.bytes);
    const created: ImageAttachment[] = [];
    try { for (const input of inputs) { check(); created.push(await this.add(input.name, input.bytes)); check(); } return created; }
    catch(e) { await Promise.all(created.map(image => this.remove(image))); throw e; }
  }
  async verify(image: ImageAttachment): Promise<Uint8Array> {
    if (!isImageAttachment(image)) throw new Error("图片引用已损坏，请重新添加。");
    await this.checkedDirectory(); const path = join(this.directory, image.fileName);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== image.size || await realpath(path) !== await this.canonicalFile(image.fileName)) throw new Error("图片缓存已变化，请重新添加。");
    // O_NOFOLLOW 与 fd.stat 防止文件名检查后被换成符号链接；读取后仍核验完整摘要。
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.size !== image.size || current.size > MAX_IMAGE_BYTES) throw new Error("图片缓存大小已变化。");
      const bytes = await readBoundedImage(handle, image.size);
      if (bytes.length !== image.size || hash(bytes) !== image.sha256) throw new Error("图片内容已变化，请重新添加。");
      const actual = inspectImage(bytes);
      if (actual.mime !== image.mime || actual.width !== image.width || actual.height !== image.height) throw new Error("图片元数据与内容不一致。");
      return bytes;
    } finally { await handle.close(); }
  }
  async verifiedPath(image: ImageAttachment): Promise<string> { await this.verify(image); return join(this.directory, image.fileName); }
  async remove(image: ImageAttachment): Promise<void> { if (!isImageAttachment(image)) throw new Error("图片引用无效。"); await this.checkedDirectory(); await rm(join(this.directory, image.fileName), { force: true }); }
  async prepare(images: readonly ImageAttachment[], check: () => void = () => {}): Promise<PreparedImages> {
    const error = validateImages(images); if (error) throw new Error(error);
    if (!images.length) return { paths: [], dispose: async () => {} };
    check(); const directory = await mkdtemp(join(tmpdir(), "noteglow-images-"));
    const dispose = async (): Promise<void> => { await rm(directory, { recursive: true, force: true }); };
    const paths: string[] = [];
    try {
      for (const image of images) {
        check(); const bytes = await this.verify(image); check();
        const path = join(directory, image.fileName), handle = await open(path, "wx", 0o600);
        try { await handle.writeFile(bytes); } finally { await handle.close(); }
        paths.push(path); check();
      }
      return { paths, dispose };
    } catch(e) { await dispose(); throw e; }
  }
  private async canonicalFile(fileName: string): Promise<string> { return join(await realpath(this.base), "image-attachments", fileName); }
  private async checkedDirectory(): Promise<void> {
    await mkdir(this.base, { recursive: true, mode: 0o700 });
    if ((await lstat(this.base)).isSymbolicLink()) throw new Error("工作区私有存储不能是符号链接。");
    const base = await realpath(this.base);
    await mkdir(this.directory, { mode: 0o700 }).catch(e => { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(this.directory) !== join(base, "image-attachments")) throw new Error("图片缓存目录包含符号链接，未读写图片。");
  }
}
export function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

/** fd 读入最多 expected+1 字节，避免 stat 后文件暴涨造成无界 readFile 分配。 */
export async function readBoundedImage(handle: FileHandle, expected: number): Promise<Uint8Array> {
  if (!Number.isInteger(expected) || expected <= 0 || expected > MAX_IMAGE_BYTES) throw new Error("图片大小超出限制。");
  const bytes = Buffer.alloc(expected + 1); let offset = 0;
  while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
  if (offset !== expected) throw new Error("图片文件在读取时发生变化。");
  return bytes.subarray(0, expected);
}
