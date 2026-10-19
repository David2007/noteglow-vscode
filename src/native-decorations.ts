import * as vscode from "vscode";
import { nativeTextColorRanges } from "./native-text-colors.ts";
import { scanNativeCode } from "./native-code-colors.ts";
import type { ColorRange } from "./color-ranges.ts";

/** 只有精确快照有效时显示；普通键入事件不会产生文档编辑、保存或新的 Undo 项。 */
export function nativeEditorRanges(text: string): ColorRange[] {
  try {
    return [...nativeTextColorRanges(text), ...scanNativeCode(text).filter((block) => block.status === "valid").flatMap((block) => block.ranges.map((range) => ({ ...range, from: range.from + block.codeFrom, to: range.to + block.codeFrom })))];
  } catch { return []; }
}
export function registerNativeDecorations(): vscode.Disposable {
  const types = new Map<string, vscode.TextEditorDecorationType>();
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
  const refresh = () => {
    timer = undefined; if (disposed) return;
    const used = new Set<string>();
    for (const editor of vscode.window.visibleTextEditors) {
      const groups = new Map<string, vscode.Range[]>();
      if (editor.document.languageId === "markdown") for (const range of nativeEditorRanges(editor.document.getText())) {
        const key = `${range.property}:${range.color}`, values = groups.get(key) ?? [];
        values.push(new vscode.Range(editor.document.positionAt(range.from), editor.document.positionAt(range.to))); groups.set(key, values);
        if (!types.has(key)) types.set(key, vscode.window.createTextEditorDecorationType({ ...(range.property === "foreground" ? { color: range.color } : { backgroundColor: range.color }), rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed }));
      }
      for (const [key, type] of types) editor.setDecorations(type, groups.get(key) ?? []);
      for (const key of groups.keys()) used.add(key);
    }
    for (const [key, type] of types) if (!used.has(key)) { type.dispose(); types.delete(key); }
  };
  const schedule = () => { if (!disposed && !timer) timer = setTimeout(refresh, 40); };
  const events = [vscode.workspace.onDidChangeTextDocument(schedule), vscode.workspace.onDidCloseTextDocument(schedule), vscode.window.onDidChangeVisibleTextEditors(schedule)];
  refresh();
  return new vscode.Disposable(() => { disposed = true; if (timer) clearTimeout(timer); for (const event of events) event.dispose(); for (const type of types.values()) type.dispose(); types.clear(); });
}
