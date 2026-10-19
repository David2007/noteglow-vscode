/** 目录身份使用源码行/DOM 顺序，不用标题文本，避免重名标题跳错位置。 */
export interface OutlineHeading { title: string; level: number; line: number }
export interface OutlineNode extends OutlineHeading { parent?: OutlineNode; children: OutlineNode[]; depth: number }
export function outlineTree(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [], stack: OutlineNode[] = [];
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    const parent = stack[stack.length - 1];
    const node: OutlineNode = { ...heading, parent, depth: stack.length, children: [] };
    (parent ? parent.children : roots).push(node); stack.push(node);
  }
  return roots;
}
export function currentHeading<T extends OutlineHeading>(headings: T[], line: number): T | undefined {
  let current: T | undefined;
  for (const heading of headings) { if (heading.line > line) break; current = heading; }
  return current;
}
