import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { parseViewMessage, type ViewMessage } from "./security.ts";
export class ChatView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private extensionUri: vscode.Uri;
  private receive: (message: ViewMessage) => Promise<void>;
  constructor(extensionUri: vscode.Uri, receive: (message: ViewMessage) => Promise<void>) { this.extensionUri = extensionUri; this.receive = receive; }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view; const webview = view.webview, media = vscode.Uri.joinPath(this.extensionUri, "media");
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(24).toString("base64");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "main.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "main.js"));
    webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none';"><link rel="stylesheet" href="${css}"></head><body><header><strong>NoteGlow</strong><button id="new" title="新对话">＋ 新对话</button></header><div class="session"><select id="conversations" aria-label="对话"></select><button id="delete" title="删除当前对话">删除</button></div><div id="root"></div><div class="tools" aria-label="笔记格式工具栏"><button data-command="addSelection" title="添加编辑器选区">＋引用</button><button data-command="addFile" title="添加当前文件">＋文件</button><button data-command="bold" title="加粗"><b>B</b></button><button data-command="italic" title="斜体"><i>I</i></button><button data-command="code" title="行内代码">&lt;/&gt;</button><button id="foreground" data-command="foreground" title="应用上次字体色">A</button><button data-command="chooseForeground" title="选择字体色">▾</button><button id="background" data-command="background" title="应用上次背景色">▰</button><button data-command="chooseBackground" title="选择背景色">▾</button><button data-command="clearColor" title="清除选区颜色">⌫</button></div><main id="messages" aria-live="polite"></main><div id="status" role="status"></div><section class="composer"><div id="attachments"></div><textarea disabled id="question" maxlength="50000" rows="4" placeholder="输入问题；引用单独保留为紧凑卡片" aria-label="问题"></textarea><footer><select id="model" aria-label="Codex 模型"></select><span id="permission"></span><button id="stop">停止</button><button disabled id="send">发送 ↑</button></footer></section><script nonce="${nonce}" src="${js}"></script></body></html>`;
    webview.onDidReceiveMessage(async value => { try { await this.receive(parseViewMessage(value)); } catch(e) { vscode.window.showErrorMessage(e instanceof Error ? e.message : "NoteGlow 操作失败。"); } });
    view.onDidDispose(() => { if(this.view === view) this.view = undefined; });
  }
  post(value: unknown): void { void this.view?.webview.postMessage(value); }
}
