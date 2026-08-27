# Client↔Host 通信方案对比：轮询 vs Host 推送

> 状态：参考文档（当前采用**轮询**，推送为远期演进）
> 决策记录：`plan/architecture/architecture-decisions.md` §5
> 源码研究：`plan/development/client-rpc-research.md`
> 本文记录两个方案的完整设计、取舍与演进路径，供后续迭代参考。

---

## 1. 背景

workflow-agent 的 Client UI（DAG 监控面板）需要实时获取工作流执行状态。
状态由 Host 侧引擎写入 `.workflow-agent/state.json`，Client 侧需要感知状态变化并更新 DAG 图元。

**约束**（来自官方源码研究）：
- `host.call` 仅动态插件可用，npm 包 Client 无法使用
- Cordis service 不跨 Host(Node)/Client(浏览器) 进程边界
- 官方为 npm 包 Client 提供的通道：webServer HTTP 路由、会话事件流、Typert Remote（装配受限）

---

## 2. 方案 A：HTTP 轮询（当前采用）

### 架构

```
[Agent 执行侧 · Host 进程]                  [Web UI 侧 · 浏览器]
编排 Agent (preset)
  │ workflow_begin / workflow_status (tools)
  ▼
workflow-host (npm 包：引擎 + 工具)
  │ 调 subagent 执行各 Task
  │ 写 .workflow-agent/state.json  ──持久化──┐
  ▼                                          │
wf-status HTTP 路由 (webServer.register)     │
  │ GET /wf/status ──读文件─────────────────┘
  ▼ 返回 JSON
[Client] client-ui-monitor (npm 包)
  │ fetch('/wf/status') 每 2s 轮询 → 指纹防抖
  ▼
DAG 图元状态更新
```

### 关键点

| 项 | 设计 |
|----|------|
| 路由 | `ctx.webServer.register({kind:'prefix'\|'exact', path:'/wf/status', handler})` |
| Client 调用 | `fetch('/wf/status?workspaceRoot=...')` 同源相对路径 |
| 轮询间隔 | 1500~2000ms（与 Iter-3 一致） |
| 防抖 | 模块级指纹（`state.stage + gateResult + retries + tasks.status`），无变化不触发渲染 |
| 状态读取 | 每次请求读 state.json（无需文件 watch） |
| 安全 | loopback 检查：仅回环地址接受（仿 `isLoopbackRequest` → 403） |
| 错误处理 | JSON 解析失败/网络失败 → 保持上次快照，记录 `lastError` |

### 实现参考

- `@linxin666/dsh-tool-describe-image`（本机已安装）：
  - Host：`src/attach-routes.ts`（`webserver.register` + `isLoopbackRequest` + `readJsonBody`/`writeJson`）
  - Client：`src/client/attach.ts`（`fetch(ATTACH_ENDPOINT, {method:'POST', ...})`）
- 官方 webServer API：`docs/subsystems/web-server.zh.md`（`deepseek-harness-master`）

### 优点

- ✅ 有可运行先例（describe-image），实现风险最低
- ✅ 无长连接、无推送基础设施，架构简单
- ✅ 状态持久化在 state.json，重启可恢复
- ✅ 引擎与监控解耦（引擎不感知 UI）

### 缺点 / 限制

- ⚠️ 最多 2s 延迟（监控场景可接受）
- ⚠️ 轮询有固定网络开销（2s 一次小 JSON，可接受）
- ⚠️ 无服务器主动事件（无法实时感知"刚发生"的变化，需等下个轮询周期）

---

## 3. 方案 B：Host 推送（远期演进）

### B1. 官方会话事件流（推荐演进方向）

官方 `dsh-workflow` + `dsh-client-ui-workflow-run` 的标准模式：

```
Host 引擎                          Client 浏览器
  │  session.append('tool-workflow/run-start', {...})   ──下行 WS──▶ conversationEvents.register(definition)
  │  session.append('tool-workflow/agent-start', {...})             （match → start → update → buildViewNode）
  │  session.append('tool-workflow/agent-end', {...})               ▶ slots.register({name:'conversation.chat.node',
  │  session.append('tool-workflow/run-end', {...})                    key:'workflow-run'}, Panel)
  ▼
会话日志（持久化、可回放）
```

关键机制（官方源码）：
- Host：`session.append(type, data)` 把状态写入会话日志
  （`packages/workflow/tool-workflow/src/index.ts` 的 `createWorkflowRecorder`）
- Client：`conversationEvents.register(workflowRunDefinition)` 注册折叠 Definition，
  经下行 WebSocket 接收事件，`conversation.chat.node` keyed renderer 渲染
- 教程：`docs/cookbook/adding-a-conversation-node.zh.md`

| 优点 | 缺点 |
|------|------|
| 完全官方、推送式（无轮询） | 引擎需改为写 session 事件（改造量大） |
| 状态持久化在会话日志，历史可回放 | UI 形态受 Conversation Node 约束（chat 内嵌节点） |
| 会话内可见（切换会话/刷新可恢复） | 需理解 ConversationNodeAssembler 引擎 |

### B2. SSE / WebSocket 自定义推送

Host 侧保持 state.json + 自定义推送端点：
- Host 用 `webServer.registerUpgrade()`（WS）或 SSE handler 保持连接
- 引擎写 state.json 后通知推送层 → 推给订阅的 Client
- Client 用 `EventSource`/`WebSocket` 订阅

| 优点 | 缺点 |
|------|------|
| 实时推送、保留自定义 UI 形态（conversation.view） | 自建推送基础设施，官方无直接先例 |
| 引擎改动小（只需写文件后发通知） | 需处理重连、订阅管理、连接生命周期 |
| 保留 state.json 持久化 | 官方文档不推荐自建协议（倾向会话事件流） |

### B3. Typert Remote + 事件（理论方案，实际受限）

官方 `@Remote` decorator 提供 Client→Host 一元 RPC，
但 Client 装配（`dsh-api-remotes`）构建时固定，第三方无法自行挂载新 Remote。
**不可行**，仅记录。

---

## 4. 方案对比表

| 维度 | A. HTTP 轮询（当前） | B1. 会话事件流 | B2. 自建推送 |
|------|---------------------|---------------|-------------|
| 实时性 | ~2s 延迟 | 即时 | 即时 |
| 实现复杂度 | 低（有先例） | 中高（引擎改造） | 中（自建基建） |
| 官方支持度 | ✅ webServer 官方 | ✅ 官方 workflow 自身用 | ⚠️ 无直接先例 |
| UI 形态自由 | ✅ conversation.view tab | ⚠️ chat 内嵌节点 | ✅ conversation.view tab |
| 状态持久化 | state.json | 会话日志 | state.json |
| 历史回放 | ❌ 无 | ✅ 有 | ❌ 无 |
| 迁移成本 | — | 引擎写事件 + Client 换 Definition | 新增推送层 |

---

## 5. 演进路径建议

```
当前（Iter-5+）                   远期
─────────────────────           ─────────────────────
方案 A：HTTP 轮询        ──►    方案 B1：官方会话事件流
  · 快速修复 RPC 链路              · 工作流状态进入会话记录
  · DAG 监控可工作                 · 历史可回放、会话内可见
  · 为 B1 预留状态模型               · 官方推荐形态
```

**何时切换 B1**：
- 需求出现"工作流状态要出现在会话历史/可回放"时
- 需要跨会话切换查看工作流状态时
- UI 形态可接受 chat 内嵌节点（或 conversation.view 保持，仅数据源切换）

**切换方式**：
1. 引擎在执行 Task 时 `session.append('wf/xxx/start'|'progress'|'end', data)`（保留 state.json 双写过渡）
2. Client 新增 `conversationEvents.register()` Definition，映射事件 → DAG 状态
3. 验证回放与实时两条路径后，再移除轮询

---

## 6. 相关文档

| 文档 | 位置 |
|------|------|
| 架构决策（当前采用轮询） | `plan/architecture/architecture-decisions.md` §5 |
| 源码研究报告 | `plan/development/client-rpc-research.md` |
| 官方 webServer 文档 | `deepseek-harness-master/docs/subsystems/web-server.zh.md` |
| 官方 workflow 文档 | `deepseek-harness-master/docs/subsystems/workflow.zh.md` |
| Conversation Node 教程 | `deepseek-harness-master/docs/cookbook/adding-a-conversation-node.zh.md` |
| 官方 workflow 事件写入 | `deepseek-harness-master/packages/workflow/tool-workflow/src/index.ts` |
| HTTP 端点先例 | `~/.dsh/profiles/desktop/node_modules/@linxin666/dsh-tool-describe-image/` |
