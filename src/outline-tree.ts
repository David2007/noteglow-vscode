import * as vscode from "vscode";
import { outlineTree, currentHeading, type OutlineNode } from "./outline-model.ts";
import { sourceHeadings } from "./outline-source.ts";

/** 原生侧栏只维护当前编辑器快照，不修改笔记；多窗格点击使用原编辑器组。 */
export function registerOutline(context: vscode.ExtensionContext): vscode.Disposable {
  const changed = new vscode.EventEmitter<OutlineNode | undefined>();
  let editor: vscode.TextEditor | undefined, roots: OutlineNode[] = [], flat: OutlineNode[] = [], revision = -1;
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
  const provider: vscode.TreeDataProvider<OutlineNode> = {
    onDidChangeTreeData: changed.event,
    getChildren: node => node ? node.children : roots,
    getParent: node => node.parent,
    getTreeItem(node) {
      const item = new vscode.TreeItem(node.title, node.children.length ? (node.depth < 1 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None);
      item.id = `${editor!.document.uri.toString()}:${node.line}`;
      item.tooltip = `${node.title} · 第 ${node.line + 1} 行`;
      item.command = { command: "noteglow.outline.jump", title: "跳到标题", arguments: [editor!.document.uri, node.line, editor!.viewColumn, revision] };
      return item;
    }
  };
  const view = vscode.window.createTreeView("noteglow.outline", { treeDataProvider: provider, showCollapseAll: true });
  const reveal = (line = editor?.selection.active.line): void => {
    if (!editor || !view.visible) return;
    const node = currentHeading(flat, line ?? 0);
    if (node) void view.reveal(node, { select: true, focus: false, expand: false }).then(undefined, () => {});
  };
  const refresh = (): void => {
    if (disposed) return;
    const active = vscode.window.activeTextEditor;
    // 预览/侧栏获得焦点时保留最后的笔记；明确切到非 Markdown 编辑器才清空。
    if (!active) return;
    const next = active.document.languageId === "markdown" ? active : undefined;
    if (next === editor && next?.document.version === revision) { reveal(); return; }
    editor = next; revision = next?.document.version ?? -1;
    roots = next ? outlineTree(sourceHeadings(next.document.getText())) : [];
    flat = []; const collect = (nodes: OutlineNode[]): void => { for (const node of nodes) { flat.push(node); collect(node.children); } }; collect(roots);
    view.message = next ? (next.document.getText().length > 1_000_000 ? "笔记超过 100 万字符，目录已暂停。" : roots.length ? undefined : "当前笔记暂无标题") : "打开 Markdown 笔记以显示目录";
    view.description = next ? vscode.workspace.asRelativePath(next.document.uri).split(/[\\/]/).pop() : undefined;
    changed.fire(undefined); reveal();
    // 只在本工作区首次使用时打开侧栏，之后尊重用户手动隐藏；焦点仍留在正文。
    if (next && !context.workspaceState.get("outlineShown", false)) {
      void context.workspaceState.update("outlineShown", true);
      void vscode.commands.executeCommand("noteglow.outline.focus", { preserveFocus: true });
    }
  };
  const subscriptions = [view, changed,
    vscode.commands.registerCommand("noteglow.outline.jump", async (uri: vscode.Uri, line: number, column?: vscode.ViewColumn, version?: number) => {
      if (!uri || !Number.isInteger(line) || line < 0) return;
      // 编辑事件有短暂防抖；旧目录条目不能定位到已经变化的源码行。
      const doc = await vscode.workspace.openTextDocument(uri);
      if (version !== undefined && doc.version !== version) { refresh(); return; }
      const target = await vscode.window.showTextDocument(doc, { viewColumn: column, preserveFocus: false });
      const position = new vscode.Position(Math.min(line, doc.lineCount - 1), 0);
      target.selection = new vscode.Selection(position, position); target.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
    }),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.window.onDidChangeTextEditorSelection(event => { if (event.textEditor === editor) reveal(); }),
    vscode.window.onDidChangeTextEditorVisibleRanges(event => { if (event.textEditor === editor) reveal(event.visibleRanges[0]?.start.line); }),
    vscode.workspace.onDidChangeTextDocument(event => { if (event.document === editor?.document) { clearTimeout(timer); timer = setTimeout(refresh, 150); } }),
    view.onDidChangeVisibility(event => { if (event.visible) reveal(); })
  ];
  refresh();
  return { dispose() { disposed = true; clearTimeout(timer); for (const subscription of subscriptions) subscription.dispose(); } };
}
