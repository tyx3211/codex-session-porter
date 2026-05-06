import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { expectRecordProperty, expectStringProperty, readJsonObject, repoRoot } from "./test-support.js";

const packagePath = path.join(repoRoot, "package.json");
const sessionsSourcePath = path.join(repoRoot, "src", "sessions.ts");

test("project supports Node 20 through better-sqlite3 instead of node:sqlite", () => {
  const pkg = readJsonObject(packagePath);
  const engines = expectRecordProperty(pkg, "engines");
  const dependencies = expectRecordProperty(pkg, "dependencies");
  const source = fs.readFileSync(sessionsSourcePath, "utf8");

  assert.equal(expectStringProperty(engines, "node"), ">=20");
  assert.equal(typeof dependencies["better-sqlite3"], "string");
  assert.doesNotMatch(source, /node:sqlite/);
  assert.match(source, /better-sqlite3/);
});
