import fs from "node:fs";
import path from "node:path";
import { CliError, type CliOptions, type SessionInfo } from "./types.js";
import {
  discoverSelectableSessions,
  ensureSessionDisplayInfo,
  ensureSessionMeta,
  formatSessionListLine,
  isVsCodeSession,
} from "./sessions.js";
import { expandHomeDir, safeStat } from "./utils.js";

export function parsePick(input: string): number[] {
  const out: number[] = [];

  for (const chunk of String(input || "").split(",")) {
    const value = Number(String(chunk).trim());
    if (!Number.isInteger(value) || value < 1) continue;

    out.push(value);
  }

  return [...new Set(out)];
}

export function normalizeInputSessions(inputPaths: string[]): SessionInfo[] {
  const out: SessionInfo[] = [];

  for (const inputPath of inputPaths) {
    const filePath = path.resolve(inputPath);
    if (!fs.existsSync(filePath)) throw new CliError(`输入文件不存在：${filePath}`);
    if (!filePath.toLowerCase().endsWith(".jsonl")) throw new CliError(`输入文件不是 .jsonl：${filePath}`);

    const stat = safeStat(filePath);
    out.push({
      filePath,
      codexDir: "",
      source: "input",
      mtimeMs: stat?.mtimeMs ?? null,
      size: stat?.size ?? null,
      sortKey: stat?.mtimeMs ?? 0,
      meta: null,
    });
  }

  return out;
}

export async function resolveBaseSessions(opts: CliOptions): Promise<SessionInfo[]> {
  let sessions: SessionInfo[];

  if (opts.input.length > 0) {
    sessions = normalizeInputSessions(opts.input);
  } else {
    const codexDir = path.resolve(expandHomeDir(opts.codexDir));
    sessions = discoverSelectableSessions(codexDir, opts);
    if (sessions.length === 0) throw new CliError(`未找到会话文件，请检查目录：${codexDir}`);
  }

  await ensureSessionMeta(sessions);

  if (opts.onlyVsCode) {
    sessions = sessions.filter((sessionInfo) => isVsCodeSession(sessionInfo.meta));
  }

  sessions.sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0));
  return sessions;
}

export async function resolveSelectedSessions(opts: CliOptions): Promise<SessionInfo[]> {
  const sessions = await resolveBaseSessions(opts);

  if (opts.list) {
    if (opts.display === "thread") await ensureSessionDisplayInfo(sessions);

    for (let idx = 0; idx < sessions.length; idx += 1) {
      const sessionInfo = sessions[idx];
      if (!sessionInfo) continue;

      process.stdout.write(`${formatSessionListLine(sessionInfo, idx, opts.display)}\n`);
    }

    const hasExplicitSelection = opts.latest || opts.all || opts.pick || opts.input.length > 0;
    if (!hasExplicitSelection) process.exit(0);
  }

  if (opts.input.length > 0) return sessions;

  if (opts.latest) {
    const first = sessions.at(0);
    if (!first) throw new CliError("没有可导出的会话");
    return [first];
  }

  if (opts.all) return sessions;

  if (opts.pick) {
    const indices = parsePick(opts.pick);
    if (indices.length === 0) throw new CliError("--pick 参数无效，请使用如 1,2,3");

    const picked: SessionInfo[] = [];
    for (const index of indices) {
      const sessionInfo = sessions[index - 1];
      if (!sessionInfo) throw new CliError(`--pick 索引越界：${index}`);

      picked.push(sessionInfo);
    }

    return picked;
  }

  throw new CliError("请指定 --latest / --all / --pick / --input（也可先用 --list 查看索引）");
}

export async function resolvePickerSessions(opts: CliOptions): Promise<SessionInfo[]> {
  const sessions = await resolveBaseSessions(opts);
  await ensureSessionDisplayInfo(sessions);

  return sessions;
}
