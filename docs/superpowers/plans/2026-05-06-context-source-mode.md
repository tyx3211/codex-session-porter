# Context Source Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `cce` 增加 `history/context` 顶层来源切换，其中 `context` 导出当前最新有效的 resume context（恢复上下文）而不是原始全量历史。

**Architecture:** 在现有 Markdown 细节模式 `default / timeline / events` 之上，再引入一个顶层数据源选择。`history` 继续直接消费原始 JSONL；`context` 先把 rollout 重建成当前最新有效历史，再复用现有 Markdown 渲染层。重建逻辑对齐 Codex Rust `rollout_reconstruction` 的最终态语义，但不实现任意时点快照。

**Tech Stack:** TypeScript、Node.js、Node test runner、ESLint、现有 Ink TUI

---

### Task 1: 定义顶层 source 模式边界

**Files:**
- Modify: `src/types.ts`
- Modify: `src/args.ts`
- Modify: `src/export.ts`
- Modify: `src/index.ts`

- [ ] 定义 `ExportSource = "history" | "context"`，并把 `CliOptions` / `ExportOptions` 接上。
- [ ] 为 CLI 增加 `--source <history|context>`，默认 `history`。
- [ ] 帮助文本补充 `context` 的语义说明：这是“当前最新有效 context”，不是完整下一轮 API 请求。

### Task 2: 先写 context 重建失败测试

**Files:**
- Create: `test/context-source.test.ts`
- Test: `test/context-source.test.ts`

- [ ] 写最小失败用例，覆盖：
  - `replacement_history` 替换旧历史；
  - `thread_rolled_back` 删除最新用户 turn；
  - `context` 导出不同于 `history` 导出。
- [ ] 运行单测并确认失败原因确实是“尚未实现 context source”，而不是夹具或断言写错。

### Task 3: 实现最终态 rollout reconstruction

**Files:**
- Create: `src/context-source.ts`
- Modify: `src/guards.ts`
- Modify: `src/render.ts`

- [ ] 新建纯函数模块，负责：
  - 读取 JSONL 行；
  - 识别 `response_item` / `event_msg` / `compacted` / `turn_context` 等必要结构；
  - 重建“当前最新有效历史”。
- [ ] 只实现最终态重建，不实现任意 event_ref 时点快照。
- [ ] 保持运行时边界使用 guard 缩小，不把 `JSON.parse` 结果直接断言成业务类型。

### Task 4: 将 context source 接入导出链路

**Files:**
- Modify: `src/export.ts`
- Modify: `src/render.ts`
- Modify: `src/selection.ts`（若需要）
- Modify: `src/tui.tsx`

- [ ] `history` 继续走现有路径。
- [ ] `context` 先重建有效历史，再复用现有 Markdown 渲染。
- [ ] TUI 至少要能沿用当前 mode 导出 `context`；如果界面上暂不暴露切换键，也要保证 CLI 参数传入后行为正确。

### Task 5: 回归测试与文档

**Files:**
- Modify: `test/extended-events.test.ts`（如需补交叉行为）
- Modify: `README.md`

- [ ] 补充 README：说明 `history/context` 与 `default/timeline/events` 是两层开关。
- [ ] 跑 `npm run verify`。
- [ ] 若失败，先修失败，再更新文档与帮助文本。
