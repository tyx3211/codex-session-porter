import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cliPath, execFileAsync, writeJsonl } from "./test-support.js";

function extendedEventRows(): readonly unknown[] {
  return [
    {
      timestamp: "2026-04-23T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "session-events",
        timestamp: "2026-04-23T00:00:00.000Z",
        cwd: "/tmp/project",
        originator: "codex_vscode",
      },
    },
    {
      timestamp: "2026-04-23T00:00:00.500Z",
      type: "response_item",
      payload: {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          query: "codex timeline event lookup",
        },
      },
    },
    {
      timestamp: "2026-04-23T00:00:00.750Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: "turn_001",
        model_context_window: 258400,
        collaboration_mode_kind: "default",
      },
    },
    {
      timestamp: "2026-04-23T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_exec",
        command: ["/bin/bash", "-lc", "printf hi"],
        cwd: "/tmp/project",
        parsed_cmd: [{ type: "read", cmd: "printf hi" }],
        aggregated_output: "hi\n```js\nconsole.log(1);\n```\n",
        exit_code: 0,
        duration: { secs: 1, nanos: 250000000 },
        status: "completed",
      },
    },
    {
      timestamp: "2026-04-23T00:00:01.500Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_list",
        command: ["/bin/bash", "-lc", "fd . src"],
        cwd: "/tmp/project",
        parsed_cmd: [{ type: "list_files", cmd: "fd . src" }],
        aggregated_output: "src/index.ts\nsrc/render.ts\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 450000000 },
        status: "completed",
      },
    },
    {
      timestamp: "2026-04-23T00:00:01.750Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_unknown",
        command: ["/bin/bash", "-lc", "git status --short"],
        cwd: "/tmp/project",
        parsed_cmd: [{ type: "unknown", cmd: "git status --short" }],
        aggregated_output: " M src/render.ts\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 5000000 },
        status: "completed",
      },
    },
    {
      timestamp: "2026-04-23T00:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        call_id: "call_patch",
        success: true,
        stdout: "Success. Updated the following files:\nA demo.txt\n",
        stderr: "",
        changes: {
          "/tmp/project/demo.txt": {
            type: "add",
            content: "hello\nworld\n",
          },
        },
      },
    },
    {
      timestamp: "2026-04-23T00:00:02.500Z",
      type: "event_msg",
      payload: {
        type: "context_compacted",
      },
    },
    {
      timestamp: "2026-04-23T00:00:02.750Z",
      type: "event_msg",
      payload: {
        type: "thread_rolled_back",
        num_turns: 1,
      },
    },
    {
      timestamp: "2026-04-23T00:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "web_search_end",
        call_id: "ws_001",
        query: "codex timeline event lookup",
        action: {
          type: "search",
        },
      },
    },
    {
      timestamp: "2026-04-23T00:00:03.250Z",
      type: "event_msg",
      payload: {
        type: "mcp_tool_call_end",
        call_id: "mcp_001",
        invocation: {
          server: "pdf",
          tool: "answer-pdf-question",
          arguments: {
            filePath: "/tmp/spec.pdf",
            question: "What is the title?",
          },
        },
        duration: {
          secs: 3,
          nanos: 120000000,
        },
        result: {
          Ok: "Spec title is Demo",
        },
      },
    },
    {
      timestamp: "2026-04-23T00:00:03.500Z",
      type: "event_msg",
      payload: {
        type: "collab_agent_spawn_end",
        call_id: "spawn_001",
        new_agent_nickname: "Epicurus",
        new_agent_role: "default",
        prompt: "Summarize the spec",
      },
    },
    {
      timestamp: "2026-04-23T00:00:03.750Z",
      type: "event_msg",
      payload: {
        type: "collab_close_end",
        call_id: "close_001",
        receiver_agent_nickname: "Epicurus",
        receiver_agent_role: "default",
        status: {
          completed: "done",
        },
      },
    },
    {
      timestamp: "2026-04-23T00:00:04.000Z",
      type: "event_msg",
      payload: {
        type: "turn_aborted",
        reason: "interrupted",
      },
    },
    {
      timestamp: "2026-04-23T00:00:04.250Z",
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: "turn_001",
        last_agent_message: "done",
      },
    },
  ];
}

function legacyWorkflowRows(): readonly unknown[] {
  return [
    {
      timestamp: "2026-02-02T02:19:25.512Z",
      type: "session_meta",
      payload: {
        id: "legacy-workflow",
        timestamp: "2026-02-02T02:19:25.512Z",
        cwd: "/home/tyx/hdfs-learning",
        originator: "codex_vscode",
        cli_version: "0.92.0",
      },
    },
    {
      timestamp: "2026-02-02T02:19:25.600Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: "cd /home/tyx/hdfs-learning && nl -ba works/day2/depthv3.capnp | sed -n '1,20p'",
        }),
        call_id: "call_legacy_exec",
      },
    },
    {
      timestamp: "2026-02-02T02:19:25.700Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_legacy_exec",
        output:
          "Chunk ID: deadbeef\n" +
          "Wall time: 0.0512 seconds\n" +
          "Process exited with code 0\n" +
          "Output:\n" +
          "     1\t@0x885069b6aa49fd5c;\n" +
          "     2\tstruct DepthV3 {\n",
      },
    },
    {
      timestamp: "2026-02-02T02:41:45.626Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        status: "completed",
        call_id: "call_legacy_patch",
        name: "apply_patch",
        input:
          "*** Begin Patch\n" +
          "*** Update File: works/day2/Cpp/generate_depth.cpp\n" +
          "@@\n" +
          " struct LevelSnapshot {\n" +
          "     double price;\n" +
          "     int64_t volume;\n" +
          "+    int64_t order_count;\n" +
          " }\n" +
          "*** End Patch",
      },
    },
    {
      timestamp: "2026-02-02T02:41:51.908Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call_legacy_patch",
        output: JSON.stringify({
          output: "Success. Updated the following files:\nM works/day2/Cpp/generate_depth.cpp\n",
          metadata: {
            exit_code: 0,
            duration_seconds: 0,
          },
        }),
      },
    },
  ];
}

function extractEventRef(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = markdown.match(new RegExp(`${escaped}[\\s\\S]*?- event_ref：\`(E\\d{6})\``));
  assert.ok(match, `expected event_ref for ${heading}`);
  return match[1] || "";
}

function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = markdown.match(new RegExp(`(${escaped}[\\s\\S]*?)(?=\\n### |$)`));
  assert.ok(match, `expected section for ${heading}`);
  return match[1] || "";
}

test("--mode events renders the meaningful workflow events into markdown", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-events-"));
  const inputPath = path.join(tmpDir, "rollout-test.jsonl");
  const outputPath = path.join(tmpDir, "events.md");

  writeJsonl(inputPath, extendedEventRows());

  await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath,
    "--mode",
    "events",
    "--output",
    outputPath,
  ]);

  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.match(markdown, /### 网页搜索/);
  assert.match(markdown, /codex timeline event lookup/);
  assert.match(markdown, /### 任务开始/);
  assert.match(markdown, /### action：`read`/);
  const readSection = extractSection(markdown, "### action：`read`");
  assert.match(readSection, /- cwd：`\/tmp\/project`/);
  assert.match(readSection, /- cmd：\n\n~~~text\nprintf hi\n~~~/);
  assert.doesNotMatch(readSection, /- exit_code：`0`/);
  assert.match(markdown, /### action：`list_files`/);
  const listSection = extractSection(markdown, "### action：`list_files`");
  assert.match(listSection, /- cmd：\n\n~~~text\nfd \. src\n~~~/);
  assert.doesNotMatch(listSection, /- duration：`0\.450s`/);
  assert.match(markdown, /### 命令执行/);
  const unknownSection = extractSection(markdown, "### 命令执行");
  assert.match(unknownSection, /- cmd：\n\n~~~text\ngit status --short\n~~~/);
  assert.match(unknownSection, /- exit_code：`0`/);
  assert.match(unknownSection, /- duration：`0\.005s`/);
  assert.match(markdown, /- event_ref：`E\d{6}`/);
  assert.doesNotMatch(readSection, /#### output/);
  assert.doesNotMatch(listSection, /#### output/);
  assert.match(unknownSection, /~~~text\n M src\/render\.ts\n~~~/);
  assert.match(markdown, /### action：`edit_file`/);
  const editSection = extractSection(markdown, "### action：`edit_file`");
  assert.match(markdown, /- success：`true`/);
  assert.match(editSection, /- event_ref：`E\d{6}`/);
  assert.match(markdown, /#### add `\/tmp\/project\/demo\.txt`/);
  assert.match(markdown, /~~~diff\n--- \/dev\/null\n\+\+\+ \/tmp\/project\/demo\.txt\n\+hello\n\+world\n~~~/);
  assert.match(markdown, /### 上下文压缩/);
  assert.match(markdown, /### 线程回滚/);
  assert.match(markdown, /### 网页搜索完成/);
  assert.match(markdown, /### MCP 工具调用完成/);
  assert.match(markdown, /### 协作代理启动完成/);
  assert.match(markdown, /Epicurus/);
  assert.match(markdown, /### 协作代理关闭完成/);
  assert.match(markdown, /### 回合中断/);
  assert.match(markdown, /### 任务完成/);
});

test("default markdown mode keeps extended exec and patch events collapsed", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-default-"));
  const inputPath = path.join(tmpDir, "rollout-test.jsonl");
  const outputPath = path.join(tmpDir, "default.md");

  writeJsonl(inputPath, extendedEventRows());

  await execFileAsync(process.execPath, [cliPath, "--input", inputPath, "--output", outputPath]);

  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.doesNotMatch(markdown, /### 命令执行：/);
  assert.doesNotMatch(markdown, /### 补丁应用：/);
  assert.doesNotMatch(markdown, /~~~text\nhi/);
  assert.doesNotMatch(markdown, /### 网页搜索/);
});

test("--mode timeline keeps workflow events but hides command output and diff bodies", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-timeline-"));
  const inputPath = path.join(tmpDir, "rollout-test.jsonl");
  const outputPath = path.join(tmpDir, "timeline.md");

  writeJsonl(inputPath, extendedEventRows());

  await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath,
    "--mode",
    "timeline",
    "--output",
    outputPath,
  ]);

  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.match(markdown, /### action：`read`/);
  assert.match(markdown, /- event_ref：`E\d{6}`/);
  assert.doesNotMatch(markdown, /#### output/);
  assert.doesNotMatch(markdown, /console\.log\(1\)/);
  const readSection = extractSection(markdown, "### action：`read`");
  assert.match(readSection, /- cmd：\n\n~~~text\nprintf hi\n~~~/);
  assert.doesNotMatch(readSection, /- exit_code：`0`/);
  assert.match(markdown, /### 命令执行/);
  const unknownSection = extractSection(markdown, "### 命令执行");
  assert.match(unknownSection, /- exit_code：`0`/);
  assert.match(unknownSection, /- cmd：\n\n~~~text\ngit status --short\n~~~/);
  assert.doesNotMatch(unknownSection, /#### output/);
  assert.match(markdown, /#### add `\/tmp\/project\/demo\.txt`/);
  assert.match(markdown, /- diff_stat：`\+2 \/ -0`/);
  assert.doesNotMatch(markdown, /~~~diff/);
  assert.match(markdown, /### 上下文压缩/);
  assert.match(markdown, /### 协作代理关闭完成/);
});

test("legacy response_item workflow events are normalized in timeline mode", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-legacy-timeline-"));
  const inputPath = path.join(tmpDir, "legacy-rollout.jsonl");
  const outputPath = path.join(tmpDir, "timeline.md");

  writeJsonl(inputPath, legacyWorkflowRows());

  await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath,
    "--mode",
    "timeline",
    "--output",
    outputPath,
  ]);

  const markdown = fs.readFileSync(outputPath, "utf8");
  assert.match(markdown, /### 命令执行/);
  const commandSection = extractSection(markdown, "### 命令执行");
  const execRef = extractEventRef(markdown, "### 命令执行");
  assert.match(commandSection, /- event_ref：`E\d{6}`/);
  assert.match(commandSection, /- cwd：`\/home\/tyx\/hdfs-learning`/);
  assert.match(commandSection, /- exit_code：`0`/);
  assert.match(commandSection, /- cmd：\n\n~~~text\ncd \/home\/tyx\/hdfs-learning && nl -ba works\/day2\/depthv3\.capnp \| sed -n '1,20p'\n~~~/);
  assert.doesNotMatch(commandSection, /Chunk ID:/);
  assert.doesNotMatch(commandSection, /#### output/);

  assert.match(markdown, /### action：`edit_file`/);
  const editSection = extractSection(markdown, "### action：`edit_file`");
  const patchRef = extractEventRef(markdown, "### action：`edit_file`");
  assert.match(editSection, /- success：`true`/);
  assert.match(editSection, /- call_id：`call_legacy_patch`/);
  assert.match(editSection, /#### update `works\/day2\/Cpp\/generate_depth\.cpp`/);
  assert.match(editSection, /- diff_stat：`\+1 \/ -0`/);
  assert.doesNotMatch(markdown, /### 自定义工具调用：`apply_patch`/);
  assert.doesNotMatch(markdown, /### 自定义工具输出/);

  const scriptPath = path.join(
    process.cwd(),
    "skills",
    "cce-event-ref-lookup",
    "scripts",
    "reveal-event-ref.mjs",
  );

  const execReveal = await execFileAsync(process.execPath, [
    scriptPath,
    "--markdown",
    outputPath,
    "--event-ref",
    execRef,
  ]);
  assert.match(execReveal.stdout, /### 命令执行/);
  assert.match(execReveal.stdout, /struct DepthV3/);

  const patchReveal = await execFileAsync(process.execPath, [
    scriptPath,
    "--markdown",
    outputPath,
    "--event-ref",
    patchRef,
  ]);
  assert.match(patchReveal.stdout, /### action：`edit_file`/);
  assert.match(patchReveal.stdout, /\+    int64_t order_count;/);
});

test("timeline event_ref can be used to recover hidden exec output and diff details", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-event-ref-"));
  const inputPath = path.join(tmpDir, "rollout-test.jsonl");
  const timelinePath = path.join(tmpDir, "timeline.md");

  writeJsonl(inputPath, extendedEventRows());

  await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath,
    "--mode",
    "timeline",
    "--output",
    timelinePath,
  ]);

  const markdown = fs.readFileSync(timelinePath, "utf8");
  const execRef = extractEventRef(markdown, "### 命令执行");
  const patchRef = extractEventRef(markdown, "### action：`edit_file`");

  const scriptPath = path.join(
    process.cwd(),
    "skills",
    "cce-event-ref-lookup",
    "scripts",
    "reveal-event-ref.mjs",
  );

  const execReveal = await execFileAsync(process.execPath, [
    scriptPath,
    "--markdown",
    timelinePath,
    "--event-ref",
    execRef,
  ]);
  assert.match(execReveal.stdout, /### 命令执行/);
  assert.match(execReveal.stdout, /- cmd：\n\n~~~text\ngit status --short\n~~~/);
  assert.match(execReveal.stdout, / M src\/render\.ts/);

  const patchReveal = await execFileAsync(process.execPath, [
    scriptPath,
    "--markdown",
    timelinePath,
    "--event-ref",
    patchRef,
  ]);
  assert.match(patchReveal.stdout, /### action：`edit_file`/);
  assert.match(patchReveal.stdout, /\+hello/);
  assert.match(patchReveal.stdout, /\+world/);
});
