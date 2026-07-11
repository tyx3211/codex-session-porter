import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cliPath, execFileAsync, writeJsonl } from "./test-support.js";

test("html export builds a safe prompt-indexed session reader", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-html-"));
  const inputPath = path.join(tmpDir, "rollout-html.jsonl");
  const outputPath = path.join(tmpDir, "session.html");

  writeJsonl(inputPath, [
    {
      timestamp: "2026-07-11T01:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "请实现 **HTML 导出** <script data-evil>alert('x')</script>",
      },
    },
    {
      timestamp: "2026-07-11T01:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "已经 **完成**。\n\n```ts\nconst format = 'html';\n```",
      },
    },
    {
      timestamp: "2026-07-11T01:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "请验证第二个 Prompt",
      },
    },
    {
      timestamp: "2026-07-11T01:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "验证通过。",
      },
    },
  ]);

  await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath,
    "--format",
    "html",
    "--mode",
    "timeline",
    "--output",
    outputPath,
  ]);

  const html = fs.readFileSync(outputPath, "utf8");
  assert.match(html, /^<!doctype html>/u);
  assert.match(html, /data-role="prompt-navigation"/u);
  assert.match(html, /href="#prompt-1"/u);
  assert.match(html, /href="#prompt-2"/u);
  assert.match(html, /data-prompt-search="请实现 html 导出/u);
  assert.match(html, /data-prompt-search="请验证第二个 prompt"/u);
  assert.match(html, /id="prompt-1" class="turn turn-user" data-prompt-section/u);
  assert.match(html, /请验证第二个 Prompt/u);
  assert.match(html, /<strong>完成<\/strong>/u);
  assert.match(html, /<code class="language-ts">const format = 'html';/u);
  assert.match(html, /&lt;script data-evil&gt;alert\('x'\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script data-evil>/u);
  assert.match(html, /IntersectionObserver/u);
  assert.match(html, /data-prompt-filter/u);
});

test("html export uses an html extension for directory output", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-html-name-"));
  const inputPath = path.join(tmpDir, "rollout-html-name.jsonl");
  const outputDir = path.join(tmpDir, "exports");

  writeJsonl(inputPath, [
    {
      timestamp: "2026-07-11T01:00:00.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "扩展名测试" },
    },
  ]);
  fs.mkdirSync(outputDir);

  await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath,
    "--format",
    "html",
    "--output",
    outputDir,
  ]);

  assert.ok(fs.existsSync(path.join(outputDir, "rollout-html-name.html")));
});
