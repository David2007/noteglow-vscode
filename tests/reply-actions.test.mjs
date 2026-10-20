import test from 'node:test';import assert from 'node:assert/strict';
import {replyParts,resolveReply} from '../src/reply-actions.ts';
const codes=text=>replyParts(text).filter(p=>p.type==='code');
test('AST code extraction supports nested, indented, tilde and longer backtick fences without splitting contents',()=>{
 const markdown='Intro\n\n````md\n```js\nx\n```\n````\n\n~~~python\nprint(1)\n~~~\n\n> ```go\n> x := 1\n> ```\n\n    indented\n    code\n';
 assert.deepEqual(codes(markdown).map(p=>[p.blockIndex,p.language,p.text]),[[0,'md','```js\nx\n```'],[1,'python','print(1)'],[2,'go','x := 1'],[3,'','indented\ncode']]);
 assert.equal(replyParts(markdown)[0].text,'Intro\n\n');assert.deepEqual(codes('inline `code`\n\n<pre>\n```js\nunsafe\n```\n</pre>'),[]);
 assert.equal(codes('```js\n  first\n\nlast\n```')[0].text,'  first\n\nlast');assert.deepEqual(replyParts(''),[{type:'text',text:''}]);
});
test('host resolves only stored assistant content and copies exact whole Markdown',()=>{
 const text='# Full\r\n\r\n~~~js\r\nalert("<script>");\r\n~~~\r\nend';
 const state={activeId:'a',conversations:[{id:'a',messages:[{role:'user',text:'not assistant'},{role:'assistant',text}]}]};
 assert.equal(resolveReply(state,'a',1),text);assert.equal(resolveReply(state,'a',1,0),'alert("<script>");');
 for(const args of [['b',1],['a',0],['a',-1],['a',999],['a',NaN],['a',1,-1],['a',1,1],['a',1,0.5]])assert.throws(()=>resolveReply(state,...args));
 assert.throws(()=>resolveReply({activeId:'a',conversations:[]},'a',0));
 assert.throws(()=>resolveReply({activeId:'a',conversations:[{id:'a',messages:[{role:'assistant',text:'```\n```'}]}]},'a',0,0),/为空/);
});
