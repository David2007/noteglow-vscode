import test from 'node:test';
import assert from 'node:assert/strict';
import {parseViewMessage,containsPath,VIEW_COMMANDS} from '../src/security.ts';
test('message whitelist accepts bounded user actions and rejects privilege injection',()=>{
 assert.deepEqual(parseViewMessage({type:'ready'}),{type:'ready'});
 for(const type of ['new','stop'])assert.deepEqual(parseViewMessage({type,conversationId:'c'}),{type,conversationId:'c'});
 assert.deepEqual(parseViewMessage({type:'send',conversationId:'c',requestId:'send-1'}),{type:'send',conversationId:'c',requestId:'send-1'});
 for(const type of ['select','delete','detach','preview'])assert.deepEqual(parseViewMessage({type,id:'x',conversationId:'c'}),{type,id:'x',conversationId:'c'});
 for(const command of VIEW_COMMANDS)assert.equal(parseViewMessage({type:'command',command,conversationId:'c'}).command,command);
 assert.equal(parseViewMessage({type:'draft',text:'中文 <script>',model:'gpt-6.1-sol',conversationId:'c'}).text,'中文 <script>');
 for(const value of [null,[],{},'send',{type:'send',codexPath:'/evil'},{type:'command',command:'workbench.action.quit'},{type:'draft',text:'a'.repeat(50001),model:''},{type:'draft',text:'x',model:'--dangerous'},{type:'delete',id:'x'.repeat(201)},{type:'preview',id:2}])assert.throws(()=>parseViewMessage(value && typeof value === "object" && !Array.isArray(value) ? {conversationId:"c",...value}:value));
});
test('path boundary rejects siblings and traversal while allowing children',()=>{
 assert.ok(containsPath('/notes','/notes/a.md'));assert.ok(containsPath('/notes','/notes'));assert.equal(containsPath('/notes','/notes-other/a'),false);assert.equal(containsPath('/notes','/outside/a'),false);
});

test('image and send request identities are bounded and body rejection is acknowledged separately',()=>{assert.throws(()=>parseViewMessage({type:'send',conversationId:'c'}));assert.throws(()=>parseViewMessage({type:'send',conversationId:'c',requestId:'x'.repeat(101)}));assert.throws(()=>parseViewMessage({type:'images',conversationId:'c',requestId:'upload-1',files:[{name:'a',path:'/etc/passwd'}]}));});
