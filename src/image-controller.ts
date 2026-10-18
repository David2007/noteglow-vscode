import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename } from "node:path";
import { MAX_IMAGES, MAX_IMAGE_BYTES, MAX_IMAGE_TOTAL_BYTES, type ImageAttachment } from "./image-attachments.ts";
import { decodeImage, parseEncodedImages, type EncodedImage } from "./image-upload.ts";
import { ImageStore, readBoundedImage, type ImageInput } from "./image-store.ts";
import { ChatStore } from "./state.ts";
/** 原生路径仅由 VS Code picker/命令调用方传入；Webview 使用独立的字节消息入口。 */
export class ImageController {
  private store: ChatStore;
  private cache: ImageStore;
  private validateRoot: (root: string) => Promise<void>;
  constructor(store: ChatStore, cache: ImageStore, validateRoot: (root: string) => Promise<void>) { this.store = store; this.cache = cache; this.validateRoot = validateRoot; }
  async importEncoded(conversationId: string, raw: readonly EncodedImage[]): Promise<void> {
    const files = parseEncodedImages(raw);
    await this.importBatch(conversationId, async check => { check(); this.budget(conversationId, files.length, files.reduce((sum,file)=>sum+file.data.length/4*3-(file.data.endsWith("==")?2:file.data.endsWith("=")?1:0),0)); return files.map(file => ({ name: file.name, bytes: decodeImage(file) })); });
  }
  async importNative(conversationId: string, paths: readonly string[]): Promise<void> {
    if (!paths.length || paths.length > MAX_IMAGES) throw new Error("每条消息最多添加 10 张图片。");
    await this.importBatch(conversationId, async check => {
      const files: ImageInput[] = []; let total = 0, loaded = 0;
      this.budget(conversationId, paths.length, 0);
      // 先 stat 整批再读；任何单图或总量超预算都不分配整批图像缓冲。
      for (const path of paths) { check(); const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_IMAGE_BYTES) throw new Error("请选择普通图片文件，每张最多 10 MiB。"); total += stat.size; }
      this.budget(conversationId, paths.length, total);
      for (const path of paths) {
        check(); const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try { const stat = await handle.stat(); if (!stat.isFile() || !stat.size || stat.size > MAX_IMAGE_BYTES) throw new Error("图片文件在选择后发生变化。"); loaded += stat.size; this.budget(conversationId, paths.length, loaded); const bytes = await readBoundedImage(handle, stat.size); check(); files.push({ name: basename(path), bytes }); }
        finally { await handle.close(); }
      }
      return files;
    });
  }
  find(conversationId: string, imageId: string): ImageAttachment {
    this.store.assertConversation(conversationId); const c = this.store.current();
    const image = [...(c?.draftImages ?? []), ...(c?.messages.flatMap(message => message.images ?? []) ?? [])].find(image => image.id === imageId);
    if (!image) throw new Error("图片不属于当前会话。"); return image;
  }
  private budget(conversationId: string, count: number, bytes: number): void {
    this.store.assertConversation(conversationId); const previous = this.store.current()?.draftImages ?? [];
    if (previous.length + count > MAX_IMAGES) throw new Error("每条消息最多添加 10 张图片。");
    if (previous.reduce((total, image) => total + image.size, 0) + bytes > MAX_IMAGE_TOTAL_BYTES) throw new Error("图片合计超过 20 MiB。");
  }
  private async importBatch(conversationId: string, load: (check: () => void) => Promise<ImageInput[]>): Promise<void> {
    await this.store.importImages(conversationId, async check => {
      const c = this.store.current()!; await this.validateRoot(c.root); check();
      const inputs = await load(check); check(); this.budget(conversationId, inputs.length, inputs.reduce((sum, input) => sum + input.bytes.length, 0));
      const images = await this.cache.addBatch(inputs, check);
      return { images, discard: async () => { await Promise.all(images.map(image => this.cache.remove(image))); } };
    });
  }
}
