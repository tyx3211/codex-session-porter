import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
import {
  finiteNumberValue,
  isRecord,
  nullableFiniteNumberValue,
  parseJsonRecord,
  stringValue,
  type JsonRecord,
} from "./guards.js";
import type { DisplayMode, SessionDisplayInfo, SessionInfo, SessionMeta } from "./types.js";
import {
  compactSingleLine,
  formatBytes,
  makePreviewText,
  safeReadDir,
  safeStat,
  shortIso,
  truncate,
  walkFiles,
} from "./utils.js";

type JsonPredicate = (obj: JsonRecord) => boolean;
type DatabaseSyncCtor = typeof import("node:sqlite").DatabaseSync;

interface StateDbRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  source: string;
  model_provider: string;
  cwd: string;
  title: string;
  archived: number;
  git_branch: string | null;
  cli_version: string;
  first_user_message: string;
  created_at_ms: number | null;
  updated_at_ms: number | null;
}

const require = createRequire(import.meta.url);
let DatabaseSync: DatabaseSyncCtor | null | undefined;

export function discoverSessionFiles(codexDirOrDirs: string | string[]): SessionInfo[] {
  const codexDirs = Array.isArray(codexDirOrDirs) ? codexDirOrDirs : [codexDirOrDirs];
  const out: SessionInfo[] = [];
  const seen = new Set<string>();

  for (const codexDir of codexDirs) {
    if (!codexDir) continue;

    const sessionsDir = path.join(codexDir, "sessions");
    const archivedDir = path.join(codexDir, "archived_sessions");

    if (fs.existsSync(sessionsDir)) {
      for (const filePath of walkFiles(sessionsDir)) {
        if (!filePath.toLowerCase().endsWith(".jsonl")) continue;
        if (seen.has(filePath)) continue;

        seen.add(filePath);
        out.push(makeFileSessionInfo(filePath, codexDir, "sessions"));
      }
    }

    if (fs.existsSync(archivedDir)) {
      for (const entry of safeReadDir(archivedDir)) {
        if (!entry.isFile()) continue;
        if (!entry.name.toLowerCase().endsWith(".jsonl")) continue;

        const filePath = path.join(archivedDir, entry.name);
        if (seen.has(filePath)) continue;

        seen.add(filePath);
        out.push(makeFileSessionInfo(filePath, codexDir, "archived_sessions"));
      }
    }
  }

  return out;
}

function makeFileSessionInfo(filePath: string, codexDir: string, source: string): SessionInfo {
  const stat = safeStat(filePath);
  const sortKey = stat?.mtimeMs ?? 0;

  return {
    filePath,
    codexDir,
    source,
    mtimeMs: stat?.mtimeMs ?? null,
    size: stat?.size ?? null,
    sortKey,
    meta: null,
  };
}

async function findFirstJsonlObject(
  filePath: string,
  predicate: JsonPredicate,
  maxLines: number,
): Promise<JsonRecord | null> {
  return await new Promise((resolve) => {
    const input = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    let lineCount = 0;
    let settled = false;

    const finish = (value: JsonRecord | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      rl.close();
      input.destroy();
    };

    rl.on("line", (line) => {
      if (settled) return;

      const trimmed = String(line || "").trim();
      if (!trimmed) return;

      lineCount += 1;

      const obj = parseJsonRecord(trimmed);
      if (obj && predicate(obj)) {
        finish(obj);
        return;
      }

      if (lineCount >= maxLines) finish(null);
    });

    rl.on("close", () => finish(null));
    rl.on("error", () => finish(null));
    input.on("error", () => finish(null));
  });
}

export async function readSessionMeta(filePath: string): Promise<SessionMeta | null> {
  const first = await findFirstJsonlObject(
    filePath,
    (obj) => obj.type === "session_meta" && hasPayloadRecord(obj) && typeof obj.payload.id === "string",
    50,
  );

  return hasPayloadRecord(first) ? sessionMetaFromRecord(first.payload) : null;
}

export function isVsCodeSession(meta: SessionMeta | null): boolean {
  const originator = typeof meta?.originator === "string" ? meta.originator : "";
  const source = typeof meta?.source === "string" ? meta.source : "";

  return originator === "codex_vscode" || source === "vscode";
}

export function computeSortKey(meta: SessionMeta | null, sessionInfo: SessionInfo): number {
  const iso = typeof meta?.timestamp === "string" ? meta.timestamp : null;
  if (iso) {
    const time = Date.parse(iso);
    if (Number.isFinite(time)) return time;
  }

  return sessionInfo.sortKey ?? sessionInfo.mtimeMs ?? 0;
}

function extractTextFromResponseMessageContent(content: unknown): string {
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;

    if (!isRecord(item)) continue;

    const record = item;
    const type = record.type;
    if (type === "input_text" || type === "output_text" || type === "text") {
      if (typeof record.text === "string" && record.text) parts.push(record.text);
    }
  }

  return parts.join("");
}

function extractUserTextFromJsonlObject(obj: JsonRecord): string {
  if (obj.type === "event_msg" && hasPayloadRecord(obj)) {
    if (obj.payload.type === "user_message" && typeof obj.payload.message === "string") {
      return obj.payload.message;
    }
  }

  if (obj.type === "response_item" && hasPayloadRecord(obj)) {
    const payload = obj.payload;
    if (payload.type === "message" && payload.role === "user") {
      return extractTextFromResponseMessageContent(payload.content);
    }
  }

  return "";
}

export async function readSessionDisplayInfo(filePath: string): Promise<SessionDisplayInfo> {
  return await new Promise((resolve) => {
    const input = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    let firstUserPreview = "";
    let threadName = "";
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve({ threadName, preview: firstUserPreview });
      rl.close();
      input.destroy();
    };

    rl.on("line", (line) => {
      if (settled) return;

      const trimmed = String(line || "").trim();
      if (!trimmed) return;

      const obj = parseJsonRecord(trimmed);
      if (!obj) return;

      if (!firstUserPreview) {
        firstUserPreview = makePreviewText(extractUserTextFromJsonlObject(obj));
      }

      if (obj.type === "event_msg" && hasPayloadRecord(obj)) {
        const payload = obj.payload;
        if (payload.type === "thread_name_updated" && typeof payload.thread_name === "string") {
          const candidate = compactSingleLine(payload.thread_name);
          if (candidate) threadName = truncate(candidate, 100);
        }
      }
    });

    rl.on("close", () => finish());
    rl.on("error", () => finish());
    input.on("error", () => finish());
  });
}

export async function ensureSessionMeta(sessions: SessionInfo[]): Promise<void> {
  for (const sessionInfo of sessions) {
    if (sessionInfo.meta) continue;

    sessionInfo.meta = await readSessionMeta(sessionInfo.filePath);
    sessionInfo.sortKey = computeSortKey(sessionInfo.meta, sessionInfo);
  }
}

export async function ensureSessionDisplayInfo(sessions: SessionInfo[]): Promise<void> {
  for (const sessionInfo of sessions) {
    if (sessionInfo.displayInfo) continue;

    sessionInfo.displayInfo = await readSessionDisplayInfo(sessionInfo.filePath);
  }
}

export function discoverSelectableSessions(
  codexDir: string,
  opts: { onlyVsCode?: boolean } = {},
): SessionInfo[] {
  const indexed = discoverStateSessions(codexDir, opts);
  if (indexed.length > 0) return indexed;

  return discoverSessionFiles(codexDir);
}

function discoverStateSessions(codexDir: string, opts: { onlyVsCode?: boolean }): SessionInfo[] {
  const rows = readStateDbRows(codexDir);
  const candidateRows: StateDbRow[] = [];
  const legacyNameIds = new Set<string>();
  const sessions: SessionInfo[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isInteractiveStateSource(row.source)) continue;
    if (opts.onlyVsCode && !isVsCodeStateSource(row.source)) continue;

    candidateRows.push(row);
    if (!distinctStateThreadName(row)) legacyNameIds.add(row.id);
  }

  const legacyNames = readLegacyThreadNames(codexDir, legacyNameIds);

  for (const row of candidateRows) {
    const sessionInfo = sessionInfoFromStateRow(row, codexDir, legacyNames.get(row.id) ?? "");
    if (!sessionInfo) continue;
    if (seen.has(sessionInfo.filePath)) continue;

    seen.add(sessionInfo.filePath);
    sessions.push(sessionInfo);
  }

  return sessions;
}

function readLegacyThreadNames(codexDir: string, ids: Set<string>): Map<string, string> {
  const names = new Map<string, string>();
  if (ids.size === 0) return names;

  const filePath = path.join(codexDir, "session_index.jsonl");
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return names;
  }

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const obj = parseJsonRecord(trimmed);
    if (!obj) continue;

    const id = stringValue(obj.id);
    if (!ids.has(id)) continue;

    const threadName = truncate(compactSingleLine(obj.thread_name), 100);
    if (threadName) names.set(id, threadName);
  }

  return names;
}

function loadDatabaseSync(): DatabaseSyncCtor | null {
  if (DatabaseSync !== undefined) return DatabaseSync;

  try {
    const sqliteModule: unknown = require("node:sqlite");
    if (!isRecord(sqliteModule) || typeof sqliteModule.DatabaseSync !== "function") {
      DatabaseSync = null;
      return DatabaseSync;
    }

    // Node 的 experimental sqlite 类型只能从运行时模块上取得；这里已经用 typeof 缩小到构造函数。
    DatabaseSync = sqliteModule.DatabaseSync as DatabaseSyncCtor;
  } catch {
    DatabaseSync = null;
  }

  return DatabaseSync;
}

function findStateDbPath(codexDir: string): string | null {
  const candidates: Array<{ filePath: string; version: number; mtimeMs: number }> = [];

  for (const entry of safeReadDir(codexDir)) {
    if (!entry.isFile()) continue;
    if (!/^state(?:_\d+)?\.sqlite$/u.test(entry.name)) continue;

    const filePath = path.join(codexDir, entry.name);
    const versionMatch = /^state_(\d+)\.sqlite$/u.exec(entry.name);
    const version = versionMatch ? Number(versionMatch[1]) : -1;
    const stat = safeStat(filePath);
    candidates.push({
      filePath,
      version: Number.isFinite(version) ? version : -1,
      mtimeMs: stat?.mtimeMs ?? 0,
    });
  }

  candidates.sort((a, b) => b.version - a.version || b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

function readStateDbRows(codexDir: string): StateDbRow[] {
  const dbPath = findStateDbPath(codexDir);
  if (!dbPath) return [];

  const Db = loadDatabaseSync();
  if (!Db) return [];

  let db: InstanceType<DatabaseSyncCtor> | undefined;
  try {
    db = new Db(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        `
        SELECT
          id,
          rollout_path,
          created_at,
          updated_at,
          source,
          model_provider,
          cwd,
          title,
          archived,
          git_branch,
          cli_version,
          first_user_message,
          created_at_ms,
          updated_at_ms
        FROM threads
        WHERE archived = 0
        ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC
        `,
      )
      .all();

    return rows.flatMap((row) => stateDbRowFromRecord(row));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function sessionInfoFromStateRow(row: StateDbRow, codexDir: string, legacyThreadName = ""): SessionInfo | null {
  const filePath = row.rollout_path;
  if (!filePath || !filePath.toLowerCase().endsWith(".jsonl")) return null;
  if (!fs.existsSync(filePath)) return null;

  const preview = statePreview(row);
  const threadName = distinctStateThreadName(row) || legacyStateThreadName(legacyThreadName, preview);
  if (!threadName && !preview) return null;

  const stat = safeStat(filePath);
  const sortKey = Number.isFinite(Number(row.updated_at_ms))
    ? Number(row.updated_at_ms)
    : Number(row.updated_at) * 1000;

  return {
    filePath,
    codexDir,
    source: "state",
    stateSource: row.source,
    mtimeMs: stat?.mtimeMs ?? null,
    size: stat?.size ?? null,
    sortKey: Number.isFinite(sortKey) ? sortKey : stat?.mtimeMs ?? 0,
    meta: {
      id: row.id || "",
      timestamp: epochToIso(row.created_at, row.created_at_ms),
      updatedAt: epochToIso(row.updated_at, row.updated_at_ms),
      cwd: row.cwd || "",
      source: row.source || "",
      originator: isVsCodeStateSource(row.source) ? "codex_vscode" : "",
      model_provider: row.model_provider || "",
      cli_version: row.cli_version || "",
      git_branch: row.git_branch || "",
    },
    displayInfo: {
      threadName,
      preview,
    },
  };
}

function legacyStateThreadName(legacyThreadName: string, preview: string): string {
  const threadName = truncate(compactSingleLine(legacyThreadName), 100);
  if (!threadName) return "";

  const normalizedPreview = compactSingleLine(preview);
  if (normalizedPreview && normalizedPreview === threadName) return "";

  return threadName;
}

function epochToIso(seconds: number | null, millis: number | null): string {
  const value = Number.isFinite(Number(millis)) ? Number(millis) : Number(seconds) * 1000;
  if (!Number.isFinite(value) || value <= 0) return "";

  return new Date(value).toISOString();
}

function stateSourceText(source: unknown): string {
  return compactSingleLine(source).toLowerCase();
}

function isInteractiveStateSource(source: unknown): boolean {
  const normalized = stateSourceText(source);
  return normalized === "cli" || normalized === "vscode";
}

function isVsCodeStateSource(source: unknown): boolean {
  return stateSourceText(source) === "vscode";
}

function distinctStateThreadName(row: StateDbRow): string {
  const title = compactSingleLine(row.title);
  if (!title) return "";

  const firstUserMessage = compactSingleLine(row.first_user_message);
  if (firstUserMessage && title === firstUserMessage) return "";

  return truncate(title, 100);
}

function statePreview(row: StateDbRow): string {
  const firstUserPreview = makePreviewText(row.first_user_message, 100);
  if (firstUserPreview) return firstUserPreview;

  return truncate(compactSingleLine(row.title), 100);
}

export function sessionDisplayLabel(sessionInfo: SessionInfo, displayMode: DisplayMode): string {
  const fileName = path.basename(sessionInfo.filePath);
  if (displayMode === "file") return fileName;

  const info = sessionInfo.displayInfo || {};
  return info.threadName || info.preview || `[未命名] ${fileName}`;
}

export function sessionSearchText(sessionInfo: SessionInfo): string {
  const info = sessionInfo.displayInfo || {};

  return [
    path.basename(sessionInfo.filePath),
    sessionInfo.filePath,
    info.threadName || "",
    info.preview || "",
    sessionInfo.meta?.cwd || "",
    sessionInfo.meta?.git_branch || "",
  ]
    .join("\n")
    .toLowerCase();
}

export function sessionListTimestamp(sessionInfo: SessionInfo): string {
  return sessionInfo.meta?.updatedAt || sessionInfo.meta?.timestamp || "";
}

export function formatSessionListLine(sessionInfo: SessionInfo, idx: number, displayMode: DisplayMode): string {
  const i = String(idx + 1).padStart(3, " ");
  const label = sessionDisplayLabel(sessionInfo, displayMode);
  const ts = sessionListTimestamp(sessionInfo) ? shortIso(sessionListTimestamp(sessionInfo)) : "-";
  const src = sessionInfo.source || "sessions";
  const origin = sessionInfo.meta?.originator ? ` originator=${sessionInfo.meta.originator}` : "";
  const cwd = sessionInfo.meta?.cwd ? ` cwd=${sessionInfo.meta.cwd}` : "";
  const branch = sessionInfo.meta?.git_branch ? ` branch=${sessionInfo.meta.git_branch}` : "";

  return `${i}. ${ts} [${src}] ${label} (${formatBytes(sessionInfo.size ?? -1)})${origin}${cwd}${branch}`;
}

function hasPayloadRecord(obj: JsonRecord | null): obj is JsonRecord & { payload: JsonRecord } {
  return !!obj && !!obj.payload && typeof obj.payload === "object" && !Array.isArray(obj.payload);
}

function sessionMetaFromRecord(record: JsonRecord): SessionMeta {
  return {
    id: stringValue(record.id),
    timestamp: stringValue(record.timestamp),
    updatedAt: stringValue(record.updatedAt),
    cwd: stringValue(record.cwd),
    source: stringValue(record.source),
    originator: stringValue(record.originator),
    model_provider: stringValue(record.model_provider),
    cli_version: stringValue(record.cli_version),
    git_branch: stringValue(record.git_branch),
  };
}

function stateDbRowFromRecord(row: unknown): StateDbRow[] {
  if (!isRecord(row)) return [];

  const id = stringValue(row.id);
  const rolloutPath = stringValue(row.rollout_path);
  const createdAt = finiteNumberValue(row.created_at);
  const updatedAt = finiteNumberValue(row.updated_at);
  const source = stringValue(row.source);
  const modelProvider = stringValue(row.model_provider);
  const cwd = stringValue(row.cwd);
  const title = stringValue(row.title);
  const archived = finiteNumberValue(row.archived);
  const cliVersion = stringValue(row.cli_version);
  const firstUserMessage = stringValue(row.first_user_message);
  if (
    !id ||
    !rolloutPath ||
    createdAt === null ||
    updatedAt === null ||
    !source ||
    !modelProvider ||
    !cwd ||
    archived === null
  ) {
    return [];
  }

  return [
    {
      id,
      rollout_path: rolloutPath,
      created_at: createdAt,
      updated_at: updatedAt,
      source,
      model_provider: modelProvider,
      cwd,
      title,
      archived,
      git_branch: typeof row.git_branch === "string" ? row.git_branch : null,
      cli_version: cliVersion,
      first_user_message: firstUserMessage,
      created_at_ms: nullableFiniteNumberValue(row.created_at_ms),
      updated_at_ms: nullableFiniteNumberValue(row.updated_at_ms),
    },
  ];
}
