import { relative, isAbsolute } from "node:path";
export function containsPath(root: string, target: string): boolean { const r = relative(root, target); return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)); }
export type ViewMessage = { type: "ready" } | { type: "new" | "stop" | "send"; conversationId: string } | { type: "draft"; conversationId: string; text: string; model: string } | { type: "select" | "delete" | "detach" | "preview"; conversationId: string; id: string } | { type: "command"; conversationId: string; command: string };
export const VIEW_COMMANDS = ["addSelection", "addFile", "bold", "italic", "code", "foreground", "background", "chooseForeground", "chooseBackground", "clearColor"];
export function parseViewMessage(value: unknown): ViewMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("消息格式无效。");
  const v = value as Record<string, unknown>;
  if (v.type === "ready" && Object.keys(v).length === 1) return v as ViewMessage;
  if (typeof v.conversationId !== "string" || v.conversationId.length > 200) throw new Error("缺少有效的会话标识。");
  if (["new", "stop", "send"].includes(String(v.type)) && Object.keys(v).length === 2) return v as ViewMessage;
  if (v.type === "draft" && Object.keys(v).length === 4 && typeof v.text === "string" && v.text.length <= 50_000 && typeof v.model === "string" && /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]{0,100})?$/.test(v.model)) return v as ViewMessage;
  if (["select", "delete", "detach", "preview"].includes(String(v.type)) && Object.keys(v).length === 3 && typeof v.id === "string" && v.id.length <= 200) return v as ViewMessage;
  if (v.type === "command" && Object.keys(v).length === 3 && typeof v.command === "string" && VIEW_COMMANDS.includes(v.command)) return v as ViewMessage;
  throw new Error("不支持的消息或字段超限。");
}
