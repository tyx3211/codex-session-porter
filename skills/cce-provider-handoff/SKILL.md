---
name: cce-provider-handoff
description: Use when continuing a Codex task after switching providers, accounts, sessions, or agents and a cce handoff package may be needed
---

# CCE Provider Handoff

## Overview

Provider 切换后，不要只依赖当前对话记忆。优先使用 `cce handoff` 接续包，把“真实模型可见上下文”和“可追溯的完整历史”分开读。

第一轮 turn 的目标是恢复状态，不是继续施工。除非用户明确要求立刻执行，否则第一轮只读取 handoff 文档、必要源码和回查材料，最后输出接续理解、当前任务状态、风险点和下一步计划；不要写文件、改文件、提交、push，或执行会改变项目状态的命令。

## When To Use

- 用户给了 `cce handoff` 接续包目录
- 用户给了 `context-timeline.md`、`context-events.md`、`history-default.md`、`history-timeline.md`、`history-events.md`、`source.jsonl`
- 用户要求切换 provider、账号、模型服务商后继续一个 Codex 长任务
- agent 需要自己从本机 Codex 历史里导出可接续材料

## 已有接续包

1. 先读包内 `README.md`，确认源会话、项目目录和阅读顺序。
2. 再读 `context-timeline.md`，先建立当前任务骨架。
3. 必须读 `context-events.md`，这是当前真实模型可见上下文的详细版，包含 context 内的命令输出、工具输出和 diff 细节。
4. 如果还需要了解更早对话背景，先读 `history-default.md`，不要默认读 `history-timeline.md`。
5. 只有需要查找命令习惯、命令参数、默认配置、完整工作流索引或具体 `event_ref` 时，才读 `history-timeline.md`。
6. 只有遇到具体 `event_ref`，或需要追查更早的命令输出、完整 diff、MCP/动态工具细节时，才读 `history-events.md` 或回查 `source.jsonl`。
7. 第一轮 turn 结束时，只汇报“已经恢复到什么状态、还缺什么、下一步建议怎么做”，不要直接开始实现。

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

生成接续包本身是允许的恢复动作；生成后仍按“第一轮只恢复状态”的规则阅读和汇报，不要顺手修改业务代码。

## 回查

看到 `event_ref` 后，优先用确定性脚本，不要模糊搜索：

```bash
node skills/cce-event-ref-lookup/scripts/reveal-event-ref.mjs \
  --source-jsonl ./handoff/<package>/source.jsonl \
  --event-ref E000123
```

## Common Mistakes

- 第一轮 turn 直接开始改代码
  provider handoff 的第一轮应先恢复上下文和对齐任务状态；实现动作留到用户确认后的后续 turn。

- 一开始全文读 `history-events.md`
  应先读 `context-timeline.md`、`context-events.md` 和必要时的 `history-default.md`；`history-events.md` 是完整审计兜底，不是第一阅读材料。

- 一开始全文读 `history-timeline.md`
  `history-timeline.md` 容易包含大量工具和工作流索引。除非需要查命令习惯、命令参数、默认配置或 `event_ref`，否则先读 `history-default.md`。

- 只复制 Markdown，不复制 `source.jsonl`
  这样接续包离开原机器路径后，`event_ref` 回查会变脆弱。

- 把 `history-timeline.md` 当作当前 prompt
  它是工作流索引；真正的接续主材料是 `context-timeline.md` 和 `context-events.md`，更早历史背景优先读 `history-default.md`。
