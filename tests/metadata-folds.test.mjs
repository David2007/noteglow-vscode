import test from 'node:test';import assert from 'node:assert/strict';
import {metadataFolds,mapMetadataPositions} from '../src/metadata-folds.ts';
import {applyNativeCodeColor,encodeNativeCodeMetadata} from '../src/native-code-colors.ts';import {applyNativeTextColor} from '../src/native-text-colors.ts';
const code='```js\nconst a = 1;\n```';
function colored(){return applyNativeCodeColor(code,6,11,'foreground','#c0392b').text;}
test('code metadata gets disjoint body and metadata folds; source stays unchanged',()=>{
 const source=colored(),ranges=metadataFolds(source);assert.equal(ranges.length,1);assert.deepEqual([ranges[0].start,ranges[0].end,ranges[0].codeStart,ranges[0].codeEnd],[2,3,0,1]);assert.equal(ranges[0].status,'valid');assert.ok(source.slice(ranges[0].from,ranges[0].to).startsWith('<!-- noteglow-code-colors:1 '));
 const crlf=source.replaceAll('\n','\r\n');assert.deepEqual(metadataFolds(crlf).map(r=>[r.start,r.end]),[[2,3]]);
});
test('text metadata folds from its blank separator and never folds prose',()=>{
 const source=applyNativeTextColor('Alpha',0,5,'background','#fff88f').text;
 const [range]=metadataFolds(source);assert.deepEqual([range.start,range.end,range.codeStart,range.status],[1,2,undefined,'valid']);
});
test('stale canonical records are surfaced; unknown, invalid and ordinary input are omitted',()=>{
 assert.equal(metadataFolds(colored().replace('const a','const z'))[0].status,'stale');
 for(const source of ['plain','',colored().replace('noteglow-code-colors:1','noteglow-code-colors:2'),colored().replace('"version":1','"version":4'),'```\n/code\n','> <!-- noteglow-code-colors:1 {} -->'])assert.deepEqual(metadataFolds(source),[],source);
});
test('seen metadata positions follow prior edits and deletion permits newly created records',()=>{
 const old=[{from:10,to:30}];
 assert.deepEqual(mapMetadataPositions(old,[{rangeOffset:0,rangeLength:0,text:'abc'}]),[{from:13,to:33}]);
 assert.deepEqual(mapMetadataPositions(old,[{rangeOffset:20,rangeLength:2,text:'xxxx'}]),[{from:10,to:32}]);
 assert.deepEqual(mapMetadataPositions(old,[{rangeOffset:10,rangeLength:20,text:''}]),[]);
 assert.deepEqual(mapMetadataPositions(old,[{rangeOffset:20,rangeLength:20,text:'x'}]),[{from:10,to:21}]);
 assert.deepEqual(mapMetadataPositions(old,[{rangeOffset:40,rangeLength:0,text:'x'}]),old);
 assert.deepEqual(mapMetadataPositions(old,[{rangeOffset:0,rangeLength:1,text:''},{rangeOffset:5,rangeLength:0,text:'abcd'}]),[{from:13,to:33}]);
});

test('unsupported empty-body fold and overbudget document are left visible',()=>{
 assert.deepEqual(metadataFolds('```\n```\n'+encodeNativeCodeMetadata('',[])+'\n'),[]);
 assert.deepEqual(metadataFolds('<!-- noteglow-'+ 'x'.repeat(1_000_001)),[]);
 const text=applyNativeTextColor('Alpha',0,5,'background','#fff88f').text;
 assert.equal(metadataFolds(text.replace('Alpha','Alphz'))[0].status,'stale');
 assert.deepEqual(metadataFolds(text.replace('noteglow-text-colors:1','noteglow-text-colors:2')),[]);
 const mixed=text+'\n\n'+colored();assert.equal(metadataFolds(mixed).length,2);assert.ok(metadataFolds(mixed)[0].from<metadataFolds(mixed)[1].from);
});
