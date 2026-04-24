import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  return "";
}

export function expandHomeDir(value: string): string {
  if (!value) return value;
  if (value === "~") return os.homedir();

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

export function safeReadDir(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

export function* walkFiles(dirPath: string): Generator<string> {
  for (const entry of safeReadDir(dirPath)) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
      continue;
    }

    if (entry.isFile()) yield fullPath;
  }
}

export function shortIso(iso: string): string {
  try {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return iso;

    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}Z`;
  } catch {
    return iso;
  }
}

export function compactSingleLine(text: unknown): string {
  return stringFromUnknown(text)
    .replace(/\s+/gu, " ")
    .trim();
}

export function truncate(text: unknown, maxLen: number): string {
  const value = stringFromUnknown(text);
  if (value.length <= maxLen) return value;

  return `${value.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

export function truncateUtf8Bytes(text: unknown, maxBytes: number): string {
  let out = "";
  let used = 0;

  for (const ch of stringFromUnknown(text)) {
    const len = Buffer.byteLength(ch, "utf8");
    if (used + len > maxBytes) break;

    out += ch;
    used += len;
  }

  return out.trimEnd();
}

export function sanitizeFileNameSegment(text: unknown): string {
  return compactSingleLine(text)
    .replace(/[<>:"/\\|?*\x00-\x1f]/gu, "_")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/u, "")
    .trim();
}

export function looksLikeEnvironmentContext(text: unknown): boolean {
  const value = stringFromUnknown(text).trimStart();
  return value.startsWith("<environment_context>");
}

export function extractRequestFromIdeContextBlock(text: string): string {
  const marker = "## My request for Codex:";
  const idx = text.indexOf(marker);
  if (idx === -1) return "";

  let after = text.slice(idx + marker.length).replace(/^\s+/u, "");
  const stop = after.search(/\n##\s+/u);
  if (stop !== -1) after = after.slice(0, stop);

  return after.trim();
}

export function makePreviewText(text: unknown, maxLen = 100): string {
  const raw = typeof text === "string" ? text : "";
  if (!raw.trim() || looksLikeEnvironmentContext(raw)) return "";

  const chosen = extractRequestFromIdeContextBlock(raw) || raw;
  const compact = compactSingleLine(chosen);
  if (!compact) return "";

  return truncate(compact, maxLen);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;

  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatPathForDisplay(value: unknown): string {
  const text = stringFromUnknown(value).trim();
  if (!text) return "-";

  const home = os.homedir();
  if (text === home) return "~";

  if (text.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, text)}`;
  }

  return text;
}
