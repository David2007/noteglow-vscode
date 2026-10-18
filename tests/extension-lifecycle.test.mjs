import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const mockURL=new URL('./fixtures/lifecycle-vscode.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier==='vscode')return {url:mockURL,shortCircuit:true};return next(specifier,context);}});
const api=await import(mockURL);const {activate,deactivate}=await import('../src/extension.ts');
test('restricted-mode failure releases the rendered busy state without waiting for an error notification',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ng-lifecycle-'));const storage=join(directory,'storage'),root=join(directory,'notes');await mkdir(root);await mkdir(join(storage,'sessions'),{recursive:true});
 const attachments=[{id:'one',kind:'selection',path:'one.md',content:'第一段'},{id:'two',kind:'selection',path:'two.md',content:'第二段'}];
 const conversation={id:'conversation-a',root,title:'测试',threadId:null,model:'',draft:'请比较两段',attachments,messages:[]};
 await writeFile(join(storage,'sessions','sessions-v1.json'),JSON.stringify({version:1,activeId:conversation.id,conversations:[conversation],colors:{foreground:'#c0392b',background:'#fff88f'}}));
 api.workspace.workspaceFolders=[{name:'notes',uri:new api.Uri(root)}];const previous=process.env.CODEX_HOME;process.env.CODEX_HOME=join(directory,'no-model-cache');
 const context={storageUri:new api.Uri(storage),extensionUri:new api.Uri(directory),subscriptions:[],globalState:{get(){},async update(){}}};
 try{
  await activate(context);api.resolveView(context.extensionUri);await api.receive({type:'ready'});
  const restored=api.waitForRender(state=>!state.busy && api.notices.some(message=>message.includes('信任')));
  await api.receive({type:'send',conversationId:conversation.id});
  // showErrorMessage 故意永不 resolve；仅等待实际失败后的状态渲染，不等待通知关闭。
  await restored;
  assert.ok(api.notices.some(message=>message.includes('信任')));
  assert.ok(api.renders.some(state=>state.busy===true),'request entered the running state');
  const last=api.renders.at(-1);assert.equal(last.busy,false);assert.equal(last.conversation.draft,'请比较两段');assert.deepEqual(last.conversation.attachments,attachments);assert.equal(last.status.includes('正在保存并启动'),false);assert.equal(last.conversation.messages.length,0);
 }finally{deactivate();for(const item of context.subscriptions)item.dispose();if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await rm(directory,{recursive:true,force:true});}
});
