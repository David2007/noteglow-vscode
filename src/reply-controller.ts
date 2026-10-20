import * as vscode from "vscode";
import { captureInsertion, insertAtSnapshot } from "./editor.ts";
import { resolveReply } from "./reply-actions.ts";
import type { ReplyAction } from "./security.ts";
import type { State } from "./state.ts";

/** 在任何异步操作前固定点击时的笔记与代码来源；复制不依赖笔记，也不等待 Codex 运行队列。 */
export async function performReplyAction(state: State, message: ReplyAction, editor: vscode.TextEditor | undefined): Promise<void> {
  const target = message.type === "applyReplyCode" ? captureInsertion(editor) : undefined;
  const text = resolveReply(state, message.conversationId, message.messageIndex, message.type === "applyReplyCode" ? message.blockIndex : undefined);
  if (target) await insertAtSnapshot(target, text); else await vscode.env.clipboard.writeText(text);
}
