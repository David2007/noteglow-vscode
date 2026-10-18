import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { applyMarkdownColor, formatMarkdownSelection, type PortableColorEdit } from "./markdown-colors.ts";
import type { ColorProperty } from "./color-ranges.ts";
export interface SelectionSnapshot { editor: vscode.TextEditor; uri: string; version: number; text: string; from: number; to: number }
export function capture(editor: vscode.TextEditor | undefined): SelectionSnapshot {
  if (!editor || editor.document.languageId !== "markdown" || editor.document.uri.scheme !== "file") throw new Error("请打开本机 Markdown 文件并选择文字。");
  if (editor.selections.length !== 1 || editor.selection.isEmpty) throw new Error("请选择一个连续的非空选区。");
  return { editor, uri: editor.document.uri.toString(), version: editor.document.version, text: editor.document.getText(), from: editor.document.offsetAt(editor.selection.start), to: editor.document.offsetAt(editor.selection.end) };
}
export function decodeUtf8Markdown(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("编码不支持");
    return text;
  } catch { throw new Error("便携格式仅支持 UTF-8（可带 BOM），请先转换文件编码；正文未回滚。"); }
}
export async function editSnapshot(snapshot: SelectionSnapshot, action: "bold" | "italic" | "code" | "clear" | ColorProperty, color?: string): Promise<void> {
  const { editor, text, from, to } = snapshot, doc = editor.document;
  // UTF-8 编码合同在写入前核验；TextDocument 会剥离 UTF-8 BOM，读回也按相同规则解码。
  decodeUtf8Markdown(await readFile(doc.uri.fsPath));
  let result: PortableColorEdit;
  if (["bold", "italic", "code"].includes(action)) result = formatMarkdownSelection(text, from, to, action as "bold" | "italic" | "code");
  else result = applyMarkdownColor(text, from, to, action === "clear" ? undefined : action as ColorProperty, color);
  // 选择器可能异步等待；提交前再次核验版本与全文，避免覆盖用户后续输入。
  if (doc.isClosed || doc.uri.toString() !== snapshot.uri || doc.version !== snapshot.version || doc.getText() !== text) throw new Error("文档已变化，请重新选择后应用。");
  const accepted = await editor.edit(builder => builder.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), result.text), { undoStopBefore: true, undoStopAfter: true });
  if (!accepted) throw new Error("编辑被拒绝，正文未覆盖。");
  const changedVersion = doc.version;
  editor.selection = new vscode.Selection(doc.positionAt(result.from), doc.positionAt(result.to));
  if (!await doc.save()) throw new Error("保存失败，修改仍在编辑器缓冲区，请检查后手动保存。");
  if (doc.version !== changedVersion || doc.getText() !== result.text || decodeUtf8Markdown(await readFile(doc.uri.fsPath)) !== result.text) throw new Error("保存期间文档有变化，请核对内容；没有回滚后续编辑。");
}
