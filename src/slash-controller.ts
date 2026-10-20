import * as vscode from "vscode";
import { slashCommandEdit, type SlashEdit } from "./editor-shortcuts.ts";

/** 快捷键 context 只是提示；真正写入前同步重算，避免光标/文档切换后使用过期范围。 */
export function activeSlashEdit(editor: vscode.TextEditor | undefined): SlashEdit | null {
  if (!editor || editor.document.uri.scheme !== "file" || editor.document.languageId !== "markdown" || editor.document.isClosed || editor.selections.length !== 1 || !editor.selection.isEmpty) return null;
  const line = editor.document.lineAt(editor.selection.active.line).text;
  if (editor.selection.active.character !== line.length || !/^ {0,3}\/(code|bg)$/.test(line)) return null;
  return slashCommandEdit(editor.document.getText(), editor.document.offsetAt(editor.selection.active));
}

export function registerSlashCommands(): vscode.Disposable {
  const refresh = (): void => { void vscode.commands.executeCommand("setContext", "noteglow.slashReady", !!activeSlashEdit(vscode.window.activeTextEditor)); };
  const command = vscode.commands.registerCommand("noteglow.expandSlash", async () => {
    const editor = vscode.window.activeTextEditor, edit = activeSlashEdit(editor);
    // 即使事件尚未刷新 context，普通 Enter 也必须回到宿主，不能吞掉用户输入。
    if (!editor || !edit) { await vscode.commands.executeCommand("type", { text: "\n" }); return; }
    // final tabstop 随原生 snippet 事务记录光标，Undo/Redo 和普通编辑使用同一历史栈。
    const offset = edit.cursor - edit.from;
    const snippet = new vscode.SnippetString().appendText(edit.insert.slice(0, offset)).appendTabstop(0).appendText(edit.insert.slice(offset));
    try {
      const accepted = await editor.insertSnippet(snippet, new vscode.Range(editor.document.positionAt(edit.from), editor.document.positionAt(edit.to)), { undoStopBefore: true, undoStopAfter: true });
      if (!accepted) void vscode.window.showWarningMessage("代码块或表格转换未被接受，请检查当前文档后重试。");
    } catch {
      void vscode.window.showWarningMessage("代码块或表格转换失败，请检查当前文档后重试。");
    } finally { refresh(); }
  });
  const listeners = [vscode.window.onDidChangeActiveTextEditor(refresh), vscode.window.onDidChangeTextEditorSelection(refresh), vscode.workspace.onDidChangeTextDocument(refresh)];
  refresh();
  return new vscode.Disposable(() => { command.dispose(); for (const listener of listeners) listener.dispose(); void vscode.commands.executeCommand("setContext", "noteglow.slashReady", false); });
}
