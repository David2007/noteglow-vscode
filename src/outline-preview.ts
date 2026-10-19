import { outlineTree, type OutlineNode } from "./outline-model.ts";

/** 异步 previewScripts 可能早于官方首次正文插入。只观察到容器出现即断开。 */
export function startOutline(document: Document, window: Window): () => void {
  let stop: (() => void) | undefined;
  const observer = new (window as Window & typeof globalThis).MutationObserver(() => start());
  const start = (): void => {
    if (!document.body || !document.querySelector(".markdown-body")) return;
    observer.disconnect(); stop = mountOutline(document, window);
  };
  start();
  if (!stop) observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => { observer.disconnect(); stop?.(); };
}

/** 官方 Markdown previewScripts 入口；按钮只操作当前预览 DOM，不发送源码写入消息。 */
export function mountOutline(document: Document, window: Window): () => void {
  let headings: HTMLElement[] = [], nodes: OutlineNode[] = [];
  let selected: OutlineNode | undefined, collapsed = false, pinned = false;
  let source: string | undefined;
  try {
    const settings = JSON.parse(document.getElementById("vscode-markdown-preview-data")?.getAttribute("data-settings") ?? "{}");
    if (typeof settings.source === "string") source = settings.source;
  } catch { /* 缺少宿主元数据时等待第一条有效内容消息，不猜测文件身份。 */ }
  const folded = new Set<number>(), rows = new Map<number, HTMLButtonElement>();
  const panel = document.createElement("nav"); panel.className = "noteglow-outline"; panel.setAttribute("aria-label", "笔记目录");
  const toggle = document.createElement("button"); toggle.className = "noteglow-outline-toggle";
  const list = document.createElement("div"); list.className = "noteglow-outline-list";
  panel.append(toggle, list); document.body.append(panel);
  const setCollapsed = (): void => {
    panel.classList.toggle("is-collapsed", collapsed); document.body.classList.toggle("noteglow-has-outline", !collapsed);
    toggle.textContent = collapsed ? "≡" : "目录 −"; toggle.title = collapsed ? "展开目录" : "收起目录";
    toggle.setAttribute("aria-expanded", String(!collapsed)); list.hidden = collapsed;
  };
  const revealRow = (): void => {
    const row = selected && rows.get(selected.line);
    if (!row || collapsed) return;
    // 只移动目录自身滚动条，避免 scrollIntoView 连带改变正文阅读位置。
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  };
  toggle.onclick = () => { collapsed = !collapsed; setCollapsed(); revealRow(); };
  const paint = (): void => {
    list.replaceChildren(); rows.clear();
    if (!nodes.length) { list.textContent = "当前笔记暂无标题"; return; }
    const add = (node: OutlineNode): void => {
      const row = document.createElement("div"); row.className = "noteglow-outline-row"; row.style.paddingLeft = `${Math.min(node.depth, 5) * 10}px`;
      const arrow = document.createElement("button"); arrow.className = "noteglow-outline-arrow";
      arrow.textContent = node.children.length ? (folded.has(node.line) ? "▸" : "▾") : "";
      arrow.disabled = !node.children.length; arrow.setAttribute("aria-label", `${folded.has(node.line) ? "展开" : "收起"} ${node.title}`);
      if (node.children.length) arrow.setAttribute("aria-expanded", String(!folded.has(node.line)));
      arrow.onclick = () => { if (folded.has(node.line)) folded.delete(node.line); else folded.add(node.line); paint(); };
      const button = document.createElement("button"); button.className = "noteglow-outline-title"; button.textContent = node.title; button.title = node.title;
      button.setAttribute("aria-current", node === selected ? "location" : "false");
      button.onclick = () => {
        // 使用元素引用，不按文字或 slug 查找；重名标题与源码同步滚动仍精确对应。
        pinned = true; selected = node; headings[node.line].scrollIntoView({ block: "start" }); paint();
      };
      rows.set(node.line, button); row.append(arrow, button); list.append(row);
      if (!folded.has(node.line)) for (const child of node.children) add(child);
    };
    for (const node of nodes) add(node);
  };
  const track = (): void => {
    if (pinned) return;
    let index = -1;
    for (let i = 0; i < headings.length; i++) { if (headings[i].getBoundingClientRect().top > 36) break; index = i; }
    const find = (items: OutlineNode[]): OutlineNode | undefined => { for (const node of items) { if (node.line === index) return node; const child = find(node.children); if (child) return child; } };
    const next = find(nodes); if (next === selected) return;
    selected = next;
    for (let parent = next?.parent; parent; parent = parent.parent) folded.delete(parent.line);
    paint(); revealRow();
  };
  const rebuild = (): void => {
    // 更新事件由 VS Code 在内容替换完成后派发；目录在 markdown-body 外，不参与正文 diff。
    headings = Array.from(document.querySelectorAll<HTMLElement>(".markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6"));
    nodes = outlineTree(headings.map((heading, line) => ({ title: heading.textContent?.trim() || "（空标题）", level: Number(heading.tagName.slice(1)), line })));
    folded.clear(); const fold = (items: OutlineNode[]): void => { for (const node of items) { if (node.depth >= 1) folded.add(node.line); fold(node.children); } }; fold(nodes);
    pinned = false; selected = undefined; paint(); setCollapsed(); track();
  };
  const unpin = (event: Event): void => {
    if ((event.target as Node | null)?.nodeType && panel.contains(event.target as Node)) return;
    pinned = false;
  };
  const hostMessage = (event: MessageEvent): void => {
    const message = event.data;
    if (!message || typeof message.source !== "string") return;
    if (message.type === "updateContent") {
      if (source !== undefined && message.source !== source) { collapsed = false; setCollapsed(); }
      source = message.source;
    } else if (message.type === "updateView" && message.source === source) {
      // 官方源码→预览同步没有 wheel/pointer 事件；让宿主滚动重新决定当前章节。
      pinned = false; track();
    }
  };
  window.addEventListener("message", hostMessage);
  window.addEventListener("pointerdown", unpin);
  window.addEventListener("wheel", unpin, { passive: true });
  window.addEventListener("touchstart", unpin, { passive: true });
  window.addEventListener("keydown", unpin);
  window.addEventListener("scroll", track, { passive: true });
  window.addEventListener("vscode.markdown.updateContent", rebuild);
  rebuild();
  return () => { window.removeEventListener("message", hostMessage); window.removeEventListener("pointerdown", unpin); window.removeEventListener("wheel", unpin); window.removeEventListener("touchstart", unpin); window.removeEventListener("keydown", unpin); window.removeEventListener("scroll", track); window.removeEventListener("vscode.markdown.updateContent", rebuild); panel.remove(); document.body.classList.remove("noteglow-has-outline"); };
}
