import fs from "node:fs";
import readline from "node:readline";
import { once } from "node:events";
import { isRecord, parseJsonRecord, type JsonRecord } from "./guards.js";
import type { CliOptions, SessionMeta } from "./types.js";
import { looksLikeEnvironmentContext, stringFromUnknown } from "./utils.js";

interface Writer {
  write(text: string): void;
}

export interface RenderOptions {
  includeAgentReasoning: boolean;
  includeToolCalls: boolean;
  includeToolOutputs: boolean;
  includeEnvironmentContext: boolean;
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

function formatDuration(duration: unknown): string {
  if (!duration || typeof duration !== "object") return "";

  if (!isRecord(duration)) return "";

  const record = duration;
  const secs = Number(record.secs || 0);
  const nanos = Number(record.nanos || 0);
  const total = secs + nanos / 1000000000;
  if (!Number.isFinite(total) || total < 0) return "";

  return `${total.toFixed(3)}s`;
}

function commandLabel(payload: JsonRecord): string {
  const parsed = Array.isArray(payload.parsed_cmd) ? payload.parsed_cmd : [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;

    if (!isRecord(item)) continue;

    const record = item;
    if (typeof record.cmd === "string" && record.cmd.trim()) return record.cmd.trim();
  }

  const command: unknown[] = Array.isArray(payload.command) ? payload.command : [];
  if (command.length > 0) {
    const last = command[command.length - 1];
    if (typeof last === "string" && last.trim()) return last.trim();
  }

  return typeof payload.call_id === "string" && payload.call_id ? payload.call_id : "unknown";
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

function writeExecCommandEnd(writer: Writer, ts: string | null, payload: JsonRecord): void {
  const label = commandLabel(payload);
  writer.write(`### 命令执行：\`${label}\`${ts ? `（${ts}）` : ""}\n\n`);

  if (typeof payload.cwd === "string" && payload.cwd) {
    writer.write(`- cwd：\`${payload.cwd}\`\n`);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "exit_code")) {
    writer.write(`- exit_code：\`${String(payload.exit_code)}\`\n`);
  }

  if (typeof payload.status === "string" && payload.status) {
    writer.write(`- status：\`${payload.status}\`\n`);
  }

  const duration = formatDuration(payload.duration);
  if (duration) writer.write(`- duration：\`${duration}\`\n`);
  writer.write("\n");

  if (Array.isArray(payload.command) && payload.command.length > 0) {
    writer.write("#### command\n\n");
    writer.write(fencedBlock("json", JSON.stringify(payload.command, null, 2)));
  }

  if (Array.isArray(payload.parsed_cmd) && payload.parsed_cmd.length > 0) {
    writer.write("#### parsed_cmd\n\n");
    writer.write(fencedBlock("json", JSON.stringify(payload.parsed_cmd, null, 2)));
  }

  const output =
    typeof payload.aggregated_output === "string" && payload.aggregated_output
      ? payload.aggregated_output
      : [payload.stdout, payload.stderr].filter((value) => typeof value === "string" && value).join("\n");

  if (output) {
    writer.write("#### output\n\n");
    writer.write(fencedBlock("text", output));
  }
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

function writePatchApplyEnd(writer: Writer, ts: string | null, payload: JsonRecord): void {
  const callId = typeof payload.call_id === "string" && payload.call_id ? payload.call_id : "unknown";
  writer.write(`### 补丁应用：\`${callId}\`${ts ? `（${ts}）` : ""}\n\n`);

  if (Object.prototype.hasOwnProperty.call(payload, "success")) {
    writer.write(`- success：\`${String(payload.success)}\`\n`);
  }

  writer.write("\n");

  if (typeof payload.stdout === "string" && payload.stdout.trim()) {
    writer.write("#### stdout\n\n");
    writer.write(fencedBlock("text", payload.stdout));
  }

  if (typeof payload.stderr === "string" && payload.stderr.trim()) {
    writer.write("#### stderr\n\n");
    writer.write(fencedBlock("text", payload.stderr));
  }

  const changes = payload.changes && typeof payload.changes === "object" ? payload.changes : {};
  for (const [filePath, change] of Object.entries(changes)) {
    const record = isRecord(change) ? change : {};
    const type = typeof record.type === "string" ? record.type : "unknown";
    writer.write(`#### ${type} \`${filePath}\`\n\n`);
    writer.write(fencedBlock("diff", fileChangeDiff(filePath, change)));
  }
}

async function detectMessageSources(sourcePath: string): Promise<{
  hasEventUserMessage: boolean;
  hasEventAgentMessage: boolean;
}> {
  return await new Promise((resolve) => {
    const flags = {
      hasEventUserMessage: false,
      hasEventAgentMessage: false,
    };

    const input = fs.createReadStream(sourcePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    let settled = false;
    let lineCount = 0;
    const maxLines = 20000;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(flags);
      rl.close();
      input.destroy();
    };

    rl.on("line", (line) => {
      if (settled) return;
      lineCount += 1;

      const trimmed = String(line || "").trim();
      if (!trimmed) return;

      const obj = parseJsonRecord(trimmed);
      if (!obj) {
        if (lineCount >= maxLines) finish();
        return;
      }

      if (obj.type === "event_msg" && hasPayloadRecord(obj)) {
        const type = obj.payload.type;
        if (type === "user_message") flags.hasEventUserMessage = true;
        if (type === "agent_message") flags.hasEventAgentMessage = true;
      }

      if ((flags.hasEventUserMessage && flags.hasEventAgentMessage) || lineCount >= maxLines) {
        finish();
      }
    });

    rl.on("close", () => finish());
    rl.on("error", () => finish());
    input.on("error", () => finish());
  });
}

export async function writeMarkdownFromJsonl(
  sourcePath: string,
  meta: SessionMeta | null,
  options: RenderOptions,
  writer: Writer,
): Promise<void> {
  writer.write("# Codex 聊天记录导出\n\n");
  writer.write(`- 源文件：\`${sourcePath}\`\n`);
  if (meta?.id) writer.write(`- sessionId：\`${String(meta.id)}\`\n`);
  if (meta?.timestamp) writer.write(`- 开始时间：\`${String(meta.timestamp)}\`\n`);
  if (meta?.cwd) writer.write(`- cwd：\`${String(meta.cwd)}\`\n`);
  if (meta?.originator) writer.write(`- originator：\`${String(meta.originator)}\`\n`);
  if (meta?.cli_version) writer.write(`- cli_version：\`${String(meta.cli_version)}\`\n`);
  writer.write("\n---\n\n");

  const messageSources = await detectMessageSources(sourcePath);
  const preferEventUserMessages = messageSources.hasEventUserMessage;
  const preferEventAgentMessages = messageSources.hasEventAgentMessage;

  const input = fs.createReadStream(sourcePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    rl.on("line", (line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) return;

      const obj = parseJsonRecord(trimmed);
      if (!obj) return;

      const ts = typeof obj.timestamp === "string" ? obj.timestamp : null;

      if (obj.type === "event_msg" && hasPayloadRecord(obj)) {
        const payload = obj.payload;
        const type = payload.type;
        if (preferEventUserMessages && type === "user_message") {
          writeTurn(writer, "用户", ts, payload.message, payload.images);
          return;
        }

        if (preferEventAgentMessages && type === "agent_message") {
          writeTurn(writer, "Codex", ts, payload.message);
          return;
        }

        if (options.includeAgentReasoning && type === "agent_reasoning") {
          writeTurn(writer, "Codex（reasoning）", ts, payload.text);
          return;
        }

        if (options.mode === "events" && type === "exec_command_end") {
          writeExecCommandEnd(writer, ts, payload);
          return;
        }

        if (options.mode === "events" && type === "patch_apply_end") {
          writePatchApplyEnd(writer, ts, payload);
          return;
        }
      }

      if (options.includeToolCalls && obj.type === "response_item" && hasPayloadRecord(obj)) {
        const payload = obj.payload;
        if (payload.type === "function_call" && typeof payload.name === "string") {
          const args = typeof payload.arguments === "string" ? payload.arguments : "";
          writer.write(`### 工具调用：\`${payload.name}\`${ts ? `（${ts}）` : ""}\n\n`);
          if (args) writer.write("```json\n" + args + "\n```\n\n");
          return;
        }

        if (options.includeToolOutputs && payload.type === "function_call_output" && typeof payload.call_id === "string") {
          const output = typeof payload.output === "string" ? payload.output : "";
          writer.write(`### 工具输出：\`${payload.call_id}\`${ts ? `（${ts}）` : ""}\n\n`);
          if (output) writer.write("```text\n" + output + "\n```\n\n");
          return;
        }
      }

      if (obj.type === "response_item" && hasPayloadRecord(obj)) {
        const payload = obj.payload;
        if (payload.type === "message" && typeof payload.role === "string") {
          const role = payload.role;
          if (preferEventUserMessages && role === "user") return;
          if (preferEventAgentMessages && role === "assistant") return;

          const text = extractTextFromResponseMessageContent(payload.content);
          if (!text.trim()) return;
          if (!options.includeEnvironmentContext && looksLikeEnvironmentContext(text)) return;

          if (role === "user") {
            writeTurn(writer, "用户", ts, text);
            return;
          }

          if (role === "assistant") {
            writeTurn(writer, "Codex", ts, text);
          }
        }
      }
    });

    await once(rl, "close");
  } finally {
    rl.close();
    input.destroy();
  }
}

export async function renderMarkdownFromJsonl(
  sourcePath: string,
  meta: SessionMeta | null,
  options: RenderOptions,
): Promise<string> {
  const chunks: string[] = [];
  await writeMarkdownFromJsonl(sourcePath, meta, options, {
    write: (text) => chunks.push(text),
  });

  return chunks.join("");
}

export async function readJsonlForSync(filePath: string, options: {
  includeToolOutputs: boolean;
  includeEnvironmentContext: boolean;
}): Promise<string> {
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

    rl.on("line", (line) => {
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
    rl.on("error", (err) => finish(err));
    input.on("error", (err) => finish(err));
  });
}

function isToolOutputEntry(obj: JsonRecord): boolean {
  return obj.type === "response_item" && hasPayloadRecord(obj) && obj.payload.type === "function_call_output";
}

function isEnvironmentContextEntry(obj: JsonRecord): boolean {
  if (obj.type === "event_msg" && hasPayloadRecord(obj)) {
    if (obj.payload.type === "user_message" && typeof obj.payload.message === "string") {
      return looksLikeEnvironmentContext(obj.payload.message);
    }
  }

  if (obj.type === "response_item" && hasPayloadRecord(obj)) {
    const payload = obj.payload;
    if (payload.type === "message" && typeof payload.role === "string") {
      const text = extractTextFromResponseMessageContent(payload.content);
      return looksLikeEnvironmentContext(text);
    }
  }

  return false;
}

function hasPayloadRecord(obj: JsonRecord): obj is JsonRecord & { payload: JsonRecord } {
  return !!obj.payload && typeof obj.payload === "object" && !Array.isArray(obj.payload);
}
