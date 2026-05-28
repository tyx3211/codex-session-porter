import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { expectRecordProperty, readJsonObject, repoRoot } from "./test-support.js";

const packagePath = path.join(repoRoot, "package.json");
const tuiSourcePath = path.join(repoRoot, "src", "tui.tsx");

test("tui declares React Ink dependencies instead of enquirer", () => {
  const pkg = readJsonObject(packagePath);
  const dependencies = expectRecordProperty(pkg, "dependencies");

  assert.equal(typeof dependencies.ink, "string");
  assert.equal(typeof dependencies.react, "string");
  assert.equal(dependencies.enquirer, undefined);
});

test("tui source keeps a bounded visible window", () => {
  const source = fs.readFileSync(tuiSourcePath, "utf8");

  assert.match(source, /visibleRows/);
  assert.match(source, /wrap="truncate-end"/);
  assert.doesNotMatch(source, /limit:\s*state\.sessions\.length/);
  assert.doesNotMatch(source, /rows:\s*state\.sessions\.length/);
});

test("tui source renders resume-style columns and exposes sort toggle", () => {
  const source = fs.readFileSync(tuiSourcePath, "utf8");

  assert.match(source, /Created/);
  assert.match(source, /Updated/);
  assert.match(source, /Branch/);
  assert.match(source, /Project/);
  assert.match(source, /Conversation/);
  assert.match(source, /formatPathForDisplay/);
  assert.match(source, /sortBy/);
  assert.match(source, /切换排序/);
});

test("tui source exposes handoff export and unknown event toggles", () => {
  const source = fs.readFileSync(tuiSourcePath, "utf8");

  assert.match(source, /exportHandoffPackages/);
  assert.match(source, /exportKind/);
  assert.match(source, /includeUnknownEvents/);
  assert.match(source, /setIncludeUnknownEvents/);
  assert.match(source, /切换普通\/handoff/);
  assert.match(source, /未知事件/);
});
