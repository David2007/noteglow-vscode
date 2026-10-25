import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import MarkdownIt from 'markdown-it';import {parseFragment} from 'parse5';
import {extendMarkdownIt,paintPreviewHtml} from '../src/native-preview.ts';
import {applyNativeTextColor,scanNativeText} from '../src/native-text-colors.ts';
import {applyNativeCodeColor,scanNativeCode} from '../src/native-code-colors.ts';
const bg='#fff88f',fg='#2167a8';
const nodes=html=>{const all=[];const visit=node=>{all.push(node);for(const child of node.childNodes??[])visit(child);};visit(parseFragment(html));return all;};
const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value;
const text=node=>node.nodeName==='#text'?node.value:(node.childNodes??[]).map(text).join('');
const colors=html=>nodes(html).filter(node=>node.tagName==='span'&&attr(node,'style')).map(node=>({text:text(node),style:attr(node,'style')}));
const paint=(source,word,property='background',color=bg)=>{const at=source.indexOf(word);return applyNativeTextColor(source,at,at+word.length,property,color).text;};

test('Obsidian UI golden file is read without rewriting protocol and preview preserves all known colors',async()=>{
 const source=await readFile(new URL('./fixtures/native-obsidian.md',import.meta.url),'utf8');
 assert.equal(scanNativeText(source).filter(block=>block.status==='valid').length,4);assert.equal(scanNativeCode(source)[0].status,'valid');
 const md=extendMarkdownIt(new MarkdownIt({html:true}));const html=md.render(source);
 for(const word of ['CodeSample','ColorSample','BackgroundSample','CombinedSample','CodeBlockSample'])assert.ok(colors(html).some(item=>item.text.includes(word)),word);
 assert.ok(html.includes('<strong>'));assert.ok(html.includes('<em>'));assert.ok(html.includes('language-go'));assert.ok(!html.includes('noteglow-text-colors'));assert.ok(!html.includes('noteglow-code-colors'));
 assert.ok(colors(html).some(item=>item.text==='CombinedSample'&&item.style.includes(fg)&&item.style.includes(bg)));
});

test('duplicate paragraphs bind only to token source line, including preceding CRLF and encoded text',()=>{
 const raw='same &amp; 😀\r\n\r\nsame &amp; 😀';const at=raw.lastIndexOf('same');
 const source=applyNativeTextColor(raw,at,at+4,'foreground',fg).text;
 const html=extendMarkdownIt(new MarkdownIt()).render(source);const paragraphs=nodes(html).filter(node=>node.tagName==='p');
 assert.equal(paragraphs.length,2);assert.equal(text(paragraphs[0]),'same & 😀');assert.equal(text(paragraphs[1]),'same & 😀');
 assert.equal(paragraphs[0].childNodes.some(node=>node.tagName==='span'),false);assert.equal(paragraphs[1].childNodes.some(node=>node.tagName==='span'),true);
});

test('nested format list Setext and entities retain host markup with colored visible units',()=>{
 for(const [source,word,tag] of [['***alpha***','alpha','strong'],['- `alpha` and [link](https://example.com)','alpha','code'],['alpha\n===','alpha','h1'],['a &amp; b','&amp;','p']]) {
  const html=extendMarkdownIt(new MarkdownIt({html:true})).render(paint(source,word));
  assert.ok(nodes(html).some(node=>node.tagName===tag));assert.ok(colors(html).some(item=>item.text===(word==='&amp;'?'&':word)));
  if(source.includes('[link]'))assert.ok(html.includes('href="https://example.com"'));
 }
});

test('native fence overlays preserve host syntax spans and exact CRLF text for both highlighter modes',()=>{
 const source='```go\r\na & b 😀\r\n```\r\n',at=source.indexOf('&');const colored=applyNativeCodeColor(source,at,at+1,'background',bg).text;
 for(const full of [false,true]) {
  const md=extendMarkdownIt(new MarkdownIt({highlight:()=>full?'<pre class="host"><code><span class="token">a &amp; b 😀</span>\n</code></pre>':'<span class="token">a &amp; b 😀</span>\n'}));
  const html=md.render(colored);assert.ok(html.includes('class="token"'));assert.deepEqual(colors(html),[{text:'&',style:'background-color:'+bg}]);
  assert.equal(text(nodes(html).find(node=>node.tagName==='code')),'a & b 😀\n');
 }
 const mismatch=extendMarkdownIt(new MarkdownIt({highlight:()=>'<pre><code>wrong</code></pre>'})).render(colored);assert.deepEqual(colors(mismatch),[]);
});

test('stale and malformed records never color neighboring content or enable arbitrary HTML',()=>{
 const source=paint('alpha','alpha'),stale=source.replace('alpha\n','changed\n');
 for(const input of [stale,source.replace('"version":1','"version":2'),source.replace(bg,'red')])assert.deepEqual(colors(extendMarkdownIt(new MarkdownIt()).render(input)),[]);
 for(const htmlEnabled of [true,false]) {const renderer=extendMarkdownIt(new MarkdownIt({html:htmlEnabled}));assert.ok(!renderer.render(stale).includes('noteglow-text-colors'));assert.ok(renderer.render(source.replace('noteglow-text-colors:1','noteglow-text-colors:9')).includes('noteglow-text-colors:9'));}
 const safe=extendMarkdownIt(new MarkdownIt({html:false}));const html=safe.render(source+'\n\n<script>alert(1)</script>');assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('noteglow-text-colors'));
 const twice=new MarkdownIt();assert.equal(extendMarkdownIt(twice),twice);assert.equal(extendMarkdownIt(twice),twice);assert.equal(colors(twice.render(source)).length,1);
});

test('projection mismatch or unsafe rendered nodes fail closed and forged markers do not acquire color',()=>{
 const paints=new Map([['owned',{projection:{text:'alpha',offsets:[0,1,2,3,4]},ranges:[{from:0,to:5,property:'background',color:bg}]}]]);
 for(const html of ['<p data-noteglow-native="owned">other</p>','<p data-noteglow-native="owned"><button>alpha</button></p>','<p data-noteglow-native="foreign">alpha</p>'])assert.deepEqual(colors(paintPreviewHtml(html,paints)),[]);
});


test('unfinished trailing fence invalidates only itself and never exposes earlier metadata',()=>{
 let source=paint('alpha\n\n```go\nvalue\n```\n','alpha');
 const at=source.indexOf('value');source=applyNativeCodeColor(source,at,at+5,'foreground',fg).text;
 const unfinished=source+'\n```js\nunfinished';
 assert.equal(scanNativeText(unfinished).filter(block=>block.status==='valid').length,1);
 assert.equal(scanNativeCode(unfinished).filter(block=>block.status==='valid').length,1);
 assert.equal(scanNativeCode(unfinished).at(-1).supported,false);
 for(const html of [true,false]){
  const rendered=extendMarkdownIt(new MarkdownIt({html})).render(unfinished);
  assert.ok(colors(rendered).some(item=>item.text==='alpha'));assert.ok(colors(rendered).some(item=>item.text==='value'));
  assert.ok(!rendered.includes('noteglow-text-colors'));assert.ok(!rendered.includes('noteglow-code-colors'));assert.ok(rendered.includes('unfinished'));
 }
 const start=unfinished.indexOf('unfinished');assert.throws(()=>applyNativeCodeColor(unfinished,start,start+10,'background',bg));
});


test('table colors bind to exact cells and remain compatible with native Obsidian records',()=>{
 const raw='before\n\n| same | same |\n| :--- | ---: |\n| same | `a\\|b` &amp; 😀 |\n|  | same |\n\nafter';
 const start=raw.indexOf('`a'),end=raw.indexOf('😀')+2;
 let source=applyNativeTextColor(raw,start,end,'background',bg).text;
 source=applyNativeTextColor(source,start,end,'foreground',fg).text;
 const block=scanNativeText(source).find(block=>block.kind==='table');assert.equal(block.status,'valid');
 const md=extendMarkdownIt(new MarkdownIt({html:true})),html=md.render(source),cells=nodes(html).filter(node=>['th','td'].includes(node.tagName));
 assert.equal(cells.length,6);assert.equal(text(cells[3]),'a|b & 😀');
 const painted=colors(html);assert.ok(painted.length>=2);assert.ok(painted.every(item=>item.style.includes(fg)&&item.style.includes(bg)));
 assert.equal(painted.map(item=>item.text).join(''),'a|b & 😀');
 assert.ok(cells.filter((_,i)=>i!==3).every(cell=>!hasPaint(cell)));
 function hasPaint(node){return node.tagName==='span'||(node.childNodes??[]).some(hasPaint);}
 assert.ok(!html.includes('noteglow-text-colors'));assert.ok(html.includes('<code>'));
 const stale=source.replace('`a\\|b`','`other`');assert.deepEqual(colors(md.render(stale)),[]);
});

test('multiple paragraph heading list and table records render their own colors with HTML disabled',()=>{
 const source='alpha\n\n# heading\n\n- one\n- two\n\n| label | value |\n| --- | --- |\n| same | same |';
 const colored=applyNativeTextColor(source,0,source.length,'background',bg).text;
 const rendered=extendMarkdownIt(new MarkdownIt({html:false})).render(colored);
 assert.equal(scanNativeText(colored).filter(block=>block.status==='valid').length,4);
 assert.ok(rendered.includes('<h1>'));assert.ok(rendered.includes('<ul>'));assert.ok(rendered.includes('<table>'));
 assert.equal(colors(rendered).map(item=>item.text).join(''),'alphaheadingonetwolabelvaluesamesame');
 assert.ok(!rendered.includes('noteglow-text-colors'));
});
