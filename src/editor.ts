import * as vscode from "vscode";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { type PortableColorEdit } from "./markdown-colors.ts";
import { applyNativeCodeColor, backupNativeCodeMigration, mapMigratedCodePosition, migrateOwnedCodeToNative, minimalTextChange, resetNativeCodeMetadata } from "./native-code-colors.ts";
import { applyNativeTextColor, formatNativeText, migrateOwnedTextToNative, resetNativeTextMetadata } from "./native-text-colors.ts";
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
export async function editSnapshot(snapshot: SelectionSnapshot, action: "bold" | "italic" | "code" | "clear" | ColorProperty, color?: string, applyOnly = false): Promise<void> {
  const { editor, text, from, to } = snapshot, doc = editor.document;
  // UTF-8 编码合同在写入前核验；TextDocument 会剥离 UTF-8 BOM，读回也按相同规则解码。
  decodeUtf8Markdown(await readFile(doc.uri.fsPath));
  let result: PortableColorEdit;
  if (["bold", "italic", "code"].includes(action)) result = formatNativeText(text, from, to, action as "bold" | "italic" | "code", applyOnly);
  else result = applyNativeCodeColor(text, from, to, action === "clear" ? undefined : action as ColorProperty, color) ?? applyNativeTextColor(text, from, to, action === "clear" ? undefined : action as ColorProperty, color);
  await commitSnapshot(snapshot, result);
}

async function commitSnapshot(snapshot: SelectionSnapshot, result: PortableColorEdit): Promise<void> {
  const { editor, text } = snapshot, doc = editor.document;
  // 选择器可能异步等待；提交前再次核验版本与全文，避免覆盖用户后续输入。
  if (doc.isClosed || doc.uri.toString() !== snapshot.uri || doc.version !== snapshot.version || doc.getText() !== text) throw new Error("文档已变化，请重新选择后应用。");
  const change = minimalTextChange(text, result.text);
  if (change.from === change.to && !change.insert) return;
  const accepted = await editor.edit(builder => builder.replace(new vscode.Range(doc.positionAt(change.from), doc.positionAt(change.to)), change.insert), { undoStopBefore: true, undoStopAfter: true });
  if (!accepted) throw new Error("编辑被拒绝，正文未覆盖。");
  const changedVersion = doc.version;
  editor.selection = new vscode.Selection(doc.positionAt(result.from), doc.positionAt(result.to));
  if (!await doc.save()) throw new Error("保存失败，修改仍在编辑器缓冲区，请检查后手动保存。");
  if (doc.version !== changedVersion || doc.getText() !== result.text || decodeUtf8Markdown(await readFile(doc.uri.fsPath)) !== result.text) throw new Error("保存期间文档有变化，请核对内容；没有回滚后续编辑。");
}


/** 显式迁移/重置只操作当前文件；备份读回与版本复查均在编辑之前，失败不会覆盖后续输入。 */
export async function restoreNative(editor: vscode.TextEditor | undefined, directory: string, reset = false): Promise<string | undefined> {
  if (!editor || editor.document.uri.scheme !== "file" || editor.document.languageId !== "markdown") throw new Error("请打开本机 Markdown 文件。");
  const doc = editor.document, text = doc.getText();
  const snapshot: SelectionSnapshot = { editor, uri: doc.uri.toString(), version: doc.version, text, from: doc.offsetAt(editor.selection.start), to: doc.offsetAt(editor.selection.end) };
  if (decodeUtf8Markdown(await readFile(doc.uri.fsPath)) !== text) throw new Error("磁盘与编辑器内容不同，请先保存并重新执行。");
  if (reset && /<!-- noteglow-(?:code|text)-colors:(?!1 )/.test(text)) throw new Error("存在未知版本颜色记录，未重置。");
  const code = reset ? resetNativeCodeMetadata(text) : migrateOwnedCodeToNative(text);
  const result = reset ? { text: resetNativeTextMetadata(code), map: (position: number) => position } : migrateOwnedTextToNative(code);
  if (result.text === text) return undefined;
  const isCurrent = () => !doc.isClosed && doc.version === snapshot.version && doc.getText() === text && doc.uri.toString() === snapshot.uri;
  const adapter = { exists: async (path: string) => { try { await access(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }, mkdir: async (path: string) => { await mkdir(path, { recursive: true, mode: 0o700 }); }, write: async (path: string, content: string) => { await writeFile(path, content, { mode: 0o600, flag: "wx" }); }, read: (path: string) => readFile(path, "utf8") };
  const backup = await backupNativeCodeMigration(adapter, directory, `${Date.now()}-${randomUUID()}.md`, text, isCurrent);
  if (decodeUtf8Markdown(await readFile(doc.uri.fsPath)) !== text) throw new Error("备份期间磁盘发生变化，未写入正文。");
  const mapped = (position: number) => Math.min(result.text.length, reset ? position : result.map(mapMigratedCodePosition(text, code, position)));
  await commitSnapshot(snapshot, { text: result.text, from: mapped(snapshot.from), to: mapped(snapshot.to) });
  return backup;
}

export interface InsertionSnapshot { editor: vscode.TextEditor; uri: string; version: number; text: string; offset: number }
/** 在点击消息到达宿主时抓取活动端点；空选区可插入，有选区也绝不替换选中文字。 */
export function captureInsertion(editor: vscode.TextEditor | undefined): InsertionSnapshot {
  if (!editor || !vscode.window.visibleTextEditors.includes(editor) || editor.document.isClosed || editor.document.languageId !== "markdown" || editor.document.uri.scheme !== "file") throw new Error("请先在本机 Markdown 笔记中放置插入光标。");
  if (editor.selections.length !== 1) throw new Error("请保留一个光标后再应用代码。");
  return { editor, uri: editor.document.uri.toString(), version: editor.document.version, text: editor.document.getText(), offset: editor.document.offsetAt(editor.selection.active) };
}
export async function insertAtSnapshot(snapshot: InsertionSnapshot, code: string): Promise<void> {
  const { editor, text, offset } = snapshot, doc = editor.document;
  if (!vscode.window.visibleTextEditors.includes(editor) || doc.isClosed || doc.uri.toString() !== snapshot.uri || doc.version !== snapshot.version || doc.getText() !== text) throw new Error("目标笔记已变化或关闭，请重新放置光标后再试。");
  // 一次原生插入，不调用 save、不替换选区，也不在 await 后重定向到其他编辑器。
  const accepted = await editor.edit(builder => builder.insert(doc.positionAt(offset), code), { undoStopBefore: true, undoStopAfter: true });
  if (!accepted) throw new Error("插入被编辑器拒绝，请检查笔记是否只读或已变化。");
}
