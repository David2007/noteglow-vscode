import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { randomUUID } from "node:crypto";
import { parseFragment, serialize, defaultTreeAdapter, html as htmlNamespace, type DefaultTreeAdapterMap } from "parse5";
import { scanNativeCode } from "./native-code-colors.ts";
import { scanNativeText } from "./native-text-colors.ts";
import { projectNativeMarkdown } from "./markdown-colors.ts";
import { alignRenderedText, type ColorRange } from "./color-ranges.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
interface Paint { projection: { text: string; offsets: number[] }; ranges: ColorRange[]; exact?: boolean }
const installed = new WeakSet<MarkdownIt>();
const attribute = "data-noteglow-native";
function element(node: Node): node is Element { return "tagName" in node; }
function children(node: Node): Node[] { return "childNodes" in node ? node.childNodes : []; }

/** 只覆盖核验后的文字节点，宿主已有语法高亮、链接、粗斜体元素均保留。 */
export function paintPreviewHtml(html: string, paints: ReadonlyMap<string, Paint>): string {
  const root = parseFragment(html);
  const visit = (node: Node): void => {
    if (element(node)) {
      const id = node.attrs.find((item) => item.name === attribute)?.value, paint = id ? paints.get(id) : undefined;
      if (paint) {
        node.attrs = node.attrs.filter((item) => item.name !== attribute);
        const texts: DefaultTreeAdapterMap["textNode"][] = [];
        let unsafe = false;
        const collect = (item: Node): void => {
          if (element(item) && ["script", "style", "input", "textarea", "button", "img"].includes(item.tagName)) { unsafe = true; return; }
          if (item.nodeName === "#text" && "value" in item) texts.push(item);
          for (const child of children(item)) collect(child);
        };
        collect(node);
        const rendered = texts.map((item) => item.value).join(""), alignment = unsafe || paint.exact && rendered !== paint.projection.text ? null : alignRenderedText(paint.projection, rendered);
        if (!alignment) return;
        // 范围边界排序后单次推进；不对每个字符重新扫描全部颜色范围。
        const byProperty = { foreground: paint.ranges.filter((range) => range.property === "foreground"), background: paint.ranges.filter((range) => range.property === "background") };
        const cursors = { foreground: 0, background: 0 }; let offset = 0;
        for (const text of texts) {
          const replacements: Node[] = []; let value = "", style = "";
          const flush = () => {
            if (!value) return;
            if (!style) replacements.push({ nodeName: "#text", value, parentNode: text.parentNode });
            else {
              const span = defaultTreeAdapter.createElement("span", htmlNamespace.NS.HTML, [{ name: "style", value: style }]);
              defaultTreeAdapter.insertText(span, value); replacements.push(span);
            }
          };
          for (let i = 0; i < text.value.length; i++) {
            const source = alignment[offset + i]; const styles: string[] = [];
            if (source !== null) for (const property of ["foreground", "background"] as const) {
              const ranges = byProperty[property];
              while (cursors[property] < ranges.length && ranges[cursors[property]].to <= source) cursors[property]++;
              const range = ranges[cursors[property]];
              if (range && range.from <= source && source < range.to) styles.push(`${property === "foreground" ? "color" : "background-color"}:${range.color}`);
            }
            const next = styles.join(";");
            if (next !== style) { flush(); value = ""; style = next; }
            value += text.value[i];
          }
          flush(); offset += text.value.length;
          const parent = text.parentNode!; const index = parent.childNodes.indexOf(text);
          parent.childNodes.splice(index, 1, ...replacements as typeof parent.childNodes);
          for (const replacement of replacements) if ("parentNode" in replacement) replacement.parentNode = parent;
        }
        return;
      }
    }
    for (const child of children(node)) visit(child);
  };
  visit(root); return serialize(root);
}

/** 官方 Markdown 扩展传入自己的实例；不改安全选项，不创建另一套预览或运行脚本。 */
export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
  if (installed.has(md)) return md; installed.add(md);
  const contexts = new WeakMap<Token[], Map<string, Paint>>();
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    const output = fence(tokens, index, options, env, renderer), id = tokens[index].attrGet(attribute);
    if (!id) return output;
    // 部分宿主高亮器直接返回 pre，默认 fence renderer 会忽略 token.attrs；只标记唯一 pre/code。
    const fragment = parseFragment(output), codes: Element[] = [];
    const visit = (node: Node): void => { if (element(node) && node.tagName === "code" && element(node.parentNode!) && node.parentNode.tagName === "pre") codes.push(node); for (const child of children(node)) visit(child); };
    visit(fragment); if (codes.length !== 1) return output;
    codes[0].attrs = codes[0].attrs.filter((item) => item.name !== attribute); codes[0].attrs.push({ name: attribute, value: id });
    return serialize(fragment);
  };
  const parse = md.parse.bind(md), render = md.renderer.render.bind(md.renderer);
  md.parse = (source, env) => {
    let textBlocks: ReturnType<typeof scanNativeText> = [], codeBlocks: ReturnType<typeof scanNativeCode> = [];
    try { textBlocks = scanNativeText(source); codeBlocks = scanNativeCode(source); } catch { /* 解析失败时保持宿主普通预览。 */ }
    // 等长遮罩只隐藏已验证协议记录，保留所有行号；即使宿主禁用 HTML，也不把快照显示为文字。
    let masked = source;
    const records = [...textBlocks, ...codeBlocks].filter((block) => block.status === "valid" || block.status === "stale").sort((a, b) => b.commentFrom - a.commentFrom);
    for (const record of records) masked = masked.slice(0, record.commentFrom) + masked.slice(record.commentFrom, record.metadataTo).replace(/[^\r\n]/g, " ") + masked.slice(record.metadataTo);
    const tokens = parse(masked, env), paints = new Map<string, Paint>();
    try {
      for (const block of textBlocks) {
        if (block.status !== "valid") continue;
        const types = block.kind === "list" ? ["bullet_list_open", "ordered_list_open"] : [`${block.kind}_open`];
        const matches = tokens.filter((token) => types.includes(token.type) && token.map?.[0] === block.line);
        if (matches.length !== 1) continue;
        const id = randomUUID(); matches[0].attrSet(attribute, id);
        paints.set(id, { projection: projectNativeMarkdown(block.source), ranges: block.ranges });
      }
      for (const block of codeBlocks) {
        if (block.status !== "valid") continue;
        const matches = tokens.filter((token) => token.type === "fence" && token.map?.[0] === block.line && token.content === block.code.replace(/\r\n|\r/g, "\n"));
        if (matches.length !== 1) continue;
        const id = randomUUID(); matches[0].attrSet(attribute, id);
        const offsets: number[] = [];
        for (let i = 0; i < block.code.length; i++) { if (block.code[i] === "\r" && block.code[i + 1] === "\n") continue; offsets.push(i); }
        paints.set(id, { projection: { text: block.code.replace(/\r\n|\r/g, "\n"), offsets }, ranges: block.ranges, exact: true });
      }
    } catch { /* 未知结构仅普通渲染，绝不猜测颜色归属。 */ }
    contexts.set(tokens, paints); return tokens;
  };
  md.renderer.render = (tokens, options, env) => {
    const html = render(tokens, options, env), paints = contexts.get(tokens);
    if (!paints?.size) return html;
    try { return paintPreviewHtml(html, paints); } catch { return html; }
  };
  return md;
}
