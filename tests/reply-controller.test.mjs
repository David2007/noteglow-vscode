import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
const mockURL=new URL('./fixtures/vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const api=await import(mockURL),{performReplyAction}=await import('../src/reply-controller.ts'),{captureInsertion,insertAtSnapshot}=await import('../src/editor.ts');
const text='Before\n```js\nCODE\n```\nAfter',state={activeId:'a',conversations:[{id:'a',messages:[{role:'assistant',text}]}]};
const action={type:'applyReplyCode',conversationId:'a',requestId:'x',messageIndex:0,blockIndex:0};
function editor(){let source='Alpha Beta';const selection={anchor:{line:0,character:0},active:{line:0,character:5},start:{line:0,character:0},end:{line:0,character:5}};const document={uri:{scheme:'file',toString:()=>'/note.md'},isClosed:false,languageId:'markdown',version:1,getText:()=>source,offsetAt:p=>p.character,positionAt:p=>({line:0,character:p})};const e={selection,selections:[selection],document,calls:[],async edit(fn,options){this.calls.push(options);fn({insert:(p,text)=>{source=source.slice(0,p.character)+text+source.slice(p.character);document.version++;}});return true;}};api.window.activeTextEditor=e;api.window.visibleTextEditors=[e];return e;}
test('Apply inserts at active selection endpoint without replacing and creates one undo group',async()=>{const e=editor();await performReplyAction(state,action,e);assert.equal(e.document.getText(),'AlphaCODE Beta');assert.equal(e.selection.isEmpty,true);assert.equal(e.selection.active.character,9);assert.deepEqual(e.calls,[{undoStopBefore:true,undoStopAfter:true}]);});
test('missing, multiple, closed, changed or rejected targets never fall back elsewhere',async()=>{
 assert.throws(()=>captureInsertion(undefined));
 for(const mutate of [e=>e.selections=[],e=>e.selections=[e.selection,e.selection],e=>e.document.uri.scheme='untitled',e=>e.document.languageId='plaintext',e=>e.document.isClosed=true,()=>api.window.visibleTextEditors=[]]){const e=editor();mutate(e);assert.throws(()=>captureInsertion(e));assert.equal(e.calls.length,0);}
 for(const mutate of [e=>e.document.version++,e=>e.document.isClosed=true,e=>e.document.uri.toString=()=>'/other.md',e=>e.document.getText=()=> 'changed',()=>api.window.visibleTextEditors=[]]){const e=editor(),snapshot=captureInsertion(e);mutate(e);await assert.rejects(insertAtSnapshot(snapshot,'CODE'));assert.equal(e.calls.length,0);}
 const e=editor();e.edit=async()=>false;await assert.rejects(performReplyAction(state,action,e),/拒绝/);assert.equal(e.document.getText(),'Alpha Beta');
});
test('Copy sends exact original reply to host clipboard without requiring editor or idle state',async()=>{let clipboard;api.env.clipboard={writeText:async value=>{clipboard=value;}};await performReplyAction({...state,busy:true},{type:'copyReply',conversationId:'a',requestId:'copy',messageIndex:0},undefined);assert.equal(clipboard,text);api.env.clipboard.writeText=async()=>{throw Error('clipboard unavailable');};await assert.rejects(performReplyAction(state,{type:'copyReply',conversationId:'a',requestId:'copy',messageIndex:0},undefined),/clipboard/);});


test('Apply completion does not reclaim cursor after explicit selection or editor changes',async()=>{
 for(const change of [e=>{e.selection={anchor:{line:0,character:1},active:{line:0,character:1}};api.emitSelection({textEditor:e,kind:1,selections:[e.selection]});},()=>api.emitActive(undefined)]){
  const e=editor(),edit=e.edit;let release;e.edit=async function(...args){await edit.apply(this,args);await new Promise(resolve=>release=resolve);return true;};
  const pending=performReplyAction(state,action,e);await new Promise(resolve=>setImmediate(resolve));change(e);const selection=e.selection;release();await pending;assert.equal(e.selection,selection);assert.equal(e.document.getText(),'AlphaCODE Beta');
 }
});


test('delayed acknowledgment of the initial selection does not prevent Apply caret collapse',async()=>{
 const e=editor(),edit=e.edit;
 e.edit=async function(...args){api.emitSelection({textEditor:e,kind:3,selections:e.selections});return edit.apply(this,args);};
 await performReplyAction(state,action,e);assert.equal(e.selection.isEmpty,true);assert.equal(e.selection.active.character,9);
});


test('mouse and keyboard reselecting the original coordinates retain ownership of the selection',async()=>{
 for(const kind of [1,2]){
  const e=editor(),initial=e.selection,edit=e.edit;
  e.edit=async function(...args){api.emitSelection({textEditor:e,kind,selections:e.selections});return edit.apply(this,args);};
  await performReplyAction(state,action,e);assert.equal(e.selection,initial);assert.equal(e.document.getText(),'AlphaCODE Beta');
 }
});
