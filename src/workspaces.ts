import * as vscode from "vscode";
import { realpath } from "node:fs/promises";
import { containsPath } from "./security.ts";
export function localFolders(): readonly vscode.WorkspaceFolder[] {
  if (vscode.env.remoteName) throw new Error("NoteGlow 首版仅支持本机桌面工作区，不在远程环境启动本机 CLI。");
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length || folders.some(f => f.uri.scheme !== "file")) throw new Error("请先打开本机磁盘文件夹工作区。");
  return folders;
}
export async function chooseRoot(): Promise<string> {
  const folders = localFolders();
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(folders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f })), { title: "选择本次对话固定的根目录" }).then(i => i?.folder);
  if (!folder) throw new Error("未选择工作区。"); return await realpath(folder.uri.fsPath);
}
export async function verifyRoot(root: string, trust = true): Promise<void> {
  const folders = localFolders(); if (trust && !vscode.workspace.isTrusted) throw new Error("Codex 执行需要先信任当前工作区。");
  const roots = await Promise.all(folders.map(f => realpath(f.uri.fsPath)));
  if (!roots.includes(await realpath(root))) throw new Error("对话的根目录已移除，请重新打开该工作区。");
}
export async function verifyFile(root: string, uri: vscode.Uri): Promise<void> {
  await verifyRoot(root, false); if(uri.scheme !== "file") throw new Error("引用仅支持本机已保存文件。");
  if (!containsPath(root, await realpath(uri.fsPath))) throw new Error("引用不能跨工作区根目录或通过符号链接指向根目录之外。");
}
