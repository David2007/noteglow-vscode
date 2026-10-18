import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const mockURL=new URL('./fixtures/vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const vscode=await import(mockURL);const {capture,editSnapshot,decodeUtf8Markdown}=await import('../src/editor.ts');const {localFolders,chooseRoot,verifyRoot,verifyFile}=await import('../src/workspaces.ts');
function editorFor(path,text='1. **重要** 正文。\n'){
 let value=text;const uri={scheme:'file',fsPath:path,toString:()=>`file://${path}`};
 const positionAt=offset=>{const a=value.slice(0,offset).split('\n');return {line:a.length-1,character:a.at(-1).length};};
 const offsetAt=p=>value.split('\n').slice(0,p.line).reduce((n,line)=>n+line.length+1,0)+p.character;
 const doc={languageId:'markdown',uri,version:1,isClosed:false,getText:()=>value,positionAt,offsetAt,save:async()=>{await writeFile(path,value);return true;}};
 const selection=new vscode.Selection(positionAt(value.indexOf('重要')),positionAt(value.indexOf('重要')+2));
 const editor={document:doc,selection,selections:[selection],edit:async callback=>{callback({replace:(_range,text)=>{value=text;doc.version++;}});return true;}};
 return {editor,mutate:text=>{value=text;doc.version++;}};
}
test('editor snapshot applies portable color and saves exact text using one native edit',async()=>{const dir=await mkdtemp(join(tmpdir(),'ng-edit-'));try{const {editor}=editorFor(join(dir,'demo.md'));await writeFile(editor.document.uri.fsPath,editor.document.getText());const snap=capture(editor);await editSnapshot(snap,'background','#fff88f');assert.match(editor.document.getText(),/1\. \*\*<span/);assert.equal(await readFile(editor.document.uri.fsPath,'utf8'),editor.document.getText());assert.equal(editor.document.version,2);}finally{await rm(dir,{recursive:true,force:true});}});
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
