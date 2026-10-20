import { scanNativeCode } from "./native-code-colors.ts";
import { scanNativeText } from "./native-text-colors.ts";

export interface MetadataPosition { from: number; to: number }
export interface MetadataFold extends MetadataPosition {
  start: number; end: number; codeStart?: number; codeEnd?: number;
  status: "valid" | "stale";
}
export interface MetadataChange { rangeOffset: number; rangeLength: number; text: string }

/** 只给规范记录提供范围；代码闭合围栏保留可见，避免与正文折叠交叉。 */
export function metadataFolds(text: string): MetadataFold[] {
  if (!text.includes("<!-- noteglow-") || text.length > 1_000_000) return [];
  const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineAt = (offset: number): number => {
    let low = 0, high = starts.length;
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle; else high = middle; }
    return low;
  };
  const result: MetadataFold[] = [];
  try {
    for (const block of scanNativeCode(text)) {
      if (!block.supported || (block.status !== "valid" && block.status !== "stale")) continue;
      const end = lineAt(block.commentFrom), start = end - 1, codeStart = lineAt(block.from), codeEnd = start - 1;
      // 空围栏没有独立可折叠的正文行，不能与内置范围安全拆分。
      if (codeEnd <= codeStart) continue;
      result.push({ start, end, codeStart, codeEnd, from: block.commentFrom, to: block.metadataTo, status: block.status });
    }
    for (const block of scanNativeText(text)) {
      if (!block.supported || (block.status !== "valid" && block.status !== "stale")) continue;
      const end = lineAt(block.commentFrom), start = end - 1;
      if (start < 0 || text.slice(starts[start], starts[end]).trim()) continue;
      result.push({ start, end, from: block.commentFrom, to: block.metadataTo, status: block.status });
    }
  } catch { return []; }
  return result.sort((a, b) => a.from - b.from);
}

/** 已见记录跟随正文位移；删除记录后再创建，才视为新记录。颜色值修改不重置展开选择。 */
export function mapMetadataPositions(records: readonly MetadataPosition[], changes: readonly MetadataChange[]): MetadataPosition[] {
  const edits = [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
  const map = (position: number): number => {
    let delta = 0;
    for (const edit of edits) {
      if (position < edit.rangeOffset) break;
      if (position < edit.rangeOffset + edit.rangeLength) return edit.rangeOffset + delta + edit.text.length;
      delta += edit.text.length - edit.rangeLength;
    }
    return position + delta;
  };
  return records.filter(record => !edits.some(edit => edit.rangeOffset <= record.from && edit.rangeOffset + edit.rangeLength > record.from))
    .map(record => ({ from: map(record.from), to: map(record.to) }));
}
