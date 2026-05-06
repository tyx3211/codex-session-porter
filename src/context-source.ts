import fs from "node:fs";
import readline from "node:readline";
import { once } from "node:events";
import {
  isRecord,
  parseJsonRecord,
  stringValue,
  type JsonRecord,
} from "./guards.js";
import {
  looksLikeAgentsInstructions,
  looksLikeEnvironmentContext,
} from "./utils.js";

export interface JsonlRow {
  lineNumber: number;
  obj: JsonRecord;
}

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
 * `context` 模式导出的是“模型可见历史候选视图”：
 * 1. 从最后一次带 replacement_history 的 compaction 建立恢复基线；
 * 2. 再按 JSONL 顺序追加这个基线之后的 response_item；
 * 3. 只保留可能进入后续 history.for_prompt() 的条目；
 * 4. 也不去拼完整 Prompt 外壳。
 *
 * 当前先对新版 rollout 做高保真支持：
 * - 保留 user / assistant 两类会话正文 message；
 * - 保留函数调用、工具调用、工具输出、reasoning 等会进入 ContextManager 的 API message；
 * - 展开 compacted.replacement_history 里的 message；
 * - 保留 compacted.message 作为压缩摘要；
 * - 排除 developer、AGENTS.md、environment_context 这类框架注入；
 * - 排除 event_msg 这类 UI/审计事件。
 */
export function reconstructContextCandidateRows(rows: readonly JsonlRow[]): JsonlRow[] {
  const compactedIndex = findLastReplacementCompactionIndex(rows);
  let selected: JsonlRow[] = [];
  let startIndex = 0;

  if (compactedIndex !== -1) {
    selected = promptCandidateRowsFromCompactedRow(rows[compactedIndex]);
    startIndex = compactedIndex + 1;
  }

  for (let index = startIndex; index < rows.length; index += 1) {
    const row = rows[index];
    const type = stringValue(row.obj.type);

    if (type === "response_item" && hasPayloadRecord(row.obj)) {
      if (isPromptCandidateResponsePayload(row.obj.payload)) {
        selected.push(row);
      }

      continue;
    }

    if (type === "compacted" && hasPayloadRecord(row.obj)) {
      const replacementRows = promptCandidateRowsFromCompactedRow(row);
      if (replacementRows.length > 0) selected = replacementRows;
      continue;
    }

    if (type === "event_msg" && hasPayloadRecord(row.obj)) {
      const eventType = stringValue(row.obj.payload.type);
      if (eventType === "thread_rolled_back") {
        selected = dropLastUserTurns(selected, numericValue(row.obj.payload.num_turns));
      }

      continue;
    }
  }

  return selected;
}

export function parsedRowsToJsonl(rows: readonly JsonlRow[]): string {
  if (rows.length === 0) return "";

  return rows.map((row) => JSON.stringify(row.obj)).join("\n") + "\n";
}

function promptCandidateRowsFromCompactedRow(row: JsonlRow): JsonlRow[] {
  if (!hasPayloadRecord(row.obj)) return [];

  const rows: JsonlRow[] = [];
  const summary = stringValue(row.obj.payload.message).trim();

  if (summary) {
    rows.push({
      lineNumber: row.lineNumber * 1000 + 1,
      obj: {
        timestamp: stringValue(row.obj.timestamp),
        type: "response_item",
        payload: {
          type: "compaction",
          message: summary,
        },
      },
    });
  }

  const replacementHistory = promptCandidateReplacementHistoryItems(row.obj.payload);
  for (let index = 0; index < replacementHistory.length; index += 1) {
    rows.push({
      lineNumber: row.lineNumber * 1000 + rows.length + 1,
      obj: {
        timestamp: stringValue(row.obj.timestamp),
        type: "response_item",
        payload: replacementHistory[index],
      },
    });
  }

  return rows;
}

function findLastReplacementCompactionIndex(rows: readonly JsonlRow[]): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (stringValue(row.obj.type) !== "compacted") continue;
    if (!hasPayloadRecord(row.obj)) continue;
    if (!Array.isArray(row.obj.payload.replacement_history)) continue;

    return index;
  }

  return -1;
}

function promptCandidateReplacementHistoryItems(payload: JsonRecord): JsonRecord[] {
  if (!Array.isArray(payload.replacement_history)) return [];

  const items: JsonRecord[] = [];
  for (const item of payload.replacement_history) {
    if (!isRecord(item)) continue;
    if (!isPromptCandidateResponsePayload(item)) continue;
    if (item.type === "compaction") continue;

    items.push(item);
  }

  return items;
}

function isPromptCandidateResponsePayload(payload: JsonRecord): boolean {
  const type = stringValue(payload.type);
  if (type === "compaction") return true;
  if (type !== "message") return isContextManagerApiMessageType(type);

  const role = stringValue(payload.role);
  if (role === "assistant") return true;
  if (role !== "user") return false;

  const text = extractPromptCandidateMessageText(payload);
  if (!text) return false;
  if (looksLikeAgentsInstructions(text)) return false;
  if (looksLikeEnvironmentContext(text)) return false;

  return true;
}

function isContextManagerApiMessageType(type: string): boolean {
  switch (type) {
    case "function_call":
    case "function_call_output":
    case "tool_search_call":
    case "tool_search_output":
    case "custom_tool_call":
    case "custom_tool_call_output":
    case "local_shell_call":
    case "reasoning":
    case "web_search_call":
    case "image_generation_call":
    case "context_compaction":
      return true;
    default:
      return false;
  }
}

function hasPayloadRecord(obj: JsonRecord): obj is JsonRecord & { payload: JsonRecord } {
  return isRecord(obj.payload);
}

function numericValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;

  return Math.floor(parsed);
}

function dropLastUserTurns(rows: readonly JsonlRow[], numTurns: number): JsonlRow[] {
  if (numTurns <= 0 || rows.length === 0) return [...rows];

  let remaining = numTurns;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!isUserTurnBoundaryRow(row)) continue;

    remaining -= 1;
    if (remaining === 0) return rows.slice(0, index);
  }

  return [];
}

function isUserTurnBoundaryRow(row: JsonlRow): boolean {
  if (stringValue(row.obj.type) !== "response_item") return false;
  if (!hasPayloadRecord(row.obj)) return false;

  const payload = row.obj.payload;
  if (stringValue(payload.type) !== "message") return false;
  if (stringValue(payload.role) !== "user") return false;

  const text = extractPromptCandidateMessageText(payload);
  if (!text) return false;
  if (looksLikeAgentsInstructions(text)) return false;
  if (looksLikeEnvironmentContext(text)) return false;

  return true;
}

function extractPromptCandidateMessageText(payload: JsonRecord): string {
  const content = payload.content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;

    const text = stringValue(item.text);
    if (!text) continue;
    parts.push(text);
  }

  return parts.join("\n").trim();
}
