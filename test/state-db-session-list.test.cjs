const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
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

function writeRollout(codexDir, name, id, source, cwd, userMessage) {
  const filePath = path.join(codexDir, "sessions", "2026", "04", "24", name);
  writeJsonl(filePath, [
    {
      timestamp: "2026-04-24T01:02:03.000Z",
      type: "session_meta",
      payload: {
        id,
        timestamp: "2026-04-24T01:02:03.000Z",
        cwd,
        source,
      },
    },
    {
      timestamp: "2026-04-24T01:02:04.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: userMessage,
      },
    },
  ]);
  return filePath;
}

function createStateDb(codexDir, rows) {
  const dbPath = path.join(codexDir, "state_5.sqlite");
  const createSql = `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT,
      cli_version TEXT NOT NULL DEFAULT '',
      first_user_message TEXT NOT NULL DEFAULT '',
      agent_nickname TEXT,
      agent_role TEXT,
      memory_mode TEXT NOT NULL DEFAULT 'enabled',
      model TEXT,
      reasoning_effort TEXT,
      agent_path TEXT,
      created_at_ms INTEGER,
      updated_at_ms INTEGER
    )
  `;
  const insertSql = `
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, archived, cli_version, first_user_message,
      git_branch, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const script = `
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1]);
    const rows = JSON.parse(process.argv[2]);
    db.exec(${JSON.stringify(createSql)});
    const insert = db.prepare(${JSON.stringify(insertSql)});
    for (const row of rows) {
      insert.run(
        row.id,
        row.rolloutPath,
        row.createdAt,
        row.updatedAt,
        row.source,
        "openai",
        row.cwd,
        row.title,
        "danger-full-access",
        "never",
        row.archived ? 1 : 0,
        "test",
        row.firstUserMessage,
        row.gitBranch || null,
        row.createdAt * 1000,
        row.updatedAt * 1000,
      );
    }
    db.close();
  `;

  execFileSync(process.execPath, [
    "-e",
    script,
    dbPath,
    JSON.stringify(rows),
  ]);
}

function writeSessionIndex(codexDir, rows) {
  writeJsonl(
    path.join(codexDir, "session_index.jsonl"),
    rows.map((row) => ({
      id: row.id,
      thread_name: row.threadName,
      updated_at: row.updatedAt,
    })),
  );
}

test("--list uses Codex state DB to match resume filtering and display", async () => {
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-state-list-"));
  const named = writeRollout(
    codexDir,
    "rollout-2026-04-24T01-02-03-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "vscode",
    "/tmp/project-a",
    "first user for named row",
  );
  const unnamed = writeRollout(
    codexDir,
    "rollout-2026-04-24T02-02-03-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cli",
    "/tmp/project-b",
    "preview from first user row",
  );
  const subagent = writeRollout(
    codexDir,
    "rollout-2026-04-24T03-02-03-cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "subagent",
    "/tmp/project-c",
    "subagent should not appear",
  );
  const archived = writeRollout(
    codexDir,
    "rollout-2026-04-24T04-02-03-dddddddd-dddd-4ddd-8ddd-dddddddddddd.jsonl",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "vscode",
    "/tmp/project-d",
    "archived should not appear",
  );

  createStateDb(codexDir, [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      rolloutPath: named,
      createdAt: 1000,
      updatedAt: 4000,
      source: "vscode",
      cwd: "/tmp/project-a",
      title: "Indexed real thread name",
      firstUserMessage: "first user for named row",
      gitBranch: "main",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      rolloutPath: unnamed,
      createdAt: 1000,
      updatedAt: 3000,
      source: "cli",
      cwd: "/tmp/project-b",
      title: "preview from first user row",
      firstUserMessage: "preview from first user row",
    },
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      rolloutPath: subagent,
      createdAt: 1000,
      updatedAt: 2000,
      source: '{"subagent":{"thread_spawn":{"parent_thread_id":"x","depth":1}}}',
      cwd: "/tmp/project-c",
      title: "subagent title",
      firstUserMessage: "subagent should not appear",
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      rolloutPath: archived,
      createdAt: 1000,
      updatedAt: 1000,
      source: "vscode",
      cwd: "/tmp/project-d",
      title: "archived title",
      firstUserMessage: "archived should not appear",
      archived: true,
    },
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      rolloutPath: path.join(codexDir, "sessions", "missing.jsonl"),
      createdAt: 1000,
      updatedAt: 5000,
      source: "vscode",
      cwd: "/tmp/project-missing",
      title: "missing file title",
      firstUserMessage: "missing file should not appear",
    },
  ]);

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "--codex-dir", codexDir, "--list", "--display", "thread"],
    { env: { ...process.env, NODE_NO_WARNINGS: "1" } },
  );

  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Indexed real thread name/);
  assert.match(lines[0], /cwd=\/tmp\/project-a/);
  assert.match(lines[0], /branch=main/);
  assert.match(lines[1], /preview from first user row/);
  assert.match(lines[1], /cwd=\/tmp\/project-b/);
  assert.doesNotMatch(stdout, /subagent should not appear/);
  assert.doesNotMatch(stdout, /archived should not appear/);
  assert.doesNotMatch(stdout, /missing file should not appear/);
  assert.doesNotMatch(stdout, /\[未命名\]/);
});

test("--list uses session_index thread names when state DB title is only the first user message", async () => {
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-chat-cli-state-index-name-"));
  const distinct = writeRollout(
    codexDir,
    "rollout-2026-04-24T05-02-03-ffffffff-ffff-4fff-8fff-ffffffffffff.jsonl",
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "vscode",
    "/tmp/project-distinct",
    "state title first message",
  );
  const indexed = writeRollout(
    codexDir,
    "rollout-2026-04-24T06-02-03-11111111-1111-4111-8111-111111111111.jsonl",
    "11111111-1111-4111-8111-111111111111",
    "cli",
    "/tmp/project-indexed",
    "long first user message should not be the displayed conversation name",
  );

  createStateDb(codexDir, [
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      rolloutPath: distinct,
      createdAt: 1000,
      updatedAt: 5000,
      source: "vscode",
      cwd: "/tmp/project-distinct",
      title: "State DB distinct title",
      firstUserMessage: "state title first message",
    },
    {
      id: "11111111-1111-4111-8111-111111111111",
      rolloutPath: indexed,
      createdAt: 1000,
      updatedAt: 6000,
      source: "cli",
      cwd: "/tmp/project-indexed",
      title: "long first user message should not be the displayed conversation name",
      firstUserMessage: "long first user message should not be the displayed conversation name",
    },
  ]);
  writeSessionIndex(codexDir, [
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      threadName: "Legacy must not override state title",
      updatedAt: "2026-04-24T05:30:00Z",
    },
    {
      id: "11111111-1111-4111-8111-111111111111",
      threadName: "Older legacy thread name",
      updatedAt: "2026-04-24T06:00:00Z",
    },
    {
      id: "11111111-1111-4111-8111-111111111111",
      threadName: "Latest legacy thread name",
      updatedAt: "2026-04-24T06:30:00Z",
    },
  ]);

  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, "--codex-dir", codexDir, "--list", "--display", "thread"],
    { env: { ...process.env, NODE_NO_WARNINGS: "1" } },
  );

  assert.match(stdout, /Latest legacy thread name/);
  assert.match(stdout, /State DB distinct title/);
  assert.doesNotMatch(stdout, /Older legacy thread name/);
  assert.doesNotMatch(stdout, /Legacy must not override state title/);
  assert.doesNotMatch(stdout, /long first user message should not be the displayed conversation name/);
});
