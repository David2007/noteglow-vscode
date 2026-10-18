/* 用户文本一律作为文字显示；图片资源只由宿主核验缓存后授权，Base64 只用于一次上传。 */
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
let active = '', busy = false, rendering = false, uploading = false, limits, uploadEpoch = 0, inputRevision = 0, pendingUpload, pendingSend;
const imageNodes = new Map(), imageUrls = new Map();
const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){requestImage(entry.target);observer.unobserve(entry.target);}});
function post(type, extra = {}) { vscode.postMessage(type === 'ready' ? {type} : {type, conversationId: active, ...extra}); }
function draft() { if(!rendering) post('draft',{text:$('question').value,model:$('model').value}); }
function controls() {
  const locked=busy||uploading||!!pendingSend;
  for(const id of ['new','conversations'])$(id).disabled=locked;
  for(const id of ['delete','question','model','send','add-images'])$(id).disabled=locked||!active;
  for(const button of document.querySelectorAll('[data-command]'))button.disabled=locked;
  $('stop').disabled=!locked;
}
$('question').addEventListener('input',()=>{inputRevision++;draft();});$('model').addEventListener('change',draft);
$('new').onclick=()=>post('new');$('conversations').onchange=()=>post('select',{id:$('conversations').value});
$('delete').onclick=()=>post('delete',{id:active});$('stop').onclick=()=>{uploadEpoch++;post('stop');};
function submit(){if(busy||uploading||pendingSend||!active)return;draft();const requestId=crypto.randomUUID();pendingSend={requestId,conversationId:active,revision:inputRevision,text:$('question').value};controls();post('send',{requestId});}
$('send').onclick=submit;
$('question').onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();submit();}};
$('add-images').onclick=()=>post('command',{command:'addImages'});
for(const button of document.querySelectorAll('[data-command]'))button.onclick=()=>post('command',{command:button.dataset.command});
function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
function requestImage(img){post('imageResource',{id:img.dataset.imageId});}
function imageCard(image,removable){
  const card=document.createElement('span');card.className='card image-card';
  const preview=document.createElement('button'),img=document.createElement('img'),name=document.createElement('span');
  preview.className='image-preview';preview.title=`${image.name} · ${image.width}×${image.height} · 点击预览`;
  img.alt=image.name;img.loading='lazy';img.decoding='async';img.dataset.imageId=image.id;
  img.onerror=()=>{img.alt='图片无法解码，请重新添加';preview.title=img.alt;};
  const key=`${active}:${image.id}`;if(!imageNodes.has(key))imageNodes.set(key,[]);imageNodes.get(key).push(img);
  if(imageUrls.has(key))img.src=imageUrls.get(key);else if(observer)observer.observe(img);else requestImage(img);
  name.textContent=image.name;preview.append(img,name);preview.onclick=()=>post('previewImage',{id:image.id});card.append(preview);
  if(removable){const remove=document.createElement('button');remove.textContent='×';remove.title='移除图片';remove.disabled=busy||uploading;remove.onclick=()=>post('removeImage',{id:image.id});card.append(remove);}
  return card;
}
function asBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('图片读取失败，请重新选择。'));reader.onload=()=>{const value=String(reader.result),comma=value.indexOf(',');if(comma<0)reject(Error('图片编码失败。'));else resolve(value.slice(comma+1));};reader.readAsDataURL(file);});}
async function upload(files){
  if(busy||uploading||pendingSend||!active||!limits)return;
  const id=active,epoch=uploadEpoch,request={requestId:crypto.randomUUID(),conversationId:active};let total=0,posted=false;
  try{
    if(!files.length)return;
    if(files.length+Number($('image-count').dataset.count||0)>limits.maxImages)throw Error('每条消息最多添加 10 张图片。');
    for(const file of files){if(!file.size||file.size>limits.maxBytes)throw Error('每张图片最多 10 MiB。');total+=file.size;}
    if(total+Number($('image-count').dataset.bytes||0)>limits.maxTotalBytes)throw Error('图片合计超过 20 MiB。');
    pendingUpload=request;uploading=true;controls();const encoded=[];
    for(const file of files){const data=await asBase64(file);if(id!==active||epoch!==uploadEpoch)throw Error('图片导入已停止或会话已切换。');encoded.push({name:file.name,data});}
    post('images',{conversationId:id,requestId:request.requestId,files:encoded});posted=true;
  }catch(error){if(active===id&&(!pendingUpload||pendingUpload===request))$('status').textContent=error.message||'图片添加失败。';}
  finally{if(!posted&&pendingUpload===request){pendingUpload=undefined;uploading=false;}controls();}
}
$('question').addEventListener('paste',event=>{const files=Array.from(event.clipboardData?.files??[]).filter(file=>file.type.startsWith('image/'));if(files.length){event.preventDefault();void upload(files);}});
document.body.addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types??[]).includes('Files'))event.preventDefault();});
document.body.addEventListener('drop',event=>{const files=Array.from(event.dataTransfer?.files??[]);if(files.length){event.preventDefault();void upload(files);}});
window.addEventListener('message',({data:s})=>{
  if(!s)return;
  if(s.type==='imageImportResult'){
    if(!pendingUpload||s.requestId!==pendingUpload.requestId||s.conversationId!==pendingUpload.conversationId||active!==s.conversationId)return;
    pendingUpload=undefined;uploading=false;if(!s.ok)$('status').textContent=s.error||'图片添加失败。';controls();return;
  }
  if(s.type==='sendResult'){
    if(!pendingSend||s.requestId!==pendingSend.requestId||s.conversationId!==pendingSend.conversationId||active!==s.conversationId)return;
    const sent=pendingSend;pendingSend=undefined;
    if(s.ok&&inputRevision===sent.revision&&$('question').value===sent.text)$('question').value='';
    else if(s.ok)draft();
    else $('status').textContent=s.error||'发送失败，草稿已保留。';
    controls();return;
  }
  if(s.type==='imageResource'){
    if(s.conversationId!==active)return;const key=`${active}:${s.id}`;
    if(s.url){imageUrls.set(key,s.url);for(const img of imageNodes.get(key)??[])img.src=s.url;}
    else for(const img of imageNodes.get(key)??[]){img.alt=s.error||'图片不可用';img.title=img.alt;}
    return;
  }
  if(s.type!=='state')return;rendering=true;limits=s.imageLimits??limits;
  const c=s.conversation,switched=(c?.id??'')!==active;
  if(switched){uploadEpoch++;pendingUpload=undefined;uploading=false;pendingSend=undefined;inputRevision=0;}
  const selectedModel=switched||!c?(c?.model??''):$('model').value;
  active=c?.id??'';busy=s.busy;imageNodes.clear();observer?.disconnect();
  $('conversations').replaceChildren(...s.conversations.map(c=>option(c.id,c.title)));$('conversations').value=active;
  $('root').textContent=c?`固定根目录：${c.root}`:'新建对话后，引用和草稿保存在本机工作区。';
  $('model').replaceChildren(option('','Codex 默认'),...s.models.map(m=>option(m.slug,m.displayName)));
  if(selectedModel&&!s.models.some(m=>m.slug===selectedModel))$('model').append(option(selectedModel,`${selectedModel}（已保存）`));$('model').value=selectedModel;
  if(switched||!c)$('question').value=c?.draft??'';
  $('messages').replaceChildren(...(c?.messages??[]).map(m=>{
    const article=document.createElement('article'),label=document.createElement('strong'),body=document.createElement('pre');label.textContent=m.role==='user'?'我':'Codex';body.textContent=m.text;article.append(label,body);
    if(m.attachments?.length){const refs=document.createElement('small');refs.textContent=`引用：${m.attachments.map(a=>`${a.path}:${a.startLine??1}-${a.endLine??1}`).join('，')}`;article.append(refs);}
    if(m.images?.length){const images=document.createElement('div');images.className='history-images';images.append(...m.images.map(image=>imageCard(image,false)));article.append(images);}return article;
  }));
  $('attachments').replaceChildren(...(c?.attachments??[]).map(a=>{
    const card=document.createElement('span');card.className='card';const preview=document.createElement('button'),remove=document.createElement('button');preview.textContent=`${a.path.split(/[\\/]/).pop()}:${a.startLine??1}-${a.endLine??1}`;preview.title=`${a.path} · ${a.content.length} 字符，点击预览`;preview.onclick=()=>post('preview',{id:a.id});remove.textContent='×';remove.title='移除引用';remove.onclick=()=>post('detach',{id:a.id});remove.disabled=busy||uploading;card.append(preview,remove);return card;
  }));
  const images=c?.draftImages??[];$('images').replaceChildren(...images.map(image=>imageCard(image,true)));
  $('image-count').dataset.count=String(images.length);$('image-count').dataset.bytes=String(images.reduce((sum,image)=>sum+image.size,0));$('image-count').textContent=limits?`图片 ${images.length}/${limits.maxImages}`:'';
  $('status').textContent=s.status;$('permission').textContent=s.permission;$('foreground').textContent=`A ${s.colors.foreground}`;$('background').textContent=`▰ ${s.colors.background}`;
  controls();rendering=false;
});
post('ready');
