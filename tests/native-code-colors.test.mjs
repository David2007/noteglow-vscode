import assert from 'node:assert/strict';
import test from 'node:test';
import {applyNativeCodeColor,encodeNativeCodeMetadata,scanNativeCode,minimalTextChange,migrateOwnedCodeToNative,mapMigratedCodePosition,backupNativeCodeMigration,resetNativeCodeMetadata} from '../src/native-code-colors.ts';
import {applyMarkdownColor,decodeOwnedCodeBlocks} from '../src/markdown-colors.ts';
const bg='#fff88f',fg='#c0392b';
const paint=(source,word,property='background',color=bg)=>{const from=source.indexOf(word);assert.ok(from>=0);return applyNativeCodeColor(source,from,from+word.length,property,color);};
test('three colors preserve fence info, exact CRLF, blanks, entities and source selection',()=>{
 const original='before\r\n\r\n~~~~go extra info  \r\nupdate(a)\r\nupdatePtr(&a) // &amp; 😀 -->\r\n\r\n~~~~  \r\n\r\nafter';
 const first=paint(original,'update(a)');
 assert.equal(first.text.slice(0,original.indexOf('\r\n\r\nafter')+2),original.slice(0,original.indexOf('\r\n\r\nafter')+2));
 assert.equal(first.text.slice(first.from,first.to),'update(a)');
 const second=paint(first.text,'&a');const third=paint(second.text,'updatePtr','foreground',fg);
 const block=scanNativeCode(third.text)[0];assert.equal(block.status,'valid');assert.equal(block.code,'update(a)\r\nupdatePtr(&a) // &amp; 😀 -->\r\n\r\n');
 assert.equal(block.ranges.length,3);assert.ok(third.text.endsWith('\r\nafter'));assert.ok(third.text.includes('~~~~go extra info  \r\n'));
 const metadata=third.text.slice(block.commentFrom,block.metadataTo);assert.equal((metadata.match(/-->/g)||[]).length,1);assert.ok(metadata.includes('\\u002d\\u002d\\u003e'));
 const cleared=applyNativeCodeColor(third.text,second.from,second.to);assert.equal(scanNativeCode(cleared.text)[0].ranges.length,2);
});

test('clear removes metadata and preserves original EOF shape',()=>{
 for(const original of ['```go\na\n```','```go\na\n```\n','```go\r\na\r\n```\r\n']) {
  const colored=paint(original,'a');const cleared=applyNativeCodeColor(colored.text,colored.from,colored.to);
  assert.equal(cleared.text,original);
 }
 const original='```go\na\n```\n';
 const from=original.indexOf('a');assert.equal(applyNativeCodeColor(original,from,from+1).text,original);
});

test('metadata is adjacent, versioned, bounded and snapshot-checked without global text lookup',()=>{
 const original='```go\nrepeat\n```\n';const colored=paint(original,'repeat').text;
 const stale=colored.replace('repeat\n```','changed\n```');assert.equal(scanNativeCode(stale)[0].status,'stale');
 assert.throws(()=>paint(stale,'changed'),/过期/);assert.ok(stale.includes('noteglow-code-colors'));
 const detached=colored.replace('```\n<!--','```\n\n<!--');assert.equal(scanNativeCode(detached)[0].status,'none');
 const second=original+'\n'+colored;const blocks=scanNativeCode(second);assert.equal(blocks[0].status,'none');assert.equal(blocks[1].status,'valid');
 for(const mutated of [colored.replace('colors:1','colors:9'),colored.replace('"version":1','"version":2'),colored.replace('"from":0','"from":-1'),colored.replace('"ranges":','"extra":1,"ranges":'),colored.replace('"code":"repeat\\n"','"code":42'),colored.replace('"color":"#fff88f"','"color":"red"')]) {
  assert.equal(scanNativeCode(mutated)[0].status,'invalid');assert.throws(()=>paint(mutated,'repeat'),/损坏/);
 }
 assert.throws(()=>applyNativeCodeColor(colored,colored.indexOf('<!--')+5,colored.indexOf('<!--')+10),/元数据/);
 assert.deepEqual(scanNativeCode('x'.repeat(1_000_001)),[]);
 assert.throws(()=>encodeNativeCodeMetadata('x'.repeat(200_001),[]),/超限/);
 assert.throws(()=>encodeNativeCodeMetadata('ab',[{from:0,to:2,property:'background',color:bg},{from:1,to:2,property:'background',color:bg}]),/无效/);
});

test('unsupported nested, indented, unclosed and cross-domain selections fail explicitly',()=>{
 for(const source of ['> ```go\n> value\n> ```\n','- item\n\n  ```go\n  value\n  ```\n','    value\n','```go\nvalue',' ```go\n value\n ```']) assert.throws(()=>paint(source,'value'),/顶层/);
 const source='before\n\n```go\nvalue 😀\n```\n\nafter';
 assert.throws(()=>applyNativeCodeColor(source,0,source.indexOf('value')+2,'background',bg),/跨代码块/);
 assert.equal(applyNativeCodeColor(source,0,6,'background',bg),null);
 const emoji=source.indexOf('😀');assert.throws(()=>applyNativeCodeColor(source,emoji,emoji+1,'background',bg),/emoji/);
 assert.throws(()=>paint(source,'value','background','red'),/#RGB/);
});

test('plain paragraph color coexists with unchanged native code and metadata',()=>{
 const native=paint('hello\n\n```go\na & b\n```\n','a & b').text;
 const before=scanNativeCode(native)[0];const edit=applyMarkdownColor(native,0,5,'foreground',fg);
 const after=scanNativeCode(edit.text)[0];assert.equal(after.status,'valid');assert.equal(after.code,before.code);assert.deepEqual(after.ranges,before.ranges);
 assert.equal(edit.text.slice(after.commentFrom,after.metadataTo),native.slice(before.commentFrom,before.metadataTo));
});

test('minimal replacement never splits surrogate pairs or CRLF',()=>{
 for(const [before,after] of [['a😀b','a😁b'],['a\r\nb','a\nb'],['same','same'],['','new'],['old','']]) {
  const change=minimalTextChange(before,after);assert.equal(before.slice(0,change.from)+change.insert+before.slice(change.to),after);
  assert.ok(!(/[\uD800-\uDBFF]$/.test(before.slice(0,change.from))));assert.ok(!(before[change.from-1]==='\r'&&before[change.from]==='\n'));
 }
});

test('strict legacy migration preserves exact text, language and styles with safe fence length',()=>{
 const code='update(a)\nupdatePtr(&a) // ``` 😀\n';
 let legacy=applyMarkdownColor('```go\n'+code+'```\n',6,15,'background',bg).text;
 // The original code includes a literal backtick run inside a comment, not a closing line.
 const at=legacy.indexOf('updatePtr');legacy=applyMarkdownColor(legacy,at,at+9,'foreground',fg).text;
 legacy=legacy.replace('</code></pre>','</code>\n</pre>');
 const decoded=decodeOwnedCodeBlocks(legacy);assert.equal(decoded.length,1);assert.equal(decoded[0].code,code);
 const migrated=migrateOwnedCodeToNative(legacy),block=scanNativeCode(migrated)[0];
 assert.ok(migrated.startsWith('````go\n'));assert.equal(block.code,code);assert.equal(block.status,'valid');assert.deepEqual(block.ranges,decoded[0].ranges);
 assert.equal(migrateOwnedCodeToNative(migrated),migrated);
 for(const bad of [legacy.replace('data-codex-code="1"','data-codex-code="1" onclick="bad"'),legacy.replace('&#10;</code>','</code>'),'> '+legacy,legacy.replace('</code>','<b>bad</b></code>')]) assert.throws(()=>migrateOwnedCodeToNative(bad));
});

test('native scan honors shared YAML and Obsidian opaque region protection',()=>{
 for(const source of ['---\nexample: "\n```go\nfoo\n```\n"\n---','\ufeff---\r\nexample: "\r\n```go\r\nfoo\r\n```\r\n"\r\n---',...['%%','$$','=='].map(mark=>mark+'\n```go\nfoo\n```\n'+mark)]) {
  assert.ok(!scanNativeCode(source).some(block=>block.supported));
  const from=source.indexOf('foo');
  if(source.includes('example:')) assert.equal(applyNativeCodeColor(source,from,from+3,'background',bg),null);
  else assert.throws(()=>applyNativeCodeColor(source,from,from+3,'background',bg),/顶层/);
 }
 const actual='```go\n%% $$ == literal\n```\n';assert.equal(paint(actual,'literal').text.startsWith(actual),true);
});

test('migration maps source selections into code and preserves later cursor offsets',()=>{
 const original='before\n\n```go\nalpha & beta\n```\n\nafter';
 const legacy=applyMarkdownColor(original,original.indexOf('alpha'),original.indexOf('alpha')+5,'background',bg).text;
 const migrated=migrateOwnedCodeToNative(legacy);
 const at=legacy.indexOf('&amp;');const mapped=mapMigratedCodePosition(legacy,migrated,at);
 assert.equal(migrated.slice(mapped,mapped+1),'&');
 assert.equal(mapMigratedCodePosition(legacy,migrated,2),2);
 assert.equal(migrated.slice(mapMigratedCodePosition(legacy,migrated,legacy.indexOf('after'))),'after');
});

test('clearing originally EOF metadata keeps a separator before later appended prose',()=>{
 const original='```go\nalpha\n```';const colored=paint(original,'alpha');
 const appended=colored.text+'after\n';const cleared=applyNativeCodeColor(appended,colored.from,colored.to);
 assert.equal(cleared.text,original+'\nafter\n');
 assert.equal(scanNativeCode(cleared.text)[0].code,'alpha\n');
});

test('migration backup must round-trip before editor writes and preserves failure evidence',async()=>{
 const files=new Map(),operations=[];let current=true;
 const adapter={exists:async path=>files.has(path),mkdir:async path=>{files.set(path,'');operations.push('mkdir');},write:async(path,text)=>{files.set(path,text);operations.push('write');},read:async path=>{operations.push('read');return files.get(path);}};
 assert.equal(await backupNativeCodeMigration(adapter,'backups','one.md','exact\r\n',()=>current),'backups/one.md');
 assert.deepEqual(operations,['mkdir','write','read']);assert.equal(files.get('backups/one.md'),'exact\r\n');
 await assert.rejects(backupNativeCodeMigration(adapter,'backups','one.md','other',()=>true),/已存在/);
 await assert.rejects(backupNativeCodeMigration(adapter,'backups','../bad.md','text',()=>true),/参数/);
 const length=operations.length;await assert.rejects(backupNativeCodeMigration(adapter,'backups','two.md','text',()=>false),/来源/);assert.equal(operations.length,length);
 await assert.rejects(backupNativeCodeMigration({...adapter,read:async()=> 'mismatch'},'backups','mismatch.md','text',()=>true),/读回/);assert.equal(files.get('backups/mismatch.md'),'text');
 await assert.rejects(backupNativeCodeMigration({...adapter,write:async(path,text)=>{await adapter.write(path,text);current=false;}},'backups','stale.md','text',()=>current),/备份期间/);assert.equal(files.get('backups/stale.md'),'text');
 await assert.rejects(backupNativeCodeMigration({...adapter,write:async()=>{throw new Error('disk full');}},'backups','failed.md','text',()=>true),/disk full/);
});

test('explicit code reset removes owned records without altering code and refuses unknown versions',()=>{
 const source='```go\nvalue\n```',colored=paint(source,'value').text;
 assert.equal(resetNativeCodeMetadata(colored),source);assert.equal(resetNativeCodeMetadata(source),source);
 assert.throws(()=>resetNativeCodeMetadata(colored.replace('noteglow-code-colors:1','noteglow-code-colors:2')),/未知版本/);
 const stale=colored.replace('value\n```','changed\n```');assert.equal(resetNativeCodeMetadata(stale),'```go\nchanged\n```');
});


test('reset refuses prose appended to a code record and preserves the entire input',()=>{
 const raw='```go\nalpha\n```\n',at=raw.indexOf('alpha');
 const source=applyNativeCodeColor(raw,at,at+5,'background',bg).text.replace(' -->',' --> 保留我');
 assert.throws(()=>resetNativeCodeMetadata(source),/记录后含正文/);assert.ok(source.includes('保留我'));
});
