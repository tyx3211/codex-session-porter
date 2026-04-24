const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("thread prefix export names keep a UTF-8-safe 50 byte prefix", async () => {
  const cli = await import("../dist/index.js");
  const sessionInfo = {
    filePath:
      "/tmp/rollout-2026-04-24T01-02-03-11111111-1111-4111-8111-111111111111.jsonl",
    displayInfo: {
      threadName: "会话标题会话标题会话标题会话标题会话标题会话标题",
    },
  };

  const fileName = cli.tuiExportFileName(sessionInfo, {
    format: "markdown",
    namingMode: "thread-prefix",
  });
  const prefix = fileName.split("-rollout-")[0];

  assert.ok(Buffer.byteLength(prefix, "utf8") <= 50);
  assert.doesNotThrow(() => Buffer.from(prefix, "utf8").toString("utf8"));
  assert.match(fileName, /-rollout-2026-04-24T01-02-03-11111111-1111-4111-8111-111111111111\.md$/);
});

test("thread prefix export names fall back to original session name when no thread name exists", async () => {
  const cli = await import("../dist/index.js");
  const sessionInfo = {
    filePath:
      "/tmp/rollout-2026-04-24T01-02-03-11111111-1111-4111-8111-111111111111.jsonl",
    displayInfo: {
      preview: "raw first user message",
    },
  };

  assert.equal(
    cli.tuiExportFileName(sessionInfo, {
      format: "markdown",
      namingMode: "thread-prefix",
    }),
    "rollout-2026-04-24T01-02-03-11111111-1111-4111-8111-111111111111.md",
  );
});

test("tui output paths always treat the selected output as a directory", async () => {
  const cli = await import("../dist/index.js");
  const sessionInfo = {
    filePath:
      "/tmp/rollout-2026-04-24T01-02-03-11111111-1111-4111-8111-111111111111.jsonl",
    displayInfo: {
      threadName: "Named Session",
    },
  };

  assert.equal(
    cli.resolveTuiOutputPath(sessionInfo, "/tmp/cce-out", {
      format: "markdown",
      namingMode: "original",
    }),
    path.join(
      "/tmp/cce-out",
      "rollout-2026-04-24T01-02-03-11111111-1111-4111-8111-111111111111.md",
    ),
  );
});
