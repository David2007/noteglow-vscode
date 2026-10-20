import assert from 'node:assert/strict';
import test from 'node:test';
import { slashCommandEdit } from '../src/editor-shortcuts.ts';
function expand(source, command) {
 const cursor = source.indexOf(command) + command.length;
 const edit = slashCommandEdit(source, cursor);
 assert.ok(edit);
 return { ...edit, text: source.slice(0, edit.from) + edit.insert + source.slice(edit.to) };
}

test('code and table are native blocks with useful cursor positions and isolated surrounding prose', () => {
 const code = expand('before\n/code\nafter', '/code');
 assert.equal(code.text, 'before\n\n```\n\n```\n\nafter');
 assert.equal(code.cursor, code.text.indexOf('```') + 4);
 const table = expand('/bg', '/bg');
 assert.equal(table.text, '| 标题 1 | 标题 2 |\n| --- | --- |\n|  |  |\n|  |  |');
 assert.equal(table.text.slice(table.cursor, table.cursor + 4), '标题 1');
 assert.equal(expand('before\n\n  /code\n\nafter', '/code').text, 'before\n\n```\n\n```\n\nafter');
 const crlf = expand('before\r\n/code\r\nafter', '/code');
 assert.equal(crlf.text, 'before\r\n\r\n```\r\n\r\n```\r\n\r\nafter');
 assert.equal(crlf.text.slice(crlf.cursor, crlf.cursor + 2), '\r\n');
});

test('plain input, invalid cursors and protected Markdown never expand', () => {
 for (const source of ['hello /code', '/code x', '/CODE', '/code ', '    /code', '> /code', '- /code', '```\n/code\n```', '~~~\n/code', '/code\n\n```', '<!--\n/code\n-->', '<div>\n/code\n</div>', '---\n/code\n---', '$$\n/code\n$$', '%%\n/code\n%%', '`text\n/code\ntext`', '- item\n  /code']) {
  const at = source.indexOf('/code');
  const cursor = at >= 0 ? at + 5 : source.length;
  assert.equal(slashCommandEdit(source, cursor), null, source);
 }
 for (const cursor of [-1, 1.5, NaN, 6, 0, 4]) assert.equal(slashCommandEdit('/code', cursor), null);
 assert.equal(slashCommandEdit('x'.repeat(1_000_001), 1), null);
});

