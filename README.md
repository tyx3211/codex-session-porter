# Codex Session Porter

[中文](#中文) | [English](#english)

## 中文

Codex Session Porter 是一个面向 OpenAI Codex CLI / Codex VS Code 会话历史的导出工具。它提供短命令 `cce`，可以把本地 `~/.codex` 里的会话导出为 Markdown 或 JSONL，并提供基于 React Ink 的 TUI（终端交互界面）多选导出器。

它的目标不是完整复刻 Codex 的富文本界面，而是把对人类有用的会话内容尽量稳定、可读地落成文件：用户消息、助手回复、工具调用、命令输出、patch diff（补丁差异）、会话线程名、创建/更新时间、分支和项目目录。

### 特性

- 与 `codex resume` 接近的会话发现逻辑：优先读取 Codex `state_*.sqlite`，并使用 `session_index.jsonl` 回退补全线程名。
- 支持 `history` / `context` 两层来源模式；`context` 会导出新版 rollout 的“模型可见历史候选视图”：先从最后一次带 `replacement_history` 的 compaction（上下文压缩）建立基线，再追加其后的消息、工具调用与工具结果，但不带 `AGENTS.md`、developer、`<environment_context>` 这类框架自动注入块；它既不是原始全量历史，也不是完整下一轮 API 请求。
- 支持 `default`、`timeline` 和 `events` 三种 Markdown 模式；`timeline` 会保留完整工作流事件与 `action` 时间线，但折叠“命令执行”事件的正文输出与详细 diff，`events` 会展开完整事件细节。
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
cce tui --mode timeline --output ./exports

# 按原始 session 文件名显示列表
cce --list --display file

# 导出最新会话
cce --latest --output ./latest.md

# 导出最新会话的模型可见历史候选视图
cce --latest --source context --output ./latest-context.md

# 导出指定索引会话
cce --pick 1,3 --output ./exports

# 导出全部会话
cce --all --output ./exports

# 导出中等详细时间线，保留 workflow 但折叠命令输出正文和详细 diff
cce --latest --mode timeline --output ./latest-timeline.md

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
- `--source <history|context>`：导出来源，默认 `history`
- `--mode <default|timeline|events>`：Markdown 渲染模式，默认 `default`
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
- `c`：切换 `history` / `context` 导出来源
- `m`：切换 `default` / `timeline` / `events` Markdown 模式
- `d`：切换线程名 / 文件名显示
- `s` 或 `Tab`：切换 `Updated` / `Created` 排序
- `Enter`：确认选择
- `q` 或 `Esc`：退出

### 两层模式

- `history`：导出原始 rollout / 历史事件流
- `context`：导出新版 rollout 的模型可见历史候选视图；从最后一次带 `replacement_history` 的 compaction 建立恢复基线，再按 JSONL 顺序追加后续消息、工具调用与工具结果，并过滤掉框架自动注入和 UI/审计事件

注意：

- `context` 不是完整下一轮 API 请求
- `context` 不会伪造下一轮 turn 开始时运行时重新注入的 developer 指令、skills、plugins 或其他 Prompt 外壳字段
- `context` 当前只对较新的 rollout 结构做高保真支持；更早版本不保证能完整复原
- `context` 默认会保留用户消息、助手消息、函数/工具调用、函数/工具输出、reasoning（推理项）、web/tool search（网页/工具搜索）相关响应项，以及 compaction（压缩摘要）与 replacement history（替代历史）里的模型可见条目
- `context` 默认不会保留 `AGENTS.md` 注入、developer 注入、`<environment_context>`，以及 `context_compacted` 这类仅提示性的工作流事件
- `context` 的 Markdown 详细程度仍由 `--mode` 控制：`timeline` 会显示命令执行和编辑事件但折叠正文输出，`events` 会展开完整输出和 diff

### Markdown 模式

- `default`：只导出用户/助手主对话，以及显式要求保留的 reasoning / tool call 内容
- `timeline`：导出完整工作流事件时间线；普通内置 `action` 只保留 `event_ref / cwd / cmd`，未知工具调用会回退成“命令执行”事件，保留执行元数据但折叠正文输出；文件编辑事件改成 `edit_file`，并把每个文件的 diff 改成 `+/-` 行数统计
- `events`：导出完整工作流事件时间线；普通内置 `action` 只保留精简元数据，命令执行事件会展开完整正文输出，`edit_file` 会展开完整 patch diff

`timeline` 和 `events` 会把 Codex / Codex VS Code 记录的新事件展开成 Markdown，包括：

- 以 `action` 为主语的文件读取、搜索、列目录和编辑事件，以及回退到“命令执行”的未知工具调用
- 普通内置 `action` 下的 `cwd / cmd`，其中 `cmd` 会单独落在 `~~~` 代码块里；命令执行事件会额外保留执行元数据与可回查正文
- patch 变更涉及的文件，以及 `timeline` 下的 diff 统计或 `events` 下的完整 diff
- 网页搜索、任务开始/结束、上下文压缩、线程回滚、协作代理生命周期、MCP 工具调用等工作流事件

这两种模式下，每个事件块都会带一个稳定的 `event_ref`。事件块仍使用 `~~~` 作为 Markdown 代码围栏，避免命令输出里出现反引号代码块时提前闭合外层代码块。

### Timeline 回查 Skill

仓库内置了一个 repo-local skill：`skills/cce-event-ref-lookup`。

如果希望把它安装到用户级 `~/.codex/skills`，可以使用仓库外的 Codex `skill-installer`，从本仓库的 GitHub 地址安装：

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo tyx3211/codex-session-porter \
  --path skills/cce-event-ref-lookup
```

当我们查看 `--mode timeline` 导出的 Markdown 时，如果想恢复某个事件被折叠掉的命令输出或完整 diff，可以直接用：

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --markdown ./latest-timeline.md \
  --event-ref E000123
```

脚本会根据 Markdown 头部记录的 `源文件` 路径，精确回到原始 JSONL 的那一行记录，并输出完整事件内容。对“命令执行”事件会恢复完整输出；对 `edit_file` 事件会恢复完整 diff。

### 致谢

本项目的早期导出思路借鉴了 [@abgyjaguo/codex-chat-exporter](https://github.com/abgyjaguo/codex-chat-exporter)。在此基础上，本项目补充了 CLI、TUI、Codex state DB 会话发现、`session_index.jsonl` 线程名回退、VS Code 新事件展开等能力。

## English

Codex Session Porter is an exporter for OpenAI Codex CLI / Codex VS Code session history. It provides the short command `cce`, exports local `~/.codex` conversations to Markdown or JSONL, and includes a React Ink based TUI picker for selecting multiple sessions.

The goal is not to reproduce the full rich UI from Codex. Instead, it turns useful conversation data into stable, readable files: user messages, assistant replies, tool calls, command outputs, patch diffs, thread names, created/updated timestamps, branches, and project directories.

### Features

- Session discovery close to `codex resume`: reads Codex `state_*.sqlite` first and falls back to `session_index.jsonl` for thread names.
- Two source layers: `history` and `context`. `context` exports a prompt-candidate, model-visible history view for newer rollout formats instead of the raw full history.
- Three Markdown modes: `default`, `timeline`, and `events`. `timeline` keeps the workflow event stream and `action` timeline, but hides command-execution body output and detailed diffs, while `events` expands the full event details.
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
cce tui --mode timeline --output ./exports

# Show raw session file names
cce --list --display file

# Export the latest session
cce --latest --output ./latest.md

# Export the latest prompt-candidate context view for the latest session
cce --latest --source context --output ./latest-context.md

# Export selected sessions by index
cce --pick 1,3 --output ./exports

# Export all sessions
cce --all --output ./exports

# Export a medium-detail workflow timeline
cce --latest --mode timeline --output ./latest-timeline.md

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
- `--source <history|context>`: export source, defaults to `history`
- `--mode <default|timeline|events>`: Markdown rendering mode, defaults to `default`
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
- `c`: switch between `history` and `context`
- `m`: toggle `default` / `timeline` / `events` Markdown mode
- `d`: toggle thread-name / file-name display
- `s` or `Tab`: toggle `Updated` / `Created` sorting
- `Enter`: confirm selection
- `q` or `Esc`: quit

### Source Layers

- `history`: export the raw rollout / history stream
- `context`: export a model-visible prompt-candidate history view for newer rollouts; it stays ordered like a Markdown conversation history while filtering out rows that clearly do not belong in the later prompt chain

Notes:

- `context` is not the full next API request payload
- `context` does not fabricate the runtime-reinjected developer instructions, skills, plugins, or other prompt-wrapper fields that get attached when a new turn actually starts
- `context` currently targets newer rollout formats for high-fidelity reconstruction; older formats are not guaranteed
- `context` keeps already-recorded developer/environment-like injections, user messages, assistant messages, and compaction markers
- `context` excludes reasoning, command output, tool output, and search output by default because those do not belong to this prompt-candidate history view

### Markdown Modes

- `default`: exports the main user/assistant conversation, plus any explicitly enabled reasoning or tool-call content
- `timeline`: exports the workflow event stream; built-in actions keep only `event_ref / cwd / cmd`, unknown tool calls fall back to a command-execution event that keeps execution metadata but hides body output, and `edit_file` replaces full diffs with `+/-` line-count summaries
- `events`: exports the workflow event stream; built-in actions stay compact, command-execution events expand full output, and `edit_file` expands complete patch diffs

Both `timeline` and `events` expand Codex / Codex VS Code workflow events into Markdown, including:

- action-centric file reads, searches, directory listings, and edit events, plus fallback command-execution events for unknown tool calls
- `cwd / cmd` for built-in actions, with `cmd` rendered in a dedicated fenced block, plus execution metadata and recoverable body output for command-execution events
- changed files, with either diff stats in `timeline` or complete diff bodies in `events`
- workflow records such as web searches, task start/finish, context compaction, thread rollback, collaboration lifecycle, and MCP tool calls

Each event block carries a stable `event_ref`. Event blocks use `~~~` as Markdown fences, which avoids accidental closing when command output itself contains backtick code fences.

### Timeline Lookup Skill

The repository ships a repo-local skill at `skills/cce-event-ref-lookup`.

If you want it installed into the user-level Codex skill directory (`~/.codex/skills`), you can use Codex's `skill-installer` helper against this GitHub repository:

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo tyx3211/codex-session-porter \
  --path skills/cce-event-ref-lookup
```

When reading a `--mode timeline` export, this helper can recover the hidden command output or full patch diff for a specific `event_ref`:

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --markdown ./latest-timeline.md \
  --event-ref E000123
```

The script reads the source JSONL path from the Markdown header, jumps back to the exact JSONL line referenced by `event_ref`, and prints the full event details.

### Acknowledgements

The early export approach was inspired by [@abgyjaguo/codex-chat-exporter](https://github.com/abgyjaguo/codex-chat-exporter). This project builds on that idea with a CLI, a TUI picker, Codex state DB discovery, `session_index.jsonl` thread-name fallback, and Codex VS Code event expansion.
