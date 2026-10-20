import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
const mockURL=new URL('./fixtures/folding-vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const api=await import(mockURL),{registerMetadataFolding}=await import('../src/native-metadata-folding.ts');
const {applyNativeCodeColor}=await import('../src/native-code-colors.ts');
const source=applyNativeCodeColor('```js\nconst a = 1;\n```',6,11,'foreground','#c0392b').text;
const settle=()=>new Promise(r=>setTimeout(r,140));
function editor(){const point={line:1,character:0},selection={start:point,end:point,anchor:point,active:point};return {document:{uri:{scheme:'file'},languageId:'markdown',isClosed:false,version:1,getText:()=>source},selections:[selection]};}
async function setup(){api.reset();const e=editor();api.window.activeTextEditor=e;api.window.visibleTextEditors=[e];const disposable=registerMetadataFolding();await settle();return {e,disposable};}
const folds=()=>api.calls.filter(c=>c[0]==='editor.fold');
test('valid metadata folds once without selections or settings writes; explicit command can refold',async()=>{
 const {e,disposable}=await setup();try{assert.equal(folds().length,1);assert.deepEqual(folds()[0][1],{selectionLines:[2],levels:1,direction:'down'});const selection=e.selections;
 api.events.active();await settle();assert.equal(folds().length,1);assert.equal(e.selections,selection);
 await api.handlers.get('noteglow.foldMetadata')();assert.equal(folds().length,2);
 api.events.visible();await settle();assert.equal(folds().length,2);
 api.window.visibleTextEditors=[];api.events.visible();api.window.visibleTextEditors=[e];api.events.active();await settle();assert.equal(folds().length,2,'tab switching preserves manual unfold');
 api.events.close(e.document);api.events.active();await settle();assert.equal(folds().length,3,'closing document resets view tracking');
 }finally{disposable.dispose();}assert.equal(api.provider,undefined);assert.equal(api.handlers.size,0);
});
test('stale unfolds and invalid removes provider ranges',async()=>{
 const {e,disposable}=await setup();try{
 e.document.getText=()=>source.replace('const a','const z');e.document.version++;api.events.document({document:e.document,contentChanges:[{rangeOffset:12,rangeLength:1,text:'z'}]});await settle();assert.ok(api.calls.some(c=>c[0]==='editor.unfold'));assert.equal(folds().length,1);
 e.document.getText=()=>source.replace('noteglow-code-colors:1','noteglow-code-colors:9');e.document.version++;api.events.document({document:e.document,contentChanges:[]});await settle();assert.deepEqual(api.provider.provideFoldingRanges(e.document),[]);
 }finally{disposable.dispose();}
});
test('disable, indentation strategy, metadata selection and provider conflicts never fold nearest parent',async()=>{
 for(const mode of ['disabled','indentation','selection','conflict']){
  api.reset();const e=editor();api.window.activeTextEditor=e;api.window.visibleTextEditors=[e];
  if(mode==='disabled')api.options.autoFoldMetadata=false;
  if(mode==='indentation')api.options.foldingStrategy='indentation';
  if(mode==='selection'){const p={line:3,character:2};e.selections=[{start:p,end:p,anchor:p,active:p}];}
  const execute=api.commands.executeCommand;if(mode==='conflict')api.commands.executeCommand=async(name,arg)=>{if(name==='vscode.executeFoldingRangeProvider')return [{start:0,end:3}];return execute(name,arg);};
  const disposable=registerMetadataFolding();await settle();assert.equal(folds().length,0,mode);disposable.dispose();api.commands.executeCommand=execute;
 }
});
test('async activation disposal and doc/focus/selection races do not fold',async()=>{
 api.reset();let release;api.activation(()=>new Promise(r=>release=r));const disposed=registerMetadataFolding();disposed.dispose();release();await settle();assert.equal(api.provider,undefined);
 for(const change of [e=>e.document.version++,()=>api.window.activeTextEditor=undefined,()=>api.options.autoFoldMetadata=false,()=>api.options.folding=false,()=>api.options.foldingStrategy='indentation',e=>e.selections[0].active={line:2,character:1}]){
  api.reset();const e=editor();api.window.activeTextEditor=e;api.window.visibleTextEditors=[e];const execute=api.commands.executeCommand;
  api.commands.executeCommand=async(name,arg)=>{const result=await execute(name,arg);if(name==='vscode.executeFoldingRangeProvider')change(e);return result;};
  const disposable=registerMetadataFolding();await settle();assert.equal(folds().length,0);disposable.dispose();api.commands.executeCommand=execute;
 }
});

test('initial metadata caret postpones default folding until selection leaves',async()=>{
 api.reset();const e=editor(),p={line:3,character:0};e.selections=[{start:p,end:p,anchor:p,active:p}];api.window.activeTextEditor=e;api.window.visibleTextEditors=[e];
 const disposable=registerMetadataFolding();try{await settle();assert.equal(folds().length,0);const outside={line:1,character:0};e.selections=[{start:outside,end:outside,anchor:outside,active:outside}];api.events.selection({textEditor:e});await settle();assert.equal(folds().length,1);
 }finally{disposable.dispose();}
});

test('each view column folds once; edits before a seen record preserve manual unfold',async()=>{
 const {e,disposable}=await setup();try{
  const second={...e,viewColumn:2};api.window.activeTextEditor=second;api.window.visibleTextEditors=[e,second];api.events.active();await settle();assert.equal(folds().length,2);
  api.window.activeTextEditor=e;api.events.active();await settle();assert.equal(folds().length,2);
  const prefix='# New\n\n';e.document.getText=()=>prefix+source;e.document.version++;api.events.document({document:e.document,contentChanges:[{rangeOffset:0,rangeLength:0,text:prefix}]});await settle();assert.equal(folds().length,2,'known record offset moves without refolding');
 }finally{disposable.dispose();}
});
test('manual command remains available with automatic folding disabled',async()=>{
 api.reset();api.options.autoFoldMetadata=false;const e=editor();api.window.activeTextEditor=e;api.window.visibleTextEditors=[e];const disposable=registerMetadataFolding();
 try{await settle();assert.equal(folds().length,0);await api.handlers.get('noteglow.foldMetadata')();assert.equal(folds().length,1);}finally{disposable.dispose();}
});

test('selection race during first provider query retries once after caret leaves metadata',async()=>{
 api.reset();const e=editor();api.window.activeTextEditor=e;api.window.visibleTextEditors=[e];const execute=api.commands.executeCommand;let release,first=true;
 api.commands.executeCommand=async(name,arg)=>{const ranges=await execute(name,arg);if(name==='vscode.executeFoldingRangeProvider'&&first){first=false;await new Promise(r=>release=r);}return ranges;};
 const disposable=registerMetadataFolding();try{
  await settle();assert.ok(release);const inside={line:3,character:0};e.selections=[{start:inside,end:inside,anchor:inside,active:inside}];release();await settle();assert.equal(folds().length,0);
  const outside={line:1,character:0};e.selections=[{start:outside,end:outside,anchor:outside,active:outside}];api.events.selection({textEditor:e});await settle();assert.equal(folds().length,1);
  api.events.selection({textEditor:e});await settle();assert.equal(folds().length,1);
 }finally{disposable.dispose();api.commands.executeCommand=execute;}
});

test('stale unfolding retries after a selection race during its provider query',async()=>{
 const {e,disposable}=await setup();const execute=api.commands.executeCommand;let release,first=true;
 api.commands.executeCommand=async(name,arg)=>{const ranges=await execute(name,arg);if(name==='vscode.executeFoldingRangeProvider'&&first){first=false;await new Promise(r=>release=r);}return ranges;};
 try{
  e.document.getText=()=>source.replace('const a','const z');e.document.version++;api.events.document({document:e.document,contentChanges:[{rangeOffset:12,rangeLength:1,text:'z'}]});await settle();assert.ok(release);
  const p={line:1,character:2};e.selections=[{start:p,end:p,anchor:p,active:p}];release();await settle();assert.equal(api.calls.filter(c=>c[0]==='editor.unfold').length,0);
  api.events.selection({textEditor:e});await settle();assert.equal(api.calls.filter(c=>c[0]==='editor.unfold').length,1);assert.equal(folds().length,1);
 }finally{disposable.dispose();api.commands.executeCommand=execute;}
});
