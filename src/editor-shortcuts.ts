import { isPlainMarkdownLine } from "./markdown-colors.ts";

export interface SlashEdit { from: number; to: number; insert: string; cursor: number }

/** 完整独立行加 Enter 才提交；普通段落两侧补空行，防止表格吞并相邻正文。 */
export function slashCommandEdit(text: string, cursor: number): SlashEdit | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length || text.length > 1_000_000) return null;
  const from = text.lastIndexOf("\n", cursor - 1) + 1;
  const newline = text.indexOf("\n", cursor);
  const to = newline < 0 ? text.length : newline;
  const line = text.slice(from, to).replace(/\r$/, "");
  if (cursor !== from + line.length || !/^ {0,3}\/(code|bg|mermaid|h[1-6])$/.test(line)) return null;
  const commandFrom = from + line.indexOf("/");
  try { if (!isPlainMarkdownLine(text, commandFrom, from + line.length)) return null; }
  catch { return null; }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const before = text.slice(0, from);
  const after = newline < 0 ? "" : text.slice(newline + 1);
  const prefix = before && !/(?:\r?\n){2}$/.test(before) ? eol : "";
  const suffix = after && !/^\r?\n/.test(after) ? eol : "";
  const heading = /\/h([1-6])$/.exec(line);
  if (heading) {
    const insert = prefix + "#".repeat(Number(heading[1])) + " ";
    return { from, to: from + line.length, insert: insert + suffix, cursor: from + insert.length };
  }
  if (line.endsWith("/mermaid")) {
    const block = ["```mermaid", "flowchart TD", "    A[开始] --> B[结束]", "```"].join(eol);
    return { from, to: from + line.length, insert: prefix + block + suffix, cursor: from + prefix.length + 10 + eol.length };
  }
  const code = line.endsWith("/code");
  const block = code ? ["```", "", "```"].join(eol) : ["| 标题 1 | 标题 2 |", "| --- | --- |", "|  |  |", "|  |  |"].join(eol);
  return { from, to: from + line.length, insert: prefix + block + suffix, cursor: from + prefix.length + (code ? 3 + eol.length : 2) };
}

