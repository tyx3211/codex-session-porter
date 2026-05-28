export type ExportFormat = "markdown" | "jsonl";

export type MarkdownMode = "default" | "timeline" | "events";

export type ExportSource = "history" | "context";

export type DisplayMode = "thread" | "file";

export type TuiNamingMode = "original" | "thread-prefix";

export interface CliOptions {
  codexDir: string;
  format: ExportFormat;
  source: ExportSource;
  mode: MarkdownMode;
  display: DisplayMode;
  output: string;
  tui: boolean;
  handoff: boolean;
  latest: boolean;
  all: boolean;
  list: boolean;
  pick: string;
  input: string[];
  includeAgentReasoning: boolean;
  includeToolCalls: boolean;
  includeToolOutputs: boolean;
  includeEnvironmentContext: boolean;
  includeUnknownEvents: boolean;
  onlyVsCode: boolean;
  help?: boolean;
}

export interface SessionMeta {
  id?: string;
  timestamp?: string;
  updatedAt?: string;
  cwd?: string;
  source?: string;
  originator?: string;
  model_provider?: string;
  cli_version?: string;
  git_branch?: string;
}

export interface SessionDisplayInfo {
  threadName?: string;
  preview?: string;
}

export interface SessionInfo {
  filePath: string;
  codexDir: string;
  source: string;
  stateSource?: string;
  mtimeMs: number | null;
  size: number | null;
  sortKey: number;
  meta: SessionMeta | null;
  displayInfo?: SessionDisplayInfo;
}

export interface ExportOptions extends CliOptions {
  namingMode?: TuiNamingMode;
}

export interface TuiResult {
  selected: SessionInfo[];
  outputDir: string;
  mode: MarkdownMode;
  namingMode: TuiNamingMode;
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}
