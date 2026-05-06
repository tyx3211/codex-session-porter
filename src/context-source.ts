import fs from "node:fs";
import readline from "node:readline";
import { once } from "node:events";
import {
  isRecord,
  parseJsonRecord,
  stringValue,
  type JsonRecord,
} from "./guards.js";

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
 * 1. 仍按 JSONL 顺序回放，保留流式历史感；
 * 2. 只保留可能进入后续 history.for_prompt() 的条目；
 * 3. 不再只取最后一次 compaction 之后的最终态；
 * 4. 也不去拼完整 Prompt 外壳。
 *
 * 当前先对新版 rollout 做高保真支持：
 * - 保留 developer / user / assistant 三类 message；
 * - 展开 compacted.replacement_history 里的 message / compaction；
 * - 保留 context_compacted / thread_rolled_back 这类关键上下文转折事件；
 * - 排除 reasoning、命令输出、工具输出、search output 等不属于此视图的条目。
 */
export function reconstructContextCandidateRows(rows: readonly JsonlRow[]): JsonlRow[] {
  const selected: JsonlRow[] = [];

  for (const row of rows) {
    const type = stringValue(row.obj.type);

    if (type === "response_item" && hasPayloadRecord(row.obj)) {
      if (isPromptCandidateResponsePayload(row.obj.payload)) {
        selected.push(row);
      }

      continue;
    }

    if (type === "compacted" && hasPayloadRecord(row.obj)) {
      selected.push(...promptCandidateRowsFromCompactedRow(row));
      continue;
    }

    if (type === "event_msg" && hasPayloadRecord(row.obj)) {
      const eventType = stringValue(row.obj.payload.type);
      if (eventType === "context_compacted" || eventType === "thread_rolled_back") {
        selected.push(row);
      }
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
  if (type !== "message") return false;

  const role = stringValue(payload.role);
  return role === "developer" || role === "user" || role === "assistant";
}

function hasPayloadRecord(obj: JsonRecord): obj is JsonRecord & { payload: JsonRecord } {
  return isRecord(obj.payload);
}
