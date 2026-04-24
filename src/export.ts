import fs from "node:fs";
import path from "node:path";
import type { ExportOptions, SessionInfo, TuiNamingMode } from "./types.js";
import { readJsonlForSync, renderMarkdownFromJsonl } from "./render.js";
import { expandHomeDir, safeStat, sanitizeFileNameSegment, truncateUtf8Bytes } from "./utils.js";

export const TUI_NAMING_ORIGINAL: TuiNamingMode = "original";
export const TUI_NAMING_THREAD_PREFIX: TuiNamingMode = "thread-prefix";

export function defaultExportFileName(filePath: string, format: ExportOptions["format"]): string {
  const base = path.basename(filePath, ".jsonl");
  return format === "markdown" ? `${base}.md` : `${base}.jsonl`;
}

export function resolveOutputPath(selected: SessionInfo[], opts: ExportOptions, sessionInfo: SessionInfo): string {
  const defaultName = defaultExportFileName(sessionInfo.filePath, opts.format);

  if (selected.length === 1) {
    if (!opts.output) return path.resolve(process.cwd(), defaultName);

    const resolved = path.resolve(expandHomeDir(opts.output));
    if (fs.existsSync(resolved) && safeStat(resolved)?.isDirectory()) {
      return path.join(resolved, defaultName);
    }

    if (!path.extname(resolved) && (opts.output.endsWith("/") || opts.output.endsWith("\\"))) {
      fs.mkdirSync(resolved, { recursive: true });
      return path.join(resolved, defaultName);
    }

    return resolved;
  }

  const outDir = opts.output ? path.resolve(expandHomeDir(opts.output)) : path.resolve(process.cwd(), "exports");
  fs.mkdirSync(outDir, { recursive: true });
  return path.join(outDir, defaultName);
}

export async function exportOneSession(sessionInfo: SessionInfo, outPath: string, opts: ExportOptions): Promise<void> {
  if (opts.format === "jsonl") {
    const jsonlText = await readJsonlForSync(sessionInfo.filePath, {
      includeToolOutputs: opts.includeToolOutputs,
      includeEnvironmentContext: opts.includeEnvironmentContext,
    });
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, jsonlText, "utf8");
    return;
  }

  const markdownText = await renderMarkdownFromJsonl(sessionInfo.filePath, sessionInfo.meta, {
    includeAgentReasoning: opts.includeAgentReasoning,
    includeToolCalls: opts.includeToolCalls,
    includeToolOutputs: opts.includeToolOutputs,
    includeEnvironmentContext: opts.includeEnvironmentContext,
    mode: opts.mode,
  });

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, markdownText, "utf8");
}

export function tuiExportFileName(
  sessionInfo: Pick<SessionInfo, "filePath" | "displayInfo">,
  opts: Pick<ExportOptions, "format" | "namingMode">,
): string {
  const originalName = defaultExportFileName(sessionInfo.filePath, opts.format);
  if (opts.namingMode !== TUI_NAMING_THREAD_PREFIX) return originalName;

  const threadName = sessionInfo.displayInfo?.threadName || "";
  const safePrefix = truncateUtf8Bytes(sanitizeFileNameSegment(threadName), 50);
  if (!safePrefix) return originalName;

  return `${safePrefix}-${originalName}`;
}

export function resolveTuiOutputPath(
  sessionInfo: Pick<SessionInfo, "filePath" | "displayInfo">,
  outputDir: string,
  opts: Pick<ExportOptions, "format" | "namingMode">,
): string {
  return path.join(path.resolve(expandHomeDir(outputDir || "exports")), tuiExportFileName(sessionInfo, opts));
}
