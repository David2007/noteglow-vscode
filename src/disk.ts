import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseState, emptyState, type State } from "./state.ts";
export async function readState(directory: string): Promise<State> {
  try { return parseState(JSON.parse(await readFile(join(directory, "sessions-v1.json"), "utf8"))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw new Error("NoteGlow 会话存储无法读取，已停止写入。原文件保留，请检查或备份后恢复。"); }
}
/** 工作区私有存储，临时文件和目标文件同目录；仅承诺单实例队列下的原子替换。 */
export async function writeState(directory: string, state: State): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "sessions-v1.json"), temporary = `${path}.${randomUUID()}.tmp`, text = JSON.stringify(state);
  try { await writeFile(temporary, text, { mode: 0o600, flag: "wx" }); await rename(temporary, path); if (await readFile(path, "utf8") !== text) throw new Error("会话保存后读回不一致。"); }
  finally { await unlink(temporary).catch(() => {}); }
}
