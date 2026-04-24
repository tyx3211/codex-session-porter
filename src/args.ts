import os from "node:os";
import path from "node:path";
import { CliError, type CliOptions } from "./types.js";
import { expandHomeDir } from "./utils.js";

export function printHelp(): void {
  const text = `
Codex Chat Export CLI

用途：从 ~/.codex 的历史 JSONL 导出 Markdown/JSONL（按 codex-chat-exporter 规则）

用法：
  cce [tui | --latest | --all | --pick 1,2 | --input <jsonl> ...] [选项]

选择会话：
  tui                        打开交互式会话选择器
  --latest                    导出最新会话
  --all                       导出全部会话
  --pick <i,j,k>              按索引选择（先按时间倒序）
  --input <file>              直接指定 JSONL 文件（可重复）
  --list                      仅列出会话索引（配合 --only-vscode / --codex-dir / --display）

会话发现：
  默认优先读取 Codex state_*.sqlite，只列出 cli/vscode 交互会话、未归档会话和存在的 rollout 文件；
  没有可用状态库时，回退到扫描 sessions/ 与 archived_sessions/。

导出配置：
  --format <markdown|jsonl>   导出格式，默认 markdown
  --mode <default|events>     Markdown 渲染模式；events 会展开 exec/patch 新事件
  --display <thread|file>     会话列表显示模式，默认 thread
  --output <path>             输出路径；单会话可为文件，多会话应为目录

过滤开关（默认都关闭）：
  --include-agent-reasoning
  --include-tool-calls
  --include-tool-outputs
  --include-environment-context
  --only-vscode               仅保留 originator=codex_vscode 或 source=vscode

路径配置：
  --codex-dir <dir>           默认 ~/.codex

其他：
  -h, --help                  显示帮助

示例：
  # 1) 导出最新会话为 markdown（只含 user/assistant）
  cce --latest

  # 2) 导出最新会话，包含 reasoning + 工具调用 + 工具输出
  cce --latest --include-agent-reasoning --include-tool-calls --include-tool-outputs

  # 3) 导出最新会话，并展开 Codex VS Code 的命令执行 / patch 新事件
  cce --latest --mode events --output ./latest-events.md

  # 4) 打开交互式会话选择器
  cce tui --mode events --output ./exports

  # 5) 按线程名/首条消息列出会话
  cce --list --display thread

  # 6) 导出指定会话索引到目录
  cce --pick 1,3 --output ./exports

  # 7) 直接导出某个 JSONL 文件
  cce --input ~/.codex/sessions/2026/02/02/rollout-xxx.jsonl --output ./one.md
`;
  process.stdout.write(text);
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    codexDir: path.join(os.homedir(), ".codex"),
    format: "markdown",
    mode: "default",
    display: "thread",
    output: "",
    tui: false,
    latest: false,
    all: false,
    list: false,
    pick: "",
    input: [],
    includeAgentReasoning: false,
    includeToolCalls: false,
    includeToolOutputs: false,
    includeEnvironmentContext: false,
    onlyVsCode: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "tui":
      case "--tui":
        opts.tui = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--codex-dir":
        i += 1;
        if (i >= argv.length) throw new CliError("--codex-dir 需要参数");
        opts.codexDir = expandHomeDir(argv[i] || "");
        break;
      case "--format":
        i += 1;
        if (i >= argv.length) throw new CliError("--format 需要参数");
        opts.format = parseFormat(argv[i] || "");
        break;
      case "--mode":
        i += 1;
        if (i >= argv.length) throw new CliError("--mode 需要参数");
        opts.mode = parseMode(argv[i] || "");
        break;
      case "--display":
        i += 1;
        if (i >= argv.length) throw new CliError("--display 需要参数");
        opts.display = parseDisplay(argv[i] || "");
        break;
      case "--output":
        i += 1;
        if (i >= argv.length) throw new CliError("--output 需要参数");
        opts.output = expandHomeDir(argv[i] || "");
        break;
      case "--latest":
        opts.latest = true;
        break;
      case "--all":
        opts.all = true;
        break;
      case "--list":
        opts.list = true;
        break;
      case "--pick":
        i += 1;
        if (i >= argv.length) throw new CliError("--pick 需要参数");
        opts.pick = String(argv[i] || "");
        break;
      case "--input":
        i += 1;
        if (i >= argv.length) throw new CliError("--input 需要参数");
        opts.input.push(expandHomeDir(argv[i] || ""));
        break;
      case "--include-agent-reasoning":
        opts.includeAgentReasoning = true;
        break;
      case "--include-tool-calls":
        opts.includeToolCalls = true;
        break;
      case "--include-tool-outputs":
        opts.includeToolOutputs = true;
        break;
      case "--include-environment-context":
        opts.includeEnvironmentContext = true;
        break;
      case "--only-vscode":
        opts.onlyVsCode = true;
        break;
      default:
        throw new CliError(`未知参数：${arg}`);
    }
  }

  if (opts.mode === "events" && opts.format !== "markdown") {
    throw new CliError("--mode events 仅支持 markdown 导出");
  }

  return opts;
}

function parseFormat(value: string): CliOptions["format"] {
  const normalized = value.toLowerCase();
  if (normalized === "markdown" || normalized === "jsonl") return normalized;

  throw new CliError("--format 仅支持 markdown/jsonl");
}

function parseMode(value: string): CliOptions["mode"] {
  const normalized = value.toLowerCase();
  if (normalized === "default" || normalized === "events") return normalized;

  throw new CliError("--mode 仅支持 default/events");
}

function parseDisplay(value: string): CliOptions["display"] {
  const normalized = value.toLowerCase();
  if (normalized === "thread" || normalized === "file") return normalized;

  throw new CliError("--display 仅支持 thread/file");
}
