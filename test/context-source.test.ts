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
        role: "developer",
        content: [{ type: "input_text", text: "开发者规则：保持中文输出" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions for /tmp/context-project\n- 始终使用中文输出" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:02.500Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/tmp/context-project</cwd>\n</environment_context>" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "最早问题" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "最早回答" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:05.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: "{\"cmd\":\"printf hidden\"}",
        call_id: "call_hidden_exec",
      },
    },
    {
      timestamp: "2026-05-06T00:00:05.500Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_hidden_exec",
        output: "COMMAND_OUTPUT_ONLY\n",
      },
    },
    {
      timestamp: "2026-05-06T00:00:06.000Z",
      type: "compacted",
      payload: {
        message: "压缩摘要",
        replacement_history: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "压缩后问题" }],
          },
          {
            type: "compaction",
            encrypted_content: "opaque-compaction-payload",
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "压缩后回答" }],
          },
        ],
      },
    },
    {
      timestamp: "2026-05-06T00:00:08.000Z",
      type: "event_msg",
      payload: {
        type: "context_compacted",
      },
    },
    {
      timestamp: "2026-05-06T00:00:09.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: "{\"cmd\":\"printf after_compact\"}",
        call_id: "call_after_compact_exec",
      },
    },
    {
      timestamp: "2026-05-06T00:00:09.500Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_after_compact_exec",
        output: "AFTER_COMPACT_OUTPUT_ONLY\n",
      },
    },
    {
      timestamp: "2026-05-06T00:00:10.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<permissions instructions>\n不要作为接续正文保留\n</permissions instructions>" }],
      },
    },
    {
      timestamp: "2026-05-06T00:00:10.500Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<plugins_instructions>\n插件运行时注入\n</plugins_instructions>" }],
      },
    },
  ];
}

test("--source context exports prompt-candidate markdown history for newer rollout rows", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-context-"));
  const inputPath = path.join(tmpDir, "rollout-context.jsonl");
  const contextPath = path.join(tmpDir, "context.md");

  writeJsonl(inputPath, contextSourceRows());

  await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath,
    "--source",
    "context",
    "--mode",
    "timeline",
    "--output",
    contextPath,
  ]);

  const contextMarkdown = fs.readFileSync(contextPath, "utf8");
  assert.doesNotMatch(contextMarkdown, /开发者规则：保持中文输出/);
  assert.doesNotMatch(contextMarkdown, /# AGENTS\.md instructions for/);
  assert.doesNotMatch(contextMarkdown, /<environment_context>/);
  assert.doesNotMatch(contextMarkdown, /最早问题/);
  assert.doesNotMatch(contextMarkdown, /最早回答/);
  assert.doesNotMatch(contextMarkdown, /printf hidden/);
  assert.match(contextMarkdown, /压缩摘要/);
  assert.match(contextMarkdown, /压缩后问题/);
  assert.match(contextMarkdown, /压缩后回答/);
  assert.match(contextMarkdown, /### 命令执行/);
  assert.match(contextMarkdown, /~~~text\nprintf after_compact\n~~~/);
  assert.doesNotMatch(contextMarkdown, /### 上下文压缩/);
  assert.doesNotMatch(contextMarkdown, /COMMAND_OUTPUT_ONLY/);
  assert.doesNotMatch(contextMarkdown, /AFTER_COMPACT_OUTPUT_ONLY/);
  assert.doesNotMatch(contextMarkdown, /<permissions instructions>/);
  assert.doesNotMatch(contextMarkdown, /<plugins_instructions>/);
});
