const assert=require('node:assert/strict');const vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('David2007.noteglow');assert.ok(extension);await extension.activate();
 const commands=await vscode.commands.getCommands(true);for(const name of ['open','background','foreground','bold','addSelection','restoreTheme'])assert.ok(commands.includes('noteglow.'+name));
 const uri=vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'demo.md');const doc=await vscode.workspace.openTextDocument(uri);const editor=await vscode.window.showTextDocument(doc);
 const from=doc.getText().indexOf('重要');editor.selection=new vscode.Selection(doc.positionAt(from),doc.positionAt(from+2));
 await vscode.commands.executeCommand('noteglow.background');assert.match(doc.getText(),/1\. \*\*<span data-codex-color="1" style="background-color:#fff88f">重要<\/span>\*\*/);assert.equal(doc.isDirty,false);
 const painted=doc.getText();await vscode.commands.executeCommand('undo');assert.equal(doc.getText(),'1. **重要** 正文。\n\n```js\nconst a = 1;\n```\n');await vscode.commands.executeCommand('redo');assert.equal(doc.getText(),painted);
 const bom=await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,'bom.md'));const be=await vscode.window.showTextDocument(bom);be.selection=new vscode.Selection(bom.positionAt(0),bom.positionAt(3));await vscode.commands.executeCommand('noteglow.foreground');assert.match(bom.getText(),/data-codex-color/);assert.equal(bom.isDirty,false);
 await vscode.commands.executeCommand('markdown.showPreviewToSide');await vscode.commands.executeCommand('noteglow.open');
 console.log('NoteGlow Extension Host: activation, commands, portable color, disk save, Undo/Redo and native preview passed.');
};
