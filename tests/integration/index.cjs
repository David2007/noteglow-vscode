const assert=require('node:assert/strict');const vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('David2007.noteglow');assert.ok(extension);await extension.activate();
 const commands=await vscode.commands.getCommands(true);for(const name of ['open','background','foreground','bold','addSelection','restoreTheme','addImages'])assert.ok(commands.includes('noteglow.'+name));
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'demo.md');const doc=await vscode.workspace.openTextDocument(uri);const editor=await vscode.window.showTextDocument(doc);
 const from=doc.getText().indexOf('重要');editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(from+2));
 await vscode.commands.executeCommand('noteglow.background');assert.match(doc.getText(),/1\. \*\*<span data-codex-color="1" style="background-color:#fff88f">重要<\/span>\*\*/);assert.equal(doc.isDirty,false);
 const painted=doc.getText();await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),'1. **重要** 正文。\n\n```js\nconst a = 1;\n```\n');await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),painted);
 await verifyRepeatedCodeColors();
 const bom=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'bom.md'));const be=await vscode.window.showTextDocument(bom);be.selection=new vscode.Selection(bom.positionAt(0),bom.positionAt(3));await vscode.commands.executeCommand('noteglow.foreground');assert.match(bom.getText(),/data-codex-color/);assert.equal(bom.isDirty,false);
 await vscode.commands.executeCommand('markdown.showPreviewToSide');await vscode.commands.executeCommand('noteglow.open');
 await vscode.commands.executeCommand('noteglow.addImages',[vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'image.png')]);
 const fs=require('node:fs/promises'),path=require('node:path');const storageRoot=path.join(process.env.NOTEGLOW_TEST_PROFILE,'User','workspaceStorage');
 const entries=await fs.readdir(storageRoot,{recursive:true});const stateFile=entries.find(name=>name.endsWith(path.join('sessions','sessions-v1.json')));assert.ok(stateFile,'native image command persisted the workspace session');
 const saved=JSON.parse(await fs.readFile(path.join(storageRoot,stateFile),'utf8'));const current=saved.conversations.find(c=>c.id===saved.activeId);assert.equal(current.draftImages.length,1);assert.equal(current.draftImages[0].mime,'image/png');assert.equal(current.draftImages[0].width,24);assert.equal(JSON.stringify(current.draftImages).includes(vscode.workspace.workspaceFolders[0].uri.fsPath),false);
 console.log('NoteGlow Extension Host: activation, commands, portable color, three code selections, disk save, Undo/Redo native preview and private image import passed.');
};


// 通过公开命令与真实 TextEditor 验证源实体选区；HTML 解析仅用于结果断言。
async function verifyRepeatedCodeColors() {
 const {parseFragment}=await import('parse5');
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'code-colors.md');
 const doc=await vscode.workspace.openTextDocument(uri);
 const editor=await vscode.window.showTextDocument(doc);
 const originalCode='update(a)\nupdatePtr(&a) // &amp; 😀\n\n';
 const textOf=node=>node.nodeName==='#text'?node.value:(node.childNodes??[]).map(textOf).join('');
 const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value;
 const inspect=source=>{
  const all=[];const visit=node=>{all.push(node);for(const child of node.childNodes??[])visit(child);};visit(parseFragment(source));
  const code=all.find(node=>node.tagName==='code');assert.ok(code,'portable code exists');
  return {code:textOf(code),colors:all.filter(node=>node.tagName==='span'&&attr(node,'data-codex-color')==='1').map(node=>({text:textOf(node),style:attr(node,'style')}))};
 };
 const select=value=>{
  const text=doc.getText(),from=text.indexOf(value);assert.ok(from>=0,`source selection exists: ${value}`);
  editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(from+value.length));
 };
 const saved=async()=>{
  assert.equal(doc.isDirty,false,'command saves the document');
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'),doc.getText(),'disk matches editor');
  assert.equal(inspect(doc.getText()).code,originalCode,'code bytes survive each command');
 };
 select('update(a)');await vscode.commands.executeCommand('noteglow.background');await saved();
 const first=doc.getText();
 const spaced=first.replace('><code','>\n  <code').replace('</code></pre>','</code>\n</pre>');
 assert.notEqual(spaced,first,'fixture adds wrapper whitespace');
 assert.equal(await editor.edit(builder=>builder.replace(new vscode.Range(doc.positionAt(0),doc.positionAt(first.length)),spaced),{undoStopBefore:true,undoStopAfter:true}),true);
 assert.equal(await doc.save(),true);
 select('&amp;');await vscode.commands.executeCommand('noteglow.background');await saved();
 const second=doc.getText();
 assert.deepEqual(inspect(second).colors,[{text:'update(a)',style:'background-color:#fff88f'},{text:'&',style:'background-color:#fff88f'}]);
 select('updatePtr');await vscode.commands.executeCommand('noteglow.foreground');await saved();
 const third=doc.getText();
 assert.deepEqual(inspect(third).colors,[{text:'update(a)',style:'background-color:#fff88f'},{text:'updatePtr',style:'color:#c0392b'},{text:'&',style:'background-color:#fff88f'}]);
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),second,'one Undo removes only third color');
 assert.equal(await doc.save(),true);await saved();
 await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),third,'Redo restores only third color');
 assert.equal(await doc.save(),true);await saved();
 select('&amp;');await vscode.commands.executeCommand('noteglow.clearColor');await saved();
 const cleared=doc.getText();
 assert.deepEqual(inspect(cleared).colors,[{text:'update(a)',style:'background-color:#fff88f'},{text:'updatePtr',style:'color:#c0392b'}],'clear changes only second selection');
 await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),third,'Undo restores only cleared second selection');
 await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),cleared,'Redo clears only second selection');
 assert.equal(await doc.save(),true);await saved();
}
