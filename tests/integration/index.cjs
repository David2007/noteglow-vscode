const assert=require('node:assert/strict');const vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('David2007.noteglow');assert.ok(extension);await extension.activate();
 const commands=await vscode.commands.getCommands(true);for(const name of ['open','background','foreground','bold','addSelection','restoreTheme','addImages'])assert.ok(commands.includes('noteglow.'+name));
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'demo.md');const doc=await vscode.workspace.openTextDocument(uri);const editor=await vscode.window.showTextDocument(doc);
 const from=doc.getText().indexOf('重要');editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(from+2));
 await vscode.commands.executeCommand('noteglow.background');assert.match(doc.getText(),/1\. \*\*<span data-codex-color="1" style="background-color:#fff88f">重要<\/span>\*\*/);assert.equal(doc.isDirty,false);
 const painted=doc.getText();await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),'1. **重要** 正文。\n\n```js\nconst a = 1;\n```\n');await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),painted);
 const bom=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'bom.md'));const be=await vscode.window.showTextDocument(bom);be.selection=new vscode.Selection(bom.positionAt(0),bom.positionAt(3));await vscode.commands.executeCommand('noteglow.foreground');assert.match(bom.getText(),/data-codex-color/);assert.equal(bom.isDirty,false);
 await vscode.commands.executeCommand('markdown.showPreviewToSide');await vscode.commands.executeCommand('noteglow.open');
 await vscode.commands.executeCommand('noteglow.addImages',[vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'image.png')]);
 const fs=require('node:fs/promises'),path=require('node:path');const storageRoot=path.join(process.env.NOTEGLOW_TEST_PROFILE,'User','workspaceStorage');
 const entries=await fs.readdir(storageRoot,{recursive:true});const stateFile=entries.find(name=>name.endsWith(path.join('sessions','sessions-v1.json')));assert.ok(stateFile,'native image command persisted the workspace session');
 const saved=JSON.parse(await fs.readFile(path.join(storageRoot,stateFile),'utf8'));const current=saved.conversations.find(c=>c.id===saved.activeId);assert.equal(current.draftImages.length,1);assert.equal(current.draftImages[0].mime,'image/png');assert.equal(current.draftImages[0].width,24);assert.equal(JSON.stringify(current.draftImages).includes(vscode.workspace.workspaceFolders[0].uri.fsPath),false);
 console.log('NoteGlow Extension Host: activation, commands, portable color, disk save, Undo/Redo native preview and private image import passed.');
};
