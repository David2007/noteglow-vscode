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
 await verifyRepeatedCodeColors();await verifyRestoration();await verifyOutline(extension);
 const bom=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'bom.md'));const be=await vscode.window.showTextDocument(bom);be.selection=new vscode.Selection(bom.positionAt(0),bom.positionAt(3));await vscode.commands.executeCommand('noteglow.foreground');assert.match(bom.getText(),/noteglow-text-colors:1/);assert.equal(bom.isDirty,false);
 await vscode.commands.executeCommand('markdown.showPreviewToSide');await vscode.commands.executeCommand('noteglow.open');
 await vscode.commands.executeCommand('noteglow.addImages',[vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'image.png')]);
 const fs=require('node:fs/promises'),path=require('node:path');const storageRoot=path.join(process.env.NOTEGLOW_TEST_PROFILE,'User','workspaceStorage');
 const entries=await fs.readdir(storageRoot,{recursive:true});const stateFile=entries.find(name=>name.endsWith(path.join('sessions','sessions-v1.json')));assert.ok(stateFile,'native image command persisted the workspace session');
 const saved=JSON.parse(await fs.readFile(path.join(storageRoot,stateFile),'utf8'));const current=saved.conversations.find(c=>c.id===saved.activeId);assert.equal(current.draftImages.length,1);assert.equal(current.draftImages[0].mime,'image/png');assert.equal(current.draftImages[0].width,24);assert.equal(JSON.stringify(current.draftImages).includes(vscode.workspace.workspaceFolders[0].uri.fsPath),false);
 console.log('NoteGlow Extension Host: activation, commands, native color, three code selections, disk save, Undo/Redo native preview and private image import passed.');
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
