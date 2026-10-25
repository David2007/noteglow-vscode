// 纯核心同步 NoteGlow Obsidian b6994cc 的表格和多段格式；普通文档编辑由宿主仅刷新失效状态。
import { normalizeColor, replaceColor, mergeRanges, type ColorRange, type ColorProperty } from "./color-ranges.ts";
import { nativeTextBlocks, nativeTextDocumentShape, nativeTextMetadataRecords, restoreOwnedInline, formatMarkdownSelection, nativeSelectionFormatState, nativeTextFormatRanges, projectNativeMarkdown, type PortableColorEdit, type Format } from "./markdown-colors.ts";

const MARKER = "<!-- noteglow-text-colors:", PREFIX = MARKER + "1 ";
const MAX_TEXT = 1_000_000, MAX_BLOCK = 200_000;
export interface NativeTextBlock {
  from: number; to: number; line: number; kind: string; structure: string; supported: boolean;
  cells: Array<{ from: number; to: number }>; units: Array<{ from: number; to: number }>; source: string; eol: string;
  metadataFrom: number; metadataTo: number; commentFrom: number;
  status: "none" | "valid" | "stale" | "invalid"; ranges: ColorRange[];
}
function boundary(text: string, at: number): boolean {
  return !(at > 0 && at < text.length && (/[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]) || text[at - 1] === "\r" && text[at] === "\n"));
}
function validRanges(ranges: unknown, source: string): ranges is ColorRange[] {
  if (!Array.isArray(ranges) || ranges.length > 10000) return false;
  const ends = { foreground: 0, background: 0 };
  return ranges.every((range) => {
    if (!range || Object.keys(range).sort().join() !== "color,from,property,to" || !["foreground", "background"].includes(range.property) || !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.from >= range.to || range.to > source.length || !boundary(source, range.from) || !boundary(source, range.to) || typeof range.color !== "string" || normalizeColor(range.color) !== range.color) return false;
    const property = range.property as ColorProperty;
    if (range.from < ends[property]) return false;
    ends[property] = range.to; return true;
  });
}
export function encodeNativeTextMetadata(source: string, ranges: readonly ColorRange[]): string {
  if (source.length > MAX_BLOCK || !validRanges(ranges, source)) throw new Error("正文颜色记录超限或范围无效。");
  return PREFIX + JSON.stringify({ version: 1, source, ranges }).replace(/[<>&-]/g, (value) => `\\u${value.charCodeAt(0).toString(16).padStart(4, "0")}`) + " -->";
}
const cache = new Map<string, NativeTextBlock[]>();
/** 两个新增换行只属于记录；完整顶层块之外插入，不改变列表内部紧凑性。 */
export function scanNativeText(text: string): NativeTextBlock[] {
  if (text.length > MAX_TEXT) return [];
  const cached = cache.get(text); if (cached) return cached;
  let parsed: ReturnType<typeof nativeTextBlocks>;
  try { parsed = nativeTextBlocks(text); } catch { return []; }
  const blocks = parsed.map((item): NativeTextBlock => {
    const source = text.slice(item.from, item.to), eol = source.includes("\r\n") || text.includes("\r\n") ? "\r\n" : "\n";
    const block: NativeTextBlock = { ...item, supported: item.supported && source.length <= MAX_BLOCK, source, eol, metadataFrom: item.to, metadataTo: item.to, commentFrom: item.to, status: "none", ranges: [] };
    const separator = /^(\r\n|\n)\1/.exec(text.slice(item.to));
    if (!separator || !text.startsWith(MARKER, item.to + separator[0].length)) return block;
    block.commentFrom = item.to + separator[0].length;
    const end = text.indexOf("\n", block.commentFrom), raw = text.slice(block.commentFrom, end < 0 ? text.length : end).replace(/\r$/, "");
    block.metadataTo = block.commentFrom + raw.length; block.status = "invalid";
    try {
      if (!raw.startsWith(PREFIX) || !raw.endsWith(" -->")) return block;
      const data = JSON.parse(raw.slice(PREFIX.length, -4));
      if (!data || Object.keys(data).sort().join() !== "ranges,source,version" || data.version !== 1 || typeof data.source !== "string" || encodeNativeTextMetadata(data.source, data.ranges) !== raw) return block;
      block.status = item.supported && data.source === source ? "valid" : "stale";
      if (block.status === "valid") block.ranges = data.ranges;
    } catch { /* 损坏记录保留，用户可通过重置命令清理。 */ }
    return block;
  });
  cache.set(text, blocks); while (cache.size > 2) cache.delete(cache.keys().next().value!);
  return blocks;
}
export function nativeTextColorRanges(text: string): ColorRange[] {
  return scanNativeText(text).filter((block) => block.status === "valid").flatMap((block) => block.ranges.map((range) => ({ ...range, from: range.from + block.from, to: range.to + block.from })));
}
function selectedBlock(text: string, from: number, to: number): NativeTextBlock {
  if (text.length > MAX_TEXT || from < 0 || from >= to || to > text.length || !boundary(text, from) || !boundary(text, to)) throw new Error("正文选区无效或笔记过大。");
  const blocks = scanNativeText(text).filter((block) => from < block.to && to > block.from);
  if (blocks.length !== 1 || !blocks[0].supported || from < blocks[0].from || to > blocks[0].to) throw new Error("请选择同一段落、标题或列表内的正文；未知 HTML、引用和嵌套代码暂不支持。旧 HTML 请先执行恢复原生正文命令。");
  const block = blocks[0];
  if (block.status === "invalid" || block.status === "stale") throw new Error("正文颜色记录已过期或损坏，原文已保留；请执行“重置当前笔记的正文颜色记录”后重新着色。");
  return block;
}
function writeRanges(text: string, block: NativeTextBlock, ranges: ColorRange[]): string {
  const insert = ranges.length ? block.eol + block.eol + encodeNativeTextMetadata(block.source, mergeRanges(ranges)) : "";
  const output = text.slice(0, block.to) + insert + text.slice(block.metadataTo);
  if (output.length > MAX_TEXT) throw new Error("包含颜色记录后超过 100 万字符，未修改。");
  if (nativeTextDocumentShape(text) !== nativeTextDocumentShape(output)) throw new Error("颜色记录将改变列表或段落结构，原文已保留。");
  return output;
}
interface TextSelection { from: number; to: number }
/** 源码连续选择按单元格内容裁剪，管道、分隔行和空格子不参与格式。 */
function selectedTextRanges(block: NativeTextBlock, from: number, to: number): TextSelection[] {
  const ranges = block.kind === "table" ? block.cells.map((cell) => ({ from: Math.max(from, cell.from), to: Math.min(to, cell.to) })).filter((range) => range.to > range.from) : [{ from, to }];
  if (!ranges.length || ranges.length > 10000) throw new Error("所选单元格没有可格式化的文字，请勿只选择表格分隔符或空格子。");
  return ranges;
}
/** 整个连续选区先校验；仅跳过块间空白和该块已有的有效记录，引用/围栏/未知 HTML 不静默略过。 */
function selectedBlocks(text: string, from: number, to: number): NativeTextBlock[] {
  if (text.length > MAX_TEXT || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to || to > text.length || !boundary(text, from) || !boundary(text, to)) throw new Error("正文选区无效或笔记过大。");
  const blocks = scanNativeText(text).filter((block) => from < block.to && to > block.from);
  if (!blocks.length) throw new Error("请选择支持的正文，不能只选择分隔符或颜色记录；旧 HTML 请先执行恢复原生正文命令。");
  let cursor = from;
  for (const block of blocks) {
    if (!block.supported || text.slice(cursor, Math.max(cursor, block.from)).trim()) throw new Error("选区包含不支持的引用、代码块或 HTML，原文未修改；旧 HTML 请先执行恢复原生正文命令。");
    if (block.status === "invalid" || block.status === "stale") throw new Error("正文颜色记录已过期或损坏，请先重置记录。");
    if (to > block.to && to < block.metadataTo) throw new Error("请勿只选择部分颜色记录。");
    cursor = Math.max(cursor, block.metadataTo);
  }
  if (text.slice(cursor, to).trim()) throw new Error("选区包含不支持的引用、代码块或 HTML，原文未修改；旧 HTML 请先执行恢复原生正文命令。");
  return blocks;
}

export function applyNativeTextColor(text: string, from: number, to: number, property?: ColorProperty, color?: string): PortableColorEdit {
  const blocks = selectedBlocks(text, from, to);
  let output = text, end = to;
  for (const block of [...blocks].reverse()) {
    const edit = applyNativeTextColorBlock(output, Math.max(from, block.from), Math.min(to, block.to), property, color);
    const delta = edit.text.length - output.length;
    // 颜色记录插入在块后；只有位于选区末端之前的记录才移动末端。
    if (block.to < to) end += delta;
    output = edit.text;
  }
  return { text: output, from, to: end };
}

export function formatNativeText(text: string, from: number, to: number, format: Format, applyOnly = false, url?: string): PortableColorEdit {
  if (format === "strike" || format === "underline" || format === "link") return formatNativeTextBlock(text, from, to, format, applyOnly, url);
  const blocks = selectedBlocks(text, from, to);
  const selections = blocks.flatMap((block) => selectedTextRanges(block, Math.max(from, block.from), Math.min(to, block.to)));
  const batchApplyOnly = applyOnly || blocks.length > 1 && !nativeSelectionFormatState(text, selections, format).applied;
  let output = text, start = from, end = to, touched = false;
  for (const block of [...blocks].reverse()) {
    const left = Math.max(from, block.from), right = Math.min(to, block.to);
    if (format !== "code" && !nativeSelectionFormatState(text, [{ from: left, to: right }], format).eligible) continue;
    const edit = formatNativeTextBlock(output, left, right, format, batchApplyOnly);
    end = touched ? end + edit.text.length - output.length : edit.to;
    start = edit.from; output = edit.text; touched = true;
  }
  if (!touched) throw new Error("选区没有可设置格式的正文。");
  return { text: output, from: start, to: end };
}
function applyNativeTextColorBlock(text: string, from: number, to: number, property?: ColorProperty, color?: string): PortableColorEdit {
  const block = selectedBlock(text, from, to), selections = selectedTextRanges(block, from, to);
  if (property && !normalizeColor(color ?? "")) throw new Error("请输入 #RGB 或 #RRGGBB。");
  const units = block.units.filter((unit) => selections.some((range) => unit.from < range.to && unit.to > range.from));
  if (!units.length || units.some((unit) => !selections.some((range) => unit.from >= range.from && unit.to <= range.to))) throw new Error("请选择完整文字，不能拆开实体或只选择格式标签。");
  let ranges = block.ranges;
  const intervals: Array<{ from: number; to: number }> = [];
  for (const unit of units) { const last = intervals[intervals.length - 1]; if (last && unit.from <= last.to) last.to = Math.max(last.to, unit.to); else intervals.push({ ...unit }); }
  for (const unit of intervals) ranges = replaceColor(ranges, unit.from - block.from, unit.to - block.from, property, color);
  return { text: writeRanges(text, block, ranges), from, to };
}
/** 格式只在本块原生 Markdown 上执行；携带颜色通过解析器的精确位置映射，绝不重建 HTML。 */
function formatNativeTextBlock(text: string, from: number, to: number, format: Format, applyOnly = false, url?: string): PortableColorEdit {
  const block = selectedBlock(text, from, to), selections = selectedTextRanges(block, from, to).flatMap((range) => nativeTextFormatRanges(block.source).map((part) => ({ from: Math.max(range.from, part.from + block.from), to: Math.min(range.to, part.to + block.from) })).filter((part) => part.from < part.to)).map((range) => ({ from: range.from - block.from, to: range.to - block.from }));
  if (!selections.length) throw new Error("请选择正文，不要只选择容器标记。");
  const extra = format === "strike" || format === "underline" || format === "link";
  if (extra && selections.length !== 1) throw new Error("该格式请选择同一段落或单元格内的连续正文。");
  const batch = selections.length > 1;
  if (format === "bold" || format === "italic") {
    for (let index = selections.length - 1; index >= 0; index--) if (!nativeSelectionFormatState(block.source, [selections[index]], format).eligible) selections.splice(index, 1);
    if (!selections.length) throw new Error("选区没有可设置格式的正文。");
  }
  const batchApplyOnly = applyOnly || batch && !nativeSelectionFormatState(block.source, selections, format).applied;
  let result: PortableColorEdit = { text: block.source, ranges: block.ranges, from: from - block.from, to: to - block.from };
  let selectionTo = result.to;
  // 先在内存从后向前改各格，前方原 offset 不变；任一格拒绝则整体不写，最终只交给宿主一次事务。
  for (let index = selections.length - 1; index >= 0; index--) {
    const range = selections[index];
    const next = formatMarkdownSelection(result.text, range.from, range.to, format, result.ranges, true, batchApplyOnly, url);
    selectionTo = index === selections.length - 1 ? next.to : selectionTo + next.text.length - result.text.length;
    result = { ...next, to: selectionTo };
  }
  const parsed = nativeTextBlocks(result.text);
  if (parsed.length !== 1 || !parsed[0].supported || parsed[0].kind !== block.kind || parsed[0].from !== 0 || parsed[0].to !== result.text.length) throw new Error("格式修改将改变段落结构，原文已保留。");
  const replacement = result.text + ((result.ranges?.length ?? 0) ? block.eol + block.eol + encodeNativeTextMetadata(result.text, result.ranges!) : "");
  return { text: text.slice(0, block.from) + replacement + text.slice(block.metadataTo), from: block.from + result.from, to: block.from + result.to };
}
/** 重置只清理当前笔记中独立的自有记录行，不触碰快照中的正文或其他 HTML。 */
export function resetNativeTextMetadata(text: string): string {
  let output = text;
  for (const record of nativeTextMetadataRecords(text).reverse()) output = output.slice(0, record.from) + output.slice(record.to);
  return output;
}
export function migrateOwnedTextToNative(text: string): { text: string; count: number; map(position: number): number } {
  const restored = restoreOwnedInline(text);
  if (!restored.count) return { text, count: 0, map: (position) => position };
  let output = restored.text;
  // 已有原生记录不能被旧 HTML 还原静默移位；必须先人工重置或分离旧结构。
  if (restored.count && text.includes(MARKER)) throw new Error("笔记同时包含旧 HTML 与正文颜色记录，请先备份并重置正文颜色记录后恢复。");
  for (const range of [...restored.ranges].sort((a, b) => b.from - a.from || b.to - a.to)) output = applyNativeTextColor(output, range.from, range.to, range.property, range.color).text;
  // 从后向前插入记录，只有前方块的记录会平移后面的光标；逐块按精确快照匹配位置。
  const blocks = scanNativeText(output).filter((block) => block.status === "valid");
  return { text: output, count: restored.count, map: (position) => { let at = restored.map(position); for (const block of blocks) if (block.to < at) at += block.metadataTo - block.to; return at; } };
}

/** 标题转换作用于完整单行正文块；颜色快照与偏移随前缀一起更新。 */
export function setNativeHeading(text: string, from: number, to: number, level: number): PortableColorEdit {
  if (!Number.isInteger(level) || level < 0 || level > 6) throw new Error("标题级别须为 0–6。");
  const block = selectedBlock(text, from, to);
  if (!["paragraph", "heading"].includes(block.kind) || /[\r\n]/.test(block.source)) throw new Error("请选择单行正文或 ATX 标题。");
  const match = /^( {0,3}#{1,6}[ \t]+)(.*?)([ \t]+#+[ \t]*)?$/.exec(block.source);
  const oldPrefix = match?.[1].length ?? 0, body = match?.[2] ?? block.source;
  const prefix = level ? "#".repeat(level) + " " : "";
  const source = prefix + body;
  const parsed = nativeTextBlocks(source);
  if (parsed.length !== 1 || !parsed[0].supported || parsed[0].kind !== (level ? "heading" : "paragraph") || parsed[0].to !== source.length) throw new Error("转换会改变正文结构，未修改。");
  if (projectNativeMarkdown(source).text !== projectNativeMarkdown(block.source).text) throw new Error("转换会改变可见文字，未修改。");
  const delta = prefix.length - oldPrefix;
  const ranges = block.ranges.map(range => ({ ...range, from: range.from + delta, to: range.to + delta }));
  const before = text.slice(0, block.from), after = text.slice(block.metadataTo);
  // 标题原本可用单换行隔开正文；转回段落时补空行，避免吞并相邻段落。
  const leading = !level && before && !/(?:\r?\n){2}$/.test(before) ? block.eol : "";
  const trailing = !level && /^(?:\r?\n)[^\r\n]/.test(after) ? block.eol : "";
  const replacement = leading + source + (ranges.length ? block.eol + block.eol + encodeNativeTextMetadata(source, ranges) : "") + trailing;
  const map = (offset: number) => block.from + leading.length + Math.max(prefix.length, Math.min(source.length, offset - block.from + delta));
  return { text: before + replacement + after, from: map(from), to: map(to) };
}

/** 单个绝对 HTTP(S) 地址，最多 2048 字符；空值表示移除链接，整值校验。 */
export function normalizeLink(value: string): string {
  if (!value) return "";
  if (value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new Error("请输入一个不含空白、最多 2048 字符的 HTTP(S) 地址。");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("请输入完整的 HTTP(S) 地址，例如 https://example.com。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("仅支持不含账号密码的 HTTP(S) 地址。");
  return url.href.replace(/[()<>]/g, character => "%" + character.charCodeAt(0).toString(16).toUpperCase());
}
