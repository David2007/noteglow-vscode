import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const mockURL=new URL('./fixtures/vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const vscode=await import(mockURL);const {capture,editSnapshot,decodeUtf8Markdown,restoreNative}=await import('../src/editor.ts');const {localFolders,chooseRoot,verifyRoot,verifyFile}=await import('../src/workspaces.ts');
function editorFor(path,text='1. **重要** 正文。\n'){
 let value=text;const uri={scheme:'file',fsPath:path,toString:()=>`file://${path}`};
 const positionAt=offset=>{const a=value.slice(0,offset).split('\n');return {line:a.length-1,character:a.at(-1).length};};
 const offsetAt=p=>value.split('\n').slice(0,p.line).reduce((n,line)=>n+line.length+1,0)+p.character;
 const doc={languageId:'markdown',uri,version:1,isClosed:false,getText:()=>value,positionAt,offsetAt,save:async()=>{await writeFile(path,value);return true;}};
 const selection=new vscode.Selection(positionAt(value.indexOf('重要')),positionAt(value.indexOf('重要')+2));
 const editor={document:doc,selection,selections:[selection],edit:async callback=>{callback({replace:(range,text)=>{const from=offsetAt(range.start),to=offsetAt(range.end);value=value.slice(0,from)+text+value.slice(to);doc.version++;}});return true;}};
 return {editor,mutate:text=>{value=text;doc.version++;}};
}
test('editor snapshot applies native color and saves exact text using one native edit',async()=>{const dir=await mkdtemp(join(tmpdir(),'ng-edit-'));try{const {editor}=editorFor(join(dir,'demo.md'));await writeFile(editor.document.uri.fsPath,editor.document.getText());const snap=capture(editor);await editSnapshot(snap,'background','#fff88f');assert.match(editor.document.getText(),/^1\. \*\*重要\*\* 正文。/);assert.match(editor.document.getText(),/noteglow-text-colors:1/);assert.doesNotMatch(editor.document.getText(),/<span|<code/);assert.equal(await readFile(editor.document.uri.fsPath,'utf8'),editor.document.getText());assert.equal(editor.document.version,2);}finally{await rm(dir,{recursive:true,force:true});}});
test('invalid selection and stale versions reject without overwriting later edits',async()=>{const dir=await mkdtemp(join(tmpdir(),'ng-stale-'));assert.throws(()=>capture(undefined));const {editor,mutate}=editorFor(join(dir,'demo.md'));await writeFile(editor.document.uri.fsPath,editor.document.getText());const snap=capture(editor);mutate('new input');await assert.rejects(editSnapshot(snap,'bold'),/已变化/);assert.equal(editor.document.getText(),'new input');await rm(dir,{recursive:true,force:true});editor.document.languageId='plaintext';assert.throws(()=>capture(editor));editor.document.languageId='markdown';editor.document.uri.scheme='untitled';assert.throws(()=>capture(editor));editor.document.uri.scheme='file';editor.selections=[];assert.throws(()=>capture(editor));});
test('native edit/save failures preserve current buffer and disk mismatch is reported',async()=>{const dir=await mkdtemp(join(tmpdir(),'ng-fail-'));try{
 let x=editorFor(join(dir,'a.md'));await writeFile(x.editor.document.uri.fsPath,x.editor.document.getText());x.editor.edit=async()=>false;await assert.rejects(editSnapshot(capture(x.editor),'bold'),/编辑被拒绝/);
 x=editorFor(join(dir,'b.md'));await writeFile(x.editor.document.uri.fsPath,x.editor.document.getText());x.editor.document.save=async()=>false;await assert.rejects(editSnapshot(capture(x.editor),'italic'),/保存失败/);assert.match(x.editor.document.getText(),/\*\*\*/);
 x=editorFor(join(dir,'c.md'));await writeFile(x.editor.document.uri.fsPath,x.editor.document.getText());x.editor.document.save=async()=>{await writeFile(x.editor.document.uri.fsPath,'different');return true;};await assert.rejects(editSnapshot(capture(x.editor),'code'),/读|变化/);
 x=editorFor(join(dir,'d.md'));await writeFile(x.editor.document.uri.fsPath,x.editor.document.getText());await editSnapshot(capture(x.editor),'foreground','#c0392b');const snap=capture(x.editor);await editSnapshot(snap,'clear');assert.equal(x.editor.document.getText(),'1. **重要** 正文。\n');
 }finally{await rm(dir,{recursive:true,force:true});}});
test('workspace adapter verifies local roots, trust and symlink boundaries',async()=>{const dir=await mkdtemp(join(tmpdir(),'ng-roots-'));try{
 const a=join(dir,'a'),b=join(dir,'b');await mkdir(a);await mkdir(b);await writeFile(join(a,'a.md'),'x');await writeFile(join(b,'b.md'),'y');
 const uri=path=>({scheme:'file',fsPath:path});vscode.workspace.workspaceFolders=[{name:'a',uri:uri(a)}];vscode.workspace.isTrusted=true;vscode.env.remoteName=undefined;
 assert.equal(localFolders().length,1);assert.equal(await chooseRoot(),a);await verifyRoot(a);await verifyFile(a,uri(join(a,'a.md')));await assert.rejects(verifyFile(a,uri(join(b,'b.md'))),/跨工作区/);
 await symlink(join(b,'b.md'),join(a,'escape.md'));await assert.rejects(verifyFile(a,uri(join(a,'escape.md'))),/符号链接/);
 vscode.workspace.isTrusted=false;await assert.rejects(verifyRoot(a),/信任/);await verifyRoot(a,false);vscode.workspace.isTrusted=true;
 await assert.rejects(verifyRoot(b),/已移除/);await assert.rejects(verifyFile(a,{scheme:'untitled',fsPath:'x'}),/本机已保存/);
 vscode.workspace.workspaceFolders.push({name:'b',uri:uri(b)});assert.equal(await chooseRoot(),a);vscode.window.showQuickPick=async()=>undefined;await assert.rejects(chooseRoot(),/未选择/);
 vscode.env.remoteName='ssh-remote';assert.throws(localFolders,/远程/);vscode.env.remoteName=undefined;vscode.workspace.workspaceFolders=[];assert.throws(localFolders,/文件夹/);
 vscode.workspace.workspaceFolders=[{name:'virtual',uri:{scheme:'mem'}}];assert.throws(localFolders,/本机磁盘/);
 }finally{vscode.env.remoteName=undefined;vscode.workspace.workspaceFolders=[];await rm(dir,{recursive:true,force:true});}});

test('UTF8 BOM is ignored for native document comparison and invalid encodings reject',()=>{assert.equal(decodeUtf8Markdown(Buffer.from('\ufeff正文')),'正文');assert.equal(decodeUtf8Markdown(Buffer.from('正文')),'正文');assert.throws(()=>decodeUtf8Markdown(Buffer.from([0xff,0xfe,0x61,0])),/UTF-8/);assert.throws(()=>decodeUtf8Markdown(Buffer.from([0x61,0,0x62,0])),/UTF-8/);});

// 备份必须先读回成功；磁盘冲突和备份目录失败都不得进入编辑事务。
test('current document restoration backs up exact HTML and reset keeps native text',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ng-restore-'));try{
 const legacy='<span data-codex-color="1" style="background-color:#fff88f">重要</span> 正文。\n';
 const {editor}=editorFor(join(dir,'note.md'),legacy);await writeFile(editor.document.uri.fsPath,legacy);
 const backup=await restoreNative(editor,join(dir,'backups'));assert.equal(await readFile(backup,'utf8'),legacy);
 assert.match(editor.document.getText(),/^重要 正文。/);assert.doesNotMatch(editor.document.getText(),/<span|<code/);
 const native=editor.document.getText();const resetBackup=await restoreNative(editor,join(dir,'backups'),true);
 assert.equal(await readFile(resetBackup,'utf8'),native);assert.equal(editor.document.getText(),'重要 正文。\n');
 assert.equal(await restoreNative(editor,join(dir,'backups')),undefined);
 const conflict=editorFor(join(dir,'conflict.md'),legacy);await writeFile(conflict.editor.document.uri.fsPath,'other');
 await assert.rejects(restoreNative(conflict.editor,join(dir,'backups')),/磁盘/);assert.equal(conflict.editor.document.getText(),legacy);
 const failed=editorFor(join(dir,'failed.md'),legacy);await writeFile(failed.editor.document.uri.fsPath,legacy);await writeFile(join(dir,'blocked'),'file');
 await assert.rejects(restoreNative(failed.editor,join(dir,'blocked')));assert.equal(failed.editor.document.getText(),legacy);assert.equal(failed.editor.document.version,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('decorations refresh exact snapshots only and dispose without writing source',async()=>{
 const {registerNativeDecorations,nativeEditorRanges}=await import('../src/native-decorations.ts');
 const {applyNativeTextColor}=await import('../src/native-text-colors.ts');
 let value=applyNativeTextColor('alpha',0,5,'background','#fff88f').text;
 const handlers=[],disposed=[],sets=[];
 const listen=fn=>{handlers.push(fn);return {dispose:()=>disposed.push('event')};};
 vscode.workspace.onDidChangeTextDocument=listen;vscode.workspace.onDidCloseTextDocument=listen;vscode.window.onDidChangeVisibleTextEditors=listen;
 vscode.window.createTextEditorDecorationType=options=>({options,dispose:()=>disposed.push('type')});
 vscode.window.visibleTextEditors=[{document:{languageId:'markdown',getText:()=>value,positionAt:offset=>({line:0,character:offset})},setDecorations:(type,ranges)=>sets.push({type,ranges})}];
 const controller=registerNativeDecorations();assert.equal(sets.at(-1).ranges.length,1);assert.equal(nativeEditorRanges(value).length,1);
 value=value.replace('alpha\n','changed\n');const stale=value;handlers[0]();await new Promise(resolve=>setTimeout(resolve,70));
 assert.equal(value,stale);assert.equal(sets.at(-1).ranges.length,0);assert.equal(nativeEditorRanges(stale).length,0);
 handlers[1]();controller.dispose();const count=sets.length;await new Promise(resolve=>setTimeout(resolve,70));assert.equal(sets.length,count);assert.equal(disposed.filter(item=>item==='event').length,3);vscode.window.visibleTextEditors=[];
});
