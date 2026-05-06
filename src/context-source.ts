import fs from "node:fs";
import readline from "node:readline";
import { once } from "node:events";
import {
  finiteNumberValue,
  isRecord,
  parseJsonRecord,
  stringValue,
  type JsonRecord,
} from "./guards.js";

export interface JsonlRow {
  lineNumber: number;
  obj: JsonRecord;
}

const LEGACY_COMPACTION_USER_MESSAGE_MAX_TOKENS = 20_000;

/**
 * 统一把 JSONL 读取成已解析对象行，便于上层按 history / context 两种来源复用。
 * 这里保留原始行号，后续如果仍然需要把某些 workflow 事件映射回 event_ref，
 * 也能继续沿用同一套编号语义。
 */
export async function readParsedJsonlRows(filePath: string): Promise<JsonlRow[]> {
  const rows: JsonlRow[] = [];
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    let lineNumber = 0;

    rl.on("line", (line) => {
      lineNumber += 1;

      const trimmed = String(line || "").trim();
      if (!trimmed) return;

      const obj = parseJsonRecord(trimmed);
      if (!obj) return;

      rows.push({ lineNumber, obj });
    });

    await once(rl, "close");
  } finally {
    rl.close();
    input.destroy();
  }

  return rows;
}

/**
 * `context` 模式只需要“当前最新有效历史”。
 *
 * 这里复刻的是 Codex rollout reconstruction 的最终态主语义：
 * 1. 普通 `response_item` 继续顺序追加；
 * 2. `compacted.replacement_history` 会整段替换当前历史；
 * 3. `thread_rolled_back` 会删除最近若干个用户 turn；
 * 4. 对 legacy compaction（没有 replacement_history）做轻量兼容。
 *
 * 这一步还不追求“任意 event_ref 时点快照”，也不重建下一轮完整 prompt。
 */
export function reconstructLatestContextRows(rows: readonly JsonlRow[]): JsonlRow[] {
  let history: JsonlRow[] = [];

  for (const row of rows) {
    const type = stringValue(row.obj.type);

    if (type === "response_item" && hasPayloadRecord(row.obj)) {
      history.push(row);
      continue;
    }

    if (type === "compacted" && hasPayloadRecord(row.obj)) {
      history = replacementHistoryRowsFromCompactedRow(row, history);
      continue;
    }

    if (type === "event_msg" && hasPayloadRecord(row.obj)) {
      const payload = row.obj.payload;
      if (payload.type === "thread_rolled_back") {
        const numTurns = normalizedRollbackTurnCount(payload.num_turns);
        if (numTurns > 0) {
          history = dropLastUserTurns(history, numTurns);
        }
      }
    }
  }

  return history;
}

export function parsedRowsToJsonl(rows: readonly JsonlRow[]): string {
  if (rows.length === 0) return "";

  return rows.map((row) => JSON.stringify(row.obj)).join("\n") + "\n";
}

function replacementHistoryRowsFromCompactedRow(
  row: JsonlRow,
  currentHistory: readonly JsonlRow[],
): JsonlRow[] {
  if (!hasPayloadRecord(row.obj)) return [...currentHistory];

  const replacementHistory = replacementHistoryItemsFromPayload(row.obj.payload);
  if (replacementHistory !== null) {
    return replacementHistory.map((item, index) => ({
      lineNumber: row.lineNumber * 1000 + index + 1,
      obj: {
        timestamp: stringValue(row.obj.timestamp),
        type: "response_item",
        payload: item,
      },
    }));
  }

  return buildLegacyCompactedRows(row, currentHistory);
}

function replacementHistoryItemsFromPayload(payload: JsonRecord): JsonRecord[] | null {
  if (!Array.isArray(payload.replacement_history)) return null;

  const items: JsonRecord[] = [];
  for (const item of payload.replacement_history) {
    if (!isRecord(item)) continue;
    items.push(item);
  }

  return items;
}

function buildLegacyCompactedRows(row: JsonlRow, currentHistory: readonly JsonlRow[]): JsonlRow[] {
  if (!hasPayloadRecord(row.obj)) return [...currentHistory];

  const summaryText = stringValue(row.obj.payload.message).trim() || "(no summary available)";
  const selectedMessages = selectLegacyCompactionUserMessages(currentHistory);

  const rows: JsonlRow[] = selectedMessages.map((message, index) => ({
    lineNumber: row.lineNumber * 1000 + index + 1,
    obj: responseMessageRow(row, "user", message),
  }));

  rows.push({
    lineNumber: row.lineNumber * 1000 + selectedMessages.length + 1,
    obj: responseMessageRow(row, "user", summaryText),
  });

  return rows;
}

function selectLegacyCompactionUserMessages(history: readonly JsonlRow[]): string[] {
  const selected: string[] = [];
  let remaining = LEGACY_COMPACTION_USER_MESSAGE_MAX_TOKENS;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = userMessageTextFromResponseRow(history[index]);
    if (!message) continue;

    if (remaining <= 0) break;

    const tokens = approxTokenCount(message);
    if (tokens <= remaining) {
      selected.push(message);
      remaining -= tokens;
      continue;
    }

    selected.push(truncateToApproxTokens(message, remaining));
    break;
  }

  selected.reverse();
  return selected;
}

function dropLastUserTurns(history: readonly JsonlRow[], numTurns: number): JsonlRow[] {
  if (numTurns <= 0 || history.length === 0) return [...history];

  const kept: JsonlRow[] = [];
  let pendingTurns = numTurns;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const row = history[index];

    if (pendingTurns > 0) {
      if (isUserTurnBoundary(row)) {
        pendingTurns -= 1;
      }
      continue;
    }

    kept.push(row);
  }

  kept.reverse();
  return kept;
}

function normalizedRollbackTurnCount(value: unknown): number {
  const numeric = finiteNumberValue(value);
  if (numeric === null || numeric <= 0) return 0;

  return Math.trunc(numeric);
}

function isUserTurnBoundary(row: JsonlRow): boolean {
  if (stringValue(row.obj.type) !== "response_item" || !hasPayloadRecord(row.obj)) return false;

  const payload = row.obj.payload;
  return payload.type === "message" && payload.role === "user" && extractTextFromMessageContent(payload.content) !== "";
}

function userMessageTextFromResponseRow(row: JsonlRow | undefined): string {
  if (!row) return "";
  if (stringValue(row.obj.type) !== "response_item" || !hasPayloadRecord(row.obj)) return "";

  const payload = row.obj.payload;
  if (payload.type !== "message" || payload.role !== "user") return "";

  return extractTextFromMessageContent(payload.content);
}

function responseMessageRow(row: JsonlRow, role: "user" | "assistant", text: string): JsonRecord {
  const contentType = role === "assistant" ? "output_text" : "input_text";

  return {
    timestamp: stringValue(row.obj.timestamp),
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: contentType, text }],
    },
  };
}

function extractTextFromMessageContent(content: unknown): string {
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;

    if (
      (item.type === "input_text" || item.type === "output_text" || item.type === "text") &&
      typeof item.text === "string" &&
      item.text
    ) {
      parts.push(item.text);
    }
  }

  return parts.join("");
}

function approxTokenCount(text: string): number {
  return Math.floor((text.length + 3) / 4);
}

function truncateToApproxTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";

  const maxChars = Math.max(1, maxTokens * 4);
  return text.slice(0, maxChars);
}

function hasPayloadRecord(obj: JsonRecord): obj is JsonRecord & { payload: JsonRecord } {
  return isRecord(obj.payload);
}
