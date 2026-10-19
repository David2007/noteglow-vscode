import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterEnd } from "./markdown-colors.ts";
import type { OutlineHeading } from "./outline-model.ts";
/** 复用现有 Markdown 解析器；围栏/缩进代码不会被误认，YAML 遮罩保留源码行号。 */
export function sourceHeadings(text: string): OutlineHeading[] {
  if (text.length > 1_000_000) return [];
  const end = frontmatterEnd(text);
  const ast = fromMarkdown(end ? text.slice(0, end).replace(/[^\r\n]/g, " ") + text.slice(end) : text);
  const headings: OutlineHeading[] = [];
  type Node = { type: string; value?: string; alt?: string | null; children?: Node[]; depth?: number; position?: { start: { line: number } } };
  const label = (node: Node): string => node.type === "html" ? "" : node.value ?? node.alt ?? node.children?.map(label).join("") ?? "";
  const visit = (node: Node): void => {
    if (node.type === "heading" && node.position) headings.push({ title: label(node).trim() || "（空标题）", level: node.depth!, line: node.position.start.line - 1 });
    for (const child of node.children ?? []) visit(child);
  };
  visit(ast); return headings;
}
