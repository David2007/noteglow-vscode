import * as vscode from "vscode";
import { metadataFolds, mapMetadataPositions, type MetadataPosition, type MetadataFold } from "./metadata-folds.ts";

/** 折叠只改变当前编辑器视图，不写正文、设置或 Undo。自动操作每条记录仅尝试一次。 */
export function registerMetadataFolding(): vscode.Disposable {
  let disposed = false, ready = false, provider: vscode.Disposable | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Map<vscode.TextDocument, Map<number, { records: MetadataPosition[]; pending: boolean }>>(), changed = new vscode.EventEmitter<void>();
  const stateFor = (editor: vscode.TextEditor) => {
    let views = seen.get(editor.document); if (!views) { views = new Map(); seen.set(editor.document, views); }
    const column = editor.viewColumn ?? 0;
    let state = views.get(column); if (!state) { state = { records: [], pending: false }; views.set(column, state); }
    return state;
  };
  const enabled = () => vscode.workspace.getConfiguration("noteglow").get("autoFoldMetadata", true);
  const local = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor => !!editor && editor.document.uri.scheme === "file" && editor.document.languageId === "markdown" && !editor.document.isClosed;
  const selectionKey = (editor: vscode.TextEditor) => editor.selections.map(s => `${s.anchor.line}:${s.anchor.character}:${s.active.line}:${s.active.character}`).join(";");
  async function fold(force = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!ready || disposed || !local(editor) || (!force && !enabled())) return;
    const foldingEnabled = () => {
      const settings = vscode.workspace.getConfiguration("editor", editor.document.uri);
      return settings.get("folding", true) && settings.get("foldingStrategy", "auto") === "auto";
    };
    if (!foldingEnabled()) return;
    const doc = editor.document, version = doc.version, selection = selectionKey(editor), records = metadataFolds(doc.getText());
    const state = stateFor(editor), previous = state.records, selected = (record: MetadataFold) => editor.selections.some(s => s.start.line <= record.end && s.end.line >= record.end);
    const unseen = records.filter(record => record.status === "valid" && (force || !previous.some(old => old.from === record.from)));
    const fresh = unseen.filter(record => !selected(record));
    const stale = records.filter(record => record.status === "stale");
    // 查询期间光标仍可能移动；未处理或失效记录保持 pending，下一次选择事件可重新核验。
    state.pending = unseen.length > 0 || stale.length > 0;
    const remember = () => {
      state.records = records.filter(record => previous.some(old => old.from === record.from) || (record.status === "valid" && !selected(record)));
      state.pending = unseen.some(selected);
    };
    if (!fresh.length && !stale.length) { remember(); return; }
    // 先读宿主最终合并范围；第三方提供者或用户设置可能让本插件范围不生效，绝不能误折最近的标题。
    const actual = await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", doc.uri);
    const current = () => !disposed && (force || enabled()) && foldingEnabled() && vscode.window.activeTextEditor === editor && !doc.isClosed && doc.version === version && selectionKey(editor) === selection;
    if (!current() || !Array.isArray(actual)) return;
    const exact = (record: MetadataFold) => actual.some(range => range.start === record.start && range.end === record.end) &&
      (record.codeStart === undefined || actual.some(range => range.start === record.codeStart && range.end === record.codeEnd));
    const unfold = stale.filter(exact).map(record => record.start);
    if (unfold.length) await vscode.commands.executeCommand("editor.unfold", { selectionLines: unfold, levels: 1, direction: "down" });
    if (!current()) return;
    const collapse = fresh.filter(exact).map(record => record.start);
    if (collapse.length) await vscode.commands.executeCommand("editor.fold", { selectionLines: collapse, levels: 1, direction: "down" });
    if (current()) remember();
  }
  const schedule = () => {
    if (disposed || timer) return;
    timer = setTimeout(() => { timer = undefined; void fold().catch(() => {}); }, 100);
  };
  const listeners = [
    vscode.commands.registerCommand("noteglow.foldMetadata", () => fold(true).catch(() => { void vscode.window.showWarningMessage("颜色记录暂时无法折叠，请稍后重试。"); })),
    vscode.window.onDidChangeActiveTextEditor(schedule),
    vscode.window.onDidChangeVisibleTextEditors(schedule),
    vscode.window.onDidChangeTextEditorSelection(event => { if (seen.get(event.textEditor.document)?.get(event.textEditor.viewColumn ?? 0)?.pending) schedule(); }),
    vscode.workspace.onDidChangeTextDocument(event => { for (const state of seen.get(event.document)?.values() ?? []) state.records = mapMetadataPositions(state.records, event.contentChanges); changed.fire(); schedule(); }),
    vscode.workspace.onDidCloseTextDocument(doc => { seen.delete(doc); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("noteglow.autoFoldMetadata")) { seen.clear(); schedule(); } })
  ];
  // 不阻塞本插件 activate：内置 Markdown 可能同时加载本插件的 markdown-it 扩展，等待会造成激活循环。
  const markdown = vscode.extensions.getExtension("vscode.markdown-language-features");
  if (markdown) void markdown.activate().then(() => {
    if (disposed) return;
    provider = vscode.languages.registerFoldingRangeProvider({ language: "markdown", scheme: "file" }, {
      onDidChangeFoldingRanges: changed.event,
      provideFoldingRanges(doc) {
        return metadataFolds(doc.getText()).flatMap(record => [
          ...(record.codeStart === undefined ? [] : [new vscode.FoldingRange(record.codeStart, record.codeEnd!)]),
          new vscode.FoldingRange(record.start, record.end, vscode.FoldingRangeKind.Comment)
        ]);
      }
    });
    ready = true; schedule();
  }, () => {});
  return new vscode.Disposable(() => { disposed = true; if (timer) clearTimeout(timer); provider?.dispose(); for (const listener of listeners) listener.dispose(); changed.dispose(); seen.clear(); });
}
