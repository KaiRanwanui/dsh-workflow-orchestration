# Iter-12 报告 — 前台实例界面：DAG 跟随 session + 实例列表

**日期**：2026-08-28
**版本**：@workflow-agent/workflow-host v0.5.0（含 /wf/list）、@workflow-agent/client-ui-monitor **v0.2.0**
**前置**：Iter-11（实例操控工具，ab15dee）
**状态**：代码与构建完成，**待 `systemctl --user restart dsh.service` + 浏览器刷新后验证**

---

## 交付内容

### 1. Client：workspaceRoot 跟随当前 session cwd（核心）

`conversation.view` occupant 的标准 props 面含 `sessionId` + `useSessions`（dsh-client-ui-renderer `standardProps`：root 级 `useSessions`/`useWorkspaces`，session 级注入 `sessionId`）。改造 client-ui-monitor：

```js
const sessionCwd = useSessions((s) =>
  sessionId === undefined ? undefined : (s.byId && s.byId[sessionId] ? s.byId[sessionId].cwd : undefined))
```

- **解析链**：session cwd（正斜杠归一）→ 回退 useWorkspaces 首项 → 均无则 "No workspace"
- **根切换即重置**：`activeRoot` 变化时清空 `latest/wfInstances/wfInstanceId`，立即重渲染 + 重轮询——切 session 不再看到上一个工作区的 DAG
- **移除硬编码回退**：旧 `fetch('/wf/config?workspaceRoot=/home/zhaokai/Projects/dsh_projects')` 开发机特定路径删除（session cwd + 工作区钩子已覆盖）

这与架构范例一致：官方 `ConversationRoot` 同款取值（`useSessions((s) => s.byId[sessionId]?.cwd)`）。

### 2. Client：实例切换条（只读）

- `/wf/list?workspaceRoot=` 每 10s 轮询当前 cwd 实例列表
- `instances.length > 1` 时 DAG 上方渲染 chip 条：`workflowName · id尾6位 · stage`，点击切换 `wfInstanceId`
- `wfInstanceId` 参与 `/wf/status` 轮询（空 = 最新实例）；单实例不显示（减噪）

### 3. Host：`/wf/list` 只读路由

- `registerWebRoutes(ctx, registry)` 接收实例注册表；`/wf/list` 走 registry.listInstances（复用 workflow_list 工具的聚合逻辑），同受 loopback 围栏保护
- webserver-routes 是 mjs 内联-only section（无独立源文件，Iter-5 手工改过的既定例外），直接改 mjs

---

## 关键决策

| 决策 | 理由 |
|------|------|
| 跟随 session cwd 而非工作区列表 | 实例目录锚定 session cwd（Iter-10 设计）；"实例选择/切换由 DSH session 列表承担"，面板跟随即自动正确 |
| 实例切换条只读 | start/stop/reset 按钮需 HTTP 化操控工具（写操作 + 会话语义），风险面大；读侧先行，按钮归 Iter-13+ 或按需 |
| 删除 /wf/config 硬编码回退 | 硬编码项目根是多实例错位的根源之一；解析链中已无它的必要位置 |
| 根切换清空面板状态 | 防串台：上一 cwd 的 DAG 快照/实例选择不能带到新 cwd |

## 验证（部署后执行）

1. `systemctl --user restart dsh.service`（同时加载 Iter-11 v0.5.0 工具 + /wf/list）
2. 浏览器刷新（Client v0.2.0 bundle 重载）
3. 打开测试 session（cwd=workflow_test_ws）→ Workflow Tab：应显示 test-demo COMPLETED DAG（而非项目根的 concurrent-demo）
4. `curl 'http://127.0.0.1:3080/wf/list?workspaceRoot=/home/zhaokai/Projects/dsh_projects/workflow_test_ws'` → instances 数组含 test-demo-2205f9ec
5. 在 orchestrator 会话调 workflow_create 第二个实例 → 面板出现切换条

## 已知限制 / 后续

- 切换条无操作按钮（create/start/stop/reset 的 HTTP 化未做）
- session cwd 为 HOME 的普通会话：面板显示 "Waiting for workflow..."（正确——该 cwd 无实例）
- subagent 会话的 cwd 跟随主会话，面板行为一致

## 下一步

**Iter-13 编排编辑器**（DAG 拖拽编辑 + YAML 生成）；可选插队：实例操作按钮 HTTP 化。
