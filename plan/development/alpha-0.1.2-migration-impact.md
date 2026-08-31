# DSH 0.1.2-alpha.2 变更对 workflow-agent 的影响分析与迁移方案要点

> **文档用途**：后续从 DSH `0.1.1-rc.2` 迁移到 `0.1.2-alpha.x`（或更新稳定版）时的参考资料。
> 记录 alpha 变更内容、对 workflow-agent 的具体影响、迁移注意事项与初步方案，避免届时重新调研。
>
> - **创建时间**：2026-08-31 11:03（周一，CST）
> - **当前 DSH 基线**：`0.1.1-rc.2`（`latest` 稳定版，`@deepseek-ai/dsh`）
> - **项目基线**：workflow-agent 持续在 `0.1.1-rc.2` 上迭代（本项目的正式开发以 npm 包形态进行，不用 Cordis 动态插件）
> - **项目计划**：**不变**。仍按迭代推进（当前处于 Iter-22 设计定稿，明日起开发；后续 Iter-SUBA / Iter-23 / Iter-24）。本文档仅为前瞻性影响分析，不改变迭代节奏。
> - **调研人**：DSH 运行时代码 + npm 实际包源码核对；GitHub 源码/Discussion 在本机（2026-08-31）不可达，Host 侧签名由客户端实际调用与类型声明反推，**动手迁移前需对照 alpha `.d.ts` 复核**。

---

## 1. 结论摘要（TL;DR）

1. **`0.1.2-alpha.2` 退役了 `APIProxy` 服务**，改用全新的 **Remote/Controller（Typert）** 架构。这是**破坏性变更**，不是增量。
2. 对 workflow-agent 的**直接命中点**：插件把 `apiProxy` 声明为 `inject` **硬依赖**，且**面板控制（启动/停止/继续）的消息注入完全依赖 `apiProxy.sessions.prompt` / `apiProxy.subagents.prompt`**。
3. 影响**分级**：
   - 🔴 **硬依赖断裂**：`apiProxy` 从 `inject` 移除后服务不存在 → Cordis 会让 workflow-host 插件停在 waiting（不激活），`workflow_begin`/`workflow_status` 工具与所有 `/wf/*` 路由一并消失。
   - 🔴 **功能层断裂**：即便改为软依赖，面板按钮的「注入指令给 agent」功能失效（退化为 Iter-21 之前那种「改了实例态但 agent 不感知」）。
   - 🟡 **次生变更**：session 格式迁移、每会话投影缓存、客户端模块系统重写、`code-mode→PTC` 改名等，需逐一评估。
4. **好消息**：workflow **引擎核心**（实例注册表、状态机、`workflow_begin`/`workflow_status` 工具、`/wf` 路由）**不直接使用 `apiProxy`**，迁移面相对窄，主要集中在「插件 `inject` 声明」+「两处 prompt 调用」。
5. **当前不建议升级**：`0.1.1-rc.2` 仍是 DSH 的 `latest`（npm 上 `stable` 通道最新），项目在 rc2 上迭代无任何压力。本文件是**为将来迁移做的前置分析**。

---

## 2. Alpha 0.1.2 到底改了什么（已核实）

### 2.1 APIProxy 退役

官方 Release Notes 与仓库 Discussion 明确：

- `ApiProxy retired in favor of Remote controllers, per-session projection cache, session format migration, code-mode → PTC mode rename.`
  - 来源：[Discussion #4867](https://github.com/deepseek-ai/deepseek-harness/discussions/4867)
  - 中文速览：[Discussion #4870](https://github.com/deepseek-ai/deepseek-harness/discussions/4870)（「ApiProxy 退役（全面 Remote 控制器化）」）
  - Release 镜像：[Freedom.Tech 0.1.2-alpha.1](https://freedom.tech/posts/2026-08-28-deepseek-harness-0-1-2-alpha-1/)

**实证**：

- `@deepseek-ai/dsh-host-apiproxy` 在 npm 上**没有 alpha.2 版本**（最高 `0.1.1-rc.2`，`next` tag 指向它）→ 该包不再随 alpha 发布。
- 新前端包 `@deepseek-ai/dsh-web-frontend@0.1.2-alpha.2` 的 bundle 中 `apiProxy`、`sessions.prompt` 出现次数均为 **0** → 客户端 RPC 桥已不再走 APIProxy。

### 2.2 替代机制：Remote/Controller（Typert）

出现一批新包（均已发布 `0.1.2-alpha.2`）：

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-api-remotes` | 为本应用选择并挂载 Host Remote 能力的 BFF facade；Client 通过 `ctx.remote.$mount()` 挂载每项贡献 |
| `@deepseek-ai/dsh-api-gateway` | Remote 传输层（endpoint / carrier / 取消 / 重连 / 校验） |
| `@deepseek-ai/dsh-typert-protocol` | Typert 类型协议（类型化双向 RPC），`RemoteResult`/`RemoteError` 等失败词汇 |
| `@deepseek-ai/dsh-api-session-controller` | **新包，仅有 `0.1.2-alpha.2` 一版**。持有 Host `ctx.sessionController` 服务，并生成 Client `session`/`subagents`/`skills`/`fileReferences` Remote 命名空间 |
| `@deepseek-ai/dsh-session-projection` / `…-cache` | 每会话投影 / 投影缓存（新概念） |
| `@deepseek-ai/dsh-host-webserver` | `webServer` 服务包化（仍在，但接口需复核） |

架构特征：不再有中心化的 `apiProxy` RPC 桥，改为「Host 能力以 `@Remote('name')` 装饰器声明 → 生成 `/remote` 产物 → Client 通过 Gateway 按 `ctx.remote.<namespace>.<method>` 调用」的声明式方案。命名空间与 Host Cordis 事件转发靠 `API_REMOTE_FORWARDED_EVENTS` 名单驱动。

### 2.3 session / subagent 的 prompt 接口变化（关键）

旧（`0.1.1-rc.2`，apiProxy）：

```js
// 普通 session
apiProxy.sessions.prompt({
  rpcId: `wf-start-${Date.now()}`,
  payload: { sessionId, mode: 'queue', content: [{ type: 'text', text }] },
})
// subagent session
apiProxy.subagents.prompt({
  rpcId: `wf-start-subagent-${Date.now()}`,
  payload: { parentSessionId, childSessionId, mode: 'continuable', content: [{ type: 'text', text }] },
})
```

新（`0.1.2-alpha.2`，session-controller）：

```js
// 普通 session（Host 侧 ctx.sessionController，或 Client 侧 ctx.remote.session）
ctx.sessionController.prompt({ requestId, sessionId, mode, content, clientTimeZone? }, signal)
// 或
ctx.remote.session.prompt({ requestId, sessionId, mode, content, clientTimeZone }, signal)

// subagent（Client 侧 ctx.remote.subagents）
ctx.remote.subagents.prompt({
  requestId,
  parentSessionId,
  childSessionId,
  mode: 'continuable',
  content,
  clientTimeZone,
}, signal)
```

**差异点（迁移时必须处理）**：

| 维度 | 旧 | 新 |
|---|---|---|
| 标识 | `rpcId`（外层） | `requestId`（并入请求体） |
| 结构 | `{ rpcId, payload: {...} }` 两层 | 单层拍平（无 `payload` 嵌套） |
| mode | 普通 `queue`/`steer`；子代理 `continuable` | 普通 `'queue' \| 'steer'`；子代理固定 `'continuable'` |
| 子代理寻址 | `parentSessionId` + `childSessionId` | 显式 `address` 概念 `{ parentSessionId, childSessionId, mode }`（子代理须 `origin==='subagent'` 且归属该 parent） |
| 新增字段 | — | 可选 `clientTimeZone`（浏览器时区采样） |
| 返回 | `SessionPromptValue` | `SessionPromptValue` / `RemoteResult<SessionPromptValue>`（wrap 成 `{ ok, value } \| { ok:false, error }`） |

> 注意：新普通 session 的 `mode` 收窄为 `'queue' | 'steer'`；旧的 `'continuable'` 只用于子代理地址。

---

## 3. 对 workflow-agent 的影响分析（具体定位）

项目路径：`/home/zhaokai/Projects/dsh_projects/workflow-agent`

### 3.1 受影响文件与代码位置

`apiProxy` 出现在**两处宿主插件定义**（npm 包形态 + agent preset 形态）：

| 文件 | 位置 | 内容 |
|---|---|---|
| `code/packages/workflow-host/lib/index.js` | **L7** | `const inject = ['fs','tools','webServer','subagents','agents','apiProxy','sessions']` |
| `code/packages/workflow-host/lib/index.js` | **L2852**, **L2863**, **L2869** | `injectSessionCmd()`：`ctx.get('apiProxy')` → `subagents.prompt` / `sessions.prompt` |
| `code/packages/workflow-host/lib/index.js` | **L2892**, **L2897**, **L2909** | `start` 分支：`ctx.get('apiProxy')` → prompt 注入 |
| `code/agent-presets/workflow-orchestrator/workflow-host.mjs` | **L8** | `export const inject = ['fs','tools','subagents','agents','apiProxy','sessions']` |
| `code/agent-presets/workflow-orchestrator/workflow-host.mjs` | **L2843-2916** | 同上两处 prompt 调用（mjs 为 build-preset.js 拼接产物） |

> 现有代码里用 `ctx.get('apiProxy')` + `if (!apiProxy)` 软判断，**但 `inject` 数组仍把 `apiProxy` 列为必需服务** —— 二者矛盾。Cordis 语义是：`inject` 声明了即认为是必需的，服务不存在则插件**停在 waiting（不激活）**。因此 alpha 下会**整体不激活**，而非仅消息注入降级。

### 3.2 功能映射

- **引擎核心（不依赖 `apiProxy`，基本可迁移）**：实例注册表（instance-store）、状态机、`workflow_begin`/`workflow_status`/`workflow_stop`/`workflow_reset` 等工具、`/wf/list`、`/wf/adopt`、实例目录/落盘（state.json / instance.yaml）、孤儿回收。
- **依赖 `apiProxy` 的功能（须迁移）**：面板「启动 / 停止 / 继续 / 重置」的**向 agent 注入指令**。这是 Iter-15 / Iter-21 的核心，也是 Iter-22 继续打磨的「面板控制」主链路。

### 3.3 可能受次生变更影响的面

| 变更 | 潜在影响 | 处置 |
|---|---|---|
| session 格式迁移（`SessionHeader` 版本 pin 在 0，不兼容 log 直接拒读，无迁移） | 若 workflow-agent 直接读 session 日志 / 会话持久化格式 | 复核会话持久化读法，muestran 试 |
| 每会话投影缓存（`dsh-session-projection*`） | 影响「读取会话实时状态」（如 `agents.get(sid).inbox.hasPending` 探针） | 复核投影/快照接口 |
| 客户端模块系统重写 | `code/packages/client-ui-monitor`（用 `slots`）的挂载方式可能变化 | 复核 client `slots` 挂载与 `ctx.remote.$mount` 约定 |
| `webServer` 包化 | `/wf/*` 路由注册接口可能微调 | 复核 `dsh-host-webserver` |
| `code-mode → PTC` 改名 | 与本项目几乎无关 | 无 |

---

## 4. 迁移注意事项（Checklist）

1. **先改 `inject`，别让它卡死整个插件**：把 `apiProxy` 从 `inject` 移除；改用 `ctx.get('apiProxy')` / `ctx.get('sessionController')` 软依赖（或做成可开关 shim）。这是**第一步**，否则工具/路由直接消失，根本不是「功能降级」而是「整个插件没挂上」。
2. **`inject` 与 `ctx.get` 混用要统一**：项目里 `sessions`/`agents`/`tools`/`webServer` 也同时出现在 `inject` 和 `ctx.get(...)` 判断里，语义上应以一处为准。迁移时建议把「可缺省」的从 `inject` 移除，只留真正必需的服务。
3. **prompt 调用改签名**：`rpcId → requestId`、去掉 `payload` 包裹、子代理改 `address` 语义、可选 `clientTimeZone`。**务必对照 alpha `.d.ts` 复核 Host 侧 `ctx.sessionController.prompt` 的精确签名**（本机 GitHub 不可达，本节为反推）。
4. **普通 session mode 收窄**：普通 endpoint 只有 `'queue' | 'steer'`；子代理才用 `'continuable'`。当前 `injectSessionCmd` 里 `stop` 用 `'steer'`、`start/resume` 用 `'queue'`，这个语义保留，但要确认新实现接受。
5. **子代理寻址校验**：新实现要求子代理 `origin==='subagent'` 且归属该 parent，否则报 `subagent/unauthorized`。当前依赖 `parentSessionId` 判断分支，迁移后要换到 `remote.subagents.prompt` 或等效 address 路径，并处理「普通 session 却带 parentSessionId」的边界。
6. **返回值包装变化**：新返回 `RemoteResult<SessionPromptValue>`（`{ ok, value }` / `{ ok:false, error }`），现有调用读 `promptResult` 的地方要适配，且 `snap.promptResult` 存入快照的字段结构会变。
7. **Host 侧 vs Client 侧归属**：Host 插件调注入 → 用 `ctx.sessionController.prompt`（Host 服务）。Client 侧若需触发 → 用 `ctx.remote.session.prompt` / `ctx.remote.subagents.prompt`。别把 Client 的 `remote` 用法直接抄到 Host 端。
8. **版本锁定策略**：迁移前先记录 DSH 当前版本、`@deepseek-ai/dsh-*` 相关包版本、本项目 host/client 版本（当前 host v0.11.14 / client v0.5.10 附近），迁移后可对照。迁移前先把 rc2 下的回归用例跑通，锁定基线。
9. **回归关注点**：面板 4 键（start/stop/resume/reset）对「agent 是否真的感知到」的行为，是验证迁移成败的关键；不要只验证实例态变化。Iter-21 曾修过「按钮无效（agent 不感知）」，迁移后必须重点回归此点。

---

## 5. 初步迁移方案要点（供将来执行）

> 目标：在 alpha（或更新的稳定版）上，保持 workflow-agent 功能等价，尤其是面板控制的「向 agent 注入指令」链路。

### 5.1 分层改造

- **Layer A — 宿主接入（首选，改动小）**：保留现有 Host 插件的语义，把消息注入从 `apiProxy.sessions.prompt` 换成 `ctx.sessionController.prompt`（普通）/ 子代理路径。改造点：
  1. `inject` 去掉 `apiProxy`（或改 `sessionController`）。
  2. `injectSessionCmd` 和 `start` 分支的两处调用改新签名。
  3. 适配 `RemoteResult` 包装。
- **Layer B — 服务降级兜底（可选）**：提供一层 `MessageInjector` 抽象，Host 侧根据 `ctx.get('sessionController')` 是否存在，自动选择「新 sessionController」或「旧 apiProxy」；这样迁移期间能同时在 rc2 / alpha 上跑，降低风险。

### 5.2 建议落地顺序

1. **先探针**：迁移前用一个最小 Host 插件确认 alpha 下 `ctx.get('sessionController')` 是否存在、其 `prompt` 签名与返回结构（对照 `.d.ts`）。若用 alpha，先等 `0.1.2` 出稳定版（alpha 属测试通道）。
2. **改 `inject`** → 确认插件能激活、工具/路由回来。
3. **改 prompt 调用签名** → 单测/手测面板 4 键。
4. **回归**：启动/停止/继续/重置 + 孤儿回收 + 多实例 + 状态一致性（Iter-20/21 的 v4 手测用例）。
5. **锁定版本**：记录迁移后 DSH 及各相关 `@deepseek-ai/dsh-*` 包版本号。

### 5.3 不建议做的

- 不直接在 alpha 上继续迭代（alpha 是测试通道，`0.1.2` 尚无 stable；项目计划保持 rc2 不变）。
- 不重写引擎核心去适配 `@Remote` 装饰器——引擎核心并不依赖 apiProxy，不值得为此大动干戈。
- 不把 Client 侧 `ctx.remote` 用法套到 Host 端。

---

## 6. 附：本次调研的证据链（便于复核）

| 结论 | 证据 |
|---|---|
| apiProxy 无 alpha.2 | `@deepseek-ai/dsh-host-apiproxy` npm dist-tags：`latest 0.0.1-rc.1` / `next 0.1.1-rc.2`，无 `0.1.2` |
| 客户端不再含 apiProxy | `@deepseek-ai/dsh-web-frontend@0.1.2-alpha.2` bundle `apiProxy`=0、`sessions.prompt`=0 |
| 新包出现 | `@deepseek-ai/dsh-api-remotes` / `dsh-api-gateway` / `dsh-api-session-controller` 均带 `0.1.2-alpha.2` |
| 新 prompt 签名 | `dsh-api-session-controller@0.1.2-alpha.2` `lib/typert.host.js` 内 `SessionPromptRequest { requestId, sessionId, mode:'queue'\|'steer', content, clientTimeZone? }`；`lib/client.js` `remote.session.prompt` / `remote.subagents.prompt` |
| mode 收窄 | `SessionPromptRequest` 仅 `'queue' \| 'steer'`；子代理固定 `'continuable'` |
| 本次无法核实项 | GitHub 源码/Discussion 在本机（2026-08-31）不可达；Host 侧 `ctx.sessionController.prompt` 精确签名由客户端调用 + 类型声明反推 |

---

*本文为前瞻性影响分析，项目迭代计划不变，当前仍以 DSH `0.1.1-rc.2` 为基线推进。*
