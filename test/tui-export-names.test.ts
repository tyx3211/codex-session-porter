import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { distModuleUrl, isRecord } from "./test-support.js";

type ExportFormat = "markdown" | "jsonl";
type NamingMode = "original" | "thread-prefix";

interface ExportModule {
  tuiExportFileName(
    sessionInfo: { filePath: string; displayInfo?: { threadName?: string; preview?: string } },
    opts: { format: ExportFormat; namingMode: NamingMode },
  ): string;
  resolveTuiOutputPath(
    sessionInfo: { filePath: string; displayInfo?: { threadName?: string; preview?: string } },
    outputDir: string,
    opts: { format: ExportFormat; namingMode: NamingMode },
  ): string;
}

function isExportModule(value: unknown): value is ExportModule {
  if (!isRecord(value)) return false;

  return typeof value.tuiExportFileName === "function" && typeof value.resolveTuiOutputPath === "function";
}

/**
 * 这里是测试层自己的动态模块边界：
 * 1. 测试会先被编译到 `test-js/`，因此不能再依赖静态相对路径去找 `dist/index.js`；
 * 2. 运行时动态导入得到的值先按 `unknown` 处理，再在这里验证出我们真正要用的两个导出函数；
 * 3. 一旦导入结果不符合预期，就立刻抛错，避免把错误拖到后面的断言里。
 */
async function loadExportModule(): Promise<ExportModule> {
  const moduleValue: unknown = await import(distModuleUrl("index.js"));
  if (!isExportModule(moduleValue)) {
    throw new TypeError("Expected dist/index.js to expose tui export helpers");
  }

  return moduleValue;
}

test("thread prefix export names keep a UTF-8-safe 50 byte prefix", async () => {
  const cli = await loadExportModule();
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
  const cli = await loadExportModule();
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
  const cli = await loadExportModule();
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
