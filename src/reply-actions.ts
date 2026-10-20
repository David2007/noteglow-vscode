import { fromMarkdown } from "mdast-util-from-markdown";
import type { State } from "./state.ts";

export type ReplyPart = { type: "text"; text: string } | { type: "code"; text: string; language: string; blockIndex: number };
/** AST 决定代码边界，避免把代码内较短围栏、HTML 或普通反引号误切开；只用 textContent 展示。 */
export function replyParts(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [], blocks: Array<{ from: number; to: number; text: string; language: string }> = [];
  const visit = (node: ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>["children"][number]): void => {
    if (node.type === "code" && node.position) blocks.push({ from: node.position.start.offset!, to: node.position.end.offset!, text: node.value, language: node.lang ?? "" });
    else if ("children" in node) for (const child of node.children) visit(child as Parameters<typeof visit>[0]);
  };
  visit(fromMarkdown(text));
  let offset = 0;
  for (const [blockIndex, block] of blocks.entries()) {
    if (block.from > offset) parts.push({ type: "text", text: text.slice(offset, block.from) });
    parts.push({ type: "code", text: block.text, language: block.language, blockIndex }); offset = block.to;
  }
  if (offset < text.length || !parts.length) parts.push({ type: "text", text: text.slice(offset) });
  return parts;
}

/** 操作只引用当前会话已存储的 assistant 回复；客户端永远不能指定要写入或复制的正文。 */
export function resolveReply(state: State, conversationId: string, messageIndex: number, blockIndex?: number): string {
  if (state.activeId !== conversationId) throw new Error("会话已切换，请重新操作。");
  const conversation = state.conversations.find(item => item.id === conversationId), message = conversation?.messages[messageIndex];
  if (!Number.isSafeInteger(messageIndex) || messageIndex < 0 || !message || message.role !== "assistant") throw new Error("回复已不存在或不是 Codex 回复。");
  if (blockIndex === undefined) return message.text;
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) throw new Error("代码块标识无效。");
  const part = replyParts(message.text).find(item => item.type === "code" && item.blockIndex === blockIndex);
  if (!part || part.type !== "code") throw new Error("代码块已不存在，请重新操作。");
  if (!part.text.length) throw new Error("代码块为空，没有可插入的内容。");
  return part.text;
}
