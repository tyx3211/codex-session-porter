const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const cliPath = path.resolve(__dirname, "..", "dist", "cli.js");

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function extendedEventRows() {
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
      timestamp: "2026-04-23T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_exec",
        command: ["/bin/bash", "-lc", "printf hi"],
        cwd: "/tmp/project",
        parsed_cmd: [{ type: "unknown", cmd: "printf hi" }],
        aggregated_output: "hi\n```js\nconsole.log(1);\n```\n",
        exit_code: 0,
        duration: { secs: 1, nanos: 250000000 },
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
  ];
}

test("--mode events renders extended exec and patch events into markdown", async () => {
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
  assert.match(markdown, /### 命令执行：`printf hi`/);
  assert.match(markdown, /- cwd：`\/tmp\/project`/);
  assert.match(markdown, /- exit_code：`0`/);
  assert.match(markdown, /- duration：`1\.250s`/);
  assert.match(markdown, /~~~text\nhi\n```js\nconsole\.log\(1\);\n```\n~~~/);
  assert.match(markdown, /### 补丁应用：`call_patch`/);
  assert.match(markdown, /- success：`true`/);
  assert.match(markdown, /#### add `\/tmp\/project\/demo\.txt`/);
  assert.match(markdown, /~~~diff\n--- \/dev\/null\n\+\+\+ \/tmp\/project\/demo\.txt\n\+hello\n\+world\n~~~/);
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
});
