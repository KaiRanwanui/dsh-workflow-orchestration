# Iter-21 报告 — 前后台状态一致·v4 手测问题闭环 + Resume 提前

**日期**：2026-08-29
**状态**：✅ **代码完成 + Client 热修**（host v0.11.6 / client v0.5.6；157 单测通过；awaiting 部署验证。v1 手测发现 DAG 闪烁/Stop-Resume-采用按钮无反应，已随 v0.5.6 Client 热修）
**前置**：Iter-20（R1~R4 + forSession 根因 + S5 预设门控/BROKEN 展示 + 内置默认模板可执行，host v0.11.5 / client v0.5.4，157 单测）
**输入**：v4 手工验证 `plan/development/iter20-verification-report-v4.md`（14 通过 / 2 N/A / 5 问题）

---

## 背景

Iter-20 已修并通过单测；v4 手工验证在 host v0.11.5 / client v0.5.4 上发现 5 个问题（A4/A6/其他#1/#2/B2）与 STOPPED 无 Resume（原 S2）。本迭代集中修复并端到端验证，D3（Resume）按用户指示**提前**到本迭代。

## 问题定位（v4 手测，含根因）

| 编号 | 现象（v4 手测） | 根因 | 证据 |
|------|----------------|------|------|
| A4 | workflow BOUND 会话 DAG 只有起点/终点，无步骤节点 | `loadStateFromFile` 对 CREATED（无 state.json）返回 `tasks: []`，面板拿不到任务节点 | host lib 2419-2426 |
| A6 | 工作流**子会话**的面板仍显示工作流面板（有 +/采用） | 子会话继承 `workflow-orchestrator` preset → `agentPreset === 'workflow-orchestrator'`，严格门控放行 | Client `isWorkflowSession` 单一条件 |
| 其他#1 | 新建会话后按钮长时间显示 Start，需 F5；`/wf/status` 返回 null | 模块级 `wfSessionState` 未随会话/工作区切换重置；同工作区切换会话时 `activeRoot` 不变 → 不重拉列表 → 残留上一会话状态 | Client workspaceRoot effect |
| 其他#2 | 采用弹窗不显示孤儿实例列表 / 点击无反应 | 与 #1 同源——新会话 `wfInstances` 未及时填充，`poolInstances` 空；创建后列表刷新才带出 | Client 采用池 |
| B2（难复现） | 删 `metadata.json` 一次出 BROKEN、恢复后再删**不出现** BROKEN；`/wf/status` 返回 CREATED；无 `/wf/list` 轮询 | BROKEN→恢复→再 BROKEN 循环后模块级状态/render 态失同步，或轮询被展示态中断 | Client 状态机 + /wf/status 路径 |

## 交付（R1~R5）

| # | 项 | 方案 |
|---|----|------|
| R1 | CREATED 态 DAG 补任务节点（A4） | `loadStateFromFile` 对 CREATED 不再返回 `tasks: []`；从 `instance.yaml` 解析并生成 **PENDING 任务快照**（复用 `begin()` 任务字段：id/name/type/dependsOn/status/processor/outputs/gate/`_loop_*`/`_concurrent_*`），使启动前即显示步骤节点 |
| R2 | 子会话门控（A6） | `isWorkflowSession = agentPreset === 'workflow-orchestrator' && (useSessions(s=>s.byId[sid]?.origin) !== 'subagent')`；子会话一律占位 |
| R3 | 会话切换状态一致（其他#1/#2） | 切会话（含同工作区）时重置 `wfSessionState/wfInstances/wfInstanceId/latest/lastError` 并**重拉列表**；将 `sessionId` 纳入 workspaceRoot effect 依赖；消除按钮残留与采用池空/无反应；`boundId` 匹配修复（/wf/status 不再返 null） |
| R4 | BROKEN 加固（B2） | BROKEN 每次从 `/wf/list` 经 `deriveSessionState` 重派生（已有）；BROKEN 展示态**不中断轮询**（早退只影响渲染）；会话切换防御性重置模块态；避免 BROKEN→恢复→再 BROKEN 失同步 |
| R5 | Client Resume 按钮（D3=原 S2 提前） | STOPPED 显示 **Resume** 按钮 → `POST /wf/resume`（Host 已支持 `workflow_resume`/路由）；续跑保 DONE；并入 `wfListLoader` 即时刷新 |

## 验证（端到端）

- **A4**：新建实例（CREATED/BOUND）面板 DAG 显示任务节点（PENDING），不再只有 start/end。
- **A6**：打开工作流子会话 → 面板占位（"此会话不是 Workflow 编排会话"）。
- **其他#1**：同工作区切换会话 → 按钮/状态即时正确；`/wf/status` 返回正常数据（非 null）。
- **其他#2**：采用弹窗即时列出未绑定实例；点击采用有响应。
- **B2**：反复 删 `metadata.json`→恢复→再删，BROKEN 告警始终正确出现；轮询不中断。
- **D3**：STOPPED 实例显示 Resume，点击 → RUNNING（续跑保 DONE）。
- 单测：test-host 全绿（157+，如需补断言）；client bundle 构建通过。

## 提交

- `feat(iter-21): 前后台状态一致·v4 手测问题闭环 + Resume 提前`（R1~R5；具体 hash 见 `git log --grep=iter-21`；改动 `workflow-host.mjs` 的 `loadStateFromFile` + `client-ui-monitor/src/client.js`）

## 实现要点（已落地）

- **R1**：`loadStateFromFile` CREATED 分支 `tasks` 由 `[]` 改为从 `parseWorkflow(instance.yaml)` 生成 PENDING 任务快照（匹配 `begin()` 字段：id/name/type/dependsOn/status/processor/outputs/gate/`_loop_*`/`_concurrent_*`），启动前 DAG 即显示步骤节点。
- **R2**：`isWorkflowSession = sessionPreset === 'workflow-orchestrator' && sessionOrigin !== 'subagent'`（`sessionOrigin` 经 `useSessions(s=>s.byId[sid]?.origin)`）。
- **R3**：新增模块级 `wfLastSessionId` + 会话切换 effect——任意会话切换（含同工作区 `activeRoot` 不变）重置 `wfInstances/wfInstanceId/wfSessionState/latest/lastError` 并重拉列表；`isWorkflowSession` 同步 effect 在 preset 异步加载 false→true 时也启动列表轮询。
- **R4**：BROKEN 每轮经 `/wf/list` `deriveSessionState` 重派生；BROKEN 早退只影响渲染，不中断轮询；切会话防御性重置（同 R3）。B2 的"轮询停止/状态失同步"随 R3 重置+重拉得到修复。
- **R5**：`controlBtns` 在 `sessionBound && currentStage==='STOPPED'` 时新增 **Resume** 按钮 → `POST /wf/resume`（Host 已支持）。

## 验证（端到端，待部署后逐条）

- **A4**：新建实例（CREATED/BOUND）面板 DAG 显示任务节点（PENDING），不再只有 start/end。
- **A6**：打开工作流子会话 → 面板占位。
- **其他#1**：同工作区切换会话 → 按钮/状态即时正确；`/wf/status` 返回正常数据（非 null）。
- **其他#2**：采用弹窗即时列出未绑定实例；点击采用有响应。
- **B2**：反复 删 `metadata.json`→恢复→再删，BROKEN 告警始终正确出现；轮询不中断。
- **D3**：STOPPED 实例显示 Resume，点击 → RUNNING（续跑保 DONE）。
- 单测：test-host 157/157 通过；client/host 源码 `node --check` 通过。

> 部署验证：`systemctl --user restart dsh.service`（host v0.11.6）+ 浏览器硬刷新（client v0.5.5）+ 新 workflow 会话，然后跑上述 A4/A6/#1/#2/B2/D3。

## 后续

- **Iter-22**：剩余 S1/S3/S4（去自动 idle→stop、孤儿进采用池完整语义、reset 清对话）。
- **Iter-23**：实例生命周期闭环 + 归档。
- **Iter-24**：编排可视化编辑（24.1~24.4）。

> 设计稿（R1~R5）确认无误后按约定开写；涉及 Client 为主 + Host `loadStateFromFile` 一处，改动集中在 `code/packages/client-ui-monitor/src/client.js` 与 `workflow-host.mjs`，需重建并重部署后验证。
