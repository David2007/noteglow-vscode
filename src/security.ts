import { parseEncodedImages, type EncodedImage } from "./image-upload.ts";
import { relative, isAbsolute } from "node:path";
export function containsPath(root: string, target: string): boolean { const r = relative(root, target); return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)); }
export type ReplyAction = { type: "copyReply"; conversationId: string; requestId: string; messageIndex: number } | { type: "applyReplyCode"; conversationId: string; requestId: string; messageIndex: number; blockIndex: number };
export type ViewMessage = ReplyAction | { type: "images"; conversationId: string; requestId: string; files: EncodedImage[] } | { type: "ready" } | { type: "new" | "stop"; conversationId: string } | { type: "send"; conversationId: string; requestId: string } | { type: "draft"; conversationId: string; text: string; model: string } | { type: "select" | "delete" | "detach" | "preview" | "removeImage" | "previewImage" | "imageResource"; conversationId: string; id: string } | { type: "command"; conversationId: string; command: string };
export const VIEW_COMMANDS = ["addSelection", "addFile", "textFormat", "bold", "strike", "italic", "underline", "link", "code", "foreground", "background", "chooseForeground", "chooseBackground", "clearColor", "addImages"];
export function parseViewMessage(value: unknown): ViewMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("消息格式无效。");
  const v = value as Record<string, unknown>;
  if (v.type === "ready" && Object.keys(v).length === 1) return v as ViewMessage;
  if (typeof v.conversationId !== "string" || v.conversationId.length > 200) throw new Error("缺少有效的会话标识。");
  if ((v.type === "copyReply" || v.type === "applyReplyCode") && requestIdentity(v) && Number.isSafeInteger(v.messageIndex) && (v.messageIndex as number) >= 0 && (v.messageIndex as number) < 500) {
    if (v.type === "copyReply" && Object.keys(v).length === 4) return v as ReplyAction;
    if (v.type === "applyReplyCode" && Object.keys(v).length === 5 && Number.isSafeInteger(v.blockIndex) && (v.blockIndex as number) >= 0) return v as ReplyAction;
  }
  if (v.type === "images" && Object.keys(v).length === 4 && requestIdentity(v)) return { type: "images", conversationId: v.conversationId, requestId: v.requestId as string, files: parseEncodedImages(v.files) };
  if (v.type === "send" && Object.keys(v).length === 3 && requestIdentity(v)) return v as ViewMessage;
  if (["new", "stop"].includes(String(v.type)) && Object.keys(v).length === 2) return v as ViewMessage;
  if (v.type === "draft" && Object.keys(v).length === 4 && typeof v.text === "string" && v.text.length <= 50_000 && typeof v.model === "string" && /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]{0,100})?$/.test(v.model)) return v as ViewMessage;
  if (["select", "delete", "detach", "preview", "removeImage", "previewImage", "imageResource"].includes(String(v.type)) && Object.keys(v).length === 3 && typeof v.id === "string" && v.id.length <= 200) return v as ViewMessage;
  if (v.type === "command" && Object.keys(v).length === 3 && typeof v.command === "string" && VIEW_COMMANDS.includes(v.command)) return v as ViewMessage;
  throw new Error("不支持的消息或字段超限。");
}

/** 仅回传有界请求标识；即使正文 schema 被拒绝，合法调用方也能释放本地等待槽位。 */
export function requestIdentity(value: unknown): { conversationId: string; requestId: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (!["images", "send", "copyReply", "applyReplyCode"].includes(String(item.type)) || typeof item.conversationId !== "string" || item.conversationId.length > 200 || typeof item.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.requestId)) return undefined;
  return { conversationId: item.conversationId, requestId: item.requestId };
}
