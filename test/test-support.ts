import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

/**
 * 这里集中放测试层自己的运行时边界与小型工具：
 * 1. ESM 测试不再依赖 `__dirname`，统一从 `import.meta.url` 反推仓库路径；
 * 2. `JSON.parse` 的结果一律先当成 `unknown`，再在这里缩小成对象；
 * 3. 需要动态导入 `dist` 产物时，也统一从这里构造绝对 file URL，
 *    避免测试编译到 `test-js/` 后，相对路径指向发生漂移。
 */
export const testDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(testDir, "..");
export const cliPath = path.join(repoRoot, "dist", "cli.js");
export const execFileAsync = promisify(execFile);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readJsonObject(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new TypeError(`Expected JSON object in ${filePath}`);
  }

  return parsed;
}

export function expectRecordProperty(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new TypeError(`Expected ${key} to be an object`);
  }

  return value;
}

export function expectStringProperty(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }

  return value;
}

export function writeJsonl(filePath: string, rows: readonly unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

export function distModuleUrl(fileName: string): string {
  return pathToFileURL(path.join(repoRoot, "dist", fileName)).href;
}
