#!/usr/bin/env node

import fs from "node:fs";

function printUsage() {
  process.stdout.write(`Usage:
  node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs --markdown <timeline.md> --event-ref <E000123> [--format markdown|json]
  node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs --source-jsonl <session.jsonl> --event-ref <E000123> [--format markdown|json]
`);
}

function parseArgs(argv) {
  const options = {
    markdown: "",
    sourceJsonl: "",
    eventRef: "",
    format: "markdown",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--markdown":
        i += 1;
        options.markdown = argv[i] || "";
        break;
      case "--source-jsonl":
        i += 1;
        options.sourceJsonl = argv[i] || "";
        break;
      case "--event-ref":
        i += 1;
        options.eventRef = argv[i] || "";
        break;
      case "--format":
        i += 1;
        options.format = argv[i] || "";
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  if (!options.markdown && !options.sourceJsonl) {
    throw new Error("需要提供 --markdown 或 --source-jsonl");
  }

  if (!options.eventRef) {
    throw new Error("需要提供 --event-ref");
  }

  if (options.format !== "markdown" && options.format !== "json") {
    throw new Error("--format 仅支持 markdown/json");
  }

  return options;
}

function parseEventRef(eventRef) {
  const match = /^E(\d+)$/u.exec(eventRef);
  if (!match) {
    throw new Error(`非法 event_ref：${eventRef}`);
  }

  const lineNumber = Number(match[1]);
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
    throw new Error(`非法 event_ref：${eventRef}`);
  }

  return lineNumber;
}

function extractSourceJsonlFromMarkdown(markdownPath) {
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const match = markdown.match(/^- 源文件：`(.+)`$/mu);
  if (!match || !match[1]) {
    throw new Error(`无法从 Markdown 头部解析源 JSONL：${markdownPath}`);
  }

  return match[1];
}

function parseJsonRecord(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function stringFromUnknown(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  return "";
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fenceForContent(text) {
  const matches = text.match(/~{3,}/gu) || [];
  const length = matches.reduce((max, match) => Math.max(max, match.length + 1), 3);
  return "~".repeat(length);
}

function fencedBlock(lang, content) {
  const text = stringFromUnknown(content).replace(/\s+$/u, "");
  const fence = fenceForContent(text);
  return `${fence}${lang}\n${text}\n${fence}\n\n`;
}

function formatDuration(duration) {
  if (!isRecord(duration)) return "";

  const secs = Number(duration.secs || 0);
  const nanos = Number(duration.nanos || 0);
  const total = secs + nanos / 1000000000;
  if (!Number.isFinite(total) || total < 0) return "";

  return `${total.toFixed(3)}s`;
}

function commandLabel(payload) {
  const parsed = Array.isArray(payload.parsed_cmd) ? payload.parsed_cmd : [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    if (typeof item.cmd === "string" && item.cmd.trim()) return item.cmd.trim();
  }

  const command = Array.isArray(payload.command) ? payload.command : [];
  if (command.length > 0) {
    const last = command[command.length - 1];
    if (typeof last === "string" && last.trim()) return last.trim();
  }

  return typeof payload.call_id === "string" && payload.call_id ? payload.call_id : "unknown";
}

function commandActionKind(payload) {
  const parsed = Array.isArray(payload.parsed_cmd) ? payload.parsed_cmd : [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    if (typeof item.type === "string" && item.type.trim()) return item.type.trim();
  }

  return "";
}

function fileChangeDiff(filePath, change) {
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

/**
 * 这个脚本只负责“回查被 timeline 折叠掉的完整正文”，因此 Markdown 输出也只需要
 * 精确复现命令事件与补丁事件的完整版本。其他事件统一退回原始 JSON，可避免脚本和主
 * 渲染器在很多边角语义上发生漂移。
 */
function renderEventMarkdown(record, eventRef) {
  const timestamp = typeof record.timestamp === "string" ? record.timestamp : null;
  const payload = isRecord(record.payload) ? record.payload : null;
  if (!payload) {
    return `### 原始事件回查${timestamp ? `（${timestamp}）` : ""}\n\n- event_ref：\`${eventRef}\`\n\n${fencedBlock("json", JSON.stringify(record, null, 2))}`;
  }

  if (payload.type === "exec_command_end") {
    let out = `### 命令执行：\`${commandLabel(payload)}\`${timestamp ? `（${timestamp}）` : ""}\n\n`;
    out += `- event_ref：\`${eventRef}\`\n`;

    const action = commandActionKind(payload);
    if (action) out += `- action：\`${action}\`\n`;
    if (typeof payload.cwd === "string" && payload.cwd) out += `- cwd：\`${payload.cwd}\`\n`;
    if (Object.prototype.hasOwnProperty.call(payload, "exit_code")) out += `- exit_code：\`${String(payload.exit_code)}\`\n`;
    if (typeof payload.status === "string" && payload.status) out += `- status：\`${payload.status}\`\n`;

    const duration = formatDuration(payload.duration);
    if (duration) out += `- duration：\`${duration}\`\n`;
    out += "\n";

    if (Array.isArray(payload.command) && payload.command.length > 0) {
      out += "#### command\n\n";
      out += fencedBlock("json", JSON.stringify(payload.command, null, 2));
    }

    if (Array.isArray(payload.parsed_cmd) && payload.parsed_cmd.length > 0) {
      out += "#### parsed_cmd\n\n";
      out += fencedBlock("json", JSON.stringify(payload.parsed_cmd, null, 2));
    }

    const output =
      typeof payload.aggregated_output === "string" && payload.aggregated_output
        ? payload.aggregated_output
        : [payload.stdout, payload.stderr].filter((value) => typeof value === "string" && value).join("\n");

    if (output) {
      out += "#### output\n\n";
      out += fencedBlock("text", output);
    }

    return out;
  }

  if (payload.type === "patch_apply_end") {
    const callId = typeof payload.call_id === "string" && payload.call_id ? payload.call_id : "unknown";
    let out = `### 补丁应用：\`${callId}\`${timestamp ? `（${timestamp}）` : ""}\n\n`;
    out += `- event_ref：\`${eventRef}\`\n`;
    if (Object.prototype.hasOwnProperty.call(payload, "success")) out += `- success：\`${String(payload.success)}\`\n`;
    out += "\n";

    if (typeof payload.stdout === "string" && payload.stdout.trim()) {
      out += "#### stdout\n\n";
      out += fencedBlock("text", payload.stdout);
    }

    if (typeof payload.stderr === "string" && payload.stderr.trim()) {
      out += "#### stderr\n\n";
      out += fencedBlock("text", payload.stderr);
    }

    const changes = payload.changes && typeof payload.changes === "object" ? payload.changes : {};
    for (const [filePath, change] of Object.entries(changes)) {
      const type = isRecord(change) && typeof change.type === "string" ? change.type : "unknown";
      out += `#### ${type} \`${filePath}\`\n\n`;
      out += fencedBlock("diff", fileChangeDiff(filePath, change));
    }

    return out;
  }

  return `### 原始事件回查${timestamp ? `（${timestamp}）` : ""}\n\n- event_ref：\`${eventRef}\`\n\n${fencedBlock("json", JSON.stringify(record, null, 2))}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceJsonl = options.sourceJsonl || extractSourceJsonlFromMarkdown(options.markdown);
  const lineNumber = parseEventRef(options.eventRef);

  const lines = fs.readFileSync(sourceJsonl, "utf8").split(/\n/u);
  const rawLine = lines[lineNumber - 1];
  if (!rawLine || !rawLine.trim()) {
    throw new Error(`event_ref ${options.eventRef} 在 ${sourceJsonl} 中不存在`);
  }

  const record = parseJsonRecord(rawLine.trim());
  if (!record) {
    throw new Error(`event_ref ${options.eventRef} 指向的行不是合法 JSON 对象`);
  }

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderEventMarkdown(record, options.eventRef));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
