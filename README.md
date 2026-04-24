# Codex Session Porter

[中文](#中文) | [English](#english)

## 中文

Codex Session Porter 是一个面向 OpenAI Codex CLI / Codex VS Code 会话历史的导出工具。它提供短命令 `cce`，可以把本地 `~/.codex` 里的会话导出为 Markdown 或 JSONL，并提供基于 React Ink 的 TUI（终端交互界面）多选导出器。

它的目标不是完整复刻 Codex 的富文本界面，而是把对人类有用的会话内容尽量稳定、可读地落成文件：用户消息、助手回复、工具调用、命令输出、patch diff（补丁差异）、会话线程名、创建/更新时间、分支和项目目录。

### 特性

- 与 `codex resume` 接近的会话发现逻辑：优先读取 Codex `state_*.sqlite`，并使用 `session_index.jsonl` 回退补全线程名。
- 支持 `default` 和 `events` 两种 Markdown 模式；`events` 会展开 Codex VS Code 新事件中的命令执行结果和 patch diff。
- TUI 支持多选会话、按 `Updated` / `Created` 排序、显示 `Created`、`Updated`、`Branch`、`Project`、`Conversation` 列。
- TUI 导出时可选择按线程名作为文件名前缀，线程名前缀最多保留 50 个 UTF-8 字节。
- JSONL 导出支持过滤工具输出和环境上下文。
- 短命令为 `cce`，便于放进用户级 Node bin。

### Node 版本要求

需要 Node.js `>= 20`。

原因是本工具会直接读取 Codex 的 SQLite state DB（状态数据库）。SQLite 读取由 `better-sqlite3` 提供，因此不依赖 Node 22.5+ 才出现的内置 `node:sqlite` 模块。

### 安装与构建

从 GitHub 克隆：

```bash
git clone https://github.com/tyx3211/codex-session-porter.git
cd codex-session-porter
npm install
npm run build
```

注册为用户级命令：

```bash
npm link
cce --help
```

也可以直接用 Node 运行构建产物：

```bash
node dist/cli.js --help
```

### 常用命令

```bash
# 查看会话列表，默认按 updated 时间倒序
cce --list

# 打开交互式会话选择器
cce tui --mode events --output ./exports

# 按原始 session 文件名显示列表
cce --list --display file

# 导出最新会话
cce --latest --output ./latest.md

# 导出指定索引会话
cce --pick 1,3 --output ./exports

# 导出全部会话
cce --all --output ./exports

# 展开 Codex VS Code 新事件，包含命令输出和 patch diff
cce --latest --mode events --output ./latest-events.md

# 导出 JSONL
cce --latest --format jsonl --output ./latest.jsonl

# 导出时包含 reasoning、工具调用和工具输出
cce --latest \
  --include-agent-reasoning \
  --include-tool-calls \
  --include-tool-outputs
```

### 选项

- `--codex-dir <dir>`：Codex 数据目录，默认 `~/.codex`
- `--latest`：选择最新会话
- `--all`：选择全部会话
- `--pick <i,j,k>`：按列表索引选择会话
- `--input <file>`：直接指定一个或多个 `.jsonl` 文件
- `--list`：打印会话索引列表
- `--format <markdown|jsonl>`：导出格式，默认 `markdown`
- `--mode <default|events>`：Markdown 渲染模式，默认 `default`
- `--display <thread|file>`：会话列表显示模式，默认 `thread`
- `--output <path>`：输出路径；单会话可为文件，多会话建议为目录
- `--include-agent-reasoning`：Markdown 中包含 reasoning（推理内容）
- `--include-tool-calls`：Markdown 中包含工具调用
- `--include-tool-outputs`：Markdown 中包含工具输出，依赖 `--include-tool-calls`
- `--include-environment-context`：包含 `<environment_context>`
- `--only-vscode`：仅导出 Codex VS Code 会话

### TUI 快捷键

- `↑` / `↓`：移动光标
- `Space`：选中或取消选中当前会话
- `a`：全选或反选
- `m`：切换 `default` / `events` Markdown 模式
- `d`：切换线程名 / 文件名显示
- `s` 或 `Tab`：切换 `Updated` / `Created` 排序
- `Enter`：确认选择
- `q` 或 `Esc`：退出

### Markdown events 模式

`--mode events` 会把 Codex VS Code 记录的新事件展开成 Markdown，包括：

- 命令执行目录、退出码、耗时和输出
- patch 变更涉及的文件和 diff 片段

事件块使用 `~~~` 作为 Markdown 代码围栏，避免命令输出里出现反引号代码块时提前闭合外层代码块。

### 致谢

本项目的早期导出思路借鉴了 [@abgyjaguo/codex-chat-exporter](https://github.com/abgyjaguo/codex-chat-exporter)。在此基础上，本项目补充了 CLI、TUI、Codex state DB 会话发现、`session_index.jsonl` 线程名回退、VS Code 新事件展开等能力。

## English

Codex Session Porter is an exporter for OpenAI Codex CLI / Codex VS Code session history. It provides the short command `cce`, exports local `~/.codex` conversations to Markdown or JSONL, and includes a React Ink based TUI picker for selecting multiple sessions.

The goal is not to reproduce the full rich UI from Codex. Instead, it turns useful conversation data into stable, readable files: user messages, assistant replies, tool calls, command outputs, patch diffs, thread names, created/updated timestamps, branches, and project directories.

### Features

- Session discovery close to `codex resume`: reads Codex `state_*.sqlite` first and falls back to `session_index.jsonl` for thread names.
- Two Markdown modes: `default` and `events`. The `events` mode expands Codex VS Code command results and patch diffs.
- TUI picker with multi-select, `Updated` / `Created` sorting, and `Created`, `Updated`, `Branch`, `Project`, `Conversation` columns.
- Optional thread-name file prefix in TUI exports, capped at 50 UTF-8 bytes.
- JSONL export with switches for tool outputs and environment context.
- Short command name: `cce`.

### Node Requirement

Node.js `>= 20` is required.

This tool reads the Codex SQLite state DB directly. SQLite access is provided by `better-sqlite3`, so it does not rely on Node's built-in `node:sqlite` module, which only exists in Node 22.5+.

### Install And Build

Clone from GitHub:

```bash
git clone https://github.com/tyx3211/codex-session-porter.git
cd codex-session-porter
npm install
npm run build
```

Register the command in your user-level Node bin:

```bash
npm link
cce --help
```

You can also run the built CLI directly:

```bash
node dist/cli.js --help
```

### Common Commands

```bash
# List sessions, sorted by updated time by default
cce --list

# Open the interactive picker
cce tui --mode events --output ./exports

# Show raw session file names
cce --list --display file

# Export the latest session
cce --latest --output ./latest.md

# Export selected sessions by index
cce --pick 1,3 --output ./exports

# Export all sessions
cce --all --output ./exports

# Expand Codex VS Code event records, including command output and patch diffs
cce --latest --mode events --output ./latest-events.md

# Export JSONL
cce --latest --format jsonl --output ./latest.jsonl

# Include reasoning, tool calls, and tool outputs
cce --latest \
  --include-agent-reasoning \
  --include-tool-calls \
  --include-tool-outputs
```

### Options

- `--codex-dir <dir>`: Codex data directory, defaults to `~/.codex`
- `--latest`: select the latest session
- `--all`: select all sessions
- `--pick <i,j,k>`: select sessions by list index
- `--input <file>`: pass one or more `.jsonl` files directly
- `--list`: print session index list
- `--format <markdown|jsonl>`: export format, defaults to `markdown`
- `--mode <default|events>`: Markdown rendering mode, defaults to `default`
- `--display <thread|file>`: list display mode, defaults to `thread`
- `--output <path>`: output path; a single session can use a file path, multiple sessions should use a directory
- `--include-agent-reasoning`: include reasoning in Markdown
- `--include-tool-calls`: include tool calls in Markdown
- `--include-tool-outputs`: include tool outputs in Markdown; requires `--include-tool-calls`
- `--include-environment-context`: include `<environment_context>`
- `--only-vscode`: export Codex VS Code sessions only

### TUI Keys

- `↑` / `↓`: move cursor
- `Space`: select or deselect the current session
- `a`: select all or invert selection
- `m`: toggle `default` / `events` Markdown mode
- `d`: toggle thread-name / file-name display
- `s` or `Tab`: toggle `Updated` / `Created` sorting
- `Enter`: confirm selection
- `q` or `Esc`: quit

### Markdown Events Mode

`--mode events` expands Codex VS Code event records into Markdown, including:

- command working directory, exit code, duration, and output
- changed files and diff snippets from patch events

Event blocks use `~~~` as Markdown fences, which avoids accidental closing when command output itself contains backtick code fences.

### Acknowledgements

The early export approach was inspired by [@abgyjaguo/codex-chat-exporter](https://github.com/abgyjaguo/codex-chat-exporter). This project builds on that idea with a CLI, a TUI picker, Codex state DB discovery, `session_index.jsonl` thread-name fallback, and Codex VS Code event expansion.
