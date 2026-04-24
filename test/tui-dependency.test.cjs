const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packagePath = path.resolve(__dirname, "..", "package.json");
const tuiSourcePath = path.resolve(__dirname, "..", "src", "tui.tsx");

test("tui declares React Ink dependencies instead of enquirer", () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  assert.equal(typeof pkg.dependencies.ink, "string");
  assert.equal(typeof pkg.dependencies.react, "string");
  assert.equal(pkg.dependencies.enquirer, undefined);
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
