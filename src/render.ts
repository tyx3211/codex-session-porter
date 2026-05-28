import fs from "node:fs";
import readline from "node:readline";
import { isRecord, parseJsonRecord, type JsonRecord } from "./guards.js";
import { readParsedJsonlRows, type JsonlRow } from "./context-source.js";
import type { CliOptions, SessionMeta } from "./types.js";
import {
  compactSingleLine,
  looksLikeEnvironmentContext,
  looksLikeRuntimeContextInjection,
  stringFromUnknown,
  truncate,
} from "./utils.js";

interface Writer {
  write(text: string): void;
}

type WorkflowDetailLevel = "summary" | "full";

interface EventRenderContext {
  ts: string | null;
  eventRef: string;
  detail: WorkflowDetailLevel;
  includeUnknownEvents: boolean;
}

interface LegacyPendingResponseItem {
  context: EventRenderContext;
  payload: JsonRecord;
}

interface LegacyWorkflowState {
  readonly pendingExecCalls: Map<string, LegacyPendingResponseItem>;
  readonly pendingPatchCalls: Map<string, LegacyPendingResponseItem>;
}

interface DiffStat {
  added: number;
  removed: number;
}

export interface RenderOptions {
  source: CliOptions["source"];
  includeAgentReasoning: boolean;
  includeToolCalls: boolean;
  includeToolOutputs: boolean;
  includeEnvironmentContext: boolean;
  includeUnknownEvents: boolean;
  mode: CliOptions["mode"];
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

function writeTurn(writer: Writer, who: string, ts: string | null, message: unknown, images?: unknown): void {
  writer.write(`## ${who}${ts ? `（${ts}）` : ""}\n\n`);

  const text = typeof message === "string" ? message : "";
  if (text) writer.write(`${text.trimEnd()}\n\n`);

  if (Array.isArray(images) && images.length > 0) {
    writer.write(`（包含 ${images.length} 张图片：未导出）\n\n`);
  }
}

function writeCompactionTurn(writer: Writer, ts: string | null, message: unknown): void {
  writer.write(`## 上下文压缩摘要${ts ? `（${ts}）` : ""}\n\n`);

  const text = typeof message === "string" ? message.trim() : "";
  if (text) {
    writer.write(`${text}\n\n`);
    return;
  }

  writer.write("（压缩内容已加密，无法导出正文）\n\n");
}

function formatDuration(duration: unknown): string {
  if (!duration || typeof duration !== "object") return "";
  if (!isRecord(duration)) return "";

  const secs = Number(duration.secs || 0);
  const nanos = Number(duration.nanos || 0);
  const total = secs + nanos / 1000000000;
  if (!Number.isFinite(total) || total < 0) return "";

  return `${total.toFixed(3)}s`;
}

function commandLabel(payload: JsonRecord): string {
  const parsed = Array.isArray(payload.parsed_cmd) ? payload.parsed_cmd : [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    if (!isRecord(item)) continue;

    if (typeof item.cmd === "string" && item.cmd.trim()) return item.cmd.trim();
  }

  const command: unknown[] = Array.isArray(payload.command) ? payload.command : [];
  if (command.length > 0) {
    const last = command[command.length - 1];
    if (typeof last === "string" && last.trim()) return last.trim();
  }

  return typeof payload.call_id === "string" && payload.call_id ? payload.call_id : "unknown";
}

function commandActionKind(payload: JsonRecord): string {
  const parsed = Array.isArray(payload.parsed_cmd) ? payload.parsed_cmd : [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    if (!isRecord(item)) continue;

    if (typeof item.type === "string" && item.type.trim()) return item.type.trim();
  }

  return "";
}

function normalizedCommandActionKind(payload: JsonRecord): string {
  const action = commandActionKind(payload);
  if (action) return action;

  return "unknown";
}

function isBuiltinCommandAction(action: string): boolean {
  return action !== "" && action !== "unknown";
}

function fenceForContent(text: string): string {
  const matches = text.match(/~{3,}/gu) || [];
  const length = matches.reduce((max, match) => Math.max(max, match.length + 1), 3);

  return "~".repeat(length);
}

function fencedBlock(lang: string, content: unknown): string {
  const text = stringFromUnknown(content).replace(/\s+$/u, "");
  const fence = fenceForContent(text);

  return `${fence}${lang}\n${text}\n${fence}\n\n`;
}

/**
 * 每个事件块都写一个稳定的 event_ref（事件引用），这样较短的时间线导出可以不内嵌
 * 大段输出或 diff 正文，但后续仍能确定性回查到原始 JSONL 里的那一行记录。
 */
function writeEventHeader(writer: Writer, title: string, context: EventRenderContext): void {
  writer.write(`### ${title}${context.ts ? `（${context.ts}）` : ""}\n\n`);
  writer.write(`- event_ref：\`${context.eventRef}\`\n`);
}

function writeCodeMetadataLine(writer: Writer, label: string, value: string): void {
  if (!value) return;
  writer.write(`- ${label}：\`${value}\`\n`);
}

function writeTextMetadataLine(writer: Writer, label: string, value: string): void {
  if (!value) return;
  writer.write(`- ${label}：${value}\n`);
}

function writeCodeBlockField(writer: Writer, label: string, lang: string, value: string): void {
  if (!value) return;
  writer.write(`- ${label}：\n\n`);
  writer.write(fencedBlock(lang, value));
}

function writeJsonBlockField(writer: Writer, label: string, value: unknown): void {
  if (value === null || value === undefined) return;

  try {
    writer.write(`- ${label}：\n\n`);
    writer.write(fencedBlock("json", JSON.stringify(value, null, 2)));
  } catch {
    const text = stringFromUnknown(value);
    if (text) writeCodeBlockField(writer, label, "text", text);
  }
}

function lineCountFromContent(content: string): number {
  const normalized = content.replace(/\n$/u, "");
  if (!normalized) return 0;

  return normalized.split("\n").length;
}

/**
 * diff 统计只服务于 timeline 模式，因此这里优先做“稳定且可解释”的统计：
 * - add/delete 直接按内容行数统计；
 * - update 优先解析 unified diff；
 * - 若只有退化文本，则尽量识别 + / - 行；
 * - 实在无法识别时返回 0/0，而不是猜测错误结果。
 */
function fileChangeStat(change: unknown): DiffStat {
  const record = isRecord(change) ? change : {};
  const type = typeof record.type === "string" ? record.type : "unknown";
  const content = typeof record.content === "string" ? record.content : "";

  if (type === "add") {
    return { added: lineCountFromContent(content), removed: 0 };
  }

  if (type === "delete") {
    return { added: 0, removed: lineCountFromContent(content) };
  }

  const patchText =
    typeof record.unified_diff === "string" && record.unified_diff
      ? record.unified_diff
      : typeof record.diff === "string" && record.diff
        ? record.diff
        : content;

  let added = 0;
  let removed = 0;
  for (const line of patchText.split("\n")) {
    if (!line) continue;
    if (line.startsWith("+++")) continue;
    if (line.startsWith("---")) continue;
    if (line.startsWith("@@")) continue;

    if (line.startsWith("+")) {
      added += 1;
      continue;
    }

    if (line.startsWith("-")) {
      removed += 1;
    }
  }

  return { added, removed };
}

function fileChangeDiff(filePath: string, change: unknown): string {
  const record = isRecord(change) ? change : {};
  const type = typeof record.type === "string" ? record.type : "unknown";
  const content = typeof record.content === "string" ? record.content : "";

  if (type === "add") {
    const body = content
      .replace(/\n$/u, "")
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n");
    return [`--- /dev/null`, `+++ ${filePath}`, body].filter(Boolean).join("\n");
  }

  if (type === "delete") {
    const body = content
      .replace(/\n$/u, "")
      .split("\n")
      .map((line) => `-${line}`)
      .join("\n");
    return [`--- ${filePath}`, `+++ /dev/null`, body].filter(Boolean).join("\n");
  }

  if (typeof record.unified_diff === "string" && record.unified_diff) return record.unified_diff;
  if (typeof record.diff === "string" && record.diff) return record.diff;
  if (content) return content;

  return JSON.stringify(record, null, 2);
}

function parseDurationSeconds(secondsText: string): JsonRecord | null {
  const seconds = Number(secondsText);
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  const secs = Math.trunc(seconds);
  const nanos = Math.round((seconds - secs) * 1000000000);

  return {
    secs,
    nanos,
  };
}

function inferLegacyCommandCwd(command: string): string {
  const match = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s*&&/u.exec(command);
  if (!match) return "";

  return (match[1] || match[2] || match[3] || "").trim();
}

interface LegacyExecCommandEnvelope {
  readonly duration: JsonRecord | null;
  readonly exitCode: string;
  readonly output: string;
}

/**
 * 旧版 exec_command 的输出被包了一层执行器信封：
 * - 前几行是 Chunk / Wall time / Process exited...
 * - 真正的 stdout/stderr 在最后的 Output: 段
 *
 * 这里把它拆成“元数据 + 正文”，让后续统一复用新版命令事件渲染。
 */
function parseLegacyExecCommandEnvelope(outputText: string): LegacyExecCommandEnvelope {
  const exitCodeMatch = /(?:^|\n)Process exited with code (\d+)\s*(?:\n|$)/u.exec(outputText);
  const wallTimeMatch = /(?:^|\n)Wall time: ([0-9.]+) seconds\s*(?:\n|$)/u.exec(outputText);
  const outputMatch = /(?:^|\n)Output:\n([\s\S]*)$/u.exec(outputText);

  return {
    duration: wallTimeMatch?.[1] ? parseDurationSeconds(wallTimeMatch[1]) : null,
    exitCode: exitCodeMatch?.[1] || "",
    output: outputMatch?.[1] || outputText,
  };
}

/**
 * 旧版 apply_patch 只有原始 patch 文本，没有新版 patch_apply_end 的结构化 changes。
 * 这里做一层保守解析：
 * - Add/Delete 还原为 content
 * - Update 保留 unified diff 主体
 * - Move 只影响展示路径，不额外伪造复杂语义
 */
function parseLegacyApplyPatchChanges(input: string): JsonRecord {
  const changes: JsonRecord = {};
  const lines = input.split("\n");

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] || "";

    if (line.startsWith("*** Add File: ")) {
      const filePath = line.slice("*** Add File: ".length).trim();
      index += 1;

      const contentLines: string[] = [];
      while (index < lines.length) {
        const nextLine = lines[index] || "";
        if (nextLine.startsWith("*** ")) break;

        if (nextLine.startsWith("+")) contentLines.push(nextLine.slice(1));
        index += 1;
      }

      changes[filePath] = {
        type: "add",
        content: contentLines.length > 0 ? `${contentLines.join("\n")}\n` : "",
      };
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      const filePath = line.slice("*** Delete File: ".length).trim();
      changes[filePath] = {
        type: "delete",
        content: "",
      };
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const originalPath = line.slice("*** Update File: ".length).trim();
      let targetPath = originalPath;
      index += 1;

      const diffLines: string[] = [];
      while (index < lines.length) {
        const nextLine = lines[index] || "";
        if (
          nextLine.startsWith("*** Update File: ") ||
          nextLine.startsWith("*** Add File: ") ||
          nextLine.startsWith("*** Delete File: ") ||
          nextLine === "*** End Patch"
        ) {
          break;
        }

        if (nextLine.startsWith("*** Move to: ")) {
          targetPath = nextLine.slice("*** Move to: ".length).trim();
          index += 1;
          continue;
        }

        if (nextLine !== "*** End of File") diffLines.push(nextLine);
        index += 1;
      }

      changes[targetPath] = {
        type: "update",
        unified_diff: diffLines.join("\n"),
      };
      continue;
    }

    index += 1;
  }

  return changes;
}

function previewValue(value: unknown, maxLen = 140): string {
  if (typeof value === "string") return truncate(compactSingleLine(value), maxLen);

  if (value === null || value === undefined) return "";

  try {
    return truncate(compactSingleLine(JSON.stringify(value)), maxLen);
  } catch {
    return truncate(compactSingleLine(stringFromUnknown(value)), maxLen);
  }
}

function eventDetailLevelForMode(mode: CliOptions["mode"]): WorkflowDetailLevel | null {
  if (mode === "events") return "full";
  if (mode === "timeline") return "summary";

  return null;
}

function eventRefFromLineNumber(lineNumber: number): string {
  return `E${String(lineNumber).padStart(6, "0")}`;
}

function writeExecCommandEvent(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  const label = commandLabel(payload);
  const action = normalizedCommandActionKind(payload);
  const isBuiltinAction = isBuiltinCommandAction(action);
  const title = isBuiltinAction ? `action：\`${action}\`` : "命令执行";
  writeEventHeader(writer, title, context);

  if (typeof payload.cwd === "string" && payload.cwd) writeCodeMetadataLine(writer, "cwd", payload.cwd);
  if (isBuiltinAction) {
    writeCodeBlockField(writer, "cmd", "text", label);
    writer.write("\n");
    return;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "exit_code")) {
    writeCodeMetadataLine(writer, "exit_code", String(payload.exit_code));
  }

  if (typeof payload.status === "string" && payload.status) {
    writeCodeMetadataLine(writer, "status", payload.status);
  }

  const duration = formatDuration(payload.duration);
  if (duration) writeCodeMetadataLine(writer, "duration", duration);
  writeCodeBlockField(writer, "cmd", "text", label);
  writer.write("\n");

  if (context.detail === "summary") return;

  const output =
    typeof payload.aggregated_output === "string" && payload.aggregated_output
      ? payload.aggregated_output
      : [payload.stdout, payload.stderr].filter((value) => typeof value === "string" && value).join("\n");

  if (output) {
    writer.write("#### output\n\n");
    writer.write(fencedBlock("text", output));
  }
}

function writePatchApplyEvent(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  writeEventHeader(writer, "action：`edit_file`", context);

  if (Object.prototype.hasOwnProperty.call(payload, "success")) {
    writeCodeMetadataLine(writer, "success", String(payload.success));
  }

  if (typeof payload.call_id === "string" && payload.call_id) {
    writeCodeMetadataLine(writer, "call_id", payload.call_id);
  }

  writer.write("\n");

  if (context.detail === "full") {
    if (typeof payload.stdout === "string" && payload.stdout.trim()) {
      writer.write("#### stdout\n\n");
      writer.write(fencedBlock("text", payload.stdout));
    }

    if (typeof payload.stderr === "string" && payload.stderr.trim()) {
      writer.write("#### stderr\n\n");
      writer.write(fencedBlock("text", payload.stderr));
    }
  }

  const changes = payload.changes && typeof payload.changes === "object" ? payload.changes : {};
  for (const [filePath, change] of Object.entries(changes)) {
    const record = isRecord(change) ? change : {};
    const type = typeof record.type === "string" ? record.type : "unknown";
    writer.write(`#### ${type} \`${filePath}\`\n\n`);

    if (context.detail === "full") {
      writer.write(fencedBlock("diff", fileChangeDiff(filePath, change)));
      continue;
    }

    const stat = fileChangeStat(change);
    writeCodeMetadataLine(writer, "diff_stat", `+${stat.added} / -${stat.removed}`);
    writer.write("\n");
  }
}

function writeSimpleEvent(
  writer: Writer,
  context: EventRenderContext,
  title: string,
  metadata: Array<{ label: string; value: string; kind?: "code" | "text" }>,
): void {
  writeEventHeader(writer, title, context);
  for (const item of metadata) {
    if (!item.value) continue;
    if (item.kind === "text") {
      writeTextMetadataLine(writer, item.label, item.value);
      continue;
    }

    writeCodeMetadataLine(writer, item.label, item.value);
  }
  writer.write("\n");
}

function writeErrorEvent(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  writeEventHeader(writer, "错误事件", context);
  writeCodeMetadataLine(writer, "codex_error_info", stringFromUnknown(payload.codex_error_info));
  writer.write("\n");

  const message = stringFromUnknown(payload.message);
  if (!message) return;

  if (context.detail === "full") {
    writer.write("#### message\n\n");
    writer.write(fencedBlock("text", message));
    return;
  }

  writeTextMetadataLine(writer, "message", previewValue(message));
  writer.write("\n");
}

function writeMcpToolCallEnd(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  const invocation = isRecord(payload.invocation) ? payload.invocation : {};
  const result = isRecord(payload.result) ? payload.result : {};

  writeSimpleEvent(writer, context, "MCP 工具调用完成", [
    { label: "call_id", value: stringFromUnknown(payload.call_id) },
    { label: "server", value: stringFromUnknown(invocation.server) },
    { label: "tool", value: stringFromUnknown(invocation.tool) },
    { label: "duration", value: formatDuration(payload.duration) },
    { label: "result", value: previewValue(result.Err || result.Ok || result, 180), kind: "text" },
  ]);
}

function writeMcpToolCallBegin(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  const invocation = isRecord(payload.invocation) ? payload.invocation : {};

  writeEventHeader(writer, "MCP 工具调用开始", context);
  writeCodeMetadataLine(writer, "call_id", stringFromUnknown(payload.call_id));
  writeCodeMetadataLine(writer, "server", stringFromUnknown(invocation.server));
  writeCodeMetadataLine(writer, "tool", stringFromUnknown(invocation.tool));

  if (context.detail === "full") {
    writeJsonBlockField(writer, "arguments", invocation.arguments);
  } else {
    writeTextMetadataLine(writer, "arguments", previewValue(invocation.arguments, 180));
  }

  writer.write("\n");
}

function writeDynamicToolCallRequest(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  writeEventHeader(writer, "动态工具调用请求", context);
  writeCodeMetadataLine(writer, "call_id", stringFromUnknown(payload.call_id));
  writeCodeMetadataLine(writer, "tool", stringFromUnknown(payload.tool_name || payload.name || payload.tool));

  if (context.detail === "full") {
    writeJsonBlockField(writer, "arguments", payload.arguments);
  } else {
    writeTextMetadataLine(writer, "arguments", previewValue(payload.arguments, 180));
  }

  writer.write("\n");
}

function writeDynamicToolCallResponse(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  writeEventHeader(writer, "动态工具调用响应", context);
  writeCodeMetadataLine(writer, "call_id", stringFromUnknown(payload.call_id));
  writeCodeMetadataLine(writer, "tool", stringFromUnknown(payload.tool_name || payload.name || payload.tool));
  writeCodeMetadataLine(writer, "success", stringFromUnknown(payload.success));
  writeCodeMetadataLine(writer, "duration", formatDuration(payload.duration));
  writeTextMetadataLine(writer, "error", previewValue(payload.error, 180));

  if (context.detail === "full") {
    writeJsonBlockField(writer, "content_items", payload.content_items);
  } else {
    writeTextMetadataLine(writer, "content", previewValue(payload.content_items, 180));
  }

  writer.write("\n");
}

function writeTerminalInteraction(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  writeEventHeader(writer, "终端交互", context);
  writeCodeMetadataLine(writer, "call_id", stringFromUnknown(payload.call_id));
  writeTextMetadataLine(writer, "stdin", previewValue(payload.stdin, 120));

  const stdout = stringFromUnknown(payload.stdout || payload.output);
  if (context.detail === "full" && stdout) {
    writer.write("\n#### stdout\n\n");
    writer.write(fencedBlock("text", stdout));
    return;
  }

  writeTextMetadataLine(writer, "stdout", previewValue(stdout, 180));
  writer.write("\n");
}

function writePatchUpdatedEvent(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  writeEventHeader(writer, "补丁更新", context);
  writeCodeMetadataLine(writer, "call_id", stringFromUnknown(payload.call_id));
  writer.write("\n");

  const changes = payload.changes && typeof payload.changes === "object" ? payload.changes : {};
  for (const [filePath, change] of Object.entries(changes)) {
    const record = isRecord(change) ? change : {};
    const type = typeof record.type === "string" ? record.type : "unknown";
    writer.write(`#### ${type} \`${filePath}\`\n\n`);

    if (context.detail === "full") {
      writer.write(fencedBlock("diff", fileChangeDiff(filePath, change)));
      continue;
    }

    const stat = fileChangeStat(change);
    writeCodeMetadataLine(writer, "diff_stat", `+${stat.added} / -${stat.removed}`);
    writer.write("\n");
  }
}

function writeTurnDiffEvent(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  writeEventHeader(writer, "回合 diff", context);
  const diff = stringFromUnknown(payload.unified_diff);

  if (context.detail === "full" && diff) {
    writer.write("\n");
    writer.write(fencedBlock("diff", diff));
    return;
  }

  const stat = fileChangeStat({ type: "update", unified_diff: diff });
  writeCodeMetadataLine(writer, "diff_stat", `+${stat.added} / -${stat.removed}`);
  writer.write("\n");
}

function writeUnknownWorkflowEvent(writer: Writer, context: EventRenderContext, payload: JsonRecord): void {
  writeEventHeader(writer, "未归类事件", context);
  writeCodeMetadataLine(writer, "type", stringFromUnknown(payload.type));
  writeTextMetadataLine(writer, "summary", previewValue(payload, 220));

  if (context.detail === "full") {
    writeJsonBlockField(writer, "payload", payload);
  }

  writer.write("\n");
}

function writeCollabEvent(
  writer: Writer,
  context: EventRenderContext,
  title: string,
  payload: JsonRecord,
  nameKey: string,
  roleKey: string,
): void {
  writeSimpleEvent(writer, context, title, [
    { label: "call_id", value: stringFromUnknown(payload.call_id) },
    { label: "agent", value: stringFromUnknown(payload[nameKey]) },
    { label: "role", value: stringFromUnknown(payload[roleKey]) },
    { label: "status", value: previewValue(payload.status), kind: "text" },
    { label: "prompt", value: previewValue(payload.prompt, 160), kind: "text" },
  ]);
}

function writeWorkflowEventFromEventMsg(
  writer: Writer,
  context: EventRenderContext,
  payload: JsonRecord,
): boolean {
  const type = stringFromUnknown(payload.type);

  switch (type) {
    case "exec_command_end":
      writeExecCommandEvent(writer, context, payload);
      return true;
    case "patch_apply_end":
      writePatchApplyEvent(writer, context, payload);
      return true;
    case "task_started":
      writeSimpleEvent(writer, context, "任务开始", [
        { label: "turn_id", value: stringFromUnknown(payload.turn_id) },
        { label: "context_window", value: stringFromUnknown(payload.model_context_window) },
        { label: "collaboration_mode", value: stringFromUnknown(payload.collaboration_mode_kind) },
      ]);
      return true;
    case "task_complete":
      writeSimpleEvent(writer, context, "任务完成", [
        { label: "turn_id", value: stringFromUnknown(payload.turn_id) },
        { label: "summary", value: previewValue(payload.last_agent_message), kind: "text" },
      ]);
      return true;
    case "thread_settings_applied": {
      const settings = isRecord(payload.thread_settings) ? payload.thread_settings : payload;
      writeSimpleEvent(writer, context, "线程设置已应用", [
        { label: "model", value: stringFromUnknown(settings.model) },
        { label: "model_provider", value: stringFromUnknown(settings.model_provider_id || settings.model_provider) },
        { label: "cwd", value: stringFromUnknown(settings.cwd) },
      ]);
      return true;
    }
    case "thread_goal_updated":
      writeSimpleEvent(writer, context, "目标更新", [
        { label: "goal_id", value: stringFromUnknown(payload.goal_id || payload.id) },
        { label: "status", value: stringFromUnknown(payload.status) },
        { label: "description", value: previewValue(payload.description || payload.text || payload.goal, 180), kind: "text" },
      ]);
      return true;
    case "mcp_startup_update":
      writeSimpleEvent(writer, context, "MCP 启动更新", [
        { label: "server", value: stringFromUnknown(payload.server) },
        { label: "status", value: previewValue(payload.status, 180), kind: "text" },
      ]);
      return true;
    case "mcp_startup_complete":
      writeSimpleEvent(writer, context, "MCP 启动完成", [
        { label: "ready", value: previewValue(payload.ready, 180), kind: "text" },
        { label: "failed", value: previewValue(payload.failed, 180), kind: "text" },
        { label: "cancelled", value: previewValue(payload.cancelled, 180), kind: "text" },
      ]);
      return true;
    case "turn_aborted":
      writeSimpleEvent(writer, context, "回合中断", [
        { label: "reason", value: stringFromUnknown(payload.reason) },
      ]);
      return true;
    case "context_compacted":
      writeSimpleEvent(writer, context, "上下文压缩", [
        { label: "effect", value: "后续回合可能基于压缩摘要继续工作", kind: "text" },
      ]);
      return true;
    case "thread_rolled_back":
      writeSimpleEvent(writer, context, "线程回滚", [
        { label: "num_turns", value: stringFromUnknown(payload.num_turns) },
      ]);
      return true;
    case "web_search_end":
      writeSimpleEvent(writer, context, "网页搜索完成", [
        { label: "call_id", value: stringFromUnknown(payload.call_id) },
        { label: "query", value: previewValue(payload.query), kind: "text" },
        { label: "action", value: stringFromUnknown(isRecord(payload.action) ? payload.action.type : "") },
      ]);
      return true;
    case "mcp_tool_call_begin":
      writeMcpToolCallBegin(writer, context, payload);
      return true;
    case "mcp_tool_call_end":
      writeMcpToolCallEnd(writer, context, payload);
      return true;
    case "dynamic_tool_call_request":
      writeDynamicToolCallRequest(writer, context, payload);
      return true;
    case "dynamic_tool_call_response":
      writeDynamicToolCallResponse(writer, context, payload);
      return true;
    case "request_user_input":
      writeSimpleEvent(writer, context, "请求用户输入", [
        { label: "call_id", value: stringFromUnknown(payload.call_id) },
        { label: "prompt", value: previewValue(payload.prompt || payload.message || payload.question, 180), kind: "text" },
      ]);
      return true;
    case "terminal_interaction":
      writeTerminalInteraction(writer, context, payload);
      return true;
    case "patch_apply_updated":
      writePatchUpdatedEvent(writer, context, payload);
      return true;
    case "turn_diff":
      writeTurnDiffEvent(writer, context, payload);
      return true;
    case "stream_error":
      writeSimpleEvent(writer, context, "流式错误", [
        { label: "message", value: previewValue(payload.message || payload.error, 180), kind: "text" },
      ]);
      return true;
    case "model_reroute":
      writeSimpleEvent(writer, context, "模型重路由", [
        { label: "requested_model", value: stringFromUnknown(payload.requested_model || payload.from_model) },
        { label: "resolved_model", value: stringFromUnknown(payload.resolved_model || payload.to_model || payload.model) },
      ]);
      return true;
    case "model_verification":
      writeSimpleEvent(writer, context, "模型验证", [
        { label: "message", value: previewValue(payload.message || payload.reason, 180), kind: "text" },
      ]);
      return true;
    case "realtime_conversation_started":
      writeSimpleEvent(writer, context, "实时会话开始", [
        { label: "realtime_session_id", value: stringFromUnknown(payload.realtime_session_id) },
        { label: "version", value: stringFromUnknown(payload.version) },
      ]);
      return true;
    case "realtime_conversation_closed":
      writeSimpleEvent(writer, context, "实时会话关闭", [
        { label: "realtime_session_id", value: stringFromUnknown(payload.realtime_session_id) },
        { label: "reason", value: previewValue(payload.reason, 180), kind: "text" },
      ]);
      return true;
    case "realtime_conversation_realtime":
      writeSimpleEvent(writer, context, "实时会话事件", [
        { label: "realtime_session_id", value: stringFromUnknown(payload.realtime_session_id) },
        { label: "event", value: previewValue(payload.event || payload.payload, 180), kind: "text" },
      ]);
      return true;
    case "realtime_conversation_sdp":
      writeSimpleEvent(writer, context, "实时会话 SDP", [
        { label: "realtime_session_id", value: stringFromUnknown(payload.realtime_session_id) },
        { label: "sdp", value: previewValue(payload.sdp, 180), kind: "text" },
      ]);
      return true;
    case "realtime_conversation_list_voices_response":
      writeSimpleEvent(writer, context, "实时会话声音列表", [
        { label: "voices", value: previewValue(payload.voices, 180), kind: "text" },
      ]);
      return true;
    case "view_image_tool_call":
      writeSimpleEvent(writer, context, "查看图片", [
        { label: "call_id", value: stringFromUnknown(payload.call_id) },
        { label: "path", value: stringFromUnknown(payload.path) },
      ]);
      return true;
    case "collab_agent_spawn_end":
      writeCollabEvent(writer, context, "协作代理启动完成", payload, "new_agent_nickname", "new_agent_role");
      return true;
    case "collab_close_end":
      writeCollabEvent(writer, context, "协作代理关闭完成", payload, "receiver_agent_nickname", "receiver_agent_role");
      return true;
    case "collab_waiting_end":
      writeCollabEvent(writer, context, "协作代理等待完成", payload, "receiver_agent_nickname", "receiver_agent_role");
      return true;
    case "collab_agent_interaction_end":
      writeCollabEvent(writer, context, "协作代理交互完成", payload, "receiver_agent_nickname", "receiver_agent_role");
      return true;
    case "collab_resume_end":
      writeCollabEvent(writer, context, "协作代理恢复完成", payload, "receiver_agent_nickname", "receiver_agent_role");
      return true;
    case "item_completed": {
      const item = isRecord(payload.item) ? payload.item : {};
      writeSimpleEvent(writer, context, "计划项完成", [
        { label: "thread_id", value: stringFromUnknown(payload.thread_id) },
        { label: "turn_id", value: stringFromUnknown(payload.turn_id) },
        { label: "item_type", value: stringFromUnknown(item.type) },
        { label: "summary", value: previewValue(item.text, 180), kind: "text" },
      ]);
      return true;
    }
    case "thread_name_updated":
      writeSimpleEvent(writer, context, "线程名更新", [
        { label: "thread_name", value: stringFromUnknown(payload.thread_name), kind: "text" },
      ]);
      return true;
    case "error":
      writeErrorEvent(writer, context, payload);
      return true;
    default:
      if (context.detail !== "full" || !context.includeUnknownEvents) return false;

      writeUnknownWorkflowEvent(writer, context, payload);
      return true;
  }
}

function legacyExecPayloadFromResponseItems(callPayload: JsonRecord, outputPayload: JsonRecord): JsonRecord | null {
  const callId = typeof callPayload.call_id === "string" ? callPayload.call_id : "";
  const outputText = typeof outputPayload.output === "string" ? outputPayload.output : "";
  if (!callId || !outputText) return null;

  const argumentsText = typeof callPayload.arguments === "string" ? callPayload.arguments : "";
  const argumentsRecord = parseJsonRecord(argumentsText);
  const command =
    argumentsRecord && typeof argumentsRecord.cmd === "string"
      ? argumentsRecord.cmd
      : "";

  const envelope = parseLegacyExecCommandEnvelope(outputText);
  const payload: JsonRecord = {
    call_id: callId,
    parsed_cmd: command ? [{ type: "unknown", cmd: command }] : [{ type: "unknown", cmd: callId }],
    aggregated_output: envelope.output,
    status: envelope.exitCode === "" || envelope.exitCode === "0" ? "completed" : "failed",
  };

  if (command) {
    payload.command = [command];
    const inferredCwd = inferLegacyCommandCwd(command);
    if (inferredCwd) payload.cwd = inferredCwd;
  }

  if (envelope.duration) payload.duration = envelope.duration;
  if (envelope.exitCode) payload.exit_code = envelope.exitCode;

  return payload;
}

function legacyPatchPayloadFromResponseItems(callPayload: JsonRecord, outputPayload: JsonRecord): JsonRecord | null {
  const callId = typeof callPayload.call_id === "string" ? callPayload.call_id : "";
  const inputText = typeof callPayload.input === "string" ? callPayload.input : "";
  if (!callId || !inputText) return null;

  const outputText = typeof outputPayload.output === "string" ? outputPayload.output : "";
  const parsedOutput = parseJsonRecord(outputText);
  const metadata = parsedOutput && isRecord(parsedOutput.metadata) ? parsedOutput.metadata : {};
  const exitCode = stringFromUnknown(metadata.exit_code);

  const payload: JsonRecord = {
    call_id: callId,
    success: exitCode === "" || exitCode === "0",
    stdout:
      parsedOutput && typeof parsedOutput.output === "string"
        ? parsedOutput.output
        : outputText,
    changes: parseLegacyApplyPatchChanges(inputText),
  };

  return payload;
}

/**
 * 旧版 rollout 把命令与补丁记录成 response_item 成对事件：
 * - exec_command => function_call + function_call_output
 * - apply_patch => custom_tool_call + custom_tool_call_output
 *
 * 新版 timeline/events 已经围绕 end-event 渲染；这里把旧结构先折叠成同一语义，再复用
 * 现有命令/编辑事件渲染函数，避免旧版历史长期退化成“工具调用噪音”。
 */
function writeLegacyWorkflowEventFromResponseItem(
  writer: Writer,
  context: EventRenderContext,
  payload: JsonRecord,
  state: LegacyWorkflowState,
): boolean {
  if (payload.type === "function_call" && payload.name === "exec_command" && typeof payload.call_id === "string") {
    state.pendingExecCalls.set(payload.call_id, { context, payload });
    return true;
  }

  if (payload.type === "function_call_output" && typeof payload.call_id === "string") {
    const pending = state.pendingExecCalls.get(payload.call_id);
    if (!pending) return false;

    state.pendingExecCalls.delete(payload.call_id);
    const legacyPayload = legacyExecPayloadFromResponseItems(pending.payload, payload);
    if (!legacyPayload) return false;

    writeExecCommandEvent(writer, context, legacyPayload);
    return true;
  }

  if (payload.type === "custom_tool_call" && payload.name === "apply_patch" && typeof payload.call_id === "string") {
    state.pendingPatchCalls.set(payload.call_id, { context, payload });
    return true;
  }

  if (payload.type === "custom_tool_call_output" && typeof payload.call_id === "string") {
    const pending = state.pendingPatchCalls.get(payload.call_id);
    if (!pending) return false;

    state.pendingPatchCalls.delete(payload.call_id);
    const legacyPayload = legacyPatchPayloadFromResponseItems(pending.payload, payload);
    if (!legacyPayload) return false;

    writePatchApplyEvent(writer, context, legacyPayload);
    return true;
  }

  return false;
}

function writeWorkflowEventFromResponseItem(
  writer: Writer,
  context: EventRenderContext,
  payload: JsonRecord,
): boolean {
  const type = stringFromUnknown(payload.type);

  switch (type) {
    case "web_search_call": {
      const action = isRecord(payload.action) ? payload.action : {};
      writeSimpleEvent(writer, context, "网页搜索", [
        { label: "status", value: stringFromUnknown(payload.status) },
        { label: "action", value: stringFromUnknown(action.type) },
        { label: "query", value: previewValue(action.query, 180), kind: "text" },
      ]);
      return true;
    }
    case "tool_search_call": {
      const argumentsRecord = isRecord(payload.arguments) ? payload.arguments : {};
      writeSimpleEvent(writer, context, "工具搜索", [
        { label: "call_id", value: stringFromUnknown(payload.call_id) },
        { label: "status", value: stringFromUnknown(payload.status) },
        { label: "execution", value: stringFromUnknown(payload.execution) },
        { label: "query", value: previewValue(argumentsRecord.query, 180), kind: "text" },
        { label: "limit", value: stringFromUnknown(argumentsRecord.limit) },
      ]);
      return true;
    }
    case "tool_search_output":
      writeSimpleEvent(writer, context, "工具搜索结果", [
        { label: "call_id", value: stringFromUnknown(payload.call_id) },
        { label: "status", value: stringFromUnknown(payload.status) },
        { label: "execution", value: stringFromUnknown(payload.execution) },
        { label: "tool_count", value: String(Array.isArray(payload.tools) ? payload.tools.length : 0) },
      ]);
      return true;
    case "custom_tool_call":
      writeSimpleEvent(writer, context, `自定义工具调用：\`${stringFromUnknown(payload.name) || "unknown"}\``, [
        { label: "call_id", value: stringFromUnknown(payload.call_id) },
        { label: "status", value: stringFromUnknown(payload.status) },
        { label: "input_preview", value: previewValue(payload.input, 180), kind: "text" },
      ]);
      return true;
    case "custom_tool_call_output": {
      const outputText = stringFromUnknown(payload.output);
      const parsedOutput = parseJsonRecord(outputText);
      const metadata = parsedOutput && isRecord(parsedOutput.metadata) ? parsedOutput.metadata : {};

      writeSimpleEvent(writer, context, "自定义工具输出", [
        { label: "call_id", value: stringFromUnknown(payload.call_id) },
        { label: "exit_code", value: stringFromUnknown(metadata.exit_code) },
        { label: "duration_seconds", value: stringFromUnknown(metadata.duration_seconds) },
        { label: "output_preview", value: previewValue(parsedOutput?.output || outputText, 180), kind: "text" },
      ]);
      return true;
    }
    default:
      return false;
  }
}

function detectMessageSourcesFromRows(rows: readonly JsonlRow[]): {
  hasEventUserMessage: boolean;
  hasEventAgentMessage: boolean;
} {
  const flags = {
    hasEventUserMessage: false,
    hasEventAgentMessage: false,
  };

  for (let index = 0; index < rows.length && index < 20000; index += 1) {
    const obj = rows[index]?.obj;
    if (!obj || obj.type !== "event_msg" || !hasPayloadRecord(obj)) continue;

    const type = obj.payload.type;
    if (type === "user_message") flags.hasEventUserMessage = true;
    if (type === "agent_message") flags.hasEventAgentMessage = true;

    if (flags.hasEventUserMessage && flags.hasEventAgentMessage) break;
  }

  return flags;
}

export function writeMarkdownFromRows(
  rows: readonly JsonlRow[],
  sourceLabel: string,
  meta: SessionMeta | null,
  options: RenderOptions,
  writer: Writer,
): void {
  writer.write("# Codex 聊天记录导出\n\n");
  writer.write(`- 源文件：\`${sourceLabel}\`\n`);
  if (meta?.id) writer.write(`- sessionId：\`${String(meta.id)}\`\n`);
  if (meta?.timestamp) writer.write(`- 开始时间：\`${String(meta.timestamp)}\`\n`);
  if (meta?.cwd) writer.write(`- cwd：\`${String(meta.cwd)}\`\n`);
  if (meta?.originator) writer.write(`- originator：\`${String(meta.originator)}\`\n`);
  if (meta?.cli_version) writer.write(`- cli_version：\`${String(meta.cli_version)}\`\n`);
  writer.write("\n---\n\n");

  const messageSources = detectMessageSourcesFromRows(rows);
  const preferEventUserMessages = messageSources.hasEventUserMessage;
  const preferEventAgentMessages = messageSources.hasEventAgentMessage;
  const workflowDetail = eventDetailLevelForMode(options.mode);
  const shouldFilterEnvironmentContext = options.source === "history" && !options.includeEnvironmentContext;
  const legacyWorkflowState: LegacyWorkflowState = {
    pendingExecCalls: new Map<string, LegacyPendingResponseItem>(),
    pendingPatchCalls: new Map<string, LegacyPendingResponseItem>(),
  };

  for (const row of rows) {
    const obj = row.obj;
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : null;
    const eventContext: EventRenderContext = {
      ts,
      eventRef: eventRefFromLineNumber(row.lineNumber),
      detail: workflowDetail || "summary",
      includeUnknownEvents: options.includeUnknownEvents,
    };

    if (obj.type === "event_msg" && hasPayloadRecord(obj)) {
      const payload = obj.payload;
      const type = payload.type;

      if (preferEventUserMessages && type === "user_message") {
        writeTurn(writer, "用户", ts, payload.message, payload.images);
        continue;
      }

      if (preferEventAgentMessages && type === "agent_message") {
        writeTurn(writer, "Codex", ts, payload.message);
        continue;
      }

      if (options.includeAgentReasoning && type === "agent_reasoning") {
        writeTurn(writer, "Codex（reasoning）", ts, payload.text);
        continue;
      }

      if (workflowDetail && writeWorkflowEventFromEventMsg(writer, eventContext, payload)) {
        continue;
      }
    }

    if (obj.type === "response_item" && hasPayloadRecord(obj)) {
      const payload = obj.payload;

      if (workflowDetail && writeLegacyWorkflowEventFromResponseItem(writer, eventContext, payload, legacyWorkflowState)) {
        continue;
      }

      if (workflowDetail && writeWorkflowEventFromResponseItem(writer, eventContext, payload)) {
        continue;
      }
    }

    if (options.includeToolCalls && obj.type === "response_item" && hasPayloadRecord(obj)) {
      const payload = obj.payload;
      if (payload.type === "function_call" && typeof payload.name === "string") {
        const args = typeof payload.arguments === "string" ? payload.arguments : "";
        writer.write(`### 工具调用：\`${payload.name}\`${ts ? `（${ts}）` : ""}\n\n`);
        if (args) writer.write("```json\n" + args + "\n```\n\n");
        continue;
      }

      if (options.includeToolOutputs && payload.type === "function_call_output" && typeof payload.call_id === "string") {
        const output = typeof payload.output === "string" ? payload.output : "";
        writer.write(`### 工具输出：\`${payload.call_id}\`${ts ? `（${ts}）` : ""}\n\n`);
        if (output) writer.write("```text\n" + output + "\n```\n\n");
        continue;
      }
    }

    if (obj.type === "response_item" && hasPayloadRecord(obj)) {
      const payload = obj.payload;
      if (payload.type === "message" && typeof payload.role === "string") {
        const role = payload.role;
        if (preferEventUserMessages && role === "user") continue;
        if (preferEventAgentMessages && role === "assistant") continue;

        const text = extractTextFromResponseMessageContent(payload.content);
        if (!text.trim()) continue;
        if (
          shouldFilterEnvironmentContext &&
          (looksLikeEnvironmentContext(text) || looksLikeRuntimeContextInjection(text))
        ) {
          continue;
        }

        if (role === "user") {
          writeTurn(writer, "用户", ts, text);
          continue;
        }

        if (role === "assistant") {
          writeTurn(writer, "Codex", ts, text);
          continue;
        }

        if (role === "developer" && options.source === "context") {
          writeTurn(writer, "开发者", ts, text);
          continue;
        }
      }

      if (payload.type === "compaction" && options.source === "context") {
        writeCompactionTurn(writer, ts, payload.message);
        continue;
      }
    }
  }
}

export async function renderMarkdownFromJsonl(
  sourcePath: string,
  meta: SessionMeta | null,
  options: RenderOptions,
): Promise<string> {
  const rows = await readParsedJsonlRows(sourcePath);
  return renderMarkdownFromRows(rows, sourcePath, meta, options);
}

export function renderMarkdownFromRows(
  rows: readonly JsonlRow[],
  sourceLabel: string,
  meta: SessionMeta | null,
  options: RenderOptions,
): string {
  const chunks: string[] = [];
  writeMarkdownFromRows(rows, sourceLabel, meta, options, {
    write: (text) => chunks.push(text),
  });

  return chunks.join("");
}

export async function readJsonlForSync(
  filePath: string,
  options: {
    includeToolOutputs: boolean;
    includeEnvironmentContext: boolean;
  },
): Promise<string> {
  if (options.includeToolOutputs && options.includeEnvironmentContext) {
    return await fs.promises.readFile(filePath, "utf8");
  }

  return await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    const lines: string[] = [];

    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      rl.close();
      input.destroy();

      if (err) {
        reject(err);
        return;
      }

      resolve(lines.join("\n"));
    };

    rl.on("line", (line: string) => {
      const trimmed = String(line || "");
      if (!trimmed.trim()) {
        lines.push(line);
        return;
      }

      const obj = parseJsonRecord(trimmed);
      if (!obj) {
        lines.push(line);
        return;
      }

      if (!options.includeToolOutputs && isToolOutputEntry(obj)) return;
      if (!options.includeEnvironmentContext && isEnvironmentContextEntry(obj)) return;

      lines.push(line);
    });

    rl.on("close", () => finish());
    rl.on("error", (err: Error) => finish(err));
    input.on("error", (err: Error) => finish(err));
  });
}

function isToolOutputEntry(obj: JsonRecord): boolean {
  return obj.type === "response_item" && hasPayloadRecord(obj) && obj.payload.type === "function_call_output";
}

function isEnvironmentContextEntry(obj: JsonRecord): boolean {
  if (obj.type === "event_msg" && hasPayloadRecord(obj)) {
    if (obj.payload.type === "user_message" && typeof obj.payload.message === "string") {
      return looksLikeEnvironmentContext(obj.payload.message) || looksLikeRuntimeContextInjection(obj.payload.message);
    }
  }

  if (obj.type === "response_item" && hasPayloadRecord(obj)) {
    const payload = obj.payload;
    if (payload.type === "message" && typeof payload.role === "string") {
      const text = extractTextFromResponseMessageContent(payload.content);
      return looksLikeEnvironmentContext(text) || looksLikeRuntimeContextInjection(text);
    }
  }

  return false;
}

function hasPayloadRecord(obj: JsonRecord): obj is JsonRecord & { payload: JsonRecord } {
  return !!obj.payload && typeof obj.payload === "object" && !Array.isArray(obj.payload);
}
