import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const mockURL=new URL('./fixtures/lifecycle-vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const api=await import(mockURL),{activate,deactivate}=await import('../src/extension.ts');
async function openEditor(path,source){
 let value=source,selected;const document={uri:new api.Uri(path),version:1,languageId:'markdown',isClosed:false,getText:()=>value,lineAt:line=>({text:value.split('\n')[line]}),positionAt(offset){const lines=value.slice(0,offset).split('\n');return {line:lines.length-1,character:lines.at(-1).length};},offsetAt(p){return value.split('\n').slice(0,p.line).reduce((sum,line)=>sum+line.length+1,0)+p.character;},async save(){await writeFile(path,value);return true;}};
 const editor={document,get selection(){return selected;},set selection(s){selected=s;this.selections=[s];},async edit(build){build({replace(range,insert){value=value.slice(0,document.offsetAt(range.start))+insert+value.slice(document.offsetAt(range.end));document.version++;}});return true;}};
 editor.selection=new api.Selection(document.positionAt(0),document.positionAt(source.length));await writeFile(path,source);api.window.activeTextEditor=editor;return editor;
}
test('registered repeat command remembers exact successful format across clear, cancel and failure',async()=>{
 api.reset();const dir=await mkdtemp(join(tmpdir(),'ng-repeat-'));const context={extensionUri:new api.Uri(dir),subscriptions:[],globalState:{get(){},async update(){}}};const error=api.window.showErrorMessage;
 api.window.showErrorMessage=async message=>{api.notices.push(message);};
 try {
  await activate(context);
  let editor=await openEditor(join(dir,'a.md'),'Alpha');await api.commands.executeCommand('noteglow.repeatFormat');assert.match(api.notices.at(-1),/先通过/);assert.equal(editor.document.getText(),'Alpha');
  await api.commands.executeCommand('noteglow.italic');assert.equal(editor.document.getText(),'*Alpha*');
  editor=await openEditor(join(dir,'b.md'),'Beta');await api.commands.executeCommand('noteglow.repeatFormat');assert.equal(editor.document.getText(),'*Beta*');
  api.window.showQuickPick=async()=>undefined;await api.commands.executeCommand('noteglow.chooseBackground');
  editor=await openEditor(join(dir,'unsafe.md'),'$$bad$$');await api.commands.executeCommand('noteglow.bold');assert.equal(editor.document.getText(),'$$bad$$');
  editor=await openEditor(join(dir,'c.md'),'Gamma');await api.commands.executeCommand('noteglow.repeatFormat');assert.equal(editor.document.getText(),'*Gamma*','cancel/failure preserved italic');
  api.window.showQuickPick=async()=> '#1f618d';await api.commands.executeCommand('noteglow.chooseForeground');
  editor=await openEditor(join(dir,'d.md'),'Delta');await api.commands.executeCommand('noteglow.repeatFormat');const colored=editor.document.getText();
  const record=JSON.parse(colored.match(/<!-- noteglow-text-colors:1 (.+) -->/)[1]);assert.deepEqual(record.ranges,[{from:0,to:5,property:'foreground',color:'#1f618d'}]);
  await api.commands.executeCommand('noteglow.clearColor');assert.equal(editor.document.getText(),'Delta');
  await api.commands.executeCommand('noteglow.repeatFormat');assert.equal(editor.document.getText(),colored,'clear keeps exact last successful color');
 } finally {deactivate();for(const item of context.subscriptions)item.dispose();api.window.activeTextEditor=undefined;api.window.showErrorMessage=error;await rm(dir,{recursive:true,force:true});}
});
