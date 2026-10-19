import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
const mockURL=new URL('./fixtures/outline-vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const api=await import(mockURL);const {registerOutline}=await import('../src/outline-tree.ts');
function start(source){api.reset();const state=new Map();const context={workspaceState:{get:(key,fallback)=>state.get(key)??fallback,update:async(key,value)=>{state.set(key,value);}}};if(source!==undefined)api.window.activeTextEditor=api.editor(source);return {controller:registerOutline(context),state};}
test('native tree opens once and uses distinct line identities, navigation keeps document bytes and group',async()=>{
 const {controller,state}=start('# same\n## child\n### deep\n# same');const editor=api.window.activeTextEditor;
 const roots=api.provider.getChildren();assert.equal(roots.length,2);assert.equal(api.provider.getChildren(roots[0]).length,1);assert.equal(api.provider.getParent(roots[0].children[0]),roots[0]);
 const first=api.provider.getTreeItem(roots[0]),last=api.provider.getTreeItem(roots[1]),child=api.provider.getTreeItem(roots[0].children[0]);assert.notEqual(first.id,last.id);assert.equal(first.collapsibleState,2);assert.equal(child.collapsibleState,1);assert.equal(last.collapsibleState,0);assert.match(last.tooltip,/4/);
 assert.equal(state.get('outlineShown'),true);assert.equal(api.executed.filter(e=>e.name==='noteglow.outline.focus').length,1);assert.deepEqual(api.executed[0].args,[{preserveFocus:true}]);
 await api.commands.executeCommand(last.command.command,...last.command.arguments);assert.equal(editor.selection.active.line,3);assert.equal(api.window.lastShow.options.viewColumn,2);assert.equal(editor.document.getText(),'# same\n## child\n### deep\n# same');
 api.handlers.selection({textEditor:editor});assert.equal(api.reveals.at(-1).node.line,3);api.handlers.ranges({textEditor:editor,visibleRanges:[{start:{line:1},end:{line:2}}]});assert.equal(api.reveals.at(-1).node.line,1);
 api.handlers.active();assert.equal(api.executed.filter(e=>e.name==='noteglow.outline.focus').length,1);
 await api.commands.executeCommand('noteglow.outline.jump',editor.document.uri,999);assert.equal(editor.selection.active.line,3);
 const count=api.executed.length;await api.commands.executeCommand('noteglow.outline.jump',null,-1);assert.equal(api.executed.length,count+1);
 controller.dispose();assert.equal(api.commandsMap.size,0);assert.equal(Object.keys(api.handlers).length,0);
});
test('native tree refreshes edits and switches, preserves preview focus and cleans debounced updates',async()=>{
 const {controller}=start('# old');const editor=api.window.activeTextEditor;
 const oldItem=api.provider.getTreeItem(api.provider.getChildren()[0]);
 editor.setText('# new\n## second');await api.commands.executeCommand(oldItem.command.command,...oldItem.command.arguments);assert.equal(editor.revealed,undefined,'stale entry never jumps to changed source');api.handlers.change({document:editor.document});await new Promise(resolve=>setTimeout(resolve,180));assert.equal(api.provider.getChildren()[0].title,'new');
 const roots=api.provider.getChildren();api.window.activeTextEditor=undefined;api.handlers.active();assert.equal(api.provider.getChildren(),roots);
 api.window.activeTextEditor=api.editor('plain');api.handlers.active();assert.equal(api.view.message,'当前笔记暂无标题');assert.deepEqual(api.provider.getChildren(),[]);
 api.window.activeTextEditor=api.editor('x'.repeat(1_000_001));api.handlers.active();assert.match(api.view.message,/100 万/);
 api.window.activeTextEditor=api.editor('code','file:///code.ts','typescript');api.handlers.active();assert.match(api.view.message,/打开 Markdown/);assert.equal(api.view.description,undefined);
 api.window.activeTextEditor=editor;api.handlers.active();api.view.visible=false;const count=api.reveals.length;api.handlers.selection({textEditor:editor});assert.equal(api.reveals.length,count);api.handlers.visibility({visible:false});api.view.visible=true;api.handlers.visibility({visible:true});assert.ok(api.reveals.length>count);
 api.handlers.selection({textEditor:{}});api.handlers.ranges({textEditor:{},visibleRanges:[]});api.handlers.change({document:{}});
 editor.setText('# pending');api.handlers.change({document:editor.document});controller.dispose();await new Promise(resolve=>setTimeout(resolve,180));assert.equal(api.provider.getChildren()[0].title,'new');
});
test('opening without a Markdown editor is safe and source before first heading has no active selection',()=>{
 const {controller}=start();assert.deepEqual(api.provider.getChildren(),[]);
 api.window.activeTextEditor=api.editor('intro\n\n# late');api.handlers.active();assert.equal(api.reveals.length,0);
 api.handlers.ranges({textEditor:api.window.activeTextEditor,visibleRanges:[]});controller.dispose();
});

test('sticky scroll retains explicit duplicate target while visible and releases on manual scroll, selection, edit or switch',async()=>{
 const source='# same\n'+'body\n'.repeat(47)+'# same\n'+'body\n'.repeat(20)+'# later';
 const {controller}=start(source),editor=api.window.activeTextEditor;
 const jump=()=>api.commands.executeCommand('noteglow.outline.jump',editor.document.uri,48,editor.viewColumn);
 const ranges=(start,end,textEditor=editor)=>api.handlers.ranges({textEditor,visibleRanges:[{start:{line:start},end:{line:end}}]});
 await jump();api.handlers.selection({textEditor:editor});ranges(46,60);assert.equal(api.reveals.at(-1).node.line,48,'sticky header above target does not select first duplicate');
 ranges(0,20);assert.equal(api.reveals.at(-1).node.line,0,'scrolling target out of view resumes viewport tracking');
 await jump();editor.selection={active:{line:2}};api.handlers.selection({textEditor:editor});ranges(46,60);assert.equal(api.reveals.at(-1).node.line,0,'different cursor position releases explicit target');
 await jump();editor.setText(source+'\nchanged');api.handlers.change({document:editor.document});await new Promise(resolve=>setTimeout(resolve,180));ranges(46,60);assert.equal(api.reveals.at(-1).node.line,0,'revision change clears stale pin');
 await jump();const other=api.editor(source,'file:///other.md');api.window.activeTextEditor=other;api.handlers.active();ranges(46,60,other);assert.equal(api.reveals.at(-1).node.line,0,'switching document clears old target');
 controller.dispose();
});
