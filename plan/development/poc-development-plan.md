# PoC 开发计划（含执行记录）

## 阶段总览

```
Phase 0: 环境探查       ✅ 完成
Phase 1: 测试物料       ✅ 完成
Phase 2: Host 插件开发   ✅ 完成（但编排 API 不可用）
Phase 3: Client 插件开发 ✅ 完成
Phase 4: 集成运行       ⚠️ 部分完成（管道验证通过，自动化编排未通）
Phase 5: 评估总结       ✅ 完成 → 架构方向调整
```

---

## Phase 0：环境探查 ✅

### 已确认

- `fs` Service：readText, writeText, resolve, stat 可用
- `subagents` Service：list, start 可用（但 start 在 Tool 中不可靠）
- `agents` Service：roots, list, requireInitiator（RPC 上下文无 initiator）
- `sessionQuery` Service：readSurface, readSession 可用
- `llm` Service：stream 可用（但在 Tool 中返回空流）
- `timer` Service：interval, timeout 可用
- Client Slot：`conversation.input.dock` 可用
- Client Builtins：React, host.call(), ctx.interval 可用
- RPC：`harness.handle()` / `host.call()` 可用（Package-private）

---

## Phase 1：测试物料 ✅

| 文件 | 状态 |
|------|------|
| `PoC/test-data/ir-sample.md` | ✅ 用户登录功能需求 |
| `PoC/skills/poc-analyzer/SKILL.md` | ✅ 需求分析指令 |
| `PoC/skills/poc-reviewer/SKILL.md` | ✅ 设计评审指令 |
| `PoC/workflows/poc-with-gate.yaml` | ✅ 含 quality-gate 配置 |

---

## Phase 2：Host 插件开发 ✅

### 插件迭代记录

从 pkg-1 到 pkg-42，共 42 个 Package 版本。关键节点：

| Package | 尝试 | 结果 |
|---------|------|------|
| pkg-1~13 | 分离 Host/Client 插件，RPC 不达 | 发现 RPC 需同 Package |
| pkg-14~18 | 合并插件，subagent 不写文 | 发现子 Agent 不用 write 工具 |
| pkg-19~20 | 改用 `llm.stream()` | 返回空流 |
| pkg-21~24 | subagent + `sessionQuery.readSurface` | `run.sessionId` 为 undefined |
| pkg-25~36 | 改用 `harness.defineTool` | Tool 定义成功 |
| pkg-37~41 | Tool 内调 subagent | `stopReason: error`，事件有 turn 无 message |
| pkg-42 | Tool 内调 `llm.stream` | 返回空流 |
| 手动编排 | 调 `subagent` 工具 | ✅ Task + Gate 均成功 |

### 根因分析

DSH 的模型工具（`subagent` 工具）需要在 Agent Loop 上下文中调用——即模型的工具调用循环中。Cordis Tool 的 `execute` 函数虽然触发了 LLM 生成的工具调用，但其内部的 `subagents.start()` 和 `llm.stream()` 不在有效的 Agent Loop 上下文中，导致子 Agent 无法生成 LLM 响应。

---

## Phase 3：Client 插件开发 ✅

最终可用版本：`poc-6/pkg-24`（poc-combined-v20）

- Slot：`conversation.input.dock` ✅
- UI：状态标签 + 重试计数 + Start/Re-run 按钮 ✅
- 轮询：1500ms 间隔调 `workflow:status` ✅

---

## Phase 4：集成运行 ⚠️

### 通过的场景

| 场景 | 结果 |
|------|------|
| 正常执行流程 | ✅ 手动编排：Task → Gate → PASS |
| 隔离性验证 | ✅ Gate 子 Agent 不共享 Task 上下文 |
| 文件传递 | ✅ analysis.md → gate-result.md 链路正确 |
| 重试逻辑 | ⚠️ 逻辑已编写但需 Agent Loop 编排（代码在 pkg-32） |

### 未通过的场景

| 场景 | 原因 |
|------|------|
| 自动化编排 | Cordis Tool 内无法可靠调 subagent |
| 门禁 FAIL → 重试 | 需要工作流 Agent 实现 |

---

## Phase 5：评估总结 ✅

详见 `PoC/REPORT.md` 和 `solutions/architecture-proposal.md`。

### 核心结论

**编排逻辑应从 Cordis 插件层（程序化 API）迁移到 Agent Loop 层（模型调 subagent 工具）。**

也就是说，`software-design-agent` 的核心不是一个"工作流引擎 Service"，而是一个**工作流编排 Agent Preset**——由 system prompt 定义编排行为，通过 `subagent` 工具执行 Task/Gate，通过对话实现用户交互。

### 后续方向

1. 设计工作流 Agent Preset（cordis.yml + system-prompt.md + 工具配置）
2. 定义完整 YAML schema
3. 3-Task 端到端验证（含并行 + 人工决策）
4. 可选：保留 Cordis Client 插件做 Dashboard Slot