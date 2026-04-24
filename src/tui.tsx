import fs from "node:fs";
import path from "node:path";
import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import {
  exportOneSession,
  resolveTuiOutputPath,
  TUI_NAMING_ORIGINAL,
  TUI_NAMING_THREAD_PREFIX,
} from "./export.js";
import { sessionDisplayLabel } from "./sessions.js";
import type { CliOptions, DisplayMode, MarkdownMode, SessionInfo, TuiNamingMode } from "./types.js";
import { expandHomeDir, formatPathForDisplay, safeStat, truncate } from "./utils.js";

type TuiStep = "pick" | "confirm" | "output" | "naming" | "exporting" | "done";
type SortBy = "updated" | "created";

interface TuiAppProps {
  sessions: SessionInfo[];
  opts: CliOptions;
}

interface ExportProgress {
  current: number;
  total: number;
  lastPath: string;
}

const NAMING_MODES: Array<{ value: TuiNamingMode; label: string }> = [
  {
    value: TUI_NAMING_THREAD_PREFIX,
    label: "线程名前缀 + 原始 session 文件名（线程名最多 50 UTF-8 字节）",
  },
  {
    value: TUI_NAMING_ORIGINAL,
    label: "原始 session 文件名",
  },
];

export async function runTui(opts: CliOptions, sessions: SessionInfo[]): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("tui 需要在交互式终端中运行");
  }

  const instance = render(<TuiApp sessions={sessions} opts={opts} />);
  await instance.waitUntilExit();
}

function TuiApp({ sessions, opts }: TuiAppProps): React.ReactElement {
  const app = useApp();
  const { stdout } = useStdout();
  const [step, setStep] = useState<TuiStep>("pick");
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<MarkdownMode>(opts.mode);
  const [display, setDisplay] = useState<DisplayMode>(opts.display);
  const [sortBy, setSortBy] = useState<SortBy>("updated");
  const [status, setStatus] = useState("");
  const [outputInput, setOutputInput] = useState(opts.output || path.resolve(process.cwd(), "exports"));
  const [outputDir, setOutputDir] = useState("");
  const [namingCursor, setNamingCursor] = useState(0);
  const [progress, setProgress] = useState<ExportProgress>({
    current: 0,
    total: 0,
    lastPath: "",
  });

  const rows = stdout.rows || process.stdout.rows || 24;
  const columns = stdout.columns || process.stdout.columns || 100;
  const orderedSessions = sortSessions(sessions, sortBy);
  const total = orderedSessions.length;
  const visibleRows = Math.max(6, Math.min(18, rows - 10, total || 6));
  const maxWindowStart = Math.max(0, total - visibleRows);
  const windowStart = Math.max(0, Math.min(cursor - Math.floor(visibleRows / 2), maxWindowStart));
  const visibleSessions = orderedSessions.slice(windowStart, windowStart + visibleRows);
  const currentSelectionKey = orderedSessions[cursor] ? sessionSelectionKey(orderedSessions[cursor]) : null;
  const allSelectionKeys = orderedSessions.map(sessionSelectionKey);
  const selectedSessions = orderedSessions.filter((sessionInfo) => selected.has(sessionSelectionKey(sessionInfo)));
  const nowMs = Date.now();

  useInput((input, key) => {
    if (step === "exporting") return;

    if (step === "done") {
      app.exit();
      return;
    }

    if (key.escape || input === "q") {
      setStatus("已取消");
      app.exit();
      return;
    }

    if (step === "pick") {
      handlePickInput(
        input,
        key,
        total,
        currentSelectionKey,
        allSelectionKeys,
        selected,
        setSelected,
        cursor,
        setCursor,
        setSortBy,
        setMode,
        setDisplay,
        setStatus,
        setStep,
      );
      return;
    }

    if (step === "confirm") {
      handleConfirmInput(input, key, setStep, setStatus, app.exit);
      return;
    }

    if (step === "output") {
      handleOutputInput(input, key, outputInput, setOutputInput, setOutputDir, setStatus, setStep);
      return;
    }

    if (step === "naming") {
      handleNamingInput(key, namingCursor, setNamingCursor, setStep);
    }
  });

  useEffect(() => {
    if (step !== "exporting") return;

    let cancelled = false;
    const namingMode = NAMING_MODES[namingCursor]?.value || TUI_NAMING_ORIGINAL;
    const exportOpts = {
      ...opts,
      mode,
      output: outputDir,
      format: "markdown" as const,
      namingMode,
    };

    async function runExport(): Promise<void> {
      await fs.promises.mkdir(outputDir, { recursive: true });

      for (let i = 0; i < selectedSessions.length; i += 1) {
        if (cancelled) return;

        const sessionInfo = selectedSessions[i];
        if (!sessionInfo) continue;

        const outPath = resolveTuiOutputPath(sessionInfo, outputDir, exportOpts);
        await exportOneSession(sessionInfo, outPath, exportOpts);
        setProgress({
          current: i + 1,
          total: selectedSessions.length,
          lastPath: outPath,
        });
      }

      if (!cancelled) {
        setStatus(`完成：${selectedSessions.length} 个会话`);
        setStep("done");
      }
    }

    runExport().catch((error: unknown) => {
      setStatus(error instanceof Error ? `错误：${error.message}` : "错误：导出失败");
      setStep("done");
    });

    return () => {
      cancelled = true;
    };
  }, [step]);

  return (
    <Box flexDirection="column">
      <Header mode={mode} display={display} sortBy={sortBy} selectedCount={selected.size} total={total} />

      {step === "pick" && (
        <PickView
          sessions={visibleSessions}
          windowStart={windowStart}
          cursor={cursor}
          selected={selected}
          display={display}
          columns={columns}
          nowMs={nowMs}
        />
      )}

      {step === "confirm" && <ConfirmView count={selected.size} />}
      {step === "output" && <OutputView value={outputInput} status={status} />}
      {step === "naming" && <NamingView cursor={namingCursor} />}
      {step === "exporting" && <ExportingView progress={progress} />}
      {step === "done" && <DoneView status={status} />}

      {step === "pick" && <Footer status={status} />}
    </Box>
  );
}

function Header(props: {
  mode: MarkdownMode;
  display: DisplayMode;
  sortBy: SortBy;
  selectedCount: number;
  total: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>选择要导出的会话</Text>
      <Text>
        显示：{props.display}  Markdown：{props.mode}  排序：{sortByLabel(props.sortBy)}  已选：
        {props.selectedCount}/{props.total}
      </Text>
    </Box>
  );
}

function PickView(props: {
  sessions: SessionInfo[];
  windowStart: number;
  cursor: number;
  selected: Set<string>;
  display: DisplayMode;
  columns: number;
  nowMs: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        {formatTuiHeader(props.columns)}
      </Text>
      {props.sessions.map((sessionInfo, localIndex) => {
        const index = props.windowStart + localIndex;
        const active = index === props.cursor;
        const checked = props.selected.has(sessionSelectionKey(sessionInfo));

        return (
          <Text key={sessionInfo.filePath} color={active ? "cyan" : undefined} inverse={active} wrap="truncate-end">
            {formatTuiRow(sessionInfo, index, checked, active, props.display, props.columns, props.nowMs)}
          </Text>
        );
      })}
    </Box>
  );
}

function ConfirmView({ count }: { count: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>确认导出 {count} 个会话？</Text>
      <Text dimColor>Enter/y 确认，n/q 取消</Text>
    </Box>
  );
}

function OutputView({ value, status }: { value: string; status: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>导出目录路径：</Text>
      <Text color="cyan">{value}</Text>
      <Text dimColor>输入路径后按 Enter，Backspace 删除，Esc 取消</Text>
      {status ? <Text color="red">{status}</Text> : null}
    </Box>
  );
}

function NamingView({ cursor }: { cursor: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>导出文件命名方式：</Text>
      {NAMING_MODES.map((item, index) => (
        <Text key={item.value} color={index === cursor ? "cyan" : undefined} inverse={index === cursor}>
          {index === cursor ? "> " : "  "}
          {item.label}
        </Text>
      ))}
      <Text dimColor>上下切换，Enter 确认</Text>
    </Box>
  );
}

function ExportingView({ progress }: { progress: ExportProgress }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>正在导出：{progress.current}/{progress.total || "..."}</Text>
      {progress.lastPath ? <Text dimColor>{progress.lastPath}</Text> : null}
    </Box>
  );
}

function DoneView({ status }: { status: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>{status}</Text>
      <Text dimColor>按任意键退出</Text>
    </Box>
  );
}

function Footer({ status }: { status: string }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor wrap="truncate-end">↑/↓ 移动，Space 选择，a 全选/反选，Enter 确认</Text>
      <Text dimColor wrap="truncate-end">m 切换 default/events，d 切换线程名/文件名，s/Tab 切换排序，q 退出</Text>
      {status ? <Text color="yellow">{status}</Text> : null}
    </Box>
  );
}

function handlePickInput(
  input: string,
  key: { upArrow?: boolean; downArrow?: boolean; pageUp?: boolean; pageDown?: boolean; return?: boolean; tab?: boolean },
  total: number,
  currentSelectionKey: string | null,
  allSelectionKeys: string[],
  selected: Set<string>,
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
  cursor: number,
  setCursor: React.Dispatch<React.SetStateAction<number>>,
  setSortBy: React.Dispatch<React.SetStateAction<SortBy>>,
  setMode: React.Dispatch<React.SetStateAction<MarkdownMode>>,
  setDisplay: React.Dispatch<React.SetStateAction<DisplayMode>>,
  setStatus: React.Dispatch<React.SetStateAction<string>>,
  setStep: React.Dispatch<React.SetStateAction<TuiStep>>,
): void {
  if (total <= 0) return;

  if (key.upArrow) {
    setCursor(Math.max(0, cursor - 1));
    return;
  }

  if (key.downArrow) {
    setCursor(Math.min(total - 1, cursor + 1));
    return;
  }

  if (key.pageUp) {
    setCursor(Math.max(0, cursor - 10));
    return;
  }

  if (key.pageDown) {
    setCursor(Math.min(total - 1, cursor + 10));
    return;
  }

  if (input === " ") {
    if (currentSelectionKey) setSelected((current) => toggleSelected(current, currentSelectionKey));
    return;
  }

  if (input === "a") {
    setSelected((current) => {
      if (current.size === total) return new Set();
      return new Set(allSelectionKeys);
    });
    return;
  }

  if (input === "s" || input === "\t" || key.tab) {
    setSortBy((current) => (current === "updated" ? "created" : "updated"));
    setCursor(0);
    setStatus("");
    return;
  }

  if (input === "m") {
    setMode((current) => (current === "events" ? "default" : "events"));
    return;
  }

  if (input === "d") {
    setDisplay((current) => (current === "thread" ? "file" : "thread"));
    return;
  }

  if (key.return) {
    if (selected.size === 0) {
      setStatus("未选择会话");
      return;
    }

    setStatus("");
    setStep("confirm");
  }
}

function handleConfirmInput(
  input: string,
  key: { return?: boolean },
  setStep: React.Dispatch<React.SetStateAction<TuiStep>>,
  setStatus: React.Dispatch<React.SetStateAction<string>>,
  exit: () => void,
): void {
  if (key.return || input === "y" || input === "Y") {
    setStatus("");
    setStep("output");
    return;
  }

  if (input === "n" || input === "N") {
    setStatus("已取消");
    exit();
  }
}

function handleOutputInput(
  input: string,
  key: { return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; name?: string },
  outputInput: string,
  setOutputInput: React.Dispatch<React.SetStateAction<string>>,
  setOutputDir: React.Dispatch<React.SetStateAction<string>>,
  setStatus: React.Dispatch<React.SetStateAction<string>>,
  setStep: React.Dispatch<React.SetStateAction<TuiStep>>,
): void {
  if (key.return) {
    const trimmed = outputInput.trim();
    if (!trimmed) {
      setStatus("导出目录不能为空");
      return;
    }

    const resolved = path.resolve(expandHomeDir(trimmed));
    if (fs.existsSync(resolved) && !safeStat(resolved)?.isDirectory()) {
      setStatus(`导出目录不是目录：${resolved}`);
      return;
    }

    setOutputDir(resolved);
    setStatus("");
    setStep("naming");
    return;
  }

  if (key.backspace || key.delete) {
    setOutputInput((current) => current.slice(0, -1));
    return;
  }

  if (key.ctrl && input === "u") {
    setOutputInput("");
    return;
  }

  if (input && !key.ctrl) {
    setOutputInput((current) => `${current}${input}`);
  }
}

function handleNamingInput(
  key: { upArrow?: boolean; downArrow?: boolean; return?: boolean },
  namingCursor: number,
  setNamingCursor: React.Dispatch<React.SetStateAction<number>>,
  setStep: React.Dispatch<React.SetStateAction<TuiStep>>,
): void {
  if (key.upArrow || key.downArrow) {
    setNamingCursor(namingCursor === 0 ? 1 : 0);
    return;
  }

  if (key.return) {
    setStep("exporting");
  }
}

function toggleSelected(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }

  return next;
}

function sessionSelectionKey(sessionInfo: SessionInfo): string {
  const id = sessionInfo.meta?.id?.trim();
  return id ? `id:${id}` : `path:${sessionInfo.filePath}`;
}

function sortSessions(sessions: SessionInfo[], sortBy: SortBy): SessionInfo[] {
  return [...sessions].sort((a, b) => {
    const timeDiff = sessionTimeMs(b, sortBy) - sessionTimeMs(a, sortBy);
    if (timeDiff !== 0) return timeDiff;

    return sessionDisplayLabel(a, "thread").localeCompare(sessionDisplayLabel(b, "thread"));
  });
}

function sortByLabel(sortBy: SortBy): string {
  return sortBy === "updated" ? "Updated" : "Created";
}

interface TuiColumnWidths {
  prefixWidth: number;
  timeWidth: number;
  branchWidth: number;
  projectWidth: number;
  labelWidth: number;
}

function tuiColumnWidths(columns: number): TuiColumnWidths {
  const prefixWidth = 10;
  const timeWidth = 13;
  const branchWidth = Math.max(7, Math.min(10, Math.floor(columns * 0.1)));
  const projectWidth = Math.max(14, Math.min(22, Math.floor(columns * 0.2)));
  const fixedWidth = prefixWidth + timeWidth * 2 + branchWidth + projectWidth + 5;
  const labelWidth = Math.max(8, columns - fixedWidth);

  return {
    prefixWidth,
    timeWidth,
    branchWidth,
    projectWidth,
    labelWidth,
  };
}

function formatTuiHeader(columns: number): string {
  const widths = tuiColumnWidths(columns);
  const created = "Created".padEnd(widths.timeWidth, " ");
  const updated = "Updated".padEnd(widths.timeWidth, " ");
  const branch = "Branch".padEnd(widths.branchWidth, " ");
  const project = "Project".padEnd(widths.projectWidth, " ");

  return `${" ".repeat(widths.prefixWidth)} ${created} ${updated} ${branch} ${project} Conversation`;
}

function formatTuiRow(
  sessionInfo: SessionInfo,
  index: number,
  checked: boolean,
  active: boolean,
  display: DisplayMode,
  columns: number,
  nowMs: number,
): string {
  const widths = tuiColumnWidths(columns);
  const created = formatRelativeAge(sessionTimeMs(sessionInfo, "created"), nowMs).padEnd(widths.timeWidth, " ");
  const updated = formatRelativeAge(sessionTimeMs(sessionInfo, "updated"), nowMs).padEnd(widths.timeWidth, " ");
  const branch = truncate(sessionInfo.meta?.git_branch?.trim() || "-", widths.branchWidth).padEnd(widths.branchWidth, " ");
  const project = truncate(formatPathForDisplay(sessionInfo.meta?.cwd), widths.projectWidth).padEnd(widths.projectWidth, " ");
  const label = truncate(sessionDisplayLabel(sessionInfo, display), widths.labelWidth);
  const marker = active ? ">" : " ";
  const checkbox = checked ? "[x]" : "[ ]";

  return `${marker} ${checkbox} ${String(index + 1).padStart(3, " ")}. ${created} ${updated} ${branch} ${project} ${label}`;
}

function sessionTimeMs(sessionInfo: SessionInfo, sortBy: SortBy): number {
  const iso = sortBy === "created" ? sessionInfo.meta?.timestamp : sessionInfo.meta?.updatedAt || sessionInfo.meta?.timestamp;
  const parsed = parseIsoTimeMs(iso);
  if (parsed !== null) return parsed;

  const fallback = sortBy === "created" ? sessionInfo.mtimeMs ?? sessionInfo.sortKey : sessionInfo.sortKey;
  return Number.isFinite(fallback) ? fallback : 0;
}

function parseIsoTimeMs(value: string | undefined): number | null {
  if (!value) return null;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRelativeAge(timeMs: number, nowMs: number): string {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return "-";

  const seconds = Math.max(0, Math.floor((nowMs - timeMs) / 1000));
  if (seconds < 60) return pluralAge(seconds, "second");

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return pluralAge(minutes, "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return pluralAge(hours, "hour");

  const days = Math.floor(hours / 24);
  return pluralAge(days, "day");
}

function pluralAge(value: number, unit: "second" | "minute" | "hour" | "day"): string {
  return value === 1 ? `${value} ${unit} ago` : `${value} ${unit}s ago`;
}
