# Codex Session Porter

[中文](#中文) | [English](#english)

## 中文

Codex Session Porter 是一个面向 OpenAI Codex CLI / Codex VS Code 会话历史的导出工具。它提供短命令 `cce`，可以把本地 `~/.codex` 里的会话导出为 HTML、Markdown 或 JSONL，并提供基于 React Ink 的 TUI（终端交互界面）多选导出器。

它的目标不是完整复刻 Codex 的富文本界面，而是把对人类有用的会话内容尽量稳定、可读地落成文件：用户消息、助手回复、工具调用、命令输出、patch diff（补丁差异）、会话线程名、创建/更新时间、分支和项目目录。

### 特性

- 与 `codex resume` 接近的会话发现逻辑：优先读取 Codex `state_*.sqlite`，并使用 `session_index.jsonl` 回退补全线程名。
- 自包含 HTML 阅读器：左侧按用户 Prompt 建立可搜索导航，中间展示完整 Codex 会话内容，支持当前 Prompt 高亮、深色模式、移动端和打印布局。
- 支持 `history` / `context` 两层来源模式；`context` 会导出新版 rollout 的“模型可见历史候选视图”：先从最后一次带 `replacement_history` 的 compaction（上下文压缩）建立基线，再追加其后的消息、工具调用与工具结果，但不带 `AGENTS.md`、developer、`<environment_context>` 这类框架自动注入块；它既不是原始全量历史，也不是完整下一轮 API 请求。
- 支持 `default`、`timeline` 和 `events` 三种 Markdown 模式；`timeline` 会保留完整工作流事件与 `action` 时间线，但折叠“命令执行”事件的正文输出与详细 diff，`events` 会展开完整事件细节；未识别工作流事件默认隐藏，只有显式传入 `--include-unknown-events` 时才输出。
- 支持 `handoff` 接续包：把 `context-timeline.md`、`context-events.md`、`history-default.md`、`history-timeline.md`、`history-events.md` 和 `source.jsonl` 打包到同一个目录，方便切换 provider、账号或新 agent 对话后接续长任务。
- TUI 支持多选会话、按 `Updated` / `Created` 排序、显示 `Created`、`Updated`、`Branch`、`Project`、`Conversation` 列，并可显式切换普通导出 / `handoff` 接续包导出。
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

# 导出为带 Prompt 侧栏的自包含 HTML 阅读器
cce --latest --format html --output ./latest.html

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

# 调试 cce 事件覆盖率时，显式包含未识别工作流事件
cce --latest --mode events --include-unknown-events --output ./latest-events-debug.md

# 生成 provider 切换接续包
cce handoff --latest --output ./handoff
cce handoff --pick 1,3 --output ./handoff
cce handoff --input ./rollout.jsonl --output ./handoff

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
- `--format <html|markdown|jsonl>`：导出格式，默认 `markdown`；`html` 生成带 Prompt 侧栏的自包含阅读器
- `--source <history|context>`：导出来源，默认 `history`
- `--mode <default|timeline|events>`：HTML/Markdown 内容模式，默认 `default`
- `--display <thread|file>`：会话列表显示模式，默认 `thread`
- `--output <path>`：输出路径；单会话可为文件，多会话建议为目录
- `--include-agent-reasoning`：Markdown 中包含 reasoning（推理内容）
- `--include-tool-calls`：Markdown 中包含工具调用
- `--include-tool-outputs`：Markdown 中包含工具输出，依赖 `--include-tool-calls`
- `--include-environment-context`：包含 `<environment_context>`
- `--include-unknown-events`：在 `events` 模式中包含未识别工作流事件，默认隐藏
- `--only-vscode`：仅导出 Codex VS Code 会话

### HTML 阅读器

使用 `--format html` 会生成单个可离线打开的 `.html` 文件，不依赖 CDN 或额外资源。左侧列表来自每条用户 Prompt，支持搜索和滚动位置高亮；中间内容保留 Markdown 排版、代码块、表格，以及 `timeline` / `events` 模式下的工作流事件。原始 HTML 默认按文本转义，避免会话内容在浏览器中执行脚本。

```bash
cce --latest --format html --output ./latest.html
cce --latest --format html --mode timeline --output ./latest-timeline.html
cce tui --format html --output ./exports
```

### Provider Handoff 接续包

当需要切换 provider、切换账号，或者把一个长任务交给新的 agent 对话继续时，推荐使用 `handoff`，而不是让 agent 临时猜应该导出哪种模式：

```bash
cce handoff --latest --output ./handoff
cce handoff --pick 1,3 --output ./handoff
cce handoff --input ./rollout.jsonl --output ./handoff
```

每个会话会生成一个独立目录，包含：

- `README.md`：agent 首读说明，记录源 JSONL、线程名、项目目录、阅读顺序和回查方法
- `cce-provider-handoff.SKILL.md`：接续用 skill 内容副本；即使目标 agent 没安装本仓库 skill，也可以先读这个文件
- `context-timeline.md`：`--source context --mode timeline`，用于先建立当前任务骨架
- `context-events.md`：`--source context --mode events`，是当前真实模型可见上下文的详细版，会展开 context 内的命令输出、工具输出和 diff 细节
- `history-default.md`：`--source history --mode default`，是更早对话背景的默认阅读材料
- `history-timeline.md`：`--source history --mode timeline`，是完整工作流索引，保留 `event_ref`；只有需要查命令习惯、命令参数、默认配置或定位事件时再读
- `history-events.md`：`--source history --mode events`，是完整命令输出和完整 diff 的审计材料
- `source.jsonl`：原始 JSONL 副本，保证接续包离开本机原路径后仍可回查

人工挑选会话时可以先用 `cce tui --mode timeline`；TUI 中按 `h` 可以把导出类型切换为 `handoff`，多选后直接显式生成接续包。真正交给 agent 接续时，优先给它 `handoff` 接续包。

仓库内置了接续用 repo-local skill：`skills/cce-provider-handoff`。它覆盖两种场景：用户已经导出 handoff 包时，指导 agent 按顺序阅读；agent 需要自主接续时，指导 agent 先用 `cce --list --display thread` 定位会话，再运行 `cce handoff`。`handoff` 包会同时带上 `cce-provider-handoff.SKILL.md`，方便直接交给未安装该 skill 的新 agent。

推荐给新 agent 的第一条消息可以写成：

```text
请使用 cce-provider-handoff skill 接续；如果 skill 未安装，请先阅读接续包里的 cce-provider-handoff.SKILL.md 并遵守它。
第一轮 turn 只恢复状态，不要改文件或实际执行任务。
```

### TUI 快捷键

- `↑` / `↓`：移动光标
- `Space`：选中或取消选中当前会话
- `a`：全选或反选
- `c`：切换 `history` / `context` 导出来源
- `m`：切换 `default` / `timeline` / `events` 内容模式
- `u`：切换 `events` 模式下未识别事件输出，默认隐藏
- `h`：切换普通 HTML/Markdown/JSONL 导出和 `handoff` 接续包导出
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
- `context` 默认不会保留 `AGENTS.md` 注入、developer 注入、`<environment_context>`、权限/插件/skill 等运行时注入，以及 `context_compacted` 这类仅提示性的工作流事件
- `context` 的 Markdown 详细程度仍由 `--mode` 控制：`timeline` 会显示命令执行和编辑事件但折叠正文输出，`events` 会展开完整输出和 diff

### Markdown 模式

- `default`：只导出用户/助手主对话，以及显式要求保留的 reasoning / tool call 内容
- `timeline`：导出完整工作流事件时间线；普通内置 `action` 只保留 `event_ref / cwd / cmd`，未知工具调用会回退成“命令执行”事件，保留执行元数据但折叠正文输出；文件编辑事件改成 `edit_file`，并把每个文件的 diff 改成 `+/-` 行数统计
- `events`：导出完整工作流事件时间线；普通内置 `action` 只保留精简元数据，命令执行事件会展开完整正文输出，`edit_file` 会展开完整 patch diff；未识别工作流事件默认隐藏，只有 `--include-unknown-events` 会输出“未归类事件”

`timeline` 和 `events` 会把 Codex / Codex VS Code 记录的新事件展开成 Markdown，包括：

- 以 `action` 为主语的文件读取、搜索、列目录和编辑事件，以及回退到“命令执行”的未知工具调用
- 普通内置 `action` 下的 `cwd / cmd`，其中 `cmd` 会单独落在 `~~~` 代码块里；命令执行事件会额外保留执行元数据与可回查正文
- patch 变更涉及的文件，以及 `timeline` 下的 diff 统计或 `events` 下的完整 diff
- 网页搜索、任务开始/结束、上下文压缩、线程回滚、协作代理生命周期、MCP 工具调用、动态工具、目标更新、线程设置、实时会话和流式错误等工作流事件

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

在 `handoff` 接续包里，也可以直接回查包内副本：

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --source-jsonl ./handoff/<package>/source.jsonl \
  --event-ref E000123
```

脚本会根据 Markdown 头部记录的 `源文件` 路径，或显式传入的 `source.jsonl`，精确回到原始 JSONL 的那一行记录，并输出完整事件内容。对“命令执行”事件会恢复完整输出；对 `edit_file` 事件会恢复完整 diff。

### 致谢

本项目的早期导出思路借鉴了 [@abgyjaguo/codex-chat-exporter](https://github.com/abgyjaguo/codex-chat-exporter)。在此基础上，本项目补充了 CLI、TUI、Codex state DB 会话发现、`session_index.jsonl` 线程名回退、VS Code 新事件展开等能力。

## English

Codex Session Porter is an exporter for OpenAI Codex CLI / Codex VS Code session history. It provides the short command `cce`, exports local `~/.codex` conversations to HTML, Markdown, or JSONL, and includes a React Ink based TUI picker for selecting multiple sessions.

The goal is not to reproduce the full rich UI from Codex. Instead, it turns useful conversation data into stable, readable files: user messages, assistant replies, tool calls, command outputs, patch diffs, thread names, created/updated timestamps, branches, and project directories.

### Features

- Session discovery close to `codex resume`: reads Codex `state_*.sqlite` first and falls back to `session_index.jsonl` for thread names.
- Self-contained HTML reader with a searchable user-prompt sidebar, complete Codex conversation content, active-prompt highlighting, dark mode, responsive layout, and print styles.
- Two source layers: `history` and `context`. `context` exports a prompt-candidate, model-visible history view for newer rollout formats instead of the raw full history.
- Three Markdown modes: `default`, `timeline`, and `events`. `timeline` keeps the workflow event stream and `action` timeline, but hides command-execution body output and detailed diffs, while `events` expands the full event details. Unknown workflow events are hidden by default and only appear with `--include-unknown-events`.
- Provider handoff packages: `cce handoff` bundles `context-timeline.md`, `context-events.md`, `history-default.md`, `history-timeline.md`, `history-events.md`, and `source.jsonl` for continuing long tasks after switching providers, accounts, or agent sessions.
- TUI picker with multi-select, `Updated` / `Created` sorting, `Created`, `Updated`, `Branch`, `Project`, `Conversation` columns, and an explicit normal export / `handoff` package toggle.
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

# Export a self-contained HTML reader with prompt navigation
cce --latest --format html --output ./latest.html

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

# Include unknown workflow events when debugging cce event coverage
cce --latest --mode events --include-unknown-events --output ./latest-events-debug.md

# Create a provider handoff package
cce handoff --latest --output ./handoff
cce handoff --pick 1,3 --output ./handoff
cce handoff --input ./rollout.jsonl --output ./handoff

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
- `--format <html|markdown|jsonl>`: export format, defaults to `markdown`; `html` creates a self-contained prompt-indexed reader
- `--source <history|context>`: export source, defaults to `history`
- `--mode <default|timeline|events>`: HTML/Markdown content mode, defaults to `default`
- `--display <thread|file>`: list display mode, defaults to `thread`
- `--output <path>`: output path; a single session can use a file path, multiple sessions should use a directory
- `--include-agent-reasoning`: include reasoning in Markdown
- `--include-tool-calls`: include tool calls in Markdown
- `--include-tool-outputs`: include tool outputs in Markdown; requires `--include-tool-calls`
- `--include-environment-context`: include `<environment_context>`
- `--include-unknown-events`: include unknown workflow events in `events` mode; hidden by default
- `--only-vscode`: export Codex VS Code sessions only

### HTML Reader

`--format html` generates one offline-ready `.html` file with no CDN or external assets. The left sidebar lists every user prompt with search and scroll-position highlighting, while the center preserves Markdown formatting, code blocks, tables, and workflow events from `timeline` or `events` mode. Raw HTML in session content is escaped by default so it cannot execute as browser code.

```bash
cce --latest --format html --output ./latest.html
cce --latest --format html --mode timeline --output ./latest-timeline.html
cce tui --format html --output ./exports
```

### Provider Handoff Packages

Use `handoff` when a long Codex task needs to continue under a different provider, account, or fresh agent conversation:

```bash
cce handoff --latest --output ./handoff
cce handoff --pick 1,3 --output ./handoff
cce handoff --input ./rollout.jsonl --output ./handoff
```

Each selected session gets its own directory with `README.md`, `cce-provider-handoff.SKILL.md`, `context-timeline.md`, `context-events.md`, `history-default.md`, `history-timeline.md`, `history-events.md`, and `source.jsonl`. The intended reading order is `cce-provider-handoff.SKILL.md -> context-timeline.md -> context-events.md -> history-default.md`; use `history-timeline.md` only when command habits, command arguments, default configuration, workflow indexing, or `event_ref` lookup is needed. `context-timeline.md` is the outline of the current task state, while `context-events.md` is the detailed model-visible context and expands command output, tool output, and diff details that are still in context.

For manual session selection, run `cce tui`; press `h` to switch the export type to `handoff`, then multi-select sessions and generate handoff packages explicitly.

The repository also ships `skills/cce-provider-handoff`, a repo-local skill for agents that either receive an existing handoff package or need to generate one themselves with `cce --list --display thread` and `cce handoff`. Handoff packages include a copy as `cce-provider-handoff.SKILL.md`, so a fresh agent can read the package-local skill even if it has not installed the repo-local one.

Suggested first prompt for the new agent:

```text
Please use the cce-provider-handoff skill to continue. If the skill is not installed, first read cce-provider-handoff.SKILL.md from the handoff package and follow it.
The first turn should only restore task state; do not modify files or perform implementation work yet.
```

### TUI Keys

- `↑` / `↓`: move cursor
- `Space`: select or deselect the current session
- `a`: select all or invert selection
- `c`: switch between `history` and `context`
- `m`: toggle `default` / `timeline` / `events` content mode
- `u`: toggle unknown event output in `events` mode; hidden by default
- `h`: toggle normal HTML/Markdown/JSONL export and `handoff` package export
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
- `context` keeps user messages, assistant messages, function/tool calls, tool outputs, reasoning items, web/tool-search related response items, compaction summaries, and replacement-history items that are model-visible
- `context` excludes developer/system messages, `AGENTS.md`, `<environment_context>`, permissions/plugins/skills runtime injections, and UI-only workflow events
- `context` Markdown detail still follows `--mode`: `timeline` shows command/edit events with collapsed bodies, while `events` expands full output and diffs

### Markdown Modes

- `default`: exports the main user/assistant conversation, plus any explicitly enabled reasoning or tool-call content
- `timeline`: exports the workflow event stream; built-in actions keep only `event_ref / cwd / cmd`, unknown tool calls fall back to a command-execution event that keeps execution metadata but hides body output, and `edit_file` replaces full diffs with `+/-` line-count summaries
- `events`: exports the workflow event stream; built-in actions stay compact, command-execution events expand full output, and `edit_file` expands complete patch diffs. Unknown workflow events are hidden by default and only appear as uncategorized events with `--include-unknown-events`

Both `timeline` and `events` expand Codex / Codex VS Code workflow events into Markdown, including:

- action-centric file reads, searches, directory listings, and edit events, plus fallback command-execution events for unknown tool calls
- `cwd / cmd` for built-in actions, with `cmd` rendered in a dedicated fenced block, plus execution metadata and recoverable body output for command-execution events
- changed files, with either diff stats in `timeline` or complete diff bodies in `events`
- workflow records such as web searches, task start/finish, context compaction, thread rollback, collaboration lifecycle, MCP calls, dynamic tools, goals, thread settings, realtime lifecycle, and stream errors

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

Inside a `handoff` package, the same script can read the bundled `source.jsonl` directly:

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --source-jsonl ./handoff/<package>/source.jsonl \
  --event-ref E000123
```

The script reads the source JSONL path from the Markdown header, or a directly provided `source.jsonl`, jumps back to the exact JSONL line referenced by `event_ref`, and prints the full event details.

### Acknowledgements

The early export approach was inspired by [@abgyjaguo/codex-chat-exporter](https://github.com/abgyjaguo/codex-chat-exporter). This project builds on that idea with a CLI, a TUI picker, Codex state DB discovery, `session_index.jsonl` thread-name fallback, and Codex VS Code event expansion.
