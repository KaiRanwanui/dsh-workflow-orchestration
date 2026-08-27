# 多实例管理 — 复用 DSH Session 的技术方案

> 迭代计划：`plan/development/development-plan.md`（Iter-9 及之后）
> 本文记录 Iter-9（多实例管理）从需求到方案的技术讨论与决策，是后续迭代的依据。
> 状态：方案定稿（待按小步可验证原则拆分为多个迭代）。

---

## 1. 背景与目标

- workflow-agent 目前是**单实例**：一个编排 Agent（workflow-orchestrator 会话）运行一个工作流实例，`workflow_begin` 每次启动会 `begin()` 清空旧状态。
- **多实例管理**目标：定义多个工作流实例、各自独立运行状态与产物、可切换查看。
- 复用 **DSH（DeepSeek Harness）的 Session 切换**作为实例选择/切换机制，最大化复用 DSH 原生能力。

## 2. 当前架构：工作流执行与 Session、状态文件的关系

```
用户开 workflow-orchestrator 会话（编排 Agent 运行在此 DSH session）
  → 编排 Agent 调 workflow_begin 工具
    → workflow-host 插件（运行在编排 agent 的 session 上下文，exec.agent.session.header.cwd 取会话工作区）
    → engine 解析 YAML + 展开 task
    → storage.save() 写 <workspaceRoot>/.workflow-agent/state.json
  → 编排 Agent 逐个 task：
    → 调 subagent（子会话，独立上下文）执行 task
    → 调 workflow_status 更新 → engine 改状态 → storage.save() 再写 state.json
  → Client 面板每 2s 轮询 /wf/status → 读 state.json → 渲染 DAG
```

核心关系：
- **一个工作流实例 = 一个编排 Agent session**（当前"单实例 = 单 session"）
- workflow-host 是进程内插件，工具通过 `exec.agent.session` 取上下文
- **state.json 是运行状态的持久化载体**：engine 内存 state ↔ state.json（storage.save/hydrate），是 engine 与消费方之间的桥梁
- subagent 是子会话，每个 task 独立上下文

### 执行引擎（engine.js）功能

`createWorkflowEngine()` 是**纯状态机，不主动执行**，只被动改状态：
`begin`（初始化）/ `snapshot`（快照）/ `updateTask`（含 onError break/continue）/ `processBreak`（循环中断）/ `getRunnableTasks`（就绪计算）/ `setStage` 等。

执行由**编排 Agent 驱动**：读 `runnable` → 逐个启 subagent → 调 `workflow_status` 改状态。

## 3. DSH Session 机制调研（dsh-session）

- `sessions` 服务（`dsh-session`）是 **event-sourced**（append-only session log）。
- `ctx.sessions.create(id, {meta:{cwd, parentSession, seedLength}})` 创建 session（id 可显式指定或缺省 `session-<n>`）。
- `ctx.sessions.list() / get(id) / fork(source, boundary, childSessionId)`。
- `session.append(type, data)` 追加事件（记录执行轨迹，天然归档）。
- **事件**：`session/created`、`session/disposed`、`session/event`（append feed）、`session/flush`。
- SessionHeader：id / cwd / createdAt / parentSession。
- **多 session（agent）并行**：`agents` 配置支持多个 agent，每个独立 `sessionId`/`cwd`/agent loop，可同时运行（`const { session } = agent`，agent 与 session 一一绑定）。
- **无 `session-switch` 全局事件**（只有 created/disposed/event/flush）——但 DSH UI 前台切换 session 是原生能力。

> 官方 workflow（dsh-workflow）正是用 `session.append('tool-workflow/run-start'...)` 记轨迹 + client 端 `conversationEvents.register` 渲染。

## 4. 方案演进

### 4.1 早期方案（讨论过）

- **方案 A**：单引擎 + 多 state Map（engine 大改造）
- **方案 B**：多引擎实例（engine 零改造，workflow-host 维护 `Map<instanceId, engine>`）
- 倾向 B，但最初设计为"一个活跃实例 + 人工 stop→switch→start"

### 4.2 最终方案：复用 DSH Session

**实例 = 一个 DSH Session（workflow preset）**，实例选择/切换完全复用 DSH 的 session 切换：

- 每个实例一个 workflow-orchestrator session，实例目录按 session cwd 隔离
- DSH 支持多 session 并行（每个 agent 独立 session/cwd/loop），**多个实例天然并行**，可随时切换查看
- 实例切换 = DSH 前台切 session（对话/轨迹/DAG 状态都跟随）
- 不再强制"一个活跃 + 人工 stop 再切换"（DSH 会话本就并行）

## 5. 最终方案细节

### 5.1 实例目录结构

```
<session.cwd>/.workflow-agent/instances/<instanceId>/
├── instance.yaml     # 实例定义（引用源工作流 + 每实例参数快照）
├── state.json        # 运行时状态（engine snapshot）
├── metadata.json     # { instanceId, workflowName, sessionId, sessionCwd, createdAt }
├── output/           # 每实例输入/输出产物
└── logs/             # 每实例日志（后续监控数据）
```

源工作流定义文件保持只读（实例是参数化副本），同一工作流可多个实例配置各异。

### 5.2 实例映射（sessionId ↔ instanceId）

- **主方案**：实例目录 `metadata.json` 存 `{ instanceId, sessionId, sessionCwd }`（对 DSH session 零侵入）
- **后备**：`session.header.meta` 存 `instanceId`（若 cwd 定位不可靠时）
- 定位链路：`DAG 面板 useSessions + sessionId → byId[sessionId].cwd → <cwd>/.workflow-agent/instances/<id>/metadata.json → state.json`

### 5.3 实例运行状态

- 实例的 `active/stage/gateResult` 等记在实例目录 `state.json`（engine snapshot 落地）
- 编排 Agent 在该 session 里推进工作流，写该 session 实例目录
- DAG 面板用当前 session 的 cwd 定位实例，显示对应 DAG

### 5.4 操控工具

`workflow_create / workflow_start / workflow_stop / workflow_reset / workflow_list`
- 前四个操作实例目录（写定义、状态、清空重跑）
- `workflow_list` 从实例目录扫描列出
- 实例运行状态由 workflow 层管理（写入实例目录 state.json）；实例选择/切换由 DSH session 列表承担

### 5.5 "重置工作流"

- 需求：清除当前实例所有输出 + 状态，重新执行
- **在 workflow 层实现 `workflow_reset`**：清空实例目录 `output/`、`logs/`、`state.json` → 重新读 `instance.yaml` → `workflow_begin` 重跑
- **不依赖 DSH `/new`**：`/new` 更像 UI 的"新建对话"，不保证清空 workflow 实例目录

## 6. 待确认 / 后续迭代

- 实例 id = `workflowName-uuid8`（已定）
- 实例 directory 与 DSH session 的目录绑定细则
- 前台 DAG 如何精确跟随 session 切换（`useSessions+sessionId+cwd` 已验证）
- 按小步可验证原则拆分到多个迭代（见 development-plan Iter-9~ 重新规划）

---

## 7. 参考

- `plan/architecture/architecture-decisions.md`（架构决策，本文同步刷新）
- `plan/development/development-plan.md`（Iter-9~ 重新规划）
- `plan/development/iter8-report.md`（Iter-8 完成）
- DSH `@deepseek-ai/dsh-session`（sessions 服务）
