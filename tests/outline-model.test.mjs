import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceHeadings} from '../src/outline-source.ts';
import {outlineTree,currentHeading} from '../src/outline-model.ts';

test('source headings preserve duplicates and physical CRLF lines, exclude YAML, comments and both code forms',()=>{
 const source='---\r\ntitle: yaml\r\n---\r\n# **Same** &amp; `code`\r\n\r\n```md\r\n# hidden\r\n```\r\n\r\n    # indented\r\n\r\n<!-- # hidden -->\r\n\r\nSame\r\n----\r\n\r\n> ### [link](https://example.com) ![image](x)\r\n';
 assert.deepEqual(sourceHeadings(source),[{title:'Same & code',level:1,line:3},{title:'Same',level:2,line:13},{title:'link image',level:3,line:16}]);
});
test('empty headings, inline HTML and limits degrade without guessing headings',()=>{
 assert.deepEqual(sourceHeadings('plain\n\ntext'),[]);assert.deepEqual(sourceHeadings('x'.repeat(1_000_001)),[]);
 assert.deepEqual(sourceHeadings('#\n\n## <b>text</b>\n'),[{title:'（空标题）',level:1,line:0},{title:'text',level:2,line:2}]);
 assert.deepEqual(sourceHeadings('# yes\n'+' '.repeat(999_994)),[{title:'yes',level:1,line:0}]);
});
test('hierarchy tolerates skipped levels and preserves every duplicate identity',()=>{
 const input=[{title:'same',level:2,line:0},{title:'same',level:4,line:2},{title:'deep',level:6,line:3},{title:'next',level:3,line:5},{title:'root',level:1,line:6}];
 const roots=outlineTree(input);assert.equal(roots.length,2);assert.equal(roots[0].children.length,2);assert.equal(roots[0].children[0].children[0].parent,roots[0].children[0]);assert.equal(roots[0].children[1].parent,roots[0]);assert.equal(roots[1].depth,0);
 assert.equal(currentHeading(input,-1),undefined);assert.equal(currentHeading(input,2),input[1]);assert.equal(currentHeading(input,4),input[2]);assert.equal(currentHeading(input,99),input[4]);assert.equal(currentHeading([],0),undefined);assert.deepEqual(outlineTree([]),[]);
});
