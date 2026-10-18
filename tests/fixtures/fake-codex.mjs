#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  if (prompt.includes("descendant")) { spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:["ignore","inherit","inherit"]}); return; }
  if (prompt.includes("oversize")) { process.stdout.write("x".repeat(20000)); setInterval(() => {}, 1000); return; }
  if (prompt.includes("empty")) return;
  if (prompt.includes("fragment")) { process.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"分'); setTimeout(() => process.stdout.write('片"}}'), 5); return; }
  if (prompt.includes("wait")) {
    setInterval(() => undefined, 1_000);
    return;
  }
  if (prompt.includes("fail")) {
    process.stdout.write(`${JSON.stringify({
      type: "turn.failed",
      error: { message: "deterministic failure" }
    })}\n`);
    process.exitCode = 2;
    return;
  }
  const resumed = process.argv.includes("resume");
  const paths = process.argv.flatMap((arg,index) => arg === "--image" ? [process.argv[index + 1]] : []);
  const imageResult = prompt.includes("verify-images") ? JSON.stringify({ args:process.argv.slice(2), images:paths.map(path => createHash("sha256").update(readFileSync(path)).digest("hex")) }) : null;
  const events = [
    { type: "thread.started", thread_id: resumed ? "thread-resumed" : "thread-new" },
    { type: "turn.started" },
    { type: "item.started", item: { type: "command_execution", command: "secret-command" } },
    { type: "item.completed", item: { type: "command_execution", exit_code: 0 } },
    { type: "item.completed", item: { type: "agent_message", text: imageResult ?? (resumed ? "已繼續" : "已完成") } },
    { type: "turn.completed" }
  ];
  for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
});
