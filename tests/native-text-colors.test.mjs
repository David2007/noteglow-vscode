import assert from 'node:assert/strict';
import test from 'node:test';
import {applyNativeTextColor,formatNativeText,scanNativeText,nativeTextColorRanges,migrateOwnedTextToNative,resetNativeTextMetadata,encodeNativeTextMetadata} from '../src/native-text-colors.ts';
import {applyMarkdownColor,nativeTextDocumentShape,restoreOwnedInline,projectNativeMarkdown} from '../src/markdown-colors.ts';
const bg='#fff88f',fg='#c0392b';
const paint=(text,word,property='background',color=bg)=>{const from=text.indexOf(word);return applyNativeTextColor(text,from,from+word.length,property,color);};
const fixture='- `arr`：数组赋值会复制。\n- `brr`：修改副本不会影响原数组。\n- `crr`：切片共享底层数组。';
test('three list ranges remain native Markdown and clear only the second',()=>{
 let text=fixture;
 for(const word of ['arr','brr','crr'])text=paint(text,word).text;
 assert.equal(text.slice(0,fixture.length),fixture);assert.equal(scanNativeText(text).length,1);
 assert.equal(scanNativeText(text)[0].ranges.length,3);assert.ok(!text.includes('<span'));assert.ok(!text.includes('<code'));
 const at=text.indexOf('brr');text=applyNativeTextColor(text,at,at+3).text;
 assert.deepEqual(nativeTextColorRanges(text).map(range=>text.slice(range.from,range.to)),['arr','crr']);
 assert.equal(resetNativeTextMetadata(text),fixture);
});

test('metadata preserves actual Markdown AST including tight lists, headings and adjacent blocks',()=>{
 for(const source of [fixture,'# title\nnext','title\n===\nnext','1. alpha\n2. beta\n\nafter','alpha\n\n# next','- alpha\n\n- beta\n\nafter','alpha','alpha\r\n\r\nafter']) {
  const word=source.includes('alpha')?'alpha':source.includes('arr')?'arr':'title';
  const colored=paint(source,word).text;
  assert.equal(nativeTextDocumentShape(colored),nativeTextDocumentShape(source));
  const at=colored.indexOf(word);assert.equal(applyNativeTextColor(colored,at,at+word.length).text,source);
 }
});

test('bold/link/inline-code source symbols are excluded from color ranges',()=>{
 const source='- **bold** [link](https://example.test) and `code`';
 const result=applyNativeTextColor(source,0,source.length,'foreground',fg);
 const covered=nativeTextColorRanges(result.text).map(range=>result.text.slice(range.from,range.to)).join('');
 assert.equal(covered,'bold link and code');assert.ok(!covered.includes('https'));
});

test('entities and UTF16 boundaries fail closed; canonical records escape comment terminators',()=>{
 const source='a &amp; 😀 --> b',at=source.indexOf('&amp;');
 assert.throws(()=>applyNativeTextColor(source,at+1,at+3,'background',bg),/实体/);
 assert.throws(()=>applyNativeTextColor(source,source.indexOf('😀')+1,source.indexOf('😀')+2,'background',bg),/选区/);
 const result=applyNativeTextColor(source,at,at+5,'background',bg);assert.equal(result.text.slice(0,source.length),source);
 const raw=encodeNativeTextMetadata(source,[{from:0,to:1,property:'background',color:bg}]);assert.equal(raw.slice(4,-3).includes('--'),false);assert.ok(raw.includes('\\u002d'));
 assert.throws(()=>encodeNativeTextMetadata('a',[{from:0,to:2,property:'background',color:bg}]));
});

test('stale, corrupt and unsupported sources preserve text and expose a reset route',()=>{
 const valid=paint('alpha','alpha').text;
 for(const bad of [valid.replace('alpha\n','changed\n'),valid.replace('"version":1','"version":2'),valid.slice(0,-1)]) {
  assert.throws(()=>applyNativeTextColor(bad,0,1,'background',bg),/重置/);assert.equal(resetNativeTextMetadata(bad),bad.slice(0,bad.indexOf('\n\n')));
 }
 for(const source of ['> quote','- item\n\n  ```go\n  code\n  ```','<b>html</b>','$$\nmath\n$$']) assert.throws(()=>applyNativeTextColor(source,0,source.length,'background',bg));
 const literal='```html\n\n<!-- noteglow-text-colors:1 broken -->\n```';assert.equal(resetNativeTextMetadata(literal),literal);
 assert.equal(resetNativeTextMetadata('---\nvalue: "<!-- noteglow-text-colors:1 broken -->"\n---'),'---\nvalue: "<!-- noteglow-text-colors:1 broken -->"\n---');
});

test('format and recolor keep native Markdown and earlier colors',()=>{
 const colored=paint('- alpha and beta','alpha').text;
 const from=colored.indexOf('alpha');const bold=formatNativeText(colored,from,from+5,'bold');
 assert.ok(bold.text.startsWith('- **alpha** and beta'));assert.ok(!bold.text.includes('<span'));
 assert.equal(nativeTextColorRanges(bold.text).map(range=>bold.text.slice(range.from,range.to)).join(''),'alpha');
 const second=paint(bold.text,'beta','foreground',fg);assert.equal(scanNativeText(second.text)[0].ranges.length,2);
 const code=formatNativeText(second.text,second.text.indexOf('beta'),second.text.indexOf('beta')+4,'code');
 assert.ok(code.text.startsWith('- **alpha** and `beta`'));assert.equal(scanNativeText(code.text)[0].status,'valid');
});

test('strict legacy migration restores three inline codes with exact colors and source mapping',()=>{
 let old=fixture;for(const word of ['arr','brr','crr']){const at=old.indexOf(word);old=applyMarkdownColor(old,at,at+word.length,'background',bg).text;}
 const originalAt=old.indexOf('brr');const migrated=migrateOwnedTextToNative(old);
 assert.equal(migrated.count,3);assert.ok(migrated.text.startsWith(fixture));assert.equal(migrated.text.slice(migrated.map(originalAt),migrated.map(originalAt)+3),'brr');
 assert.deepEqual(nativeTextColorRanges(migrated.text).map(range=>migrated.text.slice(range.from,range.to)),['arr','brr','crr']);
 assert.equal(migrateOwnedTextToNative(migrated.text).text,migrated.text);
 assert.throws(()=>migrateOwnedTextToNative(old.replace('data-codex-code="1"','data-codex-code="1" onclick="bad"')));
 assert.throws(()=>restoreOwnedInline('<code data-codex-code="1"></code>'),/无损/);
});

test('migration orders mixed foreground/background ranges by source position across blocks',()=>{
 let old='alpha\n\nbeta';
 for(const [word,property,color] of [['alpha','background',bg],['beta','foreground',fg],['alpha','foreground',fg],['beta','background',bg]]) {
  const at=old.indexOf(word);old=applyMarkdownColor(old,at,at+word.length,property,color).text;
 }
 const migrated=migrateOwnedTextToNative(old);
 const blocks=scanNativeText(migrated.text);assert.equal(blocks.length,2);
 assert.deepEqual(blocks.map(block=>[block.source,block.status,block.ranges.length]),[['alpha','valid',2],['beta','valid',2]]);
 assert.equal(resetNativeTextMetadata(migrated.text),'alpha\n\nbeta');
});

test('reset damaged closing marker removes only its own line and retains following prose',()=>{
 const colored=paint('alpha\n\nafter\nnext','alpha').text;
 const damaged=colored.replace(' -->',' --');
 assert.equal(resetNativeTextMetadata(damaged),'alpha\n\nafter\nnext');
});

test('adjacent colored code and prose migration preserves every first and last character',()=>{
 const span=value=>'<span data-codex-color="1" style="background-color:#fff88f">'+value+'</span>';
 const code=value=>'<code data-codex-code="1">'+span(value)+'</code>';
 const old='- '+code('arr')+span(' 和 ')+code('brr')+span(' 共享同一数组。')+'\n- '+span('两个变量。')+'\n- '+span('长度 ')+code('len')+span(' 不一样。');
 const migrated=migrateOwnedTextToNative(old),block=scanNativeText(migrated.text)[0];
 assert.equal(block.source,'- `arr` 和 `brr` 共享同一数组。\n- 两个变量。\n- 长度 `len` 不一样。');
 const projection=projectNativeMarkdown(block.source);
 for(let i=0;i<projection.text.length;i++) {
  const offset=projection.offsets[i];
  assert.ok(block.ranges.some(range=>range.property==='background'&&range.from<=offset&&range.to>offset),'missing color on '+JSON.stringify(projection.text[i])+' at '+offset);
 }
 assert.deepEqual(block.ranges.map(range=>block.source.slice(range.from,range.to)),['arr',' 和 ','brr',' 共享同一数组。','两个变量。','长度 ','len',' 不一样。']);
});

test('directly adjacent colored code islands fail closed when native delimiters would merge',()=>{
 const code=value=>'<code data-codex-code="1"><span data-codex-color="1" style="background-color:#fff88f">'+value+'</span></code>';
 const source='before '+code('arr')+code('brr')+' after';
 assert.throws(()=>migrateOwnedTextToNative(source),/改变可见文字/);
 assert.equal(source,'before '+code('arr')+code('brr')+' after');
});

test('metadata schema rejects malformed, noncanonical and overlapping ranges without discarding records',()=>{
 const range={from:0,to:1,property:'background',color:bg};
 for(const ranges of [null,[null],[{...range,extra:true}],[{...range,property:'border'}],[{...range,color:'red'}],[{...range,color:42}],[{...range,from:-1}],[{...range,to:0}],[{...range,from:0.5}],[range,range]]) {
  assert.throws(()=>encodeNativeTextMetadata('alpha',ranges),/范围无效/);
 }
 assert.throws(()=>encodeNativeTextMetadata('a'.repeat(200001),[]),/超限/);
 assert.throws(()=>encodeNativeTextMetadata('a',Array(10001).fill(range)),/超限/);
 assert.throws(()=>encodeNativeTextMetadata('a\r\nb',[{...range,from:2,to:4}]),/范围无效/);
 assert.throws(()=>encodeNativeTextMetadata('😀',[{...range,to:1}]),/范围无效/);
 assert.ok(encodeNativeTextMetadata('',[]).includes('"source":""'));
 const valid=encodeNativeTextMetadata('alpha',[range]);
 for(const raw of [valid.replace(':1 ',':2 '),valid.replace('{"version":1','{ "version":1'),valid.replace('"source":"alpha"','"source":42'),valid.replace('"ranges":','"extra":true,"ranges":'),'<!-- noteglow-text-colors:1 null -->','<!-- noteglow-text-colors:1 {broken} -->']) {
  const text='alpha\n\n'+raw;assert.equal(scanNativeText(text)[0].status,'invalid');
  assert.deepEqual(nativeTextColorRanges(text),[]);assert.throws(()=>applyNativeTextColor(text,0,1,'background',bg),/重置/);
  assert.equal(resetNativeTextMetadata(text),'alpha');
 }
});

test('selection ownership accepts supported cross-block ranges while rejecting metadata and invalid syntax',()=>{
 const source=paint('alpha\n\nbeta','alpha').text;
 const across=applyNativeTextColor(source,0,source.length,'background',bg);
 const expected=['alpha',encodeNativeTextMetadata('alpha',[{from:0,to:5,property:'background',color:bg}]),'beta',encodeNativeTextMetadata('beta',[{from:0,to:4,property:'background',color:bg}])].join('\n\n');
 assert.equal(across.text,expected);assert.equal(resetNativeTextMetadata(across.text),'alpha\n\nbeta');
 assert.deepEqual(nativeTextColorRanges(across.text).map(range=>across.text.slice(range.from,range.to)),['alpha','beta']);
 for(const [from,to] of [[-1,1],[0,0],[0,source.length+1],[source.indexOf('<!--'),source.indexOf('<!--')+4]]) assert.throws(()=>applyNativeTextColor(source,from,to,'background',bg));
 assert.throws(()=>applyNativeTextColor('**alpha**',0,2,'background',bg),/格式标签/);
 assert.throws(()=>applyNativeTextColor('alpha',0,1,'background'),/#RGB/);
 assert.throws(()=>applyNativeTextColor('alpha',0,1,'foreground','invalid'),/#RGB/);
 assert.deepEqual(scanNativeText('a'.repeat(1000001)),[]);
 assert.throws(()=>applyNativeTextColor('a'.repeat(1000001),0,1,'background',bg),/过大/);
 assert.deepEqual(scanNativeText('```go\nunclosed'),[]);
 assert.equal(applyNativeTextColor('alpha',0,5).text,'alpha','clearing an uncolored block is a no-op');
 const bold=formatNativeText('alpha',0,5,'bold');assert.equal(bold.text,'**alpha**');assert.equal(bold.text.includes('noteglow-text-colors'),false);
});

test('migration refuses mixed legacy/native ownership and preserves identity mapping when already native',()=>{
 const native=paint('alpha','alpha').text;
 const identity=migrateOwnedTextToNative(native);assert.equal(identity.count,0);assert.equal(identity.map(native.length),native.length);
 const old='<span data-codex-color="1" style="color:#c0392b">beta</span>';
 assert.throws(()=>migrateOwnedTextToNative(native+'\n\n'+old),/同时包含/);
 const plainCode='before <code data-codex-code="1">value</code> after';
 const restored=migrateOwnedTextToNative(plainCode);assert.equal(restored.text,'before `value` after');assert.equal(restored.count,1);assert.equal(restored.text.includes('noteglow-text-colors'),false);
 const misplaced='alpha\n\n\n'+encodeNativeTextMetadata('alpha',[]);assert.equal(scanNativeText(misplaced)[0].status,'none');assert.deepEqual(nativeTextColorRanges(misplaced),[]);
});

test('bold italic and inline code independently toggle with both colors before or after formatting',()=>{
 const source='- alpha beta';
 for(const format of ['bold','italic','code']) for(const colorFirst of [false,true]) {
  let text=source;
  const colors=()=>{for(const [property,color] of [['foreground',fg],['background',bg]])text=paint(text,'alpha',property,color).text;};
  const toggle=()=>{const at=text.indexOf('alpha');text=formatNativeText(text,at,at+5,format).text;};
  if(colorFirst)colors();toggle();if(!colorFirst)colors();
  const reopened=JSON.parse(JSON.stringify(text));const block=scanNativeText(reopened)[0];
  assert.equal(block.status,'valid');assert.equal(block.ranges.length,2);
  for(const range of block.ranges)assert.equal(block.source.slice(range.from,range.to),'alpha');
  assert.ok(!reopened.includes('<span'));assert.ok(!reopened.includes('<code'));
  toggle();assert.equal(scanNativeText(text)[0].source,source,'cancel format preserves native text');
  assert.equal(nativeTextColorRanges(text).length,2,'cancel format preserves both colors');
  const at=text.indexOf('alpha');text=applyNativeTextColor(text,at,at+5).text;
  assert.equal(text,source,'clear removes only color record after format cancellation');
 }
});

test('bold plus italic nesting can be independently cancelled without losing colors',()=>{
 for(const order of [['bold','italic'],['italic','bold']]) {
  let text=paint(paint('- alpha beta','alpha','foreground',fg).text,'alpha').text;
  const toggle=format=>{const at=text.indexOf('alpha');text=formatNativeText(text,at,at+5,format).text;};
  for(const format of order)toggle(format);
  assert.equal(projectNativeMarkdown(scanNativeText(text)[0].source).text,'alpha beta');
  assert.equal(scanNativeText(text)[0].ranges.length,2);
  toggle(order[0]);assert.equal(scanNativeText(text)[0].ranges.length,2);
  toggle(order[1]);assert.equal(scanNativeText(text)[0].source,'- alpha beta');
  assert.deepEqual(nativeTextColorRanges(text).map(range=>text.slice(range.from,range.to)),['alpha','alpha']);
 }
});

test('native inline code inside bold is reversible; incompatible and partial-code operations refuse unchanged',()=>{
 let text=paint('**alpha** and beta','alpha').text;
 let at=text.indexOf('alpha');text=formatNativeText(text,at,at+5,'code').text;
 assert.equal(scanNativeText(text)[0].source,'**`alpha`** and beta');
 assert.equal(scanNativeText(text)[0].ranges.length,1);
 at=text.indexOf('alpha');
 for(const format of ['bold','italic'])assert.throws(()=>formatNativeText(text,at,at+5,format),/正文/);
 assert.throws(()=>formatNativeText(text,at+1,at+4,'code'),/完整/);
 const cancelled=formatNativeText(text,at,at+5,'code');assert.equal(scanNativeText(cancelled.text)[0].source,'**alpha** and beta');
 assert.equal(nativeTextColorRanges(cancelled.text).map(range=>cancelled.text.slice(range.from,range.to)).join(''),'alpha');
});

test('clear one word preserves bold italic code and neighboring foreground/background colors',()=>{
 let text='- **alpha** *beta* `gamma`';
 for(const word of ['alpha','beta','gamma'])for(const [property,color] of [['foreground',fg],['background',bg]])text=paint(text,word,property,color).text;
 const at=text.indexOf('beta'),cleared=applyNativeTextColor(text,at,at+4).text;
 assert.equal(scanNativeText(cleared)[0].source,'- **alpha** *beta* `gamma`');
 assert.deepEqual(nativeTextColorRanges(cleared).map(range=>cleared.slice(range.from,range.to)).sort(),['alpha','alpha','gamma','gamma']);
 assert.equal(scanNativeText(JSON.parse(JSON.stringify(cleared)))[0].status,'valid');
});

test('public native entrypoints reject owned legacy HTML instead of producing new HTML',()=>{
 const old=applyMarkdownColor('alpha',0,5,'background',bg).text,at=old.indexOf('alpha');
 assert.throws(()=>applyNativeTextColor(old,at,at+5,'foreground',fg),/旧 HTML/);
 for(const format of ['bold','italic','code'])assert.throws(()=>formatNativeText(old,at,at+5,format),/旧 HTML/);
 assert.ok(old.includes('<span data-codex-color'));
});

test('cancelling outer italic preserves nested bold while partial selection never removes whole wrapper',()=>{
 const source=paint('***alpha***','alpha').text,at=source.indexOf('alpha');
 const cancelled=formatNativeText(source,at,at+5,'italic');assert.equal(scanNativeText(cancelled.text)[0].source,'**alpha**');
 const partial=formatNativeText(source,at+1,at+4,'italic');
 assert.notEqual(scanNativeText(partial.text)[0].source,'**alpha**');
 assert.equal(projectNativeMarkdown(scanNativeText(partial.text)[0].source).text,'alpha');
 assert.deepEqual(nativeTextColorRanges(cancelled.text).map(range=>cancelled.text.slice(range.from,range.to)),['alpha']);
});


test('reset refuses trailing prose after owned text comment without deleting either record',()=>{
 const first=paint('alpha','alpha').text;
 const mixed=paint(first+'\n\nbeta','beta').text.replace(' -->',' --> 保留我');
 assert.throws(()=>resetNativeTextMetadata(mixed),/记录后含正文/);
 assert.ok(mixed.includes('保留我'));assert.equal((mixed.match(/noteglow-text-colors:1/g)??[]).length,2);
});

test('repeat format applies without toggling existing full or partial format and preserves colors',()=>{
 for(const [format, source, selected] of [['bold','**alpha beta**','alpha'],['italic','*alpha beta*','alpha'],['code','`alpha beta`','alpha']]) {
  const from=source.indexOf(selected);
  assert.equal(formatNativeText(source,from,from+selected.length,format,true).text,source);
  const fullFrom=source.indexOf('alpha beta');
  assert.equal(formatNativeText(source,fullFrom,fullFrom+10,format,true).text,source);
 }
 for(const [format,expected] of [['bold','**alpha**'],['italic','*alpha*'],['code','`alpha`']]) {
  const plain=paint('alpha beta','alpha').text;
  const result=formatNativeText(plain,0,5,format,true);
  assert.ok(result.text.startsWith(expected+' beta'));
  assert.equal(scanNativeText(result.text)[0].status,'valid');
  assert.equal(nativeTextColorRanges(result.text).map(range=>result.text.slice(range.from,range.to)).join(''),'alpha');
  assert.equal(formatNativeText(result.text,result.from,result.to,format,true).text,result.text);
 }
 assert.throws(()=>formatNativeText('```\nalpha\n```',4,9,'bold',true));
 assert.throws(()=>formatNativeText('`alpha`',1,6,'italic',true));
 // 普通命令仍保留原来的切换语义。
 assert.equal(formatNativeText('**alpha**',2,7,'bold').text,'alpha');
});


test('repeat bold on a mixed formatted and plain selection preserves visible text or rejects before editing',()=>{
 const source='**Alpha** Beta';
 let result;
 try { result=formatNativeText(source,0,source.length,'bold',true); }
 catch(error) {
  assert.match(error.message,/格式操作将改变正文结构或代码文字|格式修改将改变段落结构/);
  return;
 }
 assert.equal(projectNativeMarkdown(result.text).text,'Alpha Beta');
 assert.equal(formatNativeText(result.text,result.from,result.to,'bold',true).text,result.text);
});


const tableFixture='| 场景 | 结果 |\n| --- | --- |\n| nil | 发送、接收和 `for range` 都会一直阻塞 |\n| other | unchanged |';
test('table colors share one record after the complete table and clear independently',()=>{
 let text=paint(tableFixture,'场景','foreground',fg).text;
 const from=text.indexOf('发送'),to=text.indexOf('阻塞')+2;
 text=applyNativeTextColor(text,from,to,'background',bg).text;
 assert.equal(nativeTextDocumentShape(text),nativeTextDocumentShape(tableFixture));
 assert.equal(text.slice(0,tableFixture.length),tableFixture);
 const blocks=scanNativeText(text);assert.equal(blocks.length,1);assert.equal(blocks[0].kind,'table');assert.equal(blocks[0].status,'valid');assert.equal(blocks[0].to,tableFixture.length);
 assert.deepEqual(nativeTextColorRanges(text).map(range=>[range.property,text.slice(range.from,range.to)]),[['background','发送、接收和 '],['background','for range'],['background',' 都会一直阻塞'],['foreground','场景']]);
 text=applyNativeTextColor(text,from,to).text;
 assert.deepEqual(nativeTextColorRanges(text).map(range=>text.slice(range.from,range.to)),['场景']);
 assert.equal(resetNativeTextMetadata(text),tableFixture);
});

for(const format of ['bold','italic'])test(`table mixed ${format} preserves inline code and both colors through toggle and repeat`,()=>{
 const from=tableFixture.indexOf('发送'),to=tableFixture.indexOf('阻塞')+2;
 let text=applyNativeTextColor(tableFixture,from,to,'background',bg).text;
 text=applyNativeTextColor(text,from,to,'foreground',fg).text;
 const result=formatNativeText(text,from,to,format),delimiter=format==='bold'?'**':'*';
 assert.ok(result.text.includes(`${delimiter}发送、接收和${delimiter} \`for range\` ${delimiter}都会一直阻塞${delimiter}`));
 assert.equal(projectNativeMarkdown(resetNativeTextMetadata(result.text)).text,projectNativeMarkdown(tableFixture).text);
 assert.equal(scanNativeText(result.text)[0].status,'valid');
 const projectedColors=value=>{const projection=projectNativeMarkdown(resetNativeTextMetadata(value)),ranges=nativeTextColorRanges(value);return projection.offsets.map(offset=>ranges.filter(range=>range.from<=offset&&range.to>offset).map(range=>[range.property,range.color]));};
 assert.deepEqual(projectedColors(result.text),projectedColors(text));
 const repeat=formatNativeText(result.text,result.from,result.to,format,true);assert.equal(repeat.text,result.text);
 const reverted=formatNativeText(result.text,result.from,result.to,format);assert.equal(reverted.text,text);
});

test('table code toggle preserves escaped pipes, entities and emoji without making another column',()=>{
 const source='| one | two |\n| --- | --- |\n| a\\|b &amp; 😀 | next |';
 const from=source.indexOf('a\\|b'),to=source.indexOf('😀')+2;
 const painted=applyNativeTextColor(source,from,to,'foreground',fg);
 const code=formatNativeText(painted.text,from,to,'code');
 assert.ok(code.text.includes('`a\\|b & 😀`'));assert.equal(scanNativeText(code.text)[0].cells.length,4);
 const restored=formatNativeText(code.text,code.from,code.to,'code');
 assert.equal(projectNativeMarkdown(resetNativeTextMetadata(restored.text)).text,projectNativeMarkdown(source).text);
 assert.equal(scanNativeText(restored.text)[0].status,'valid');
 assert.throws(()=>applyNativeTextColor(code.text,code.text.indexOf('\\|')+1,code.text.indexOf('\\|')+2,'background',bg),/实体/);
});

test('table selection rejects separators and empty cells for all actions',()=>{
 const ranges=[[tableFixture.indexOf('---'),tableFixture.indexOf('---')+3],[0,1]];
 for(const [start,end] of ranges){
  assert.throws(()=>applyNativeTextColor(tableFixture,start,end,'background',bg),/单元格/);
  for(const format of ['bold','italic','code'])assert.throws(()=>formatNativeText(tableFixture,start,end,format),/单元格/);
 }
 const empty='| a | b |\n| --- | --- |\n|  | c |',at=empty.lastIndexOf('|  |')+1;
 assert.throws(()=>applyNativeTextColor(empty,at,at+1,'background',bg),/单元格/);
 // 正文与表格统一保留行内代码，仅对普通文字设置格式。
 assert.equal(formatNativeText('text `code` tail',0,16,'bold').text,'**text** `code` **tail**');
});


test('source cross-row selection formats each cell and code batch failure is atomic',()=>{
 const source='| a | b |\n| --- | --- |\n| one | two |\n| three | four |',from=source.indexOf('one'),to=source.indexOf('four')+4;
 const result=formatNativeText(source,from,to,'code');assert.equal(result.text,source.replace('one','`one`').replace('two','`two`').replace('three','`three`').replace('four','`four`'));
 const mixed=source.replace('four','text `code`');assert.throws(()=>formatNativeText(mixed,from,mixed.lastIndexOf('|')-1,'code'),/代码|连续/);
 const only='| a | b |\n| --- | --- |\n| `one` | `two` |';assert.throws(()=>formatNativeText(only,only.indexOf('`one`'),only.indexOf('`two`')+5,'bold'),/正文/);
});

for(const [format,marker] of [['bold','**'],['italic','*']])test(`table aggregate ${format} handles adjacent wrappers without touching partial ancestors`,()=>{
 const source=`| a | b |\n| --- | --- |\n| ${marker}one${marker} ${marker}two${marker} | ${marker}three${marker} |`,from=source.indexOf(marker+'one'),to=source.lastIndexOf('|')-1;
 const off=formatNativeText(source,from,to,format);assert.equal(off.text,source.replaceAll(marker,''));
 const mixed=source.replace(marker+'two'+marker,'two'),on=formatNativeText(mixed,mixed.indexOf(marker+'one'),mixed.lastIndexOf('|')-1,format);
 assert.equal(on.text,source);
 const partial=source.indexOf('one')+1;assert.throws(()=>formatNativeText(source,partial,to,format),/完整选择/);
});


for(const [format,marker] of [['bold','**'],['italic','*']])test(`continuous paragraphs headings lists and table use uniform ${format} and preserve inline code`,()=>{
 const source=`${marker}first${marker} \`code\` tail\n\n# heading\n\n- item one\n- item two\n\n| a | b |\n| --- | --- |\n| cell | value |`;
 const result=formatNativeText(source,0,source.length,format);
 assert.ok(result.text.startsWith(`${marker}first${marker} \`code\` ${marker}tail${marker}`));
 assert.ok(result.text.includes(`# ${marker}heading${marker}`));assert.ok(result.text.includes(`- ${marker}item one${marker}\n- ${marker}item two${marker}`));
 assert.ok(result.text.includes(`| ${marker}cell${marker} | ${marker}value${marker} |`));
 const off=formatNativeText(result.text,result.from,result.to,format);assert.equal(off.text,source.replace(marker+'first'+marker,'first'));
});

test('cross-paragraph colors preserve partial endpoints, own metadata and unselected text',()=>{
 const source='before alpha\n\n# heading\n\nomega after',from=source.indexOf('alpha'),to=source.indexOf('omega')+5;
 let result=applyNativeTextColor(source,from,to,'background',bg);
 assert.equal(resetNativeTextMetadata(result.text),source);assert.equal(scanNativeText(result.text).filter(block=>block.status==='valid').length,3);
 assert.deepEqual(nativeTextColorRanges(result.text).map(range=>result.text.slice(range.from,range.to)),['alpha','heading','omega']);
 result=applyNativeTextColor(result.text,result.from,result.to,'foreground',fg);
 assert.equal(scanNativeText(result.text).filter(block=>block.status==='valid').length,3);
 assert.equal(applyNativeTextColor(result.text,result.from,result.to).text,source);
});

test('cross-block native code toggles per paragraph and protected gaps reject the entire operation',()=>{
 const source='one\n\ntwo',coded=formatNativeText(source,0,source.length,'code');assert.equal(coded.text,'`one`\n\n`two`');
 assert.equal(formatNativeText(coded.text,coded.from,coded.to,'code').text,source);
 for(const middle of ['> quote','```js\ncode\n```','<div>html</div>','---']){
  const protectedSource='one\n\n'+middle+'\n\ntwo';
  assert.throws(()=>applyNativeTextColor(protectedSource,0,protectedSource.length,'background',bg),/不支持/);
  assert.throws(()=>formatNativeText(protectedSource,0,protectedSource.length,'bold'),/不支持/);
 }
 const unsafe='one\n\ntext `code`';assert.throws(()=>formatNativeText(unsafe,0,unsafe.length,'code'),/连续/);
});

test('cross-block formatting preserves existing colors and rejects stale later block before any output',()=>{
 let source=applyNativeTextColor('one\n\ntwo',0,3,'foreground',fg).text;source=applyNativeTextColor(source,source.lastIndexOf('two'),source.lastIndexOf('two')+3,'background',bg).text;
 const last=scanNativeText(source).find(block=>block.source==='two');assert.ok(last);
 const result=formatNativeText(source,0,last.to,'bold');assert.equal(scanNativeText(result.text).filter(block=>block.status==='valid').length,2);
 assert.deepEqual(nativeTextColorRanges(result.text).map(range=>result.text.slice(range.from,range.to)),['one','two']);
 const stale=source.replace('two\n','changed\n');assert.throws(()=>formatNativeText(stale,0,stale.lastIndexOf('changed')+7,'bold'),/过期/);
});

for(const [format,marker] of [['bold','**'],['italic','*']])test(`partial cross-paragraph ${format} preserves endpoints and colored code through repeat and off`,()=>{
 const plain='prefix alpha `code` tail\n\nsecond paragraph\n\nlast omega。 suffix';
 let text=applyNativeTextColor(plain,plain.indexOf('code'),plain.indexOf('code')+4,'background',bg).text;
 const from=text.indexOf('alpha'),to=text.lastIndexOf('omega')+5;
 text=applyNativeTextColor(text,from,to,'foreground',fg).text;
 const end=text.indexOf('omega')+5,first=formatNativeText(text,from,end,format);
 assert.equal(resetNativeTextMetadata(first.text),`prefix ${marker}alpha${marker} \`code\` ${marker}tail${marker}\n\n${marker}second paragraph${marker}\n\n${marker}last omega${marker}。 suffix`);
 const colors=value=>{const projection=projectNativeMarkdown(resetNativeTextMetadata(value)),rawProjection=projectNativeMarkdown(value),ranges=nativeTextColorRanges(value);return {text:projection.text,colors:rawProjection.offsets.map(offset=>ranges.filter(range=>range.from<=offset&&range.to>offset).map(range=>[range.property,range.color]))};};
 assert.deepEqual(colors(first.text),colors(text));
 const repeat=formatNativeText(first.text,first.from,first.to,format,true);assert.equal(repeat.text,first.text);
 const off=formatNativeText(first.text,first.from,first.to,format);assert.equal(off.text,text);assert.deepEqual(colors(off.text),colors(text));
 assert.ok(resetNativeTextMetadata(off.text).startsWith('prefix alpha'));assert.ok(resetNativeTextMetadata(off.text).endsWith('omega。 suffix'));
});


test('multiline state scanning preserves isolated unfinished trailing fence behavior',()=>{
 const source='alpha\n\nbeta\n\n```js\nunfinished';
 const to=source.indexOf('beta')+4,result=formatNativeText(source,0,to,'bold');
 assert.equal(result.text,'**alpha**\n\n**beta**\n\n```js\nunfinished');
 assert.equal(formatNativeText(result.text,result.from,result.to,'bold').text,source);
 assert.throws(()=>formatNativeText(source,0,source.length,'bold'),/不支持/);
});


for(const [format,marker] of [['bold','**'],['italic','*']])test(`native ${format} retains complete inline containers at selection edges`,()=>{
 const sources=['[foo](https://example.com) tail','head [foo](https://example.com)','<u>foo</u> tail','head <u>foo</u>','~~foo~~ tail','head ~~foo~~',format==='bold'?'*foo* tail':'**foo** tail','[**foo**](https://example.com) tail'];
 for(const source of sources){
  const colored=applyNativeTextColor(source,0,source.length,'background',bg).text;
  const styled=formatNativeText(colored,0,source.length,format);
  assert.equal(resetNativeTextMetadata(styled.text),marker+source+marker,source);
  assert.equal(formatNativeText(styled.text,styled.from,styled.to,format,true).text,styled.text,source+' repeat');
  assert.equal(formatNativeText(styled.text,styled.from,styled.to,format).text,colored,source+' off');
  assert.deepEqual(projectNativeMarkdown(resetNativeTextMetadata(styled.text)).text,projectNativeMarkdown(source).text);
 }
});

for(const [format,marker] of [['bold','**'],['italic','*']])test(`partial label and mixed batch ${format} preserve links without expanding the selection`,()=>{
 const source='[foobar](https://example.com) tail',from=source.indexOf('oo'),partial=formatNativeText(source,from,from+2,format);
 assert.equal(partial.text,'[f'+marker+'oo'+marker+'bar](https://example.com) tail');
 const batch='[foo](https://example.com) tail\n\nplain',styled=formatNativeText(batch,0,batch.length,format);
 assert.equal(projectNativeMarkdown(styled.text).text,projectNativeMarkdown(batch).text);assert.ok(styled.text.includes('https://example.com'));
 assert.equal(formatNativeText(styled.text,styled.from,styled.to,format).text,batch);
 const coded='[foo `code` bar](https://example.com) tail';
 assert.throws(()=>formatNativeText(coded,0,coded.length,format),/结构|文字/,'a link split by code must reject before returning a malformed edit');
});


for(const [format,marker] of [['bold','**'],['italic','*']])test(`cancel outer ${format} retains nested same-format containers and cancels adjacent wrappers`,()=>{
 const source=`${marker}[${marker}foo${marker}](https://example.com) tail${marker} ${marker}next${marker}`;
 const off=formatNativeText(source,0,source.length,format);
 assert.equal(off.text,`[${marker}foo${marker}](https://example.com) tail next`);
});
