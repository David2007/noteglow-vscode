/* 用户文本一律作为文字显示，不执行笔记或 CLI 返回的 HTML。 */
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
let active = '', busy = false, rendering = false;
function post(type, extra = {}) { vscode.postMessage(type === "ready" ? {type} : {type, conversationId: active, ...extra}); }
function draft() { if(!rendering) post('draft',{text:$('question').value,model:$('model').value}); }
$('question').addEventListener('input',draft); $('model').addEventListener('change',draft);
$('new').onclick=()=>post('new'); $('conversations').onchange=()=>post('select',{id:$('conversations').value});
$('delete').onclick=()=>post('delete',{id:active}); $('stop').onclick=()=>post('stop');
$('send').onclick=()=>{draft();post('send');};
$('question').onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();draft();post('send');}};
for(const button of document.querySelectorAll('[data-command]')) button.onclick=()=>post('command',{command:button.dataset.command});
function option(value, label) { const o=document.createElement('option');o.value=value;o.textContent=label;return o; }
window.addEventListener('message',({data:s})=>{
  if(!s||s.type!=='state')return; rendering=true;
  const c=s.conversation, switched=(c?.id??'')!==active, completed=busy&&!s.busy&&c?.draft==='';
  const selectedModel=switched||!c ? (c?.model??'') : $('model').value;
  active=c?.id??'';busy=s.busy;
  $('conversations').replaceChildren(...s.conversations.map(c=>option(c.id,c.title)));$('conversations').value=active;
  $('root').textContent=c?`固定根目录：${c.root}`:'新建对话后，引用和草稿保存在本机工作区。';
  $('model').replaceChildren(option('','Codex 默认'),...s.models.map(m=>option(m.slug,m.displayName)));
  if(selectedModel&&!s.models.some(m=>m.slug===selectedModel))$('model').append(option(selectedModel,`${selectedModel}（已保存）`));
  $('model').value=selectedModel;
  if(switched||completed||!c)$('question').value=c?.draft??'';
  $('messages').replaceChildren(...(c?.messages??[]).map(m=>{
    const article=document.createElement('article'),label=document.createElement('strong'),body=document.createElement('pre');
    label.textContent=m.role==='user'?'我':'Codex';body.textContent=m.text;article.append(label,body);
    if(m.attachments?.length){const refs=document.createElement('small');refs.textContent=`引用：${m.attachments.map(a=>`${a.path}:${a.startLine??1}-${a.endLine??1}`).join('，')}`;article.append(refs);}return article;
  }));
  $('attachments').replaceChildren(...(c?.attachments??[]).map(a=>{
    const card=document.createElement('span');card.className='card';const preview=document.createElement('button'),remove=document.createElement('button');
    preview.textContent=`${a.path.split(/[\\/]/).pop()}:${a.startLine??1}-${a.endLine??1}`;preview.title=`${a.path} · ${a.content.length} 字符，点击预览`;preview.onclick=()=>post('preview',{id:a.id});
    remove.textContent='×';remove.title='移除引用';remove.onclick=()=>post('detach',{id:a.id});remove.disabled=busy;card.append(preview,remove);return card;
  }));
  $('status').textContent=s.status; $('permission').textContent=s.permission;
  $('foreground').textContent=`A ${s.colors.foreground}`;$('background').textContent=`▰ ${s.colors.background}`;
  for(const id of ['new','conversations'])$(id).disabled=busy;
  for(const id of ['delete','question','model','send'])$(id).disabled=busy||!c;
  for(const b of document.querySelectorAll('[data-command]'))b.disabled=busy;
  $('stop').disabled=!busy; rendering=false;
});
post('ready');
