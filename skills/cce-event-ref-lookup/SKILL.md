---
name: cce-event-ref-lookup
description: Use when reading a cce timeline markdown export and an agent needs the hidden command output or detailed patch diff for a specific event_ref
---

# CCE Event Ref Lookup

## Overview

`cce --mode timeline` 会故意隐藏“命令执行”事件的正文输出和完整 diff，只保留工作流时间线、`action` 标题与 `event_ref`。  
当我们需要追某次“命令执行”事件的真实回显，或者追某次 `edit_file` 事件的完整改动内容时，不要靠全文搜索 Markdown，直接用 `event_ref` 回查原始 JSONL。

核心原则：`event_ref` 是精确定位键，不是模糊标签。只要 `timeline` Markdown 还保留了 `- 源文件：...` 这一行，脚本就能确定性回查。
如果正在阅读 `cce handoff` 接续包，也可以直接对包内 `source.jsonl` 使用同一个脚本。

## When To Use

- 正在看 `--mode timeline` 导出的 Markdown
- 看到某个 `### 命令执行` 或 `### action：\`edit_file\`` 事件，但正文被裁剪了
- 需要恢复该事件在 `--mode events` 下会写出的完整命令输出或 diff
- 需要把 `timeline` 里的某个事件，和原始 JSONL 的单条记录准确对应起来

不要在这些场景里用它：

- 只想看普通用户/助手对话
- 没有 `event_ref`
- 需要跨多个 session 做模糊检索

## Quick Use

从 `timeline` Markdown 回查：

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --markdown ./latest-timeline.md \
  --event-ref E000004
```

直接从 JSONL 回查：

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --source-jsonl ~/.codex/sessions/2026/04/23/rollout-demo.jsonl \
  --event-ref E000004
```

从 handoff 接续包回查：

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --source-jsonl ./handoff/<package>/source.jsonl \
  --event-ref E000004
```

如果想让 agent 后续自己解析结构化结果：

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --markdown ./latest-timeline.md \
  --event-ref E000004 \
  --format json
```

## What The Script Returns

- 对 `exec_command_end`：输出完整命令执行事件，会带回被 `timeline` 隐藏的正文输出
- 对 `patch_apply_end`：输出完整 `edit_file` 事件，包括每个文件的完整 diff
- 对其他事件：输出该条原始 JSON 记录，避免脚本擅自猜测展示语义

## Common Mistakes

- 把 `event_ref` 当成全文关键字搜索
  应该直接交给脚本；`E000123` 本质上是原始 JSONL 的物理行号引用。

- 只给 `event_ref`，不给 Markdown 或 JSONL 路径
  脚本必须知道去哪个源文件取那一行记录。

- 对 `timeline` 导出做手工清洗，把头部 `源文件` 行删掉
  这样脚本就无法从 Markdown 自动找到原始 JSONL，只能改走 `--source-jsonl`。
