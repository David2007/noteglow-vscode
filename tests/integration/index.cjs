const assert=require('node:assert/strict');const vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('David2007.noteglow');assert.ok(extension);await extension.activate();
 const commands=await vscode.commands.getCommands(true);for(const name of ['open','background','foreground','bold','addSelection','restoreTheme','addImages','restoreNative','resetNativeColors'])assert.ok(commands.includes('noteglow.'+name));
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'demo.md');const doc=await vscode.workspace.openTextDocument(uri);const editor=await vscode.window.showTextDocument(doc);
 const from=doc.getText().indexOf('重要');editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(from+2));
 await vscode.commands.executeCommand('noteglow.background');assert.match(doc.getText(),/^1\. \*\*重要\*\* 正文。/);assert.match(doc.getText(),/noteglow-text-colors:1/);assert.equal(doc.isDirty,false);
 const painted=doc.getText();await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),'1. **重要** 正文。\n\n```js\nconst a = 1;\n```\n');await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),painted);
 await vscode.commands.executeCommand('markdown.api.reloadPlugins');
 const firstHtml=await vscode.commands.executeCommand('markdown.api.render',painted);assert.match(firstHtml,/background-color:#fff88f/,'official Markdown renderer loads NoteGlow plugin');assert.match(firstHtml,/<strong>/);
 await verifyMultilineFormatting();await verifyRepeatedCodeColors();await verifyRestoration();await verifyOutline(extension);await verifyShortcuts(extension);await verifyExtraFormats(extension);await verifyMetadataFolding();await verifyReplyActions();
 const bom=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'bom.md'));const be=await vscode.window.showTextDocument(bom);be.selection=new vscode.Selection(bom.positionAt(0),bom.positionAt(3));await vscode.commands.executeCommand('noteglow.foreground');assert.match(bom.getText(),/noteglow-text-colors:1/);assert.equal(bom.isDirty,false);
 await vscode.commands.executeCommand('markdown.showPreviewToSide');await vscode.commands.executeCommand('noteglow.open');
 await vscode.commands.executeCommand('noteglow.addImages',[vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'image.png')]);
 const fs=require('node:fs/promises'),path=require('node:path');const storageRoot=path.join(process.env.NOTEGLOW_TEST_PROFILE,'User','workspaceStorage');
 const entries=await fs.readdir(storageRoot,{recursive:true});const stateFile=entries.find(name=>name.endsWith(path.join('sessions','sessions-v1.json')));assert.ok(stateFile,'native image command persisted the workspace session');
 const saved=JSON.parse(await fs.readFile(path.join(storageRoot,stateFile),'utf8'));const current=saved.conversations.find(c=>c.id===saved.activeId);assert.equal(current.draftImages.length,1);assert.equal(current.draftImages[0].mime,'image/png');assert.equal(current.draftImages[0].width,24);assert.equal(JSON.stringify(current.draftImages).includes(vscode.workspace.workspaceFolders[0].uri.fsPath),false);
 console.log('NoteGlow Extension Host: activation, commands, native color, three code selections, disk save, Undo/Redo, shortcuts, native metadata folding lifecycle, native preview and private image import passed.');
};


// 公开命令、真实 TextEditor 和官方预览 API 共用同一份持久化原生 Markdown。
async function verifyRepeatedCodeColors() {
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'code-colors.md');
 const doc=await vscode.workspace.openTextDocument(uri),editor=await vscode.window.showTextDocument(doc);
 const originalCode='update(a)\nupdatePtr(&a) // &amp; 😀\n\n';
 const inspect=source=>{const match=source.match(/<!-- noteglow-code-colors:1 (.+) -->/);assert.ok(match);const record=JSON.parse(match[1]);assert.equal(record.code,originalCode);assert.ok(source.startsWith('```go\n'+originalCode+'```'));assert.doesNotMatch(source,/<pre|<code|<span/);return record.ranges.map(r=>({text:record.code.slice(r.from,r.to),property:r.property,color:r.color}));};
 const select=value=>{const from=doc.getText().indexOf(value);assert.ok(from>=0);editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(from+value.length));};
 const saved=async()=>{assert.equal(doc.isDirty,false);assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'),doc.getText());inspect(doc.getText());};
 select('update(a)');await vscode.commands.executeCommand('noteglow.background');await saved();
 select('&');await vscode.commands.executeCommand('noteglow.background');await saved();const second=doc.getText();
 select('updatePtr');await vscode.commands.executeCommand('noteglow.foreground');await saved();const third=doc.getText();
 const ranges=inspect(third);assert.equal(ranges.length,3);assert.ok(ranges.some(r=>r.text==='&'&&r.property==='background'));assert.ok(ranges.some(r=>r.text==='update(a)'&&r.property==='background'));assert.ok(ranges.some(r=>r.text==='updatePtr'&&r.property==='foreground'));
 const html=await vscode.commands.executeCommand('markdown.api.render',third);assert.match(html,/background-color:#fff88f/);assert.match(html,/color:#c0392b/);assert.match(html,/language-go/);
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),second);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),third);await doc.save();
 select('&');await vscode.commands.executeCommand('noteglow.clearColor');await saved();const cleared=doc.getText();assert.equal(inspect(cleared).length,2);
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),third);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),cleared);await doc.save();
 const marker=cleared.slice(cleared.indexOf('<!--'));
 select('update(a)');assert.equal(await editor.edit(b=>b.replace(editor.selection,'changed(a)'),{undoStopBefore:true,undoStopAfter:true}),true);
 assert.equal(doc.getText().slice(doc.getText().indexOf('<!--')),marker,'ordinary edits never rewrite metadata');
 const staleHtml=await vscode.commands.executeCommand('markdown.api.render',doc.getText());assert.doesNotMatch(staleHtml,/background-color:#fff88f|color:#c0392b/);
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),cleared);await doc.save();
}
async function verifyRestoration(){
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'legacy.md');const doc=await vscode.workspace.openTextDocument(uri);await vscode.window.showTextDocument(doc);const before=doc.getText();
 await vscode.commands.executeCommand('noteglow.restoreNative');const native=doc.getText();assert.notEqual(native,before);assert.match(native,/noteglow-text-colors:1/);assert.doesNotMatch(native,/<span|<code/);assert.equal(doc.isDirty,false);
 const fs=require('node:fs/promises'),path=require('node:path'),root=path.join(process.env.NOTEGLOW_TEST_PROFILE,'User','workspaceStorage');const files=await fs.readdir(root,{recursive:true});const backups=files.filter(name=>name.includes('native-format-backups')&&name.endsWith('.md'));assert.ok(backups.length);assert.ok((await Promise.all(backups.map(name=>fs.readFile(path.join(root,name),'utf8')))).includes(before),'backup preserves original bytes');
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),before);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),native);await doc.save();
 await vscode.commands.executeCommand('noteglow.resetNativeColors');assert.equal(doc.getText(),'重要 正文。\n');await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),native);await doc.save();
}

// 原生 TreeView 的公开导航命令定位重名标题，且不得修改源文件。
async function verifyOutline(extension) {
 const doc=await vscode.workspace.openTextDocument({language:'markdown',content:'# Same\n\n## Same\n\n```md\n# hidden\n```\n'});
 const editor=await vscode.window.showTextDocument(doc);const before=doc.getText();
 await vscode.commands.executeCommand('noteglow.outline.jump',doc.uri,2,editor.viewColumn);
 assert.equal(vscode.window.activeTextEditor.document.uri.toString(),doc.uri.toString());assert.equal(vscode.window.activeTextEditor.selection.active.line,2);assert.equal(doc.getText(),before);
 const contributions=extension.packageJSON.contributes;
 assert.equal(contributions.views.explorer.find(v=>v.id==='noteglow.outline').visibility,'visible');
 for(const asset of [...contributions['markdown.previewScripts'],...contributions['markdown.previewStyles']])assert.ok((await vscode.workspace.fs.stat(vscode.Uri.joinPath(extension.extensionUri,asset))).size>0,'packaged preview asset exists');
 await vscode.commands.executeCommand('markdown.showPreviewToSide');
}

// 真正的 Extension Host：命令注册、磁盘保存、原生 snippet 光标及 Undo/Redo，不能用 mock 代替。
async function verifyShortcuts(extension) {
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'shortcuts.md');
 await vscode.workspace.fs.writeFile(uri,Buffer.from('Alpha Beta Gamma Delta'));
 const doc=await vscode.workspace.openTextDocument(uri),editor=await vscode.window.showTextDocument(doc);
 const select=word=>{const from=doc.getText().indexOf(word);assert.ok(from>=0);editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(from+word.length));};
 select('Alpha');await vscode.commands.executeCommand('noteglow.italic');
 select('Beta');await vscode.commands.executeCommand('noteglow.repeatFormat');assert.equal(doc.getText(),'*Alpha* *Beta* Gamma Delta');
 await vscode.commands.executeCommand('noteglow.repeatFormat');assert.equal(doc.getText(),'*Alpha* *Beta* Gamma Delta','repeat must not toggle format off');
 select('Gamma');await vscode.commands.executeCommand('noteglow.background');
 select('Delta');await vscode.commands.executeCommand('noteglow.repeatFormat');
 let record=JSON.parse(doc.getText().match(/<!-- noteglow-text-colors:1 (.+) -->/)[1]);
 assert.deepEqual(record.ranges.map(r=>record.source.slice(r.from,r.to)),['Gamma','Delta']);
 assert.ok(record.ranges.every(r=>r.property==='background'&&r.color==='#fff88f'));
 const beforeClear=doc.getText();await vscode.commands.executeCommand('noteglow.clearColor');
 await vscode.commands.executeCommand('noteglow.repeatFormat');assert.equal(doc.getText(),beforeClear,'clear must not replace recent background format');
 assert.equal(doc.isDirty,false);assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(),doc.getText());
 const bindings=extension.packageJSON.contributes.keybindings;
 assert.equal(bindings.find(k=>k.command==='noteglow.repeatFormat').mac,'cmd+shift+h');
 const enter=bindings.find(k=>k.command==='noteglow.expandSlash');assert.equal(enter.key,'enter');
 for(const guard of ['noteglow.slashReady','!isComposing','!suggestWidgetVisible','!inlineSuggestionVisible','!inSnippetMode','!editorReadonly','!editorHasMultipleSelections'])assert.ok(enter.when.includes(guard));
 for(const [name,source,expected,cursor] of [
  ['code','/code','```\n\n```',4],
  ...Array.from({length:6},(_,i)=>['h'+(i+1),'/h'+(i+1),'#'.repeat(i+1)+' ',i+2]),
  ['mermaid','/mermaid','```mermaid\nflowchart TD\n    A[开始] --> B[结束]\n```',11],
  ['table','/bg','| 标题 1 | 标题 2 |\n| --- | --- |\n|  |  |\n|  |  |',2],
  ['crlf','before\r\n/code\r\nafter','before\r\n\r\n```\r\n\r\n```\r\n\r\nafter',15]
 ]) {
  const u=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,`shortcut-${name}.md`);await vscode.workspace.fs.writeFile(u,Buffer.from(source));
  const d=await vscode.workspace.openTextDocument(u),e=await vscode.window.showTextDocument(d);const command=source.match(/\/(?:code|bg|mermaid|h[1-6])/)[0],at=source.indexOf(command)+command.length;
  e.selection=new vscode.Selection(d.positionAt(at),d.positionAt(at));
  await vscode.commands.executeCommand('noteglow.expandSlash');assert.equal(d.getText(),expected,name);assert.equal(d.offsetAt(e.selection.active),cursor,name+' body cursor');
  await vscode.commands.executeCommand('undo');assert.equal(d.getText(),source,name+' one undo');
  await vscode.commands.executeCommand('redo');assert.equal(d.getText(),expected,name+' redo');assert.equal(d.offsetAt(e.selection.active),cursor,name+' redo cursor');
  await vscode.commands.executeCommand('type',{text:'Body'});assert.equal(d.getText(),expected.slice(0,cursor)+'Body'+expected.slice(cursor),name+' body typing');
 }
}

async function verifyMetadataFolding() {
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'metadata-folding.md');
 const source='# Heading\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\ntail\n';
 await vscode.workspace.fs.writeFile(uri,Buffer.from(source));const doc=await vscode.workspace.openTextDocument(uri);let editor=await vscode.window.showTextDocument(doc);
 const at=doc.getText().indexOf('const a');editor.selection=new vscode.Selection(doc.positionAt(at),doc.positionAt(at+5));
 await vscode.commands.executeCommand('noteglow.foreground');const colored=doc.getText();
 const metadataLine=doc.positionAt(colored.indexOf('<!-- noteglow-code-colors:1')).line;
 const visible=line=>editor.visibleRanges.some(range=>range.start.line<=line&&range.end.line>=line);
 const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}assert.fail('metadata folding condition timed out');};
 await wait(()=>!visible(metadataLine));assert.equal(doc.getText(),colored);assert.equal(doc.isDirty,false);
 let ranges=await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider',uri);
 assert.ok(ranges.some(r=>r.start===0),'native heading fold survives');assert.ok(ranges.some(r=>r.start===2&&r.end===metadataLine-2),'body fold ends before closing fence');
 assert.ok(ranges.some(r=>r.start===metadataLine-1&&r.end===metadataLine));assert.ok(visible(3),'default folding keeps code body visible');
 await vscode.commands.executeCommand('editor.unfold',{selectionLines:[metadataLine-1],levels:1,direction:'down'});await wait(()=>visible(metadataLine));
 const other=await vscode.workspace.openTextDocument({language:'plaintext',content:'other'});await vscode.window.showTextDocument(other);editor=await vscode.window.showTextDocument(doc);await new Promise(r=>setTimeout(r,300));assert.ok(visible(metadataLine),'switching tabs must respect manual unfolding');
 await vscode.commands.executeCommand('noteglow.foldMetadata');await wait(()=>!visible(metadataLine));
 await vscode.commands.executeCommand('editor.fold',{selectionLines:[2],levels:1,direction:'down'});await wait(()=>!visible(3));assert.ok(visible(metadataLine-1),'closing fence remains visible');
 await vscode.commands.executeCommand('editor.unfold',{selectionLines:[2],levels:1,direction:'down'});await wait(()=>visible(3));assert.equal(visible(metadataLine),false);
 // 程序性正文编辑也必须揭示失效记录，不把失效颜色静默隐藏。
 const change=doc.getText().indexOf('const a');await editor.edit(builder=>builder.replace(new vscode.Range(doc.positionAt(change),doc.positionAt(change+7)),'const z'));
 await wait(()=>visible(metadataLine));const stale=doc.getText();await new Promise(r=>setTimeout(r,200));assert.equal(doc.getText(),stale,'folding never writes the note');
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),colored);await vscode.commands.executeCommand('noteglow.foldMetadata');await wait(()=>!visible(metadataLine));
 const marker=doc.getText().indexOf('noteglow-code-colors:1');await editor.edit(builder=>builder.replace(new vscode.Range(doc.positionAt(marker),doc.positionAt(marker+'noteglow-code-colors:1'.length)),'noteglow-code-colors:9'));
 await wait(async()=>{ranges=await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider',uri);return !ranges.some(r=>r.start===metadataLine-1)&&visible(metadataLine);});
 assert.ok(ranges.some(r=>r.start===2&&r.end===metadataLine-1),'invalid record restores original code folding');
}

async function verifyReplyActions() {
 const {performReplyAction,captureInsertion,insertAtSnapshot}=require(process.env.NOTEGLOW_REPLY_ADAPTER);
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'reply-apply.md');
 await vscode.workspace.fs.writeFile(uri,Buffer.from('Alpha Beta'));const doc=await vscode.workspace.openTextDocument(uri),editor=await vscode.window.showTextDocument(doc);
 editor.selection=new vscode.Selection(0,0,0,5);
 const reply='# Full reply\n\n~~~js\nCODE\n~~~\n\nEnd **bold**',state={activeId:'reply',conversations:[{id:'reply',messages:[{role:'assistant',text:reply}]}]};
 await performReplyAction(state,{type:'applyReplyCode',conversationId:'reply',requestId:'apply',messageIndex:0,blockIndex:0},editor);
 assert.equal(doc.getText(),'AlphaCODE Beta','Apply preserves selected text and inserts only code content');
 assert.equal(editor.selection.isEmpty,true,'Apply collapses the expanded original selection');assert.equal(doc.offsetAt(editor.selection.active),9,'cursor ends after inserted code');
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),'Alpha Beta','one native Undo reverses Apply');await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),'AlphaCODE Beta');
 const snapshot=captureInsertion(editor);await editor.edit(builder=>builder.insert(new vscode.Position(0,0),'X'));const changed=doc.getText();await assert.rejects(insertAtSnapshot(snapshot,'UNSAFE'),/已变化/);assert.equal(doc.getText(),changed);
 const clipboard=await vscode.env.clipboard.readText();try{await performReplyAction(state,{type:'copyReply',conversationId:'reply',requestId:'copy',messageIndex:0},undefined);assert.equal(await vscode.env.clipboard.readText(),reply,'whole original Markdown copied through native clipboard');}finally{await vscode.env.clipboard.writeText(clipboard);}
}

async function verifyExtraFormats(extension) {
 const contributions=extension.packageJSON.contributes;
 assert.equal(contributions.viewsContainers.secondarySidebar[0].id,'noteglow');
 assert.equal(contributions.configuration.properties['noteglow.sandboxMode'].default,'workspace-write');
 assert.equal(contributions.menus['editor/title'].find(item=>item.command==='noteglow.addSelection').group,'navigation@-100');
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'extra-formats.md');await vscode.workspace.fs.writeFile(uri,Buffer.from('Alpha'));
 const doc=await vscode.workspace.openTextDocument(uri),editor=await vscode.window.showTextDocument(doc);
 const select=()=>{const from=doc.getText().indexOf('Alpha');editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(from+5));};
 select();await vscode.commands.executeCommand('noteglow.background');const colored=doc.getText();
 select();await vscode.commands.executeCommand('noteglow.underline');assert.ok(doc.getText().startsWith('<u>Alpha</u>'));
 const underlined=doc.getText();await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),colored);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),underlined);
 select();await vscode.commands.executeCommand('noteglow.strike');assert.ok(doc.getText().startsWith('<u>~~Alpha~~</u>'));
 const rendered=await vscode.commands.executeCommand('markdown.api.render',doc.getText());assert.match(rendered,/<u>/);assert.match(rendered,/<s>/);assert.match(rendered,/background-color:#fff88f/);
 assert.equal(doc.isDirty,false);assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(),doc.getText());
}


// 合成笔记走公开格式命令、真实保存和官方预览；整批编辑必须只增加一个撤销步骤。
async function verifyMultilineFormatting() {
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'multiline-table.md');
 const original='第一段：alpha `code` tail。\n\n第二段：beta。\n\n第三段：gamma。\n\n| 场景 | 结果 |\n| --- | --- |\n| nil | 发送 `for range` 阻塞 |\n| other | unchanged |\n\nend';
 await vscode.workspace.fs.writeFile(uri,Buffer.from(original));
 const doc=await vscode.workspace.openTextDocument(uri),editor=await vscode.window.showTextDocument(doc);
 const select=(first,last)=>{const from=doc.getText().indexOf(first),to=doc.getText().indexOf(last)+last.length;assert.ok(from>=0&&to>from);editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(to));};
 const saved=async()=>{assert.equal(doc.isDirty,false);assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(),doc.getText());};
 select('第一段','gamma');await vscode.commands.executeCommand('noteglow.bold');await saved();
 const bold=doc.getText();assert.ok(bold.startsWith('**第一段：alpha** `code` **tail。**'));assert.ok(bold.includes('**第二段：beta。**'));assert.ok(bold.includes('**第三段：gamma**。'));
 assert.ok(bold.includes('| nil | 发送 `for range` 阻塞 |'));
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),original);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),bold);
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),original);await doc.save();
 select('第一段','gamma');await vscode.commands.executeCommand('noteglow.background');await saved();
 select('第一段','gamma');await vscode.commands.executeCommand('noteglow.foreground');await saved();const colored=doc.getText();
 const records=source=>Array.from(source.matchAll(/<!-- noteglow-text-colors:1 (.+) -->/g),m=>JSON.parse(m[1]));
 assert.equal(records(colored).length,3);assert.ok(records(colored).every(record=>record.ranges.some(range=>range.property==='foreground')&&record.ranges.some(range=>range.property==='background')));
 select('第一段','gamma');await vscode.commands.executeCommand('noteglow.bold');await saved();
 const combined=doc.getText();const html=await vscode.commands.executeCommand('markdown.api.render',combined);
 assert.match(html,/<strong>/);assert.match(html,/<code>/);assert.match(html,/background-color:#fff88f/);assert.match(html,/color:#c0392b/);
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),colored);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),combined);await vscode.commands.executeCommand('undo');await doc.save();
 select('第一段','gamma');await vscode.commands.executeCommand('noteglow.clearColor');assert.equal(doc.getText(),original);await saved();
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),colored);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),original);await doc.save();
 select('nil','unchanged');await vscode.commands.executeCommand('noteglow.italic');await saved();
 const table=doc.getText();assert.ok(table.includes('| *nil* | *发送* `for range` *阻塞* |'));assert.ok(table.includes('| *other* | *unchanged* |'));assert.ok(table.startsWith(original.slice(0,original.indexOf('| 场景'))));
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),original);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),table);await vscode.commands.executeCommand('undo');await doc.save();
 select('发送','unchanged');await vscode.commands.executeCommand('noteglow.background');await saved();const tableColored=doc.getText();
 const tableHtml=await vscode.commands.executeCommand('markdown.api.render',tableColored);assert.match(tableHtml,/<table\b/);assert.match(tableHtml,/<code><span style="background-color:#fff88f">for range<\/span><\/code>/);assert.equal(records(tableColored).length,1);
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),original);await doc.save();
 // 已有链接和下划线位于整段选区边缘时，不能丢失源码定界符；同时验证批量 uniform 路径。
 const inline='[foo](https://example.com) tail\n\nhead <u>bar</u>';
 await editor.edit(builder=>builder.replace(new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),inline));await doc.save();
 editor.selection=new vscode.Selection(doc.positionAt(0),doc.positionAt(inline.length));
 await vscode.commands.executeCommand('noteglow.bold');await saved();
 const formattedInline=doc.getText(),inlineHtml=await vscode.commands.executeCommand('markdown.api.render',formattedInline);
 assert.match(inlineHtml,/<a\b[^>]*href="https:\/\/example.com"/);assert.match(inlineHtml,/<u>/);assert.match(inlineHtml,/<strong>/);assert.doesNotMatch(inlineHtml,/\*\*/);
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),inline);await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),formattedInline);await doc.save();
 // 不支持的中间引用必须整批拒绝，不能先修改右侧再遗漏左侧。
 const protectedSource='alpha\n\n> quote\n\nomega';
 await editor.edit(builder=>builder.replace(new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),protectedSource));await doc.save();
 editor.selection=new vscode.Selection(doc.positionAt(0),doc.positionAt(protectedSource.length));const version=doc.version;
 // 失败通知等待用户关闭；直接调用同一生产适配器验证拒绝，避免测试等待交互。
 const {capture,editSnapshot}=require(process.env.NOTEGLOW_REPLY_ADAPTER);
 await assert.rejects(editSnapshot(capture(editor),'bold'),/不支持/);assert.equal(doc.getText(),protectedSource);assert.equal(doc.version,version);await saved();
 console.log('NoteGlow multiline: three paragraphs plus code, table rows, colors, official preview, disk equality, single Undo/Redo and guarded-gap atomicity passed.');
}
