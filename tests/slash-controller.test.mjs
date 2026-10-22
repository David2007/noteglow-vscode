import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
const mockURL=new URL('./fixtures/slash-vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const api=await import(mockURL),{activeSlashEdit,registerSlashCommands}=await import('../src/slash-controller.ts');
function editor(text='/code'){
 const selection={active:{line:0,character:text.length},isEmpty:true};
 return {selection,selections:[selection],document:{uri:{scheme:'file'},languageId:'markdown',isClosed:false,lineAt:()=>({text}),getText:()=>text,offsetAt:p=>p.character,positionAt:p=>p},async insertSnippet(snippet,range,options){this.inserted={snippet,range,options};return true;}};
}
test('native eligibility requires a local Markdown single empty cursor and exact line ending',()=>{
 assert.equal(activeSlashEdit(undefined),null);
 for(const change of [e=>e.document.uri.scheme='untitled',e=>e.document.languageId='plaintext',e=>e.document.isClosed=true,e=>e.selections=[],e=>e.selections=[e.selection,e.selection],e=>e.selection.isEmpty=false,e=>e.selection.active.character=2]){const e=editor();change(e);assert.equal(activeSlashEdit(e),null);}
 const ordinary=editor('ordinary');ordinary.document.getText=()=>assert.fail('ordinary typing must not read or parse full document');assert.equal(activeSlashEdit(ordinary),null);
 assert.ok(activeSlashEdit(editor()));
});
test('context refresh and snippet submission preserve intended cursor, undo stops and stale Enter',async()=>{
 api.window.activeTextEditor=editor();const disposable=registerSlashCommands();
 assert.deepEqual(api.calls.at(-1),['setContext','noteglow.slashReady',true]);
 await api.handlers.get('noteglow.expandSlash')();const {snippet,range,options}=api.window.activeTextEditor.inserted;
 assert.equal(snippet.value,'```\n\n```');assert.equal(snippet.cursor,4);assert.equal(range.start,0);assert.equal(range.end,5);assert.deepEqual(options,{undoStopBefore:true,undoStopAfter:true});
 api.window.activeTextEditor=editor('ordinary');for(const {fn} of api.listeners)fn();assert.deepEqual(api.calls.at(-1),['setContext','noteglow.slashReady',false]);
 await api.handlers.get('noteglow.expandSlash')();assert.deepEqual(api.calls.at(-1),['type',{text:'\n'}]);assert.equal(api.window.activeTextEditor.inserted,undefined);
 api.window.activeTextEditor=undefined;await api.handlers.get('noteglow.expandSlash')();assert.deepEqual(api.calls.at(-1),['type',{text:'\n'}]);
 disposable.dispose();assert.equal(api.handlers.size,0);assert.ok(api.listeners.every(item=>item.disposed));assert.deepEqual(api.calls.at(-1),['setContext','noteglow.slashReady',false]);
});

test('rejected and failed snippet edits notify without adding a stale newline',async()=>{
 for(const insertSnippet of [async()=>false,async()=>{throw Error('closed');}]){
  api.window.activeTextEditor=editor();api.window.activeTextEditor.insertSnippet=insertSnippet;
  const controller=registerSlashCommands(),before=api.calls.filter(c=>c[0]==='type').length,count=api.notices.length;
  await api.handlers.get('noteglow.expandSlash')();
  assert.equal(api.notices.length,count+1);assert.match(api.notices.at(-1),/转换/);
  assert.equal(api.calls.filter(c=>c[0]==='type').length,before);controller.dispose();
 }
});

test('host eligibility and snippet path include heading and Mermaid commands',async()=>{
 for(const command of ['/h1','/h2','/h3','/h4','/h5','/h6','/mermaid']){
  api.window.activeTextEditor=editor(command);assert.ok(activeSlashEdit(api.window.activeTextEditor));
  const controller=registerSlashCommands();await api.handlers.get('noteglow.expandSlash')();
  const result=api.window.activeTextEditor.inserted;assert.ok(result);assert.equal(result.range.end,command.length);
  assert.deepEqual(result.options,{undoStopBefore:true,undoStopAfter:true});
  assert.equal(result.snippet.cursor,command==='/mermaid'?11:Number(command.at(-1))+1);controller.dispose();
 }
});
