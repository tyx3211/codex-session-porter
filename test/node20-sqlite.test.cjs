const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packagePath = path.resolve(__dirname, "..", "package.json");
const sessionsSourcePath = path.resolve(__dirname, "..", "src", "sessions.ts");

test("project supports Node 20 through better-sqlite3 instead of node:sqlite", () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const source = fs.readFileSync(sessionsSourcePath, "utf8");

  assert.equal(pkg.engines.node, ">=20");
  assert.equal(typeof pkg.dependencies["better-sqlite3"], "string");
  assert.doesNotMatch(source, /node:sqlite/);
  assert.match(source, /better-sqlite3/);
});
