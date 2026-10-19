import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { relative, join } from "node:path";
import { MAX_IMAGES, MAX_IMAGE_BYTES, MAX_IMAGE_TOTAL_BYTES } from "./image-attachments.ts";
import { ImageStore } from "./image-store.ts";
import { ImageController } from "./image-controller.ts";
import { ChatStore, emptyState } from "./state.ts";
import { readState, writeState } from "./disk.ts";
import { CodexClient } from "./codex-client.ts";
import { readModels, type CodexModel } from "./models.ts";
import { capture, editSnapshot, restoreNative, type SelectionSnapshot } from "./editor.ts";
import { chooseRoot, verifyRoot, verifyFile } from "./workspaces.ts";
import { normalizeColor, type ColorProperty } from "./color-ranges.ts";
import { ChatView } from "./view.ts";
import type { ViewMessage } from "./security.ts";
import { registerNativeDecorations } from "./native-decorations.ts";
import { extendMarkdownIt } from "./native-preview.ts";
import { registerOutline } from "./outline-tree.ts";
let client: CodexClient | undefined;
let stopActive: (() => void) | undefined;
export async function activate(context: vscode.ExtensionContext): Promise<{ extendMarkdownIt: typeof extendMarkdownIt }> {
  context.subscriptions.push(registerNativeDecorations(), registerOutline(context));
  const directory = context.storageUri?.scheme === "file" ? join(context.storageUri.fsPath, "sessions") : undefined;
  let state = emptyState(), storageError = "";
  try { if(directory) state = await readState(directory); } catch(e) { storageError = (e as Error).message; void vscode.window.showErrorMessage(storageError); }
  const store = new ChatStore(state, async data => { if(storageError) throw new Error(storageError); if(!directory) throw new Error("请先打开本机文件夹，才能保存对话。"); await writeState(directory, data); });
  client = new CodexClient(); const runner = client;
  const cache = context.storageUri?.scheme === "file" ? new ImageStore(context.storageUri.fsPath) : undefined;
  const images = cache ? new ImageController(store, cache, root => verifyRoot(root, false)) : undefined;
  let imageEpoch = 0;
  const cancel = (): void => { imageEpoch++; store.cancel(runner); };
  stopActive = cancel;
  let selection: SelectionSnapshot | undefined;
  let models: CodexModel[] = [], modelWarning = "";
  const refreshModels = (): void => { try { models = readModels(); modelWarning = ""; } catch { models = []; modelWarning = "未读取到模型缓存；默认使用 Codex CLI 模型，也会保留已保存的模型。"; } };
  refreshModels();
  const config = () => vscode.workspace.getConfiguration("noteglow");
  let status = "", operations = Promise.resolve();
  const view = new ChatView(context.extensionUri, message => {
    if(message.type === "stop") { store.assertConversation(message.conversationId); cancel(); status = store.working ? "正在停止；已执行的文件修改不会撤销。" : "已停止；已执行的文件修改不会撤销。"; render(); return Promise.resolve(); }
    if (message.type === "images") return (async () => {
      try { await imageImport(() => requiredImages().importEncoded(message.conversationId, message.files)); view.post({type:"imageImportResult",conversationId:message.conversationId,requestId:message.requestId,ok:true}); }
      catch(e) { view.post({type:"imageImportResult",conversationId:message.conversationId,requestId:message.requestId,ok:false,error:e instanceof Error ? e.message : "图片导入失败。"}); throw e; }
    })();
    if (message.type === "command" && message.command === "addImages") return pickImages(message.conversationId);
    if (message.type === "imageResource") return provideImage(message.conversationId, message.id);
    const queuedEpoch = imageEpoch;
    const pending = operations.catch(() => {}).then(() => {
      if (message.type === "send" && queuedEpoch !== imageEpoch) throw new Error("发送已停止，未启动 CLI。");
      return handle(message);
    }).catch(e => {
      if(message.type === "send") view.post({type:"sendResult",conversationId:message.conversationId,requestId:message.requestId,ok:false,error:e instanceof Error ? e.message : "发送失败。"});
      throw e;
    }); operations = pending; return pending;
  }, cache ? vscode.Uri.file(cache.directory) : undefined, cancel);
  const render = (): void => view.post({ type: "state", imageLimits:{maxImages:MAX_IMAGES,maxBytes:MAX_IMAGE_BYTES,maxTotalBytes:MAX_IMAGE_TOTAL_BYTES}, conversations: store.state.conversations.map(c => ({ id:c.id, title:c.title })), conversation: store.current() ?? null, busy:store.working, colors:store.state.colors, models, status:status || modelWarning, permission:config().get<string>("sandboxMode", "read-only") === "workspace-write" ? "工作区写入" : "只读" });
  function requiredImages(): ImageController { if(storageError) throw new Error(storageError); if(!images || !cache) throw new Error("请先打开本机工作区以保存图片。"); return images; }
  async function imageImport(run: () => Promise<void>): Promise<void> {
    const pending = run(); render();
    try { await pending; } finally { if(!store.working) status = ""; render(); }
  }
  async function pickImages(expectedId = store.state.activeId, resources?: readonly vscode.Uri[]): Promise<void> {
    store.assertIdle(); const epoch = imageEpoch;
    await ensureConversation(); if(expectedId) store.assertConversation(expectedId); const id = store.state.activeId;
    const selected = resources ?? await vscode.window.showOpenDialog({ canSelectMany:true, canSelectFiles:true, canSelectFolders:false, title:"添加图片（最多 10 张）", filters:{ "图片":["png","jpg","jpeg","webp"] } });
    if(!selected?.length) return;
    if(epoch !== imageEpoch) throw new Error("图片选择已停止，请重新添加。");
    store.assertConversation(id); if(selected.some(uri => uri.scheme !== "file")) throw new Error("仅支持本机图片文件。");
    await imageImport(() => requiredImages().importNative(id, selected.map(uri => uri.fsPath)));
    await vscode.commands.executeCommand("noteglow.chat.focus");
  }
  async function provideImage(conversationId: string, imageId: string): Promise<void> {
    try {
      const record = requiredImages().find(conversationId, imageId), path = await cache!.verifiedPath(record);
      store.assertConversation(conversationId); const url = view.imageUri(vscode.Uri.file(path));
      if(url) view.post({type:"imageResource",conversationId,id:imageId,url});
    } catch { view.post({type:"imageResource",conversationId,id:imageId,error:"图片缓存不可用，请重新添加。"}); }
  }
  async function ensureConversation(): Promise<void> { if(!store.current()) await store.create(await chooseRoot()); }
  function snapshot(): SelectionSnapshot { if(vscode.window.activeTextEditor?.document.languageId === "markdown") selection = capture(vscode.window.activeTextEditor); if(!selection) throw new Error("请先在 Markdown 编辑器中选择文字。"); return selection; }
  async function attach(file: boolean): Promise<void> {
    store.assertIdle(); const expectedId = store.state.activeId; const editor = vscode.window.activeTextEditor?.document.languageId === "markdown" ? vscode.window.activeTextEditor : selection?.editor;
    if(!editor || editor.document.isClosed || editor.document.languageId !== "markdown") throw new Error("请打开 Markdown 文件。");
    const snap = file ? undefined : snapshot();
    const text = file ? editor.document.getText() : snap!.text.slice(snap!.from, snap!.to);
    if(snap && (editor.document.version !== snap.version || editor.document.getText() !== snap.text)) throw new Error("选区已过期，请重新选择。");
    const uri = editor.document.uri, startLine = file ? 1 : editor.selection.start.line + 1, endLine = file ? editor.document.lineCount : editor.selection.end.line + (editor.selection.end.character ? 1 : 0);
    await ensureConversation(); if(expectedId) store.assertConversation(expectedId); const c = store.current()!; await verifyFile(c.root, uri);
    await store.attach(c.id, c.root, [{id:randomUUID(),kind:file?"active-note":"selection",path:relative(c.root, uri.fsPath),content:text,startLine,endLine:Math.max(startLine,endLine)}]);
    await vscode.commands.executeCommand("noteglow.chat.focus"); render();
  }
  async function format(action: string): Promise<void> {
    const snap = snapshot(); let property: ColorProperty | undefined, color: string | undefined;
    if(["foreground","background","chooseForeground","chooseBackground"].includes(action)) {
      property = action.toLowerCase().includes("background") ? "background" : "foreground";
      color = store.state.colors[property];
      if(action.startsWith("choose")) {
        const presets = property === "foreground" ? ["#c0392b","#1f618d","#6c3483","#196f3d","#212121"] : ["#fff88f","#ffd6d6","#ffe3b5","#d7efcd","#cce6ff","#e7d3ff"];
        const picked = await vscode.window.showQuickPick([...presets, "自定义颜色…"], {title:property === "foreground" ? "选择字体颜色" : "选择背景颜色"}); if(!picked) return;
        const input = picked === "自定义颜色…" ? await vscode.window.showInputBox({title:"输入一个颜色",prompt:"单值，支持 #RGB 或 #RRGGBB；提交时整体校验，例如 #fff88f",value:color,validateInput:value=>normalizeColor(value)?undefined:"请输入一个 #RGB 或 #RRGGBB 颜色。"}) : picked;
        if(input === undefined) return; color = normalizeColor(input) ?? undefined; if(!color) throw new Error("颜色无效。");
      }
    }
    await editSnapshot(snap, property ?? (action === "clearColor" ? "clear" : action as "bold"|"italic"|"code"), color);
    selection = capture(snap.editor);
    if(property && color) { store.assertIdle(); store.state.colors[property] = color; if(directory) await store.persist(); }
    render();
  }
  async function send(requestId: string): Promise<void> {
    const c = store.current(); if(!c) throw new Error("请先创建对话。");
    const settings = {codexPath:config().get("codexPath","codex"),sandboxMode:config().get<"read-only"|"workspace-write">("sandboxMode","read-only"),approveForMe:config().get("approveForMe",false)};
    status = "正在保存并启动 Codex…";
    // send 在首次 await 前占用实例槽位；处理器不等待 CLI，停止按钮仍可进入。
    const pending = store.send(c.id, runner, settings, {onThreadId:()=>render(),onCleanupWarning:message=>{ void vscode.window.showWarningMessage(message); },onStatus:s=>{status=s;render();},onProgress:p=>{status=p.label;render();}}, () => verifyRoot(c.root), cache);
    render(); void pending.then(() => { view.post({type:"sendResult",conversationId:c.id,requestId,ok:true}); }, e => {
      view.post({type:"sendResult",conversationId:c.id,requestId,ok:false,error:(e as Error).message}); void vscode.window.showErrorMessage((e as Error).message);
    }).finally(()=>{status="";render();});
  }
  async function handle(message: ViewMessage): Promise<void> {
    if(message.type !== "ready") store.assertConversation(message.conversationId);
    switch(message.type) {
      case "ready": render(); return;
      case "new": await store.create(await chooseRoot()); break;
      case "select": await store.select(message.id); break;
      case "delete": {
        store.assertIdle(); const c=store.state.conversations.find(c=>c.id===message.id); if(!c) return;
        if(await vscode.window.showWarningMessage(`删除对话“${c.title}”？本地聊天和草稿将删除，笔记文件不受影响。`,{modal:true},"删除") === "删除") await store.remove(message.id); break;
      }
      case "draft": await store.draft(message.conversationId,message.text,message.model); break;
      case "detach": await store.detach(message.id); break;
      case "removeImage": await store.detachImage(message.conversationId, message.id); break;
      case "previewImage": {
        const image = requiredImages().find(message.conversationId, message.id), path = await cache!.verifiedPath(image);
        store.assertConversation(message.conversationId); await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path)); break;
      }
      case "preview": {
        const a=store.current()?.attachments.find(a=>a.id===message.id); if(!a) throw new Error("引用不存在。");
        const doc=await vscode.workspace.openTextDocument({content:`来源：${a.path}:${a.startLine??1}-${a.endLine??1}\n\n${a.content}`,language:"plaintext"}); await vscode.window.showTextDocument(doc,{preview:true}); break;
      }
      case "send": await send(message.requestId); break;
      case "command": await vscode.commands.executeCommand(`noteglow.${message.command}`); break;
    }
    render();
  }
  const command = (name: string, run:()=>Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(`noteglow.${name}`,()=>run().catch(e=>vscode.window.showErrorMessage((e as Error).message))));
  command("open",async()=>{await vscode.commands.executeCommand("noteglow.chat.focus");render();});
  context.subscriptions.push(vscode.commands.registerCommand("noteglow.addImages", (resources?: readonly vscode.Uri[]) => {
    return pickImages(undefined, Array.isArray(resources) ? resources : undefined).catch(e => { void vscode.window.showErrorMessage((e as Error).message); });
  }));
  command("addSelection",()=>attach(false)); command("addFile",()=>attach(true));
  for(const action of ["bold","italic","code","foreground","background","chooseForeground","chooseBackground","clearColor"]) command(action,()=>format(action));
  for (const action of ["restoreNative", "resetNativeColors"]) command(action, async () => {
    if (context.storageUri?.scheme !== "file") throw new Error("请先打开本机文件夹，以保存原文备份。");
    const backup = await restoreNative(vscode.window.activeTextEditor, join(context.storageUri.fsPath, "native-format-backups"), action === "resetNativeColors");
    void vscode.window.showInformationMessage(backup ? `已完成；原文备份：${backup}` : "当前笔记没有需要处理的记录。");
  });
  command("theme",async()=>{const settings=vscode.workspace.getConfiguration("workbench"); const current=settings.get<string>("colorTheme"); if(current!=="NoteGlow 绿豆色") await context.globalState.update("previousTheme",current); await settings.update("colorTheme","NoteGlow 绿豆色",vscode.ConfigurationTarget.Global);});
  command("restoreTheme",async()=>{const previous=context.globalState.get<string>("previousTheme"); if(!previous) throw new Error("没有记录之前的主题。"); if(vscode.workspace.getConfiguration("workbench").get("colorTheme")!=="NoteGlow 绿豆色") throw new Error("当前主题已手动改变，未覆盖您的新选择。"); await vscode.workspace.getConfiguration("workbench").update("colorTheme",previous,vscode.ConfigurationTarget.Global);});
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("noteglow.chat",view));
  const changed = new vscode.EventEmitter<void>(); context.subscriptions.push(changed);
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e=>{if(e.textEditor.document.languageId!=="markdown")return;try{selection=capture(e.textEditor);}catch{selection=undefined;}changed.fire();}));
  try{selection=capture(vscode.window.activeTextEditor);}catch{}
  context.subscriptions.push(vscode.languages.registerCodeLensProvider("markdown",{onDidChangeCodeLenses:changed.event,provideCodeLenses:doc=>{
    if(!config().get("selectionCodeLens",true)||!selection||selection.uri!==doc.uri.toString()||selection.version!==doc.version)return [];
    const range=new vscode.Range(doc.positionAt(selection.from).line,0,doc.positionAt(selection.from).line,0);
    return [["addSelection","＋ 添加到 Codex"],["bold","加粗"],["italic","斜体"],["code","代码"],["foreground","字体色"],["background","背景色"]].map(([c,t])=>new vscode.CodeLens(range,{command:`noteglow.${c}`,title:t}));
  }}));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(()=>{cancel();render();}));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e=>{if(e.affectsConfiguration("noteglow")){refreshModels();changed.fire();render();}}));
  context.subscriptions.push({dispose:cancel});
  return { extendMarkdownIt };
}
export function deactivate(): void { stopActive?.(); client?.stop(); }
