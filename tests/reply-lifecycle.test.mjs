import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const mockURL=new URL('./fixtures/lifecycle-vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const api=await import(mockURL),{activate,deactivate}=await import('../src/extension.ts');
test('webview Copy bypasses blocked operations and Apply resolves stored code at captured cursor',async()=>{
 api.reset();const directory=await mkdtemp(join(tmpdir(),'ng-reply-')),storage=join(directory,'storage');await mkdir(join(storage,'sessions'),{recursive:true});
 const reply='Intro\n```js\nCODE\n```\nend',conversation={id:'a',root:directory,title:'reply',threadId:null,model:'',draft:'',attachments:[],messages:[{role:'assistant',text:reply}]};
 await writeFile(join(storage,'sessions','sessions-v1.json'),JSON.stringify({version:1,activeId:'a',conversations:[conversation],colors:{foreground:'#c0392b',background:'#fff88f'}}));
 let note='Note',clipboard,release;api.env.clipboard={writeText:async value=>{clipboard=value;}};
 const selection=new api.Selection({line:0,character:0},{line:0,character:2});
 const doc={uri:new api.Uri(join(directory,'note.md')),languageId:'markdown',version:1,isClosed:false,getText:()=>note,positionAt:offset=>({line:0,character:offset}),offsetAt:p=>p.character};
 const editor={document:doc,selection,selections:[selection],async edit(fn){fn({insert:(position,text)=>{note=note.slice(0,position.character)+text+note.slice(position.character);doc.version++;}});return true;}};
 api.window.activeTextEditor=editor;api.window.visibleTextEditors=[editor];const warning=api.window.showWarningMessage;api.window.showWarningMessage=()=>new Promise(resolve=>release=resolve);
 const context={storageUri:new api.Uri(storage),extensionUri:new api.Uri(directory),subscriptions:[],globalState:{get(){},async update(){}}};
 try{
  await activate(context);api.resolveView(context.extensionUri);await api.receive({type:'ready'});
  const blocked=api.receive({type:'delete',conversationId:'a',id:'a'});await new Promise(r=>setImmediate(r));assert.ok(release);
  await api.receive({type:'copyReply',conversationId:'a',requestId:'copy',messageIndex:0});assert.equal(clipboard,reply);assert.ok(api.renders.some(r=>r.type==='replyActionResult'&&r.requestId==='copy'&&r.ok));
  await api.receive({type:'applyReplyCode',conversationId:'a',requestId:'apply',messageIndex:0,blockIndex:0});assert.equal(note,'NoCODEte');assert.ok(api.renders.some(r=>r.type==='replyActionResult'&&r.requestId==='apply'&&r.ok));
  api.window.visibleTextEditors=[];await api.receive({type:'applyReplyCode',conversationId:'a',requestId:'closed',messageIndex:0,blockIndex:0});assert.equal(note,'NoCODEte');assert.ok(api.renders.some(r=>r.type==='replyActionResult'&&r.requestId==='closed'&&!r.ok));
  await api.receive({type:'copyReply',conversationId:'other',requestId:'stale',messageIndex:0});assert.equal(clipboard,reply);assert.ok(api.renders.some(r=>r.type==='replyActionResult'&&r.requestId==='stale'&&!r.ok));
  release(undefined);await blocked;
 }finally{release?.(undefined);deactivate();for(const disposable of context.subscriptions)disposable.dispose();api.window.activeTextEditor=undefined;api.window.visibleTextEditors=[];api.window.showWarningMessage=warning;await rm(directory,{recursive:true,force:true});}
});
