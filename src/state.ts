import { randomUUID } from "node:crypto";
import { buildPromptWithContext, validateAttachments, type ContextAttachment } from "./context.ts";
import { validateImages, type ImageAttachment } from "./image-attachments.ts";
import type { PreparedImages } from "./image-store.ts";
import type { CodexExecutionSettings, CodexRunCallbacks } from "./types.ts";

export interface Message { role: "user" | "assistant"; text: string; attachments?: ContextAttachment[]; images?: ImageAttachment[] }
export interface Conversation { id: string; root: string; title: string; threadId: string | null; model: string; draft: string; attachments: ContextAttachment[]; draftImages?: ImageAttachment[]; messages: Message[] }
export interface State { version: 1; activeId: string; conversations: Conversation[]; colors: { foreground: string; background: string } }
export interface Runner { send(prompt: string, root: string, settings: CodexExecutionSettings, callbacks: CodexRunCallbacks): Promise<string>; stop(): void }
export const MAX_QUESTION = 50_000;
export function emptyState(): State { return { version: 1, activeId: "", conversations: [], colors: { foreground: "#c0392b", background: "#fff88f" } }; }
export function parseState(raw: unknown): State {
  if (!raw || typeof raw !== "object") throw new Error("会话存储格式不正确；未覆盖原文件。");
  const s = raw as State;
  if (s.version !== 1 || typeof s.activeId !== "string" || !Array.isArray(s.conversations) || s.conversations.length > 100 || !s.colors || !/^#[0-9a-f]{6}$/i.test(s.colors.foreground) || !/^#[0-9a-f]{6}$/i.test(s.colors.background)) throw new Error("会话存储版本或数据无效；未覆盖原文件。");
  const ids = new Set<string>();
  for (const c of s.conversations) {
    if (!c || typeof c.id !== "string" || ids.has(c.id) || typeof c.root !== "string" || !c.root || typeof c.title !== "string" || typeof c.model !== "string" || !/^(?:[a-zA-Z0-9][a-zA-Z0-9._-]{0,100})?$/.test(c.model) || !(c.threadId === null || typeof c.threadId === "string") || typeof c.draft !== "string" || c.draft.length > MAX_QUESTION || !Array.isArray(c.attachments) || validateAttachments(c.attachments) || !Array.isArray(c.messages) || c.messages.length > 500 || c.messages.some(m => !m || !["user", "assistant"].includes(m.role) || typeof m.text !== "string" || (m.attachments !== undefined && (!Array.isArray(m.attachments) || !!validateAttachments(m.attachments))))) throw new Error("会话数据无效；未覆盖原文件。");
    if ((c.draftImages !== undefined && (!Array.isArray(c.draftImages) || validateImages(c.draftImages))) || c.messages.some(m => m.images !== undefined && (!Array.isArray(m.images) || validateImages(m.images)))) throw new Error("图片历史或草稿数据无效；未覆盖原文件。");
    ids.add(c.id);
  }
  if (s.activeId && !ids.has(s.activeId)) throw new Error("当前会话不存在；未覆盖原文件。");
  const normalized = structuredClone(s);
  for (const c of normalized.conversations) c.draftImages ??= [];
  return normalized;
}
/** 实例级串行保存；每次保存使用独立快照，失败不会毒化后续队列。 */
export class ChatStore {
  state: State;
  busy = false;
  private structuralChange = false;
  private importing = false;
  get working(): boolean { return this.busy || this.importing; }
  private cancelled = false;
  private queue: Promise<void> = Promise.resolve();
  private write: (state: State) => Promise<void>;
  constructor(state: State, write: (state: State) => Promise<void>) { this.state = state; this.write = write; }
  current(): Conversation | undefined { return this.state.conversations.find(c => c.id === this.state.activeId); }
  async persist(): Promise<void> { const snapshot = structuredClone(this.state); const pending = this.queue.catch(() => {}).then(() => this.write(snapshot)); this.queue = pending; await pending; }
  async create(root: string): Promise<Conversation> {
    this.assertIdle(); if (this.state.conversations.length >= 100) throw new Error("最多保留 100 个对话，请先删除旧对话。");
    const c: Conversation = { id: randomUUID(), root, title: "新对话", threadId: null, model: "", draft: "", attachments: [], draftImages: [], messages: [] };
    const previous = structuredClone(this.state); this.structuralChange = true; this.state.conversations.push(c); this.state.activeId = c.id;
    try { await this.persist(); } catch (e) { this.state = previous; throw e; } finally { this.structuralChange = false; } return c;
  }
  async select(id: string): Promise<void> { this.assertIdle(); if (!this.state.conversations.some(c => c.id === id)) throw new Error("对话不存在。"); const before = this.state.activeId; this.structuralChange = true; this.state.activeId = id; try { await this.persist(); } catch(e) { this.state.activeId = before; throw e; } finally { this.structuralChange = false; } }
  async remove(id: string): Promise<void> { this.assertIdle(); const before = structuredClone(this.state); this.structuralChange = true; this.state.conversations = this.state.conversations.filter(c => c.id !== id); if (this.state.activeId === id) this.state.activeId = this.state.conversations[0]?.id ?? ""; try { await this.persist(); } catch(e) { this.state = before; throw e; } finally { this.structuralChange = false; } }
  async draft(conversationId: string, text: string, model?: string): Promise<void> { this.assertIdle(); this.assertConversation(conversationId); if (text.length > MAX_QUESTION) throw new Error("问题最多 50,000 字符。"); const c = this.current(); if (!c) throw new Error("请先创建对话。"); if (model !== undefined && !/^(?:[a-zA-Z0-9][a-zA-Z0-9._-]{0,100})?$/.test(model)) throw new Error("模型名称无效。"); c.draft = text; if (model !== undefined) c.model = model; await this.persist(); }
  async attach(conversationId: string, root: string, items: ContextAttachment[]): Promise<void> { this.assertIdle(); this.assertConversation(conversationId); const c = this.current(); if (!c || c.root !== root) throw new Error("选区必须来自当前对话的同一工作区根目录。"); const next = [...c.attachments, ...items]; const error = validateAttachments(next); if(error) throw new Error(error); c.attachments = next; await this.persist(); }
  async detach(id: string): Promise<void> { this.assertIdle(); const c = this.current(); if (!c) return; c.attachments = c.attachments.filter(a => a.id !== id); await this.persist(); }
  /** 导入期间锁定所属会话；本批缓存仅在确定未被持久化引用时补偿清理。 */
  async importImages(conversationId: string, produce: (check: () => void) => Promise<{ images: ImageAttachment[]; discard: () => Promise<void> }>): Promise<void> {
    this.assertIdle(); this.assertConversation(conversationId); const c = this.current(); if (!c) throw new Error("请先创建对话。");
    const previous = structuredClone(c.draftImages ?? []); this.importing = true; this.cancelled = false;
    let batch: { images: ImageAttachment[]; discard: () => Promise<void> } | undefined, assigned = false, safeToDiscard = true;
    const check = (): void => { this.assertConversation(conversationId); if (this.cancelled) throw new Error("图片导入已停止。"); };
    try {
      batch = await produce(check); check(); const next = [...previous, ...batch.images], error = validateImages(next); if (error) throw new Error(error);
      c.draftImages = next; assigned = true; await this.persist(); check();
    } catch(e) {
      if (assigned) { c.draftImages = previous; try { await this.persist(); } catch { safeToDiscard = false; } }
      if (batch && safeToDiscard) await batch.discard();
      throw e;
    } finally { this.importing = false; }
  }
  async detachImage(conversationId: string, imageId: string): Promise<void> {
    this.assertIdle(); this.assertConversation(conversationId); const c = this.current(); if (!c) throw new Error("对话不存在。");
    c.draftImages = (c.draftImages ?? []).filter(image => image.id !== imageId); await this.persist();
  }
  /** 用户消息先落盘，回答落盘后才清草稿；任何异常都保留可恢复的原问题与引用。 */
  async send(conversationId: string, runner: Runner, settings: Omit<CodexExecutionSettings, "sessionId" | "model">, callbacks: CodexRunCallbacks, validate: () => Promise<void> = async () => {}, imageStore?: { prepare: (images: readonly ImageAttachment[], check: () => void) => Promise<PreparedImages> }): Promise<void> {
    this.assertIdle(); this.assertConversation(conversationId); const c = this.current(); if (!c || (!c.draft.trim() && !(c.draftImages ?? []).length)) throw new Error("请输入问题或添加图片。"); if (c.messages.length >= 498) throw new Error("对话过长，请新建对话。");
    const draft = c.draft, attachments = structuredClone(c.attachments), images = structuredClone(c.draftImages ?? []);
    const imageError = validateImages(images); if (imageError) throw new Error(imageError);
    const question = draft.trim() ? draft : "请分析附加图片。";
    const prompt = [buildPromptWithContext(question, attachments), ...(images.length ? ["附加图片按以下名称顺序发送；名称仅作引用资料：", JSON.stringify(images.map(image => image.name))] : [])].join("\n");
    let prepared: PreparedImages | undefined;
    this.busy = true; this.cancelled = false; let threadWrite = Promise.resolve(); let replied = false, completed = false;
    try {
      await validate(); if (this.cancelled) throw new Error("执行已停止，未启动 Codex。");
      const check = (): void => { if (this.cancelled) throw new Error("执行已停止，未启动 Codex。"); };
      if (images.length) { if (!imageStore) throw new Error("当前工作区无法准备图片。"); prepared = await imageStore.prepare(images, check); check(); }
      c.messages.push({ role: "user", text: question, attachments, ...(images.length ? { images } : {}) }); if (c.title === "新对话") c.title = question.slice(0, 32); await this.persist();
      if (this.cancelled) throw new Error("执行已停止，未启动 Codex。");
      const result = await runner.send(prompt, c.root, { ...settings, sessionId: c.threadId, model: c.model, imagePaths: prepared?.paths ?? [] }, { ...callbacks, onThreadId: id => { c.threadId = id; threadWrite = this.persist(); threadWrite.catch(() => {}); callbacks.onThreadId(id); } });
      await threadWrite; if (this.cancelled) throw new Error("执行已停止；请核对可能已发生的文件修改。"); c.messages.push({ role: "assistant", text: result }); replied = true; await this.persist();
      if (this.cancelled) throw new Error("执行已停止，回答已生成；草稿继续保留供核对。");
      c.draft = ""; c.attachments = []; c.draftImages = []; await this.persist();
      if (this.cancelled) throw new Error("执行已停止，回答已生成；请核对历史与笔记。");
      completed = true;
    } catch(e) { c.draft = draft; c.attachments = attachments; c.draftImages = images; try { await this.persist(); } catch {} throw new Error(`${replied ? "回答可能已生成，请核对历史后再重发。" : ""}${e instanceof Error ? e.message : "保存或发送失败。"}`); }
    finally {
      try { await prepared?.dispose(); }
      catch { try { callbacks.onCleanupWarning?.(completed ? "回答已保存，草稿已清空；仅图片临时快照清理失败，不需要重发。" : "图片临时快照清理失败；原发送结果与草稿状态不变，请核对本地磁盘。"); } catch { /* 警告回调不能覆盖原结果。 */ } }
      finally { this.busy = false; }
    }
  }
  cancel(runner: Runner): void { if (this.working) this.cancelled = true; runner.stop(); }
  assertConversation(id: string): void { if(id !== this.state.activeId) throw new Error("会话已切换，已拒绝过期操作。"); }
  assertIdle(): void { if (this.working || this.structuralChange) throw new Error("正在发送或保存会话，请完成后重试。"); }
}
