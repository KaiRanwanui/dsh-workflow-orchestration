# DSH 0.1.1-rc.2 → 0.1.5-rc.2 升级影响评估与迁移计划

> **状态（2026-09-13 收尾）**：✅ **已执行完毕（Phase 0–4 全部闭合）**。Phase 2 记录见 `iter-migration-015rc2-report.md`，Phase 3 回归与缺陷修复见 `iter-migration-015rc2-verification-report.md`（含版本锁定矩阵与已知限制）。
>
> **文档用途**：DSH 新 rc 版本（0.1.5 系列）已发布。本文档给出 0.1.1-rc.2 → 0.1.5-rc.2 的完整变更清单（插件开发视角）、对 workflow-agent 的代码级影响评估（已用 0.1.5-rc.2 实包逐项核对）、以及分阶段迁移计划，供决策是否升级与规划迁移迭代。
>
> - **创建时间**：2026-09-13（周六）
> - **迁移前基线**：DSH `0.1.1-rc.2`（本机，用户级 systemd `dsh.service`，Web 3080）；项目 workflow-host `0.20.1` / client-ui-monitor `0.9.0`
> - **迁移后现状（2026-09-13）**：DSH `0.1.5-rc.2`（10 个关键卫星包同版本）；项目 host **0.21.0** / client **0.9.1**；563 单测全绿
> - **调研方法**：官方 GitHub Releases（v0.1.2-rc.1 tag 页 + releases.atom 全文）+ npm 实包下载解包（主包 + 10 个卫星包 @0.1.5-rc.2，本地 `dsh-upgrade-lab/`）代码级核对 + workflow-agent 源码全量扫描（服务用法矩阵）。
> - **前作**：`alpha-0.1.2-migration-impact.md`（2026-08-31，alpha.2 期反推分析）。本文已用 0.1.5-rc.2 实包**逐项复核并确认**了当时的推断——Host 侧 `sessionController.prompt` 签名与反推一致；并修正/补充了新发现（`subagents.followup` 服务级 API 移除、`sessions.cancel` 去向、`conversation.view` 槽位存续等）。**执行期再实证修正 3 处**（§3.3 相应条目已就地标注）：`prompt` 的 signal 实为必填、continuable 子会话不再进 agents store、注入通道不再保证即时打断（→ 面板 Stop 改路由层权威直停）。

---

## 1. 版本全景：最新发布版本是什么

### 1.1 npm 渠道状态（@deepseek-ai/dsh，2026-09-13 查询）

| dist-tag | 版本 | 发布时间 (UTC) |
|---|---|---|
| `latest` | **0.1.5-rc.1** | 2026-09-10 03:12 |
| `next` | **0.1.5-rc.2** | 2026-09-10 14:57 |
| `alpha` | 0.1.5-alpha.2 | 2026-09-09 |

**用户所说"新发布的 rc 版本" = 0.1.5 系列**：`0.1.5-rc.1`（latest 稳定通道）与 `0.1.5-rc.2`（next 通道，同日发布，仅 UI 微调）。

### 1.2 版本链（自本机基线 0.1.1-rc.2 起）

```
0.1.1-rc.2 (本机基线)
  └─ 0.1.2-alpha.2 (08-30) → alpha.3 (08-31) → alpha.4 (09-01) → alpha.5 (09-02)
       └─ 0.1.2-rc.1 (09-03)          ← 官方 release notes 汇总「自 v0.1.1-rc.2 以来全部变更」
            └─ 0.1.3-alpha.1/2 (09-07)   ← 无 0.1.3 stable
                 └─ 0.1.5-alpha.1 (09-08) → alpha.2 (09-09)   ← 跳过 0.1.4
                      └─ 0.1.5-rc.1 (09-10)  ← 官方 release notes 汇总「自 v0.1.2-rc.1 以来全部变更」
                           └─ 0.1.5-rc.2 (09-10)  ← 仅反馈弹窗/文件卡片排版等 UI 修复
```

两份聚合 release notes（0.1.2-rc.1 + 0.1.5-rc.1）合起来即覆盖本机 rc.2 → 0.1.5-rc.2 的全部变更。

---

## 2. 官方变更总览（插件开发者视角）

### 2.1 🔴 破坏性变更（Breaking）

| # | 变更 | 引入版本 | 对插件开发的影响 |
|---|---|---|---|
| B1 | **APIProxy 退役**：Remote 网关统一远程调用 API 与异常分发，旧 APIProxy 已迁移并移除 | 0.1.2-rc.1（alpha.2 起） | 依赖 `apiProxy` 服务的插件**整体不激活**（inject 硬依赖 waiting）。`@deepseek-ai/dsh-host-apiproxy` 最高仅 0.1.1-rc.2，不再发布。实包复核：0.1.5-rc.2 主包 + 10 卫星包 `apiProxy` 0 命中 |
| B2 | **`Session.events` 属性移除**：改为按需读取 API `seq`、`eventAt()`、`snapshotEvents()` | 0.1.2-rc.1 | 直读 events 数组的插件需改按需读取 |
| B3 | **SQLite Session 持久化后端移除**：官方注明已有内容不删、需用旧版本导出 | 0.1.2-rc.1 | 第三方 SQLite 持久化插件（本机 web profile 的 session-rdb）阵亡；数据需迁移 |
| B4 | **会话数据格式 V2 → V3**：受支持旧日志首次读取时自动迁移生成新日志并保留原文件；升级后**不支持降级读取**；自定义日志读取器需适配 | 0.1.5-rc.1 | 直读会话日志的工具需适配；升级=单向门（回滚窗口需备份） |
| B5 | **Session 生命周期重构**：persistence API 改为生命周期持有的 `SessionHandle`；`agentLoop.create()` 改异步；新增 session 锁（同一 session 至多被一个进程持有） | 0.1.5-rc.1 | 自建 agentLoop/持久化读取的插件需适配；只用服务的插件不受影响 |
| B6 | **`ctx.agent` 移除**（访问当前 Agent 的便捷属性），需显式传递 Agent | 0.1.5（知乎二手来源，官方 notes 未单列） | 用过 `ctx.agent` 的插件需改为显式传参。workflow-agent 未用过 ✅ |
| B7 | **默认工具调整**：SDK/Headless/ACP 默认 read/write/edit；Web `minimal` 与 `sdk-minimal` 默认仅持久 shell，`str_replace_editor` 需显式启用 | 0.1.5-rc.1 | 影响 preset/子代理的默认工具集预期 |
| B8 | **原 Detail 面板移除**，右侧 Sidebar（多标签/分栏/Markdown/代码/HTML/PDF/图片预览）取代 | 0.1.5-rc.1 | 挂 Detail 面板相关槽位的插件需改挂 Sidebar；侧边栏类第三方插件大概率失效 |

### 2.2 🟡 行为变更（需知晓）

- **Web PTC 模式不再默认暴露通用 `workflow` 工具**（0.1.2-rc.1）——与本项目无关（workflow-agent 自注册 workflow_* 五件套），但回归时要确认 PTC 场景注册仍生效。
- **网络访问 Web 界面启用一次性 token 认证**（0.1.2-rc.1）——本机 3080 为 loopback 不受影响；socat 3081→3080 转发源仍是 loopback，预期不受影响，Phase 1 验证。
- **应用统一经 `dsh` Profile 启动**（含 Python SDK/ACP）（0.1.2-rc.1）——本机已是 profile 形态 ✅。
- **可继续子代理消息排队/编辑/删除/Steer/停止**；`send_message` 统一 steer 语义，跨 Agent 与冷恢复保留发送者归属与顺序（0.1.5-rc.1）——与迁移后 `subagents.prompt` 的 delivery 语义呼应。
- **Code Mode → PTC Mode 改名**（0.1.2-rc.1）——与本项目无关。
- **出站网络请求遵循 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`**（0.1.5-rc.1）——本机环境如有代理变量需注意行为变化。
- **新默认模型 `deepseek-flash`（DeepSeek-V41-Flash）**（0.1.5-rc.1）——新会话默认模型变化，配置显式指定者不受影响。
- **统一 `FS_NOT_OBSERVED` 诊断**；普通 subprocess handle 不再暴露 pid（0.1.5-rc.1）。
- 动态 System Prompt（进消息历史）且尽量不破坏 KV Cache（0.1.5-rc.1）——长会话利好，无插件适配点。
- pi-ai 升级 0.85.1；模型探测支持自定义 provider `models` 对象与 Anthropic 原生列表（0.1.5-rc.1）。

### 2.3 0.1.5-rc.2 增量

仅体验优化：点赞/点踩弹窗确认、交付文件卡片排版与代码文件图标。**无 API 变化**，升级目标取 rc.2 即可。

### 2.4 社区资源

官方 release notes 推荐了插件升级辅助 skill：`oh-my-dsh/dsh-plugin-upgrade-skill`（非官方出品），可在 Phase 2 选配试用。

---

## 3. 对 workflow-agent 的影响评估（代码级实证）

### 3.1 结论摘要（TL;DR）

1. **迁移面窄且边界清晰**：唯一硬断裂点是 inject 数组里的 `apiProxy`（插件会 waiting 不激活）；生产代码路径需迁移 **4 个调用点**（2 组 prompt 注入 + 子代理列表探针 + stop 级联中断）；另有 1 个开发用探针路由（`/wf/probe-inject`）因 `subagents.followup` 服务级 API 移除需重写。
2. **周边服务全部存续**（0.1.5-rc.2 实包逐一核对）：`fs`、`tools.register`、`webServer.register`（同形状）、`agents.get/list/roots/currentInitiator`、`sessions.get`、`sandboxPolicy`、client `slots` 服务、**`conversation.view` 槽位**、`dsh.profile.bundles` 挂载机制、`session/event` 全局事件。客户端 client-ui-monitor 预期**零改动**（仍需产物级验证）。
3. **引擎核心零影响**：实例注册表、状态机、`workflow_*` 五件套工具、`/wf/*` 路由、实例目录落盘（state.json/instance.yaml）、孤儿回收——均不触碰 apiProxy。
4. **Session V3 无直接影响**：workflow-host 不直读会话日志（源码仅 1 处注释提及 jsonl 扩展名推断，与会话日志无关）。
5. **前作推断被证实**：alpha 期反推的 `sessionController.prompt` 签名与 0.1.5-rc.2 实包**完全一致**（requestId 拍平、mode 收窄 queue|steer、clientTimeZone 可选）。新增确认：子代理路径多出 `delivery` 字段承担 queue/steer 语义。

### 3.2 服务依赖核对矩阵（workflow-host 0.20.1 → 0.1.5-rc.2）

| 依赖 | workflow-host 用法（次数） | 0.1.5-rc.2 状态 | 证据（实包读点） |
|---|---|---|---|
| `inject[]` 数组 | `['fs','tools','webServer','subagents','agents','apiProxy','sessions']`（lib/index.js:7；workflow-host.mjs:8 无 webServer） | 🔴 `apiProxy` 断裂，其余 6 项全部存续 | 主包+10 卫星包 apiProxy 0 命中 |
| `fs` | `ctx.get('fs')` ×46 | ✅ 存续 | dsh-fs@0.1.5-rc.2 在主包 deps |
| `tools` | `ctx.tools.register` ×13 | ✅ 存续（NamedEntries，重名报错语义同） | dsh-tools/lib/index.js:2538 |
| `webServer` | `ctx.get('webServer')` ×4（/wf 路由） | ✅ 存续，`register(route)`/`registerUpgrade` 与 rc.2 **同形状**（kind exact/prefix） | dsh-host-webserver/lib/index.js:176,190 |
| `agents` | `get`×13 `list`×4 `roots`×4 `currentInitiator`×4 | ✅ 全部存续 | dsh-agent/lib/index.js:563,581,590,334 |
| `sessions` | `get` ×3（孤儿判活）；`cancel` 仅注释引用无实际调用 | ✅ `get` 存续；`cancel` 移至 `sessionController.cancel({sessionId})` | dsh-session/lib/index.js:1315（Service "sessions"） |
| `sandboxPolicy` | `ctx.get` ×2（软依赖） | ✅ 存续 | dsh-sandbox-policy 在主包 deps |
| `subagents` | `followup` ×3（仅 /wf/probe-inject 探针） | 🔴 **服务级 `followup(parent,childId,content,options)` 移除** → 改 `sendMessage(sender,targetId,content,options)`（steer 语义）或 `agent.followup(message)`（queue 语义） | rc.2: dsh-subagent/lib/index.js:855,2438 → 0.1.5 SubagentRuntime 成员表无 followup |
| `apiProxy` | `ctx.get` ×10（生产 4 调用点 + 探针 + 守卫） | 🔴 整体移除 → `sessionController` + `subagents` 服务方法 | 见 §3.3 |
| `session/event` 事件 | A1 用户停止 tap：`ctx.on('session/event', ...)`（lib/index.js:96-107） | ✅ 事件存续（firehose） | dsh-session/lib/index.js:1197,1202 |
| client `slots` | client-ui-monitor 0.9.0：`slots.inject('conversation.view', ...)`（src/client.js:1155-1156） | ✅ `slots` 服务与 **`conversation.view` 槽位名均存续** | dsh-client-ui-cordis/lib/client.js:1339+；dsh-client-ui-conversation/lib/client.js:15124（renderSlot）、16544（slots.entries） |
| `dsh.profile.bundles` | client-ui-monitor 经 web profile bundles 挂载 | ✅ 机制存续 | 0.1.5-rc.2 主包 plugin-*.js ×2、profile-boot-*.js ×3 命中 |

### 3.3 断裂点迁移映射（before / after）

**① inject 声明（两处宿主形态）**

```js
// before（lib/index.js:7 / workflow-host.mjs:8）
const inject = ['fs', 'tools', 'webServer', 'subagents', 'agents', 'apiProxy', 'sessions']
// after
const inject = ['fs', 'tools', 'webServer', 'subagents', 'agents', 'sessionController', 'sessions']
```

> `sessionController` 是 0.1.5 Host 服务名（`super(ctx, "sessionController", { namespace: "session" })`），已进入稳定 API 面（dsh-api-session-controller 0.1.5-rc.2 于 next 通道发布）。

**② 普通 session 指令注入**（`injectSessionCmd` L6065-6072 与 start 分支 L6101-6110）

```js
// before
const promptResult = await apiProxy.sessions.prompt({
  rpcId: `wf-${verb}-${Date.now()}`,
  payload: { sessionId, mode, content: [{ type: 'text', text }] },   // mode: stop→'steer'，其余→'queue'
})
// after
const sessionController = ctx.get('sessionController')
const promptResult = await sessionController.prompt(
  { requestId: `wf-${verb}-${Date.now()}`, sessionId, mode, content: [{ type: 'text', text }] },
  new AbortController().signal   // ⚠️ 执行期实证修正：signal 实为**必填**
)             // → { accepted: true }（SessionPromptValue）
```

差异：`rpcId`→`requestId` 并入请求体；去掉 `payload` 包裹；返回直接值（不再有 `{payload:{rpcId,result:{ok,value}}}` 双层解包）；新增可选 `clientTimeZone`（Host 侧注入可不传）。

> ⚠️ **执行期实证修正（2026-09-13，Phase 3）**：原文写「signal 可选」与实包不符——`sessionController.prompt` 实现首行即 `signal.throwIfAborted()`，传 `undefined` 抛 `Cannot read properties of undefined (reading 'throwIfAborted')`（缺陷 #3，见验证报告）。4 处调用统一改传真实 `AbortController().signal`。

**③ 子代理指令注入**（L6059-6066 与 L6093-6100）

```js
// before
const promptResult = await apiProxy.subagents.prompt({
  rpcId: `wf-${verb}-subagent-${Date.now()}`,
  payload: { parentSessionId, childSessionId: sessionId, mode: 'continuable', content: [{ type: 'text', text }] },
})
// after（subagents Host 服务；mode 恒 'continuable'，queue/steer 语义改由 delivery 承担）
const promptResult = await ctx.subagents.prompt(
  {
    requestId: `wf-${verb}-subagent-${Date.now()}`,
    parentSessionId, childSessionId: sessionId,
    mode: 'continuable',
    delivery: verb === 'stop' ? 'steer' : 'queue',   // ← 新增字段：保留现有 stop=steer / start=queue 语义
    content: [{ type: 'text', text }],
  },
  undefined
)             // → { messageId }（SubagentPromptReceipt）
```

**④ 子代理列表探针**（L50-57，Iter-SUBA 子会话聚合）

```js
// before
const r = await apiProxy.subagents.list({ rpcId: 'wf-children-' + Date.now(), payload: { parentSessionId } })
// 解包 r.payload.result.value.entries / .parentAvailable
// after（二选一）
const entries = await ctx.subagents.listChildren(parentSessionId)          // → SubagentListEntry[]（durable）
const catalog = await ctx.subagents.remoteExportList(parentSessionId, s)   // → SubagentCatalog（含 live activity + parentAvailable，最接近旧行为）
```

> 现 probe 自己用 `agents.get(id)?.status === 'running'` 重算 activity，故 `listChildren` 即可等价；条目结构变化：`SubagentListEntry = { kind: 'child' | 'diagnostic', ... }`（按 createdAt、id 排序）。
>
> ⚠️ **执行期实证修正（2026-09-13，Phase 3）**：0.1.5 下 **continuable 子会话不再进 agents store**（`agents.get(childId)` 恒 `undefined`），且 `listChildren` 条目的 `activity` 字段亦不可靠（子会话在跑仍报 `inactive`）→ 原「用 agents 重算 activity」的等价性前提不成立。**最终实现**：守卫判活主源改为 `sessions.get(child)`（resident = live activation，0.1.1 同源语义），`activity`/`agents.get` 仅作兜底；停止级联则**放弃判活、对全部 child 条目直接下发 `interruptByParent`**（官方契约保证 absent/idle/completed 目标为 accepted no-op）。详见验证报告缺陷 #4。

**⑤ 子代理中断**（L61-64 探针 + L4853-4864 stop 级联）

```js
// before
await apiProxy.subagents.interrupt({ rpcId: 'wf-interrupt-...', payload: { parentSessionId, childSessionId } })
// after（参数顺序变为 (child, parent, mode)；absent/idle/completed 目标是 accepted no-op）
await ctx.subagents.interruptByParent(childSessionId, parentSessionId, 'continuable')   // → { accepted: true }
```

**⑥ `/wf/probe-inject` 探针路由**（L5920-6000，Iter-14 开发工具）

```js
// before
const messageId = await subagents.followup(parentAgent, targetSessionId, content, { signal })
// after（二选一；探针为开发工具，顺手迁移即可）
const messageId = await ctx.subagents.sendMessage(parentAgent, targetSessionId, content, { signal })  // steer 语义
parentAgent.followup(message)                                                                        // queue 语义（Agent 原语）
```

**⑦ 返回值与快照字段**：`snap.promptResult` / probe 返回里的结果结构改变（`{accepted:true}` 或 `{messageId}`），`/wf` 面板与 JSON 直出消费方需同步核对（Phase 3 回归项）。核对结论：`snap.promptResult` 仅进 `/wf` JSON 直出（诊断用），无客户端消费方；`snap.apiProxyUnavailable` → `snap.sessionControllerUnavailable`（同样无外部消费方）。

> ⚠️ **执行期架构修订（2026-09-13，Phase 3 缺陷 #5）——注入通道不再保证即时性**：实测 0.1.5 下 `sessionController.prompt`/`subagents.prompt` 注入的消息**不再保证当场打断进行中的回合**（被排到 inbox `next-step`，甚至被后续 UI 操作整批移除，会话日志见 `agent/inbox/spliced {removedCount:2}`）。因此 Iter-21 确立的「面板 Stop = steer 注入 → agent 调 `workflow_stop`」间接链路失效（子会话迟迟不停）。
>
> **最终实现（面板 Stop 新语义）**：`/wf/stop` 路由层**权威直停**，同步串行四步——① 磁盘水合（重启后 `hasState=false` 时按 `state.json` 恢复）② `engine.stop()` + 落盘 + `stopReason='user-stop'` ③ **`sessionController.cancel({ sessionId })`（主通道）**：与 UI 停止按钮同一原语，0.1.5 原生级联令子会话收到 `aborted(parent)` 并终止；cancel 不可用时退回「对全部 child 条目下发 `interruptByParent`」兜底 ④ 注入「请停止」消息降级为**事后通知**（best-effort，让 agent 下轮看到 STOPPED 不再派发）。A1（会话级 UI 停止）链路不变，继续经 `session/event` tap → `applyUserStop`。

### 3.4 次生影响

| 项 | 评估 |
|---|---|
| Session V3 格式 | 无直接影响（不直读日志）。`subagents.listChildren` 依赖 projection registry——若部署未挂载会报 `subagent/projections-unavailable`；0.1.5 默认 profile 挂载，Phase 1 冒烟确认 |
| 升级单向门 | 升级后旧会话迁移为 V3、不可降级读取 → 回滚窗口内必须保留 rc.2 可读的备份副本 |
| 默认工具调整 | workflow_* 为自注册工具不受影响；orchestrator preset 子代理默认工具集预期变化（read/write/edit）需在 Phase 3 顺带观察 |
| Web PTC 通用 workflow 工具下线 | 与本项目无关，回归确认 PTC 下自注册工具仍生效即可 |
| 客户端模块系统 | 0.1.2 重写过客户端模块系统，但 `slots` 服务、`conversation.view` 槽位、`dsh.profile.bundles` 均存续 → client-ui-monitor 预期零改动；仍按纪律跑 `verify-client-bundle.js` 产物级验证 |

---

## 4. 生态与本机环境影响（升级 DSH 的连带成本）

> **注（2026-09-13 D4/D5 拍板后）**：本节第 1、3、5 点的存量处置（SQLite 导出、聚合包卸载、旧插件冒烟）因「全新安装、数据全弃」**不再适用**；仍需知晓的只剩第 2 点（V3 迁移语义）、第 4 点（token 认证）、第 6 点（默认模型）。

1. **session-rdb（SQLite 持久化）阵亡**（B3）：web profile 目前用 `@morlay/session-rdb` 把会话存 `sessions.sqlite`（2026-09-02 起的新会话）。官方 0.1.2 移除 SQLite 持久化后端 + 0.1.5 persistence API 重构（SessionHandle），该第三方插件无法在 0.1.5 工作。**升级前必须用 rc.2 把 SQLite 会话导出/迁移到 JSONL**，否则升级后这批会话不可见（数据保留但不可用）。
2. **V2→V3 自动迁移**：升级后首次读取旧 JSONL 会话自动迁移并保留原文件，无需手工干预；但迁移后旧版本读不回。
3. **Web UI 全家桶 `@linxin666/dsh-web-ui-all@0.3.6`**：已 deprecated；0.1.5 官方重做 Sidebar（B8），聚合包与其内置侧边栏/Detail 相关功能大概率失效。用户此前已决定弃用聚合包改单独安装——迁移时直接切官方 Sidebar，旧侧边栏插件（dsh-better-sidebar 等）预计不再需要。
4. **其余已装插件**（dshmarket、@liustack/modsearch、dsh-tui、@yejiming/dsh-data-agent、dsh-mnemon）：均为 Host 侧插件，核心服务名存续，预期多数可用，但需逐一冒烟；不兼容者等其作者发 0.1.5 适配版。
5. **token 认证**：loopback（3080）不受影响；socat 3081→3080 源仍为 loopback，预期不受影响（Phase 1 验证一次）。
6. **默认模型**：新会话默认 `deepseek-flash`；本机如已显式配置模型则不变，Phase 1 记录确认。

---

## 5. 迁移计划（分四阶段，总计约 3~4.5 人日）

> **分工（2026-09-13 D1 拍板后）**：Phase 0/1（备份、SQLite 会话导出、DSH 升级安装、插件生态冒烟）由**用户在其他 Agent 辅助下于会话外完成**；本 DSH 会话从 Phase 2（workflow-agent 代码适配）接手，按迭代方式推进——开工前按团队约定先确认本迭代设计方案（交付范围/验证标准）。

### Phase 0 — 准备（≈0，已按 D3-D6 简化）

- ~~备份 `~/.dsh`、SQLite 会话导出、rc.2 回归基线~~（2026-09-13 D4 拍板：全新安装、原插件与数据全部丢弃，以上全部取消）。行为基线以仓库既有记录为准（563 单测 + 各迭代 GUI 验收报告）。
- 仅存动作：确认 `~/Projects/dsh_projects/workflow-agent/`（仓库）与 `dsh-upgrade-lab/`（0.1.5-rc.2 证据包）不在清理范围——二者在 Projects 工作区，不受 `~/.dsh` / `~/.mnemon` 清空影响。
- **验证标准**：仓库与证据包完好。

### Phase 1 — 全新安装 DSH 0.1.5-rc.2（0.5d，用户 + 外部 Agent）✅ 已完成（2026-09-13，会话外）

- [x] 清空旧 DSH 数据（`~/.dsh` 等，D4/D5 拍板全部丢弃），全新安装 `@deepseek-ai/dsh@0.1.5-rc.2`，重建 web(3080) / headless profile。（✅ 复核：主包 + 10 关键卫星包均 0.1.5-rc.2）
- [x] 插件按需从零选装（D5：旧插件不迁移；侧边栏用官方内置）。（✅ 全新环境仅挂载本项目两包 + 官方 bundle）
- [x] **重启 `dsh.service` 后 journalctl 冒烟**：Web 3080 打开、新建会话、3081 转发可达。（✅ Phase 2 部署后由本会话复核：journal 无意外报错）
- [x] 此阶段 workflow-agent 尚未挂载（全新环境无插件）——Phase 2 完成适配后一并重新挂载。（✅ Phase 2 已重挂载）
- **验证标准**：journalctl 无意外报错；新会话正常对话。✅
- **回滚点**：无（全新安装无存量数据可回滚；异常则重装另起）。

### Phase 2 — workflow-agent 适配（1~1.5d）✅ 已执行（2026-09-13，报告 `iter-migration-015rc2-report.md`）

按 §3.3 映射表落地（源文件：`code/plugins/workflow-host/*` → build）：

- [x] ① 两处 `inject`：`apiProxy` → `sessionController`（`packages/workflow-host/lib/index.js:7`、`agent-presets/workflow-orchestrator/workflow-host.mjs:8`）。（npm 包侧 inject 改由 build.js 从 mjs 提取，消除模板硬编码漂移隐患）
- [x] ②③ `injectSessionCmd`（~L6043-6079）与 start 分支（~L6086-6125）的 4 处 prompt 调用改新签名（`requestId`、拍平、`delivery` 字段、返回值直接量）。
- [x] ④ 子代理列表探针（L50-57）→ `listChildren`（activity 本地 agents.get 重算，等价旧行为）。
- [x] ⑤ 中断探针（L61-64）与 stop 级联（L4853-4864）→ `interruptByParent`。
- [x] ⑥ `/wf/probe-inject`（L5920-6000）→ `sendMessage`。
- [x] ⑦ `snap.promptResult` 等返回结构消费方核对（无客户端消费方；`snap.apiProxyUnavailable`→`snap.sessionControllerUnavailable`）。
- [x] 构建：`sync-modules.js`（tools-preset/instance-store）+ mjs 直编 section 手工改 + `build.js`；563 单测全绿（桩已同步新服务形状）；client 侧 `verify-client-bundle.js` 通过（client 代码零改动）。
- [x] **全新环境重新挂载**（D4/D5 全新安装后必需）：`dsh plugin --profile web add` 完成依赖+bundle 对账；preset 文件全量部署 `~/.dsh/.agent-presets/workflow-orchestrator/`。
- [x] 部署：文件到位后**提醒用户重启 `dsh.service`**，再以 journalctl 验证插件激活（工具 5 件套 + /wf 路由注册、无 waiting）。（✅ 2026-09-13 20:41 重启后验证：journal 无 waiting/error、`[workflow-agent] materialize ok`、`/wf/list` HTTP 200 合法 JSON、`conversation.view` 槽位在 live Slots 树确认存续）
- **验证标准**：`workflow_list/create/start/status/stop/reset` 工具与 `/wf/list` 等路由全部注册成功。（✅ 路由注册达成；工具 5 件套属 orchestrator preset 会话内验证，归 Phase 3 GUI 验收）

### Phase 3 — 回归验证（0.5~1d）✅ 已执行（2026-09-13，报告 `iter-migration-015rc2-verification-report.md`；期间发现并修复 6 项迁移缺陷，含面板 Stop 架构修订为路由层权威直停）

- [x] **面板 4 键对「agent 真实感知」**（Iter-21 教训核心）：start（queue）/ stop / resume / reset——不能只看实例态变化，要看 agent 是否真的执行了注入指令。
      （✅ Start `{accepted:true}` → agent 调 `workflow_begin` → RUNNING；Stop 经 steer 当场 `agent/inbox/spliced` → agent 调 `workflow_stop` → STOPPED+`user-stop`；Resume 保进度 2/4→3/4→COMPLETED；Reset 备份+清理。**注**：Stop 最终语义已按缺陷 #5 修订为路由层权威直停，见 §3.3⑦ 注）
- [x] 子代理分支：orchestrator 作为 continuable 子代理被注入（delivery=queue/steer 两态）。
      （⚠️ **未做真实拓扑实测**——实际使用形态为根会话，无父子拓扑；以单测覆盖两态语义 + API 可达性验证关闭，见验证报告「已知限制」#1）
- [x] A1 用户停止链路：UI 停止 → `sessionController.cancel` → 回合 aborted(user) → `session/event` tap → wf STOPPED(user-stop) + 级联 interrupt。
      （✅ 实证：`turn/end {aborted, reason:{kind:'user'}}` → tap 命中 → STOPPED + `stopReason:user-stop` 落盘；子会话收到 `aborted(parent)`）
- [x] 孤儿回收（sessions.get 判活）、多实例并行、门禁 subagent（PASS→COMPLETED）、stop→resume 保进度。
      （✅ 重启后实例自动解绑入池/多实例并存/归档采用流程正常；stop→resume 保进度实证。门禁 subagent 属引擎既有能力，本轮 demo 未覆盖门禁分支，归 Iter-31 顺带）
- [x] `/wf/probe-inject` 新 API 冒烟（sendMessage 返回 messageId）。
      （⚠️ **部分完成**：路由可达 + 对根会话目标正确返回 lineage 拒绝；完整冒烟需父子拓扑，同「已知限制」#1）
- [x] 客户端面板（conversation.view 槽位）渲染正常。
      （✅ 修复缺陷 #2（projection 门控）后 DAG 面板正常渲染；`read_image` 等新版 UI 卡片未逐一过检，归日常使用观察）
- [x] 跑通一个完整 demo 工作流（含模板复制、preset items、output 落盘）。
      （✅ default-demo 完整跑通 ×2（4/4 COMPLETED，产物落盘）；items-demo/preset 复制分支由既有 563 单测覆盖）
- **验证标准**：Phase 0 锁定的回归用例全绿 + demo 工作流端到端成功。（✅ 563 单测全绿 + default-demo 端到端 COMPLETED 4/4 ×2；两项受限项见上方标注与验证报告「已知限制」）

### Phase 4 — 收尾（0.5d）✅ 已执行（2026-09-13）

- [x] 版本锁定记录：DSH **0.1.5-rc.2** + 10 个关键卫星包（同版本）+ 本项目 host **0.21.0** / client **0.9.1**（`dsh.engines.dsh: >=0.1.5-rc.1`）→ 落档见 `iter-migration-015rc2-verification-report.md`「版本锁定」节。
- [x] 文档更新：本文档头部状态改「已执行（Phase 0–4）」、基线更新为迁移后现状、§3.3 三处执行期实证修正就地标注；progress-record 增补迁移与收尾条目；旧 `alpha-0.1.2-migration-impact.md` 已标注由本文接替。
- [x] 仓库提交 + push（既有 git 通道；迁移迭代提交 `7bf13dd`）。
- [x] 附加收尾：`scripts/build-preset.js` 废弃化（文件头 DEPRECATED + 运行即 `exit 1` 并提示现役构建链），从机制上杜绝误跑覆盖现役 mjs。

---

## 6. 决策记录（2026-09-13 用户拍板，D1-D6 全部闭合）

| # | 决策 | 结论 |
|---|---|---|
| D1 | **目标版本** | ✅ **0.1.5-rc.2**。环境安装（Phase 0/1）由用户借助其他 Agent 完成，完成后回本 DSH 会话启动 workflow-agent 迁移迭代 |
| D2 | **升级时机** | ✅ 30 个迭代已全部完成（host v0.20.1 / client v0.9.0），无在途约束；Iter-31（规划中 backlog）排迁移后 |
| D3 | **兼容策略** | ✅ **直接切换**：不做双版本/兼容 shim，直接部署运行 0.1.5-rc.2 |
| D4 | **会话数据** | ✅ **全新安装，SQLite 会话数据不保留**；原插件、数据全部丢弃 → Phase 0 备份/导出项取消 |
| D5 | **生态插件** | ✅ 同 D4：旧插件不迁移，全新环境按需从零选装 0.1.5 兼容版（侧边栏用官方内置） |
| D6 | **辅助工具** | ✅ 不使用 `oh-my-dsh/dsh-plugin-upgrade-skill` |

---

## 7. 附录：证据链

| 结论 | 证据 |
|---|---|
| 版本与时间线 | npm dist-tags/time：0.1.5-rc.1=2026-09-10T03:12Z、rc.2=14:57Z；`@deepseek-ai/dsh-host-apiproxy` latest=0.0.1-rc.1 / next=0.1.1-rc.2（无新版） |
| 0.1.2-rc.1 变更 | GitHub Releases tag `dsh-v0.1.2-rc.1`（中英全文）：APIProxy 移除、Session.events 替换、SQLite 后端移除、token 认证等 |
| 0.1.5-rc.1/rc.2 变更 | GitHub `releases.atom` 全文：Session V3、SessionHandle/锁、默认工具、Sidebar、V41-Flash、HTTP_PROXY 等；rc.2 仅 UI |
| ctx.agent 移除 | 知乎《DSH 0.1.3→0.1.5 主要更新》解读（二手来源，置信中）——workflow-agent 未使用，无适配必要 |
| apiProxy 移除 | 0.1.5-rc.2 主包 + 10 卫星包解包 grep 0 命中；本地 `dsh-upgrade-lab/` |
| sessionController 契约 | dsh-api-session-controller@0.1.5-rc.2 `lib/typert.host.js`（服务注册 :2726；prompt :992；cancel :765）+ `lib/types/types.d.ts`（SessionPromptRequest :292-300、SessionCancelRequest :326-332） |
| subagents 契约 | dsh-subagent@0.1.5-rc.2 `lib/typert.host.js` 成员表（listChildren/listDescendants/remoteExportList/prompt/interruptByParent/sendMessage 等，:187-257）+ `lib/types/control-types.d.ts`（SubagentPromptRequest :86-110、Receipt） |
| followup 移除 | rc.2 本机 dsh-subagent/lib/index.js:855,2438 有 `async followup(parent, childId, content, options)`；0.1.5 SubagentRuntime 成员表无此方法（Agent 对象级 `followup(message)` 仍在） |
| agents/sessions/webServer/tools 存续 | dsh-agent/lib/index.js:563(get)/581(list)/590(roots)/334(currentInitiator)；dsh-session/lib/index.js:1315(Service "sessions")；dsh-host-webserver/lib/index.js:176,190（与 rc.2 :128,:142 同形状）；dsh-tools/lib/index.js:2538 |
| session/event 存续 | dsh-session/lib/index.js:772,1015,1197,1202 |
| conversation.view 存续 | dsh-client-ui-conversation@0.1.5-rc.2 lib/client.js:15124（renderSlot("conversation.view")）、:16544（slots.entries）；client slots 服务见 dsh-client-ui-cordis/lib/client.js:1339+ |
| dsh.profile.bundles 存续 | 0.1.5-rc.2 主包 lib/plugin-*.js ×2、lib/profile-boot-*.js ×3 命中 |
| workflow-agent 读点 | `code/packages/workflow-host/lib/index.js`：7(inject)/23-30(sessions/agents 判活)/50-64(探针)/96-107(A1 tap)/4671+(tools.register)/4853-4864(stop 级联)/5920-6000(probe-inject)/6043-6125(injectSessionCmd+start)；`code/agent-presets/workflow-orchestrator/workflow-host.mjs:8`；`code/packages/client-ui-monitor/src/client.js:1155-1156` |

---

*本文为 0.1.5-rc 系列的正式影响评估与迁移计划；执行决策见 §6，执行结果待 Phase 4 回填。前作 `alpha-0.1.2-migration-impact.md` 的推断已全部复核完毕，以本文为准。*
