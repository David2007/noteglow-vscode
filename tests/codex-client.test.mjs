import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCodexArgs, CodexClient } from "../src/codex-client.ts";

const executable = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));

test("streams normalized progress and returns the final response", async () => {
  const client = new CodexClient();
  const progress = [];
  const threads = [];
  const response = await client.send("hello", process.cwd(), settings(null), {
    onThreadId: (threadId) => threads.push(threadId),
    onStatus: () => undefined,
    onProgress: (event) => progress.push(event)
  });

  assert.equal(response, "已完成");
  assert.deepEqual(threads, ["thread-new"]);
  assert.deepEqual(progress.map((event) => event.label), [
    "Codex 正在处理",
    "正在执行命令",
    "命令执行完成",
    "Codex 已完成"
  ]);
  assert.equal(JSON.stringify(progress).includes("secret-command"), false);
  assert.equal(client.running, false);
});

test("uses the resume path when a session id exists", async () => {
  const client = new CodexClient();
  const response = await client.send("continue", process.cwd(), settings("existing"), {
    onThreadId: () => undefined,
    onStatus: () => undefined,
    onProgress: () => undefined
  });
  assert.equal(response, "已繼續");
});

test("never combines explicit sandbox and approve-for-me", () => {
  const writable = buildCodexArgs({
    ...settings(null),
    approveForMe: true,
    sandboxMode: "workspace-write"
  }, "/vault");
  assert.equal(writable.includes("--approve-for-me"), true);
  assert.equal(writable.includes("--sandbox"), false);

  const readOnly = buildCodexArgs({
    ...settings(null),
    approveForMe: true,
    sandboxMode: "read-only"
  }, "/vault");
  assert.equal(readOnly.includes("--approve-for-me"), false);
  assert.deepEqual(readOnly.slice(readOnly.indexOf("--sandbox"), readOnly.indexOf("--sandbox") + 2), [
    "--sandbox",
    "read-only"
  ]);
});

test("surfaces normalized turn failures", async () => {
  const client = new CodexClient();
  await assert.rejects(
    client.send("fail", process.cwd(), settings(null), {
      onThreadId: () => undefined,
      onStatus: () => undefined,
      onProgress: () => undefined
    }),
    /deterministic failure/
  );
  assert.equal(client.running, false);
});

test("stops an active process and remains reusable", async () => {
  const client = new CodexClient();
  const pending = client.send("wait", process.cwd(), settings(null), {
    onThreadId: () => undefined,
    onStatus: () => undefined,
    onProgress: () => undefined
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(client.running, true);
  client.stop();
  await assert.rejects(pending, /已停止/);
  assert.equal(client.running, false);

  const response = await client.send("hello", process.cwd(), settings(null), {
    onThreadId: () => undefined,
    onStatus: () => undefined,
    onProgress: () => undefined
  });
  assert.equal(response, "已完成");
});

function settings(sessionId) {
  return {
    codexPath: executable,
    sandboxMode: "read-only",
    approveForMe: false,
    sessionId,
    model: ""
  };
}

test("passes selected model on new and resumed turns without relaxing the sandbox", () => {
  for (const sessionId of [null, "existing"]) {
    const args = buildCodexArgs({ ...settings(sessionId), model: "gpt-6-luna" }, "/vault");
    assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "gpt-6-luna"]);
    assert.ok(args.includes("--skip-git-repo-check"));
    assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
    if (sessionId) {
      assert.ok(args.includes('sandbox_mode="read-only"'));
      assert.ok(args.includes('approval_policy="on-request"'));
      assert.ok(args.includes('approvals_reviewer="user"'));
    }
  }
});

test("fragmented unterminated JSONL returns only completed message", async()=>{
 const c=new CodexClient();assert.equal(await c.send("fragment",process.cwd(),settings(null),{onThreadId(){},onStatus(){},onProgress(){}}),"分片");
});
test("bounded output kills child and releases lock",async()=>{
 const c=new CodexClient({timeoutMs:5000,maxOutputBytes:1000,maxLineChars:1000});
 await assert.rejects(c.send("oversize",process.cwd(),settings(null),{onThreadId(){},onStatus(){},onProgress(){}}),/输出超过/);assert.equal(c.running,false);
});
test("deadline cancels running process, empty output and missing executable reject",async()=>{
 const cb={onThreadId(){},onStatus(){},onProgress(){}};
 const c=new CodexClient({timeoutMs:30,maxOutputBytes:4000000,maxLineChars:1000000});
 await assert.rejects(c.send("wait",process.cwd(),settings(null),cb),/超过/);assert.equal(c.running,false);
 const other=new CodexClient();await assert.rejects(other.send("empty",process.cwd(),settings(null),cb),/没有返回/);
 await assert.rejects(other.send("x",process.cwd(),{...settings(null),codexPath:"/does-not-exist/codex"},cb));assert.equal(other.running,false);
});

test('timeout settles even when wrapper descendants hold inherited stdio',async()=>{const c=new CodexClient({timeoutMs:250,maxOutputBytes:4000000,maxLineChars:1000000});const started=Date.now();await assert.rejects(c.send('descendant',process.cwd(),settings(null),{onThreadId(){},onStatus(){},onProgress(){}}),/超过/);assert.equal(c.running,false);assert.ok(Date.now()-started<6000);});

test('synchronous spawn argument failure does not poison the request lock',async()=>{const c=new CodexClient();const cb={onThreadId(){},onStatus(){},onProgress(){}};await assert.rejects(c.send('x',process.cwd(),{...settings(null),codexPath:'bad\0path'},cb),/无法启动/);assert.equal(c.running,false);assert.equal(await c.send('hello',process.cwd(),settings(null),cb),'已完成');});
