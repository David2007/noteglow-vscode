import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import {formatNativeText,applyNativeTextColor,scanNativeText,nativeTextColorRanges,setNativeHeading,normalizeLink} from '../src/native-text-colors.ts';
import {extendMarkdownIt} from '../src/native-preview.ts';
const format=(text,action,url)=>{const from=text.indexOf('alpha');return formatNativeText(text,from,from+5,action,false,url);};
const colors=text=>nativeTextColorRanges(text).map(range=>({text:text.slice(range.from,range.to),color:range.color}));

test('strike and underline toggle while preserving nested bold and colors in official Markdown projection',()=>{
 for(const [action,open,close] of [['strike','~~','~~'],['underline','<u>','</u>']]){
  const source=applyNativeTextColor('alpha',0,5,'background','#fff88f').text;
  const styled=format(source,action);assert.ok(styled.text.startsWith(open+'alpha'+close));assert.equal(styled.text.slice(styled.from,styled.to),'alpha');assert.deepEqual(colors(styled.text),[{text:'alpha',color:'#fff88f'}]);
  const bold=format(styled.text,'bold');assert.ok(bold.text.startsWith(open+'**alpha**'+close));assert.equal(scanNativeText(bold.text)[0].status,'valid');
  const removed=format(bold.text,action);assert.ok(removed.text.startsWith('**alpha**'));assert.deepEqual(colors(removed.text),colors(source));
  assert.equal(format(styled.text,action).text,source);
  const html=extendMarkdownIt(new MarkdownIt({html:true})).render(styled.text);assert.match(html,action==='strike'?/<s>/:/<u>/);assert.match(html,/background-color:#fff88f/);
 }
});
test('links add, replace and remove without losing formatting or colored characters',()=>{
 const source=applyNativeTextColor('**alpha**',2,7,'foreground','#c0392b').text;
 const link=format(source,'link',normalizeLink('https://example.com/a(b)'));assert.ok(link.text.startsWith('**[alpha](https://example.com/a%28b%29)**'));
 const updated=format(link.text,'link','https://other.test/');assert.ok(updated.text.includes('[alpha](https://other.test/)'));assert.equal(updated.text.includes('example.com'),false);
 assert.equal(format(updated.text,'link','').text,source);assert.deepEqual(colors(updated.text),colors(source));
 assert.equal(format(source,'link','').text,source);
 assert.throws(()=>formatNativeText('[alpha](https://example.com)',2,4,'link',false,'https://other.test/'),/完整链接/);
});
test('only paired attribute-free underline is accepted; HTML, code and metadata remain protected',()=>{
 for(const source of ['<u class="x">alpha</u>','<u>alpha','<u><span>alpha</span></u>','```\nalpha\n```','`alpha`','> alpha'])assert.throws(()=>format(source,'underline'),source);
 for(const source of ['<u><u>alpha</u></u>','<u>**alpha**</u>'])assert.equal(scanNativeText(source)[0].supported,true);
 const stale=applyNativeTextColor('alpha',0,5,'background','#fff88f').text.replace('alpha\n','alpha beta\n');assert.throws(()=>format(stale,'strike'),/过期|损坏/);
});
test('heading levels preserve colors and body selection, including return to body and adjacent prose',()=>{
 const source=applyNativeTextColor('alpha',0,5,'foreground','#c0392b').text;
 for(let level=1;level<=6;level++){
  const result=setNativeHeading(source,0,5,level);assert.ok(result.text.startsWith('#'.repeat(level)+' alpha'));assert.equal(result.text.slice(result.from,result.to),'alpha');assert.deepEqual(colors(result.text),colors(source));
  assert.equal(setNativeHeading(result.text,result.from,result.to,0).text,source);
 }
 const adjacent=setNativeHeading('before\n# alpha\nafter',9,14,0);assert.equal(adjacent.text,'before\n\nalpha\n\nafter');assert.equal(adjacent.text.slice(adjacent.from,adjacent.to),'alpha');
 assert.equal(setNativeHeading('## alpha ##',3,8,3).text,'### alpha');
 assert.equal(setNativeHeading('# alpha\r\nafter',2,7,0).text,'alpha\r\n\r\nafter');
 assert.throws(()=>setNativeHeading('alpha #',0,5,1),/可见文字/);
 for(const level of [-1,7,NaN,1.5])assert.throws(()=>setNativeHeading('alpha',0,5,level));
 for(const source of ['alpha\nbeta','alpha\n===','- alpha','> alpha','```\nalpha\n```'])assert.throws(()=>setNativeHeading(source,source.indexOf('alpha'),source.indexOf('alpha')+5,1));
});
test('link input contract validates a single HTTP(S) URL, bounds and removal',()=>{
 assert.equal(normalizeLink(''),'');assert.equal(normalizeLink('https://example.com'),'https://example.com/');assert.equal(normalizeLink('http://example.com/a(b)'),'http://example.com/a%28b%29');
 const max='https://example.com/'+ 'a'.repeat(2048-20);assert.equal(max.length,2048);assert.equal(normalizeLink(max),max);
 for(const input of [max+'a','https://a.test https://b.test','https://a.test\n','javascript:alert(1)','file:///tmp/note','https://user:pass@example.com','example.com','']){if(input)assert.throws(()=>normalizeLink(input),input);}
});
