import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cliPath, execFileAsync, writeJsonl } from "./test-support.js";

function handoffRows(): readonly unknown[] {
  return [
    {
      timestamp: "2026-05-26T01:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "handoff-session",
        timestamp: "2026-05-26T01:00:00.000Z",
        cwd: "/tmp/handoff-project",
        originator: "codex_vscode",
        cli_version: "0.133.0",
      },
    },
    {
      timestamp: "2026-05-26T01:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "thread_name_updated",
        thread_name: "验证 provider 切换接续包",
      },
    },
    {
      timestamp: "2026-05-26T01:00:02.000Z",
      type: "turn_context",
      payload: {
        cwd: "/tmp/handoff-project",
        model: "gpt-5.3-codex",
        approval_policy: "never",
        sandbox_policy: {
          type: "danger-full-access",
        },
      },
    },
    {
      timestamp: "2026-05-26T01:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "继续完成 handoff 功能" }],
      },
    },
    {
      timestamp: "2026-05-26T01:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "我会先补测试。" }],
      },
    },
    {
      timestamp: "2026-05-26T01:00:05.000Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "exec_1",
        command: ["/bin/bash", "-lc", "npm test"],
        cwd: "/tmp/handoff-project",
        parsed_cmd: [{ type: "unknown", cmd: "npm test" }],
        aggregated_output: "ok\n",
        exit_code: 0,
        duration: { secs: 1, nanos: 0 },
        status: "completed",
      },
    },
  ];
}

function listPackageFiles(packageDir: string): string[] {
  return fs.readdirSync(packageDir).sort();
}

test("handoff command exports a self-contained package for direct input", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-handoff-"));
  const inputPath = path.join(tmpDir, "rollout-handoff.jsonl");
  const outDir = path.join(tmpDir, "handoff");
  const sourceText = handoffRows().map((row) => JSON.stringify(row)).join("\n") + "\n";

  writeJsonl(inputPath, handoffRows());

  await execFileAsync(process.execPath, [
    cliPath,
    "handoff",
    "--input",
    inputPath,
    "--output",
    outDir,
  ]);

  const packageDirs = fs.readdirSync(outDir);
  assert.equal(packageDirs.length, 1);

  const packageDir = path.join(outDir, packageDirs[0] || "");
  assert.deepEqual(listPackageFiles(packageDir), [
    "README.md",
    "context-timeline.md",
    "history-events.md",
    "history-timeline.md",
    "source.jsonl",
  ]);

  assert.equal(fs.readFileSync(path.join(packageDir, "source.jsonl"), "utf8"), sourceText);

  const readme = fs.readFileSync(path.join(packageDir, "README.md"), "utf8");
  assert.match(readme, /Provider Handoff 接续包/);
  assert.match(readme, /验证 provider 切换接续包/);
  assert.match(readme, /\/tmp\/handoff-project/);
  assert.match(readme, /context-timeline\.md -> history-timeline\.md -> history-events\.md/);
  assert.match(readme, /event_ref/);
  assert.match(readme, /source\.jsonl/);

  const contextTimeline = fs.readFileSync(path.join(packageDir, "context-timeline.md"), "utf8");
  const historyTimeline = fs.readFileSync(path.join(packageDir, "history-timeline.md"), "utf8");
  const historyEvents = fs.readFileSync(path.join(packageDir, "history-events.md"), "utf8");

  assert.match(contextTimeline, /- 源文件：`.*source\.jsonl#context`/);
  assert.match(historyTimeline, /- 源文件：`.*source\.jsonl`/);
  assert.match(historyEvents, /- 源文件：`.*source\.jsonl`/);
  assert.match(historyTimeline, /### 命令执行/);
  assert.doesNotMatch(historyTimeline, /~~~text\nok\n~~~/);
  assert.match(historyEvents, /~~~text\nok\n~~~/);
});

test("handoff command creates one package per picked session", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-handoff-many-"));
  const codexDir = path.join(tmpDir, ".codex");
  const sessionDir = path.join(codexDir, "sessions", "2026", "05", "26");
  const firstPath = path.join(sessionDir, "rollout-first.jsonl");
  const secondPath = path.join(sessionDir, "rollout-second.jsonl");
  const outDir = path.join(tmpDir, "handoff");

  writeJsonl(firstPath, handoffRows());
  writeJsonl(secondPath, [
    {
      timestamp: "2026-05-26T02:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "handoff-session-2",
        timestamp: "2026-05-26T02:00:00.000Z",
        cwd: "/tmp/handoff-project-2",
        originator: "codex_vscode",
      },
    },
  ]);

  fs.utimesSync(firstPath, new Date("2026-05-26T03:00:00.000Z"), new Date("2026-05-26T03:00:00.000Z"));
  fs.utimesSync(secondPath, new Date("2026-05-26T02:00:00.000Z"), new Date("2026-05-26T02:00:00.000Z"));

  await execFileAsync(process.execPath, [
    cliPath,
    "handoff",
    "--codex-dir",
    codexDir,
    "--pick",
    "1,2",
    "--output",
    outDir,
  ]);

  const packageDirs = fs.readdirSync(outDir);
  assert.equal(packageDirs.length, 2);

  for (const packageName of packageDirs) {
    assert.ok(fs.existsSync(path.join(outDir, packageName, "README.md")));
    assert.ok(fs.existsSync(path.join(outDir, packageName, "source.jsonl")));
  }
});

test("handoff command exports the latest discovered session", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-handoff-latest-"));
  const codexDir = path.join(tmpDir, ".codex");
  const sessionDir = path.join(codexDir, "sessions", "2026", "05", "26");
  const olderPath = path.join(sessionDir, "rollout-older.jsonl");
  const latestPath = path.join(sessionDir, "rollout-latest.jsonl");
  const outDir = path.join(tmpDir, "handoff");

  writeJsonl(olderPath, [
    {
      timestamp: "2026-05-25T01:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "older-session",
        timestamp: "2026-05-25T01:00:00.000Z",
        cwd: "/tmp/older",
      },
    },
  ]);
  writeJsonl(latestPath, handoffRows());

  fs.utimesSync(olderPath, new Date("2026-05-25T01:00:00.000Z"), new Date("2026-05-25T01:00:00.000Z"));
  fs.utimesSync(latestPath, new Date("2026-05-26T01:00:00.000Z"), new Date("2026-05-26T01:00:00.000Z"));

  await execFileAsync(process.execPath, [
    cliPath,
    "handoff",
    "--codex-dir",
    codexDir,
    "--latest",
    "--output",
    outDir,
  ]);

  const packageDirs = fs.readdirSync(outDir);
  assert.equal(packageDirs.length, 1);

  const readme = fs.readFileSync(path.join(outDir, packageDirs[0] || "", "README.md"), "utf8");
  assert.match(readme, /handoff-session/);
  assert.doesNotMatch(readme, /older-session/);
});
