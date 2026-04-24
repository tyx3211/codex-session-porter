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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function writeSession(codexDir) {
  const sessionPath = path.join(
    codexDir,
    "sessions",
    "2026",
    "04",
    "24",
    "rollout-2026-04-24T01-02-03-11111111-1111-4111-8111-111111111111.jsonl",
  );
  writeJsonl(sessionPath, [
    {
      timestamp: "2026-04-24T01:02:03.000Z",
      type: "session_meta",
      payload: {
        id: "11111111-1111-4111-8111-111111111111",
        timestamp: "2026-04-24T01:02:03.000Z",
        cwd: "/tmp/project",
        source: "vscode",
      },
    },
    {
      timestamp: "2026-04-24T01:02:04.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "first user request",
      },
    },
    {
      timestamp: "2026-04-24T01:02:05.000Z",
      type: "event_msg",
      payload: {
        type: "thread_name_updated",
        thread_name: "Named export session",
      },
    },
  ]);
  return sessionPath;
}

function writeSessionWithoutThreadName(codexDir) {
  const sessionPath = path.join(
    codexDir,
    "sessions",
    "2026",
    "04",
    "24",
    "rollout-2026-04-24T02-02-03-22222222-2222-4222-8222-222222222222.jsonl",
  );
  writeJsonl(sessionPath, [
    {
      timestamp: "2026-04-24T02:02:03.000Z",
      type: "session_meta",
      payload: {
        id: "22222222-2222-4222-8222-222222222222",
        timestamp: "2026-04-24T02:02:03.000Z",
        cwd: "/tmp/project",
        source: "vscode",
      },
    },
    {
      timestamp: "2026-04-24T02:02:04.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "this raw first user message must not become the display title",
      },
    },
  ]);
  return sessionPath;
}

function writeSessionWithLateThreadName(codexDir) {
  const sessionPath = path.join(
    codexDir,
    "sessions",
    "2026",
    "04",
    "24",
    "rollout-2026-04-24T03-02-03-33333333-3333-4333-8333-333333333333.jsonl",
  );
  const rows = [
    {
      timestamp: "2026-04-24T03:02:03.000Z",
      type: "session_meta",
      payload: {
        id: "33333333-3333-4333-8333-333333333333",
        timestamp: "2026-04-24T03:02:03.000Z",
        cwd: "/tmp/project",
        source: "vscode",
      },
    },
    {
      timestamp: "2026-04-24T03:02:04.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "first user fallback",
      },
    },
  ];

  for (let i = 0; i < 3100; i += 1) {
    rows.push({
      timestamp: "2026-04-24T03:02:05.000Z",
      type: "response_item",
      payload: {
        type: "reasoning",
        summary: [],
      },
    });
  }

  rows.push({
    timestamp: "2026-04-24T03:02:06.000Z",
    type: "event_msg",
    payload: {
      type: "thread_name_updated",
      thread_name: "Late real thread name",
    },
  });
  writeJsonl(sessionPath, rows);
  return sessionPath;
}

test("--list --display thread shows thread names instead of only rollout file names", async () => {
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-list-thread-"));
  const sessionPath = writeSession(codexDir);

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "--codex-dir",
    codexDir,
    "--list",
    "--display",
    "thread",
  ]);

  assert.match(stdout, /Named export session/);
  assert.doesNotMatch(stdout, new RegExp(path.basename(sessionPath)));
});

test("--list --display file shows rollout file names", async () => {
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-list-file-"));
  const sessionPath = writeSession(codexDir);

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "--codex-dir",
    codexDir,
    "--list",
    "--display",
    "file",
  ]);

  assert.match(stdout, new RegExp(path.basename(sessionPath)));
  assert.doesNotMatch(stdout, /Named export session/);
});

test("--list --display thread scans the full rollout for late thread names", async () => {
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-late-thread-"));
  const sessionPath = writeSessionWithLateThreadName(codexDir);

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "--codex-dir",
    codexDir,
    "--list",
    "--display",
    "thread",
  ]);

  assert.match(stdout, /Late real thread name/);
  assert.doesNotMatch(stdout, new RegExp(path.basename(sessionPath)));
});

test("--list --display thread uses first user preview when no thread name exists", async () => {
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-unnamed-thread-"));
  const sessionPath = writeSessionWithoutThreadName(codexDir);

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "--codex-dir",
    codexDir,
    "--list",
    "--display",
    "thread",
  ]);

  assert.match(stdout, /this raw first user message must not become the display title/);
  assert.doesNotMatch(stdout, /\[未命名\]/);
  assert.doesNotMatch(stdout, new RegExp(path.basename(sessionPath)));
});
