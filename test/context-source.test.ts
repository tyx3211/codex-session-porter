import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cliPath, execFileAsync, writeJsonl } from "./test-support.js";

function contextSourceRows(): readonly unknown[] {
  return [
    {
      timestamp: "2026-05-06T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "session-context",
        timestamp: "2026-05-06T00:00:00.000Z",
        cwd: "/tmp/context-project",
        originator: "codex_vscode",
      },
    },
    {
      timestamp: "2026-05-06T00:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "被压缩掉的最早问题" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "被压缩掉的最早回答" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "压缩后仍应保留的问题" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "压缩后仍应保留的回答" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:05.000Z",
      type: "compacted",
      payload: {
        message: "压缩摘要",
        replacement_history: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "压缩摘要" }],
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "压缩后仍应保留的问题" }],
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "压缩后仍应保留的回答" }],
          },
        ],
      },
    },
    {
      timestamp: "2026-05-06T00:00:06.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "这轮会被回滚的用户消息" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:07.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "这轮会被回滚的助手消息" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:08.000Z",
      type: "event_msg",
      payload: {
        type: "thread_rolled_back",
        num_turns: 1,
      },
    },
  ];
}

test("--source context exports only the latest effective context after compaction and rollback", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-context-"));
  const inputPath = path.join(tmpDir, "rollout-context.jsonl");
  const historyPath = path.join(tmpDir, "history.md");
  const contextPath = path.join(tmpDir, "context.md");

  writeJsonl(inputPath, contextSourceRows());

  await execFileAsync(process.execPath, [cliPath, "--input", inputPath, "--output", historyPath]);

  await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath,
    "--source",
    "context",
    "--output",
    contextPath,
  ]);

  const historyMarkdown = fs.readFileSync(historyPath, "utf8");
  const contextMarkdown = fs.readFileSync(contextPath, "utf8");

  assert.match(historyMarkdown, /被压缩掉的最早问题/);
  assert.match(historyMarkdown, /这轮会被回滚的用户消息/);

  assert.match(contextMarkdown, /压缩摘要/);
  assert.match(contextMarkdown, /压缩后仍应保留的问题/);
  assert.match(contextMarkdown, /压缩后仍应保留的回答/);
  assert.doesNotMatch(contextMarkdown, /被压缩掉的最早问题/);
  assert.doesNotMatch(contextMarkdown, /被压缩掉的最早回答/);
  assert.doesNotMatch(contextMarkdown, /这轮会被回滚的用户消息/);
  assert.doesNotMatch(contextMarkdown, /这轮会被回滚的助手消息/);
});
