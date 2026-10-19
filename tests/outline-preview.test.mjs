import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {mountOutline,startOutline} from '../src/outline-preview.ts';
function setup(body) {
 const {document,window}=parseHTML(`<html><body><main class="markdown-body">${body}</main></body></html>`);
 const calls=[];window.HTMLElement.prototype.scrollIntoView=function(options){calls.push({element:this,options});};
 const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];let positions=headings.map((_,i)=>i*100+50);
 headings.forEach((h,i)=>h.getBoundingClientRect=()=>({top:positions[i]}));
 const dispose=mountOutline(document,window);
 return {document,window,calls,headings,dispose,positions,buttons:()=>[...document.querySelectorAll('.noteglow-outline-title')],event:name=>window.dispatchEvent(new window.Event(name))};
}
const click=(window,element)=>element.dispatchEvent(new window.Event('click'));
test('preview defaults open, builds two levels, uses text labels and exact duplicate DOM target without closing',()=>{
 const ui=setup('<h1>same</h1><h2>same</h2><h3>&lt;img src=x&gt;</h3><h1>last</h1>');
 assert.equal(ui.document.querySelector('nav').getAttribute('aria-label'),'笔记目录');assert.ok(ui.document.body.classList.contains('noteglow-has-outline'));assert.equal(ui.buttons().length,3);
 click(ui.window,ui.buttons()[1]);assert.equal(ui.calls.at(-1).element,ui.headings[1]);assert.equal(ui.buttons()[1].getAttribute('aria-current'),'location');assert.ok(ui.document.body.classList.contains('noteglow-has-outline'));
 ui.event('scroll');assert.equal(ui.buttons()[1].getAttribute('aria-current'),'location','near document end retains explicit jump');
 click(ui.window,ui.document.querySelectorAll('.noteglow-outline-arrow')[1]);assert.equal(ui.buttons().length,4);assert.equal(ui.buttons()[2].textContent,'<img src=x>');assert.equal(ui.document.querySelector('nav img'),null);
 const toggle=ui.document.querySelector('.noteglow-outline-toggle');click(ui.window,toggle);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(ui.document.body.classList.contains('noteglow-has-outline'),false);click(ui.window,toggle);assert.equal(toggle.getAttribute('aria-expanded'),'true');
 ui.dispose();assert.equal(ui.document.querySelector('nav'),null);assert.equal(ui.document.body.classList.contains('noteglow-has-outline'),false);
});
test('manual scrolling updates current heading and expands its folded ancestor; empty and replaced content refresh safely',()=>{
 const ui=setup('<h1>top</h1><h2>child</h2><h3>deep</h3><h1>end</h1>');
 ui.positions.splice(0,4,-200,-100,16,500);ui.event('scroll');assert.equal(ui.buttons().length,4);assert.equal(ui.buttons()[2].getAttribute('aria-current'),'location');
 click(ui.window,ui.buttons()[3]);ui.event('wheel');ui.event('scroll');assert.equal(ui.buttons()[2].getAttribute('aria-current'),'location');
 ui.positions.splice(0,4,50,100,200,500);ui.event('touchstart');ui.event('scroll');assert.equal(ui.buttons().every(b=>b.getAttribute('aria-current')==='false'),true);
 ui.document.querySelector('main').replaceChildren();ui.event('vscode.markdown.updateContent');assert.equal(ui.document.querySelector('.noteglow-outline-list').textContent,'当前笔记暂无标题');ui.event('scroll');
 ui.document.querySelector('main').innerHTML='<h2></h2>';const newHeading=ui.document.querySelector('h2');newHeading.getBoundingClientRect=()=>({top:100});ui.event('vscode.markdown.updateContent');assert.equal(ui.buttons()[0].textContent,'（空标题）');click(ui.window,ui.buttons()[0]);assert.equal(ui.calls.at(-1).element,newHeading);
 ui.dispose();ui.event('keydown');ui.event('vscode.markdown.updateContent');assert.equal(ui.document.querySelector('nav'),null);
});

function message(ui,data){const event=new ui.window.Event('message');event.data=data;ui.window.dispatchEvent(event);}
test('host source scrolling releases jump pin, only matching source; note switch reopens and same-note edit preserves collapse',()=>{
 const ui=setup('<h1>top</h1><h1>last</h1>');
 message(ui,{type:'updateContent',source:'file:///a.md'});
 click(ui.window,ui.buttons()[1]);ui.positions.splice(0,2,16,200);
 message(ui,{type:'updateView',source:'file:///other.md'});ui.event('scroll');assert.equal(ui.buttons()[1].getAttribute('aria-current'),'location');
 message(ui,{type:'updateView',source:'file:///a.md'});ui.event('scroll');assert.equal(ui.buttons()[0].getAttribute('aria-current'),'location');
 const toggle=ui.document.querySelector('.noteglow-outline-toggle');click(ui.window,toggle);
 message(ui,{type:'updateContent',source:'file:///a.md'});ui.event('vscode.markdown.updateContent');assert.equal(toggle.getAttribute('aria-expanded'),'false');
 message(ui,{type:'updateContent',source:'file:///b.md'});ui.event('vscode.markdown.updateContent');assert.equal(toggle.getAttribute('aria-expanded'),'true');
 message(ui,null);message(ui,{type:'unknown',source:'file:///b.md'});ui.dispose();
});
test('first render waits for official content insertion without requiring updateContent and disconnects on disposal',async()=>{
 const {document,window}=parseHTML('<html><head></head><body></body></html>');
 window.HTMLElement.prototype.scrollIntoView=function(){};
 const stop=startOutline(document,window);assert.equal(document.querySelector('nav'),null);
 document.body.innerHTML='<main class="markdown-body"><h1>first</h1></main>';
 document.querySelector('h1').getBoundingClientRect=()=>({top:50});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(document.querySelector('.noteglow-outline-title').textContent,'first');
 document.querySelector('main').append(document.createElement('p'));await new Promise(resolve=>setImmediate(resolve));assert.equal(document.querySelectorAll('nav').length,1);stop();assert.equal(document.querySelector('nav'),null);
 document.querySelector('main').remove();const canceled=startOutline(document,window);canceled();document.body.innerHTML='<main class="markdown-body"><h1>late</h1></main>';await new Promise(resolve=>setImmediate(resolve));assert.equal(document.querySelector('nav'),null);
});
test('reopening scrolls only the outline list, accounting for row coordinates above and below its viewport',()=>{
 const ui=setup('<h1>top</h1><h1>middle</h1><h1>last</h1>');
 const list=ui.document.querySelector('.noteglow-outline-list'),toggle=ui.document.querySelector('.noteglow-outline-toggle');
 Object.defineProperty(list,'clientHeight',{value:56});list.scrollTop=0;
 click(ui.window,ui.buttons()[2]);const last=ui.buttons()[2];Object.defineProperty(last,'offsetTop',{value:84});Object.defineProperty(last,'offsetHeight',{value:28});
 click(ui.window,toggle);click(ui.window,toggle);assert.equal(list.scrollTop,56);assert.equal(ui.calls.length,1,'revealing a row never invokes document scrollIntoView');
 click(ui.window,ui.buttons()[0]);const first=ui.buttons()[0];Object.defineProperty(first,'offsetTop',{value:0});Object.defineProperty(first,'offsetHeight',{value:28});
 click(ui.window,toggle);click(ui.window,toggle);assert.equal(list.scrollTop,0);assert.equal(ui.calls.length,2);ui.dispose();
});
test('source identity starts from official metadata before the first updateContent and malformed metadata stays safe',()=>{
 for(const metadata of ['{"source":"file:///initial.md"}','bad-json','{}']) {
  const {document,window}=parseHTML('<html><head><meta id="vscode-markdown-preview-data"></head><body><main class="markdown-body"><h1>first</h1></main></body></html>');
  document.getElementById('vscode-markdown-preview-data').setAttribute('data-settings',metadata);
  document.querySelector('h1').getBoundingClientRect=()=>({top:50});const stop=startOutline(document,window);
  const toggle=document.querySelector('.noteglow-outline-toggle');click(window,toggle);
  message({window},{type:'updateContent',source:'file:///next.md'});
  assert.equal(toggle.getAttribute('aria-expanded'),metadata.startsWith('{"source"')?'true':'false');stop();
 }
});
