---
name: cce-provider-handoff
description: Use when continuing a Codex task after switching providers, accounts, sessions, or agents and a cce handoff package may be needed
---

# CCE Provider Handoff

## Overview

Provider 切换后，不要只依赖当前对话记忆。优先使用 `cce handoff` 接续包，把“可继续工作的上下文”和“可追溯的完整历史”分开读。

## When To Use

- 用户给了 `cce handoff` 接续包目录
- 用户给了 `context-timeline.md`、`history-timeline.md`、`history-events.md`、`source.jsonl`
- 用户要求切换 provider、账号、模型服务商后继续一个 Codex 长任务
- agent 需要自己从本机 Codex 历史里导出可接续材料

## 已有接续包

1. 先读包内 `README.md`，确认源会话、项目目录和阅读顺序。
2. 再读 `context-timeline.md`，把它当作主接续材料。
3. 需要理解完整工作流时，再读 `history-timeline.md`。
4. 只有遇到具体 `event_ref`，或需要命令输出、完整 diff、MCP/动态工具细节时，才读 `history-events.md` 或回查 `source.jsonl`。

## 自主导出接续包

先定位会话：

```bash
cce --list --display thread
```

再生成接续包：

```bash
cce handoff --latest --output ./handoff
cce handoff --pick 1,3 --output ./handoff
cce handoff --input ./rollout.jsonl --output ./handoff
```

## 回查

看到 `event_ref` 后，优先用确定性脚本，不要模糊搜索：

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --source-jsonl ./handoff/<package>/source.jsonl \
  --event-ref E000123
```

## Common Mistakes

- 一开始全文读 `history-events.md`
  应先读 `context-timeline.md`，否则容易被完整日志淹没。

- 只复制 Markdown，不复制 `source.jsonl`
  这样接续包离开原机器路径后，`event_ref` 回查会变脆弱。

- 把 `history-timeline.md` 当作当前 prompt
  它是工作流索引；真正的接续主材料是 `context-timeline.md`。
