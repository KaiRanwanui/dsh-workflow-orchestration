# Iter-19 报告 — WebUI↔workflow 配合调优（前后台联动）

**日期**：2026-08-29
**版本**：@workflow-agent/workflow-host **v0.11.0**、@workflow-agent/client-ui-monitor **v0.5.0**
**前置**：Iter-16~18（状态机/绑定/控制/孤儿回收）
**状态**：✅ **代码完成**（143/143 单测通过，host lib + client bundle 构建通过；待部署验证）

---

## 交付内容

### 1. create 即绑定（前后台创建打通）

- `/wf/create` 路由：新增绑定到请求 `sessionId`（create-bind，实例出生即绑定会话）；无 sessionId 时回退 `sessionId=null`（UNBOUND 池）。
- Client `/wf/create` 传入当前 `sessionId`。
- 效果：面板建实例后无需 adopt，Start 直接驱动。

### 2. 执行期 = RUNNING（状态机与编排一致）

- `workflow_begin` 工具 `begin(parsed)` 后补 `engine.start()` → RUNNING（不再停留 PENDING）。
- 编排 agent 对 **已绑定/面板创建的实例** 用 `workflow_start` 驱动（不再 `workflow_begin` 重复新建）；仅自建新实例时用 `workflow_begin`（同样 → RUNNING）。
- system-prompt / agent.cordis.yml 同步该模式。

### 3. Session 启停同步（新增，前后台状态配合）

- **信号**：DSH `agents.get(sid).status`（`AgentStatus = 'idle' | 'running'`，源码 `packages/core/agent/src/runtime-types.ts`；`agent/status` 事件）。
- **规则**（注入 `isAgentRunning`，惰性观测于 `forSession`）：
  - agent `idle`（用户停 session）→ 绑定实例若 RUNNING 则 `engine.stop()` → STOPPED（保 DONE 进度）。
  - agent `running`（用户启 session）→ 绑定实例若 STOPPED 则 `engine.resume()` → RUNNING（续跑）。
  - CREATED/PENDING/COMPLETED/FAILED 不误改；无法判定 agent 状态时不触发。
- **时机**：`forSession` 观测时同步（面板 `/wf/status`、`workflow_status` 触发）。

### 4. Client 按钮 gating

- Start 仅 `CREATED/PENDING`（已重置待启动）；Stop 仅 `RUNNING`（PENDING 非执行中）。

---

## 验证

### 单测（用例 14 新增 6 断言，总 143/143 ✅）

| 断言 | 结果 |
|------|------|
| workflow_begin: 返回 RUNNING（执行期=RUNNING） | ✅ |
| workflow_begin: 实例绑定 sess-a | ✅ |
| sync:idle → 实例 STOPPED | ✅ |
| sync:running → 实例 resume RUNNING | ✅ |
| route create: 返回 sessionId=sess-b | ✅ |
| route create: metadata.sessionId=sess-b | ✅ |

### 构建

- `instance-store.js`/`tools-preset.js` → `sync-modules.js` 同步到 mjs → `build.js` 重建 host `lib/index.js`（v0.11.0，inject 含 `sessions`/`agents`）；`client-ui-monitor/build.js` 重建 client bundle（v0.5.0，`/wf/create` 带 sessionId + 按钮 gating）。

### 追加修复（手工验证发现的阻塞，A1/A2，v0.11.1 / v0.5.1）

- **A2 根因**：`/wf/create` 路由、`workflow_create`/`workflow_begin` 之前直接 `beginInstance`，**绕过 createBind 的 1:1 守卫**→同会话可绑多实例→`checkWorkspaceTreeIntegrity` 整工作区 BROKEN（CONFLICT）且无恢复。
- **修复**：上述创建路径改走 **`createBind`（1:1 守卫）**；新增 **`recoverBindingConflicts`**——按用户策略 CONFLICT 自愈：不保留"最新"，而是把冲突旧实例解绑（`sessionId→null` 回 UNBOUND 池），新建实例绑定当前会话；`recoveredConflict` 返回由 UI 弹窗明确告知。
- **A1**：Client 创建按钮仅当会话 `UNBOUND` 显示；可选实例池仅列未绑定（`sessionId==null`）实例；创建后若 `recoveredConflict` 非空弹窗提示。
- 单测：用例 14 新增 5 断言（CONFLICT 前置 BROKEN / 自愈解绑 2 个 / 不再 BROKEN / sess-y BOUND / sess-x UNBOUND），总 **148/148**。

---

### 部署验证（待执行）

1. `systemctl --user restart dsh.service`（Host 插件 v0.11.0）
2. 浏览器硬刷新（Client bundle v0.5.0）
3. 同步部署 preset（system-prompt.md / agent.cordis.yml）到 `~/.dsh/.agent-presets/workflow-orchestrator/`
4. 端到端：面板建实例（绑定）→ Start 直接 RUNNING → Stop 生效 → 在 DSH 上停/启 Session → 实例 STOPPED/resume RUNNING

## 提交

- `feat(iter-19): WebUI↔workflow 配合调优（前后台联动）`（具体 hash 见 `git log --grep=iter-19`）

## 下一步

**Iter-20 前后台状态一致（Iter-19 收尾）**：R1(/wf/list 补 sessionState + Client create/start gating)、R2(面板 Start 不置 RUNNING、状态归 workflow_start)、R4(Session 启停同步覆盖列表路径)、R3(实例列表并入创建界面)、绑定/采用/锁定、预设门控、BROKEN 展示。端到端验证：面板建实例→仅本会话绑定→Start 单权威 RUNNING→会话启停同步→列表无过期状态。其后 Iter-21 生命周期闭环+归档、Iter-22 编排编辑器（迭代计划已按功能闭环重组）。
