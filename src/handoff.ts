import fs from "node:fs";
import path from "node:path";
import { readParsedJsonlRows, reconstructContextCandidateRows, type JsonlRow } from "./context-source.js";
import { renderMarkdownFromRows } from "./render.js";
import { readSessionDisplayInfo } from "./sessions.js";
import type { SessionDisplayInfo, SessionInfo } from "./types.js";
import { expandHomeDir, sanitizeFileNameSegment, stringFromUnknown, truncateUtf8Bytes } from "./utils.js";
import { isRecord, stringValue, type JsonRecord } from "./guards.js";

interface HandoffTurnContextSummary {
  cwd: string;
  model: string;
  approvalPolicy: string;
  sandboxPolicy: string;
}

interface HandoffPackageFiles {
  readme: string;
  handoffSkill: string;
  contextEvents: string;
  contextTimeline: string;
  historyTimeline: string;
  historyEvents: string;
  sourceJsonl: string;
}

const HandoffSkillSourceUrl = new URL("../skills/cce-provider-handoff/SKILL.md", import.meta.url);
const HandoffSkillPackageFileName = "cce-provider-handoff.SKILL.md";

export async function exportHandoffPackages(sessions: readonly SessionInfo[], outputDir: string): Promise<string[]> {
  const rootDir = path.resolve(expandHomeDir(outputDir));
  await fs.promises.mkdir(rootDir, { recursive: true });

  const usedNames = new Set<string>();
  const outDirs: string[] = [];
  for (const sessionInfo of sessions) {
    const displayInfo = sessionInfo.displayInfo ?? (await readSessionDisplayInfo(sessionInfo.filePath));
    sessionInfo.displayInfo = displayInfo;

    const packageName = uniquePackageName(handoffPackageBaseName(sessionInfo, displayInfo), usedNames);
    const packageDir = path.join(rootDir, packageName);
    await fs.promises.mkdir(packageDir, { recursive: true });
    await writeHandoffPackage(sessionInfo, displayInfo, packageDir);
    outDirs.push(packageDir);
  }

  return outDirs;
}

function handoffPackageBaseName(
  sessionInfo: Pick<SessionInfo, "filePath">,
  displayInfo: SessionDisplayInfo,
): string {
  const rolloutName = path.basename(sessionInfo.filePath, ".jsonl");
  const safeRolloutName = sanitizeFileNameSegment(rolloutName) || "rollout";
  const safeThreadName = truncateUtf8Bytes(sanitizeFileNameSegment(displayInfo.threadName || ""), 50);
  if (!safeThreadName) return safeRolloutName;

  return `${safeThreadName}-${safeRolloutName}`;
}

function uniquePackageName(baseName: string, usedNames: Set<string>): string {
  let candidate = baseName;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}-${index}`;
    index += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

async function writeHandoffPackage(
  sessionInfo: SessionInfo,
  displayInfo: SessionDisplayInfo,
  packageDir: string,
): Promise<void> {
  const files: HandoffPackageFiles = {
    readme: path.join(packageDir, "README.md"),
    handoffSkill: path.join(packageDir, HandoffSkillPackageFileName),
    contextEvents: path.join(packageDir, "context-events.md"),
    contextTimeline: path.join(packageDir, "context-timeline.md"),
    historyTimeline: path.join(packageDir, "history-timeline.md"),
    historyEvents: path.join(packageDir, "history-events.md"),
    sourceJsonl: path.join(packageDir, "source.jsonl"),
  };
  const sourceText = await fs.promises.readFile(sessionInfo.filePath, "utf8");
  await fs.promises.writeFile(files.sourceJsonl, sourceText, "utf8");
  await fs.promises.copyFile(HandoffSkillSourceUrl, files.handoffSkill);

  const rows = await readParsedJsonlRows(files.sourceJsonl);
  const contextRows = reconstructContextCandidateRows(rows);
  const turnContext = latestTurnContextSummary(rows);

  await fs.promises.writeFile(
    files.contextTimeline,
    renderMarkdownFromRows(contextRows, `${files.sourceJsonl}#context`, sessionInfo.meta, {
      source: "context",
      includeAgentReasoning: false,
      includeToolCalls: false,
      includeToolOutputs: false,
      includeEnvironmentContext: false,
      mode: "timeline",
    }),
    "utf8",
  );
  await fs.promises.writeFile(
    files.contextEvents,
    renderMarkdownFromRows(contextRows, `${files.sourceJsonl}#context`, sessionInfo.meta, {
      source: "context",
      includeAgentReasoning: false,
      includeToolCalls: false,
      includeToolOutputs: false,
      includeEnvironmentContext: false,
      mode: "events",
    }),
    "utf8",
  );
  await fs.promises.writeFile(
    files.historyTimeline,
    renderMarkdownFromRows(rows, files.sourceJsonl, sessionInfo.meta, {
      source: "history",
      includeAgentReasoning: false,
      includeToolCalls: false,
      includeToolOutputs: false,
      includeEnvironmentContext: false,
      mode: "timeline",
    }),
    "utf8",
  );
  await fs.promises.writeFile(
    files.historyEvents,
    renderMarkdownFromRows(rows, files.sourceJsonl, sessionInfo.meta, {
      source: "history",
      includeAgentReasoning: false,
      includeToolCalls: false,
      includeToolOutputs: false,
      includeEnvironmentContext: false,
      mode: "events",
    }),
    "utf8",
  );
  await fs.promises.writeFile(
    files.readme,
    renderHandoffReadme({
      sessionInfo,
      displayInfo,
      packageDir,
      files,
      turnContext,
    }),
    "utf8",
  );
}

function latestTurnContextSummary(rows: readonly JsonlRow[]): HandoffTurnContextSummary | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (stringValue(row.obj.type) !== "turn_context") continue;
    if (!isRecord(row.obj.payload)) continue;

    const payload = row.obj.payload;
    return {
      cwd: stringValue(payload.cwd),
      model: stringValue(payload.model),
      approvalPolicy: stringValue(payload.approval_policy),
      sandboxPolicy: summarizeSandboxPolicy(payload.sandbox_policy),
    };
  }

  return null;
}

function summarizeSandboxPolicy(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";

  return stringValue(value.type) || previewJson(value, 120);
}

function previewJson(value: JsonRecord, maxLen: number): string {
  try {
    const text = JSON.stringify(value);
    return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
  } catch {
    return stringFromUnknown(value);
  }
}

function renderHandoffReadme(input: {
  sessionInfo: SessionInfo;
  displayInfo: SessionDisplayInfo;
  packageDir: string;
  files: HandoffPackageFiles;
  turnContext: HandoffTurnContextSummary | null;
}): string {
  const { sessionInfo, displayInfo, packageDir, files, turnContext } = input;
  const meta = sessionInfo.meta;
  const threadName = displayInfo.threadName || displayInfo.preview || path.basename(sessionInfo.filePath);
  const cwd = turnContext?.cwd || meta?.cwd || "";

  return `# Provider Handoff 接续包

这个目录用于在切换 provider、切换账号或开启新 agent 对话后，尽量无损接续原 Codex 任务。

## 会话信息

- 线程名：${threadName}
- 原始 JSONL：\`${sessionInfo.filePath}\`
- 包内 JSONL：\`${files.sourceJsonl}\`
- 接续包目录：\`${packageDir}\`
- 导出时间：\`${new Date().toISOString()}\`
${metadataLine("sessionId", meta?.id)}
${metadataLine("开始时间", meta?.timestamp)}
${metadataLine("更新时间", meta?.updatedAt)}
${metadataLine("项目目录", cwd)}
${metadataLine("originator", meta?.originator)}
${metadataLine("cli_version", meta?.cli_version)}
${metadataLine("model", turnContext?.model)}
${metadataLine("approval_policy", turnContext?.approvalPolicy)}
${metadataLine("sandbox_policy", turnContext?.sandboxPolicy)}

## 阅读顺序

cce-provider-handoff.SKILL.md -> context-timeline.md -> context-events.md -> history-timeline.md -> history-events.md

1. 如果 agent 支持 Codex skill，请明确说：“请使用 cce-provider-handoff skill 接续”。如果 skill 未安装，就先读包内 \`${HandoffSkillPackageFileName}\` 并遵守它。
2. 第一轮 turn 只恢复状态：读取 handoff 文档、必要源码和回查材料，汇报接续理解、任务状态、风险点和下一步计划；不要直接写文件、改文件、提交或 push。
3. 再读 \`context-timeline.md\`，先建立当前任务骨架。
4. 必须读 \`context-events.md\`，它是当前真实模型可见上下文的详细版，会展开 context 内的命令输出、工具输出和 diff 细节。
5. 需要理解完整工作流时，读 \`history-timeline.md\`，它保留所有关键事件的 \`event_ref\`。
6. 只有需要追查更早的具体命令输出、完整 diff、MCP 或动态工具细节时，再读 \`history-events.md\` 或用 \`event_ref\` 回查 \`source.jsonl\`。

## 回查方法

如果在 \`history-timeline.md\` 里看到某个 \`event_ref\`，可以用仓库内置脚本精确回查：

~~~bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \\
  --source-jsonl ${files.sourceJsonl} \\
  --event-ref E000123
~~~

不要一开始全文读取 \`history-events.md\`；它是完整审计材料，通常只在定位具体事件时使用。
`;
}

function metadataLine(label: string, value: unknown): string {
  const text = stringValue(value);
  if (!text) return "";

  return `- ${label}：\`${text}\`\n`;
}
