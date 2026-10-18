import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute } from "node:path";
import { parseCodexEvent } from "./codex-events.ts";
import type { CodexExecutionSettings, CodexRunCallbacks } from "./types.ts";

const MAC_CODEX_CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex"
];

export class CodexClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting = false;
  private cancelled = false;
  private forceFinish?: () => void;
  constructor(private readonly limits = { timeoutMs: 600_000, maxOutputBytes: 4_000_000, maxLineChars: 1_000_000 }) {}

  async resolveExecutable(configuredPath: string): Promise<string> {
    const configured = configuredPath.trim();
    if (configured && configured !== "codex") {
      if (!isAbsolute(configured)) return configured;
      await access(configured);
      return configured;
    }

    const pathCandidates = (process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => `${directory}/codex`);

    for (const candidate of [...pathCandidates, ...MAC_CODEX_CANDIDATES]) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the next common installation location.
      }
    }
    return "codex";
  }

  async send(
    prompt: string,
    vaultPath: string,
    settings: CodexExecutionSettings,
    callbacks: CodexRunCallbacks
  ): Promise<string> {
    if (this.running) throw new Error("Codex 正在处理其他请求。");
    this.starting = true;
    this.cancelled = false;
    let executable: string;
    try {
      executable = await this.resolveExecutable(settings.codexPath);
      if (this.cancelled) throw new Error("Codex 执行已停止。");
    } catch (error) { this.starting = false; throw error; }
    const args = buildCodexArgs(settings, vaultPath);

    callbacks.onStatus(settings.sessionId ? "正在继续对话…" : "正在启动 Codex…");

    return await new Promise<string>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try { child = spawn(executable, args, {
        cwd: vaultPath,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32"
      }); } catch (error) { this.starting = false; reject(new Error(`无法启动 Codex CLI：${error instanceof Error ? error.message : "参数无效"}`)); return; }
      this.child = child;
      this.starting = false;

      let stdoutBuffer = "";
      let stderr = "";
      let finalText = "";
      let outputBytes = 0;
      let limitError = "";
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return; settled = true; clearTimeout(deadline);
        if (this.child === child) { this.child = null; this.forceFinish = undefined; }
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
        if (error) reject(error); else resolve(finalText);
      };
      this.forceFinish = () => finish(new Error(limitError || "Codex 执行已停止；请核对可能已发生的文件修改。"));
      const deadline = setTimeout(() => { limitError = "Codex 执行超过 10 分钟，已停止；请核对可能已完成的文件修改。"; this.stop(); }, this.limits.timeoutMs);
      deadline.unref();

      const consumeLine = (line: string): void => {
        if (settled) return;
        const event = parseCodexEvent(line);
        if (!event) return;

        if (event.threadId) callbacks.onThreadId(event.threadId);
        if (event.finalText) finalText = event.finalText;
        if (event.errorMessage) stderr = `${stderr}\n${event.errorMessage}`.trim();
        if (event.progress) callbacks.onProgress(event.progress);
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (settled) return;
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > this.limits.maxOutputBytes || stdoutBuffer.length + chunk.length > this.limits.maxLineChars) { limitError = "Codex 输出超过安全上限，已停止；请核对执行结果。"; this.stop(); return; }
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-20000);
      });

      child.on("error", error => finish(new Error(`无法启动 Codex CLI：${error.message}`)));
      child.on("close", (code, signal) => {
        if (settled) return;
        if (stdoutBuffer.trim()) consumeLine(stdoutBuffer.trim());
        if (limitError) finish(new Error(limitError));
        else if (signal || this.cancelled) finish(new Error("Codex 执行已停止。"));
        else if (code !== 0) finish(new Error(cleanError(stderr) || `Codex CLI 退出码：${code}`));
        else if (!finalText) finish(new Error("Codex 已完成，但没有返回可显示的消息。"));
        else finish();
      });

      // CLI 早退时 stdin 可能报 EPIPE；收集为本次错误，避免未处理事件导致插件崩溃。
      child.stdin.on("error", (error) => { stderr = (stderr + "\n" + error.message).slice(-20000); });
      child.stdin.end(prompt);
    });
  }

  stop(): void {
    this.cancelled = true;
    const child = this.child;
    if (!child) return;
    const kill = (signal: NodeJS.Signals): void => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch { try { child.kill(signal); } catch {} }
    };
    kill("SIGTERM");
    // 子孙继承 stdio 时不能依赖 close；强制截止会销毁流并恰好结算一次。
    const force = this.forceFinish;
    const timer = setTimeout(() => { if (this.child === child) { kill("SIGKILL"); force?.(); } }, 2000);
    timer.unref();
  }

  get running(): boolean {
    return this.starting || this.child !== null;
  }
}

export function buildCodexArgs(settings: CodexExecutionSettings, vaultPath: string): string[] {
  const model = settings.model ? ["--model", settings.model] : [];
  if (settings.sessionId) {
    // 续聊也显式传模型并允许非 Git Vault；无需另一个包装脚本修补参数。
    const sandbox = ["-c", `sandbox_mode="${settings.sandboxMode}"`];
    const approvals = ["-c", 'approval_policy="on-request"', "-c",
      `approvals_reviewer="${settings.approveForMe && settings.sandboxMode === "workspace-write" ? "auto_review" : "user"}"`];
    // exec resume 会重新加载全局配置，不能依赖旧会话或本机全局权限来保证当前 Vault 边界。
    return ["exec", "resume", "--json", "--skip-git-repo-check", ...sandbox, ...approvals, ...model, settings.sessionId, "-"];
  }

  const approvalArgs = settings.approveForMe && settings.sandboxMode === "workspace-write"
    ? ["--approve-for-me"]
    : ["--sandbox", settings.sandboxMode];

  return [
    "exec",
    "--json",
    "--skip-git-repo-check",
    ...model,
    ...approvalArgs,
    "-c", 'approval_policy="on-request"',
    "-c", `approvals_reviewer="${settings.approveForMe && settings.sandboxMode === "workspace-write" ? "auto_review" : "user"}"`,
    "--cd",
    vaultPath,
    "-"
  ];
}

function cleanError(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter((line) => !line.includes("could not create PATH aliases"))
    .join("\n")
    .trim();
}
