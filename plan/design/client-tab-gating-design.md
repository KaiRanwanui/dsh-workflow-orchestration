# Workflow 页签门控机制技术报告（DSH 0.2.0-rc.2）

> **文档性质**：现行设计文档（阶段 6 Iter-MIG5 定稿，v0.29.x）
> **关联**：[阶段 6 MIG5 迭代报告](../phases/phase-6-dsh-020-migration/iterations/iter-migration-020rc2-mig5-report.md)（演进过程与实证记录）；[client-host-communication.md](client-host-communication.md)（前后台通信）
> **适用版本**：DSH 0.2.0-rc.2（实包考据基于 `~/.local/share/dsh-cli/node_modules/@deepseek-ai/` 安装实体）

---

## 1. 问题陈述

Workflow 面板以 `conversation.view` 槽位（slot）页签形式呈现在会话视图区。门控需求：

- 当前主视图会话是 **workflow-orchestrator 编排会话** → 显示 Workflow 页签；
- 当前主视图会话是**其它类型会话**（含编排会话的 subagent 子会话）→ 隐藏页签；
- 切换必须**即时**响应（事件驱动，轮询仅允许作兜底）。

0.1.5 时代的实现（Iter-39）依赖 sessions 快照的 `current` 字段判定"当前会话"；0.2.0 删除了该字段且订阅通知语义变化，导致「页签注销后无法复活」的死锁（阶段 6 B6 缺陷：切走后页签消失、切回后不回显）。

## 2. 依赖的 DSH 0.2.0 机制（实包考据）

### 2.1 槽位系统（`@deepseek-ai/dsh-client-ui-slots`）

| API | 签名 | 作用 |
|---|---|---|
| `slots.register(options, factory)` | `options: {name, id, order, label}`；`factory(props) → ReactNode` | 在名为 `options.name` 的槽位注册一个条目（entry）；返回 **disposer**（调用即注销该条目）。**注册/注销是宿主页签显示/隐藏的唯一正统手段**。 |
| `slots.inject(name, hook)` | `hook(scopeArg) → disposer` | 槽位为空时宿主评估会调用 inject 回调（惰性复活入口；0.2.0 下宿主不保证重复调用，**不可作为依赖**） |
| `slots.entries(name)` | → 条目投影 | 宿主页签条数据源 |
| `slots.subscribe(name, cb)` | → disposer | **事件订阅**：该槽位任何注册/注销变更即触发 `cb`（宿主用它刷新页签条） |

**options 关键参数**：

- `name: 'conversation.view'`——目标槽位名（会话视图区页签族）；
- `id: 'workflow'`——条目唯一 id：宿主按它去重/识别（页签 id、视图切换激活目标）；同 id 重复注册会抛错（registerEntry 幂等守卫的原因）；
- `order: 25`——页签排序权重；
- `label: () => 'Workflow'`——页签文字。**回调惰性求值**（跟随 locale），但经宿主 `resolveSlotLabel(label) ?? id` 解析——**空/undefined 不隐藏页签，只回退显示 id**（这是 label 不能当隐藏手段的原因）。

### 2.2 宿主页签条（`@deepseek-ai/dsh-client-ui-conversation`）

```js
const viewTabs = () => {
  for (const entry of slots.entries("conversation.view")) {
    if (entry.options.id === void 0) continue
    // trajectory 是宿主硬编码的 developerTools 特例——无通用条件可见性 API
    tabs.push({ id, label: resolveSlotLabel(entry.options.label) ?? id })
  }
}
slots.subscribe("conversation.view", refreshViews)  // 注册/注销 → 即时重算页签条
```

**含义**：插件侧 register/dispose 的那一刻，宿主事件链即刷新页签——门控的"显示/隐藏"本质上就是 entry 的注册态。

### 2.3 会话数据源（`@deepseek-ai/dsh-api-session-controller` 客户端服务）

`ctx.get('sessions')` 返回会话客户端服务，核心成员 `list`（snapshot store，`subscribe(cb)` + `getSnapshot()`）：

```
snapshot = {
  ids:  SessionId[]              // 全部已知会话 id（显示序）
  byId: { [id]: SessionRow }     // 会话行数据（含下述关键字段）
  phase, projectionsBySession
}
```

**byId 条目的关键字段**（门控判定输入）：

| 字段 | 类型 | 意义 |
|---|---|---|
| `retainedBy` | `{ [source]: number }` | **按来源计数的保留引用**。`retainedBy.mainView > 0` 表示该会话正被主对话视图持有展示——这是 0.2.0 里「当前会话」的判定依据（宿主 `ui-session` Controller 的 `publishMain()` 同源逻辑：取 mainView 保留计数 >0 的会话为主视图会话；全部为 0 时回退任一 mainView 保留会话，如 hero/无会话则无）。 |
| `projectionValues.agentPreset` | `string \| undefined` | 该会话的 agent preset 投影值（0.2.0 从顶层 `agentPreset` 迁移到 `projectionValues` 下）。`'workflow-orchestrator'` 即编排会话。`undefined` = 投影未就绪。 |
| `origin` | `string \| undefined` | 会话来源。`'subagent'` 表示是某会话派生的子代理会话（编排会话派生的任务子会话也带此标记，须排除）。 |

**订阅语义**：`list.subscribe(cb)` 在**会话清单变更**（含 upsert——`retainedBy` 变化走 upsert mutation）时触发。注意：它不是「专用切换事件」，而是清单级 mutation 流；门控从每次通知的快照里现算主视图会话即可。

## 3. 门控实现（`src/client.js` register() 尾部门控块）

### 3.1 状态

| 变量 | 意义 |
|---|---|
| `disposeRef` | 当前 entry 的 disposer；`null` = 未注册（页签隐藏）。**注册态即页签可见态** |
| `sessionGateMap: Map<sid, boolean>` | 每 sessionId 的门控判定缓存（供 `slots.inject` 的 verdict 短路） |
| `gateBusy` | applyGate 重入锁（事件风暴下防抖） |

### 3.2 三层驱动链（按响应速度排序）

```
① 组件 effect（即时，毫秒级）
   WorkflowGate 渲染时（宿主以当前会话 props 驱动），effect 判定 definitiveNonWf：
     origin==='subagent' 或 (preset 已加载且 ≠ workflow-orchestrator)
   → disposeEntry()：页签立即消失
   （组件 props 的 useSessions 选择器在会话切换时重渲染——这是宿主提供的组件级订阅）

② sessions.list.subscribe → applyGate（事件驱动，一次通知内）
   解析主视图会话：ids.find(id => byId[id].retainedBy.mainView > 0)
   无主视图会话（hero）→ 维持现状（return）
   投影未就绪（agentPreset===undefined）→ 维持现状，等下一次通知
   isWf = agentPreset==='workflow-orchestrator' && origin!=='subagent'
   → isWf ? registerEntry() : disposeEntry()
   订阅成功后立即首评一次（覆盖启动时序，页签初始态即刻就位）

③ 哨兵兜底（5s 低频 setInterval，仅 disposeRef===null 时干活）
   防御 ② 未覆盖的边角（理论上无）；unref() 防 Node 门禁环境吊进程
```

**为什么 ② 是主通道而不是 ①**：①依赖组件存活（宿主渲染我们的 entry），注销后组件即卸载、失去观察力；②的订阅挂在插件工厂作用域、与 entry 生命周期无关——**注销后仍有事件源驱动复活**。这正是 0.1.5→0.2.0 死锁的解法核心：旧实现只有 ①（+ 已失效的 current 字段路径），新实现 ② 提供不依赖组件存活的确定性事件源。

**为什么 ① 仍然保留**：宿主渲染 props 的重渲染比 list mutation 通知更早到达（同一次切换中组件先收到新 sessionId），保留 ① 让隐藏方向零延迟；显示方向由 ② 兜（同样即时，见验收）。

### 3.3 inject 短路（历史兼容）

`slots.inject('conversation.view', scopeArg => ...)`：scopeSid 的 verdict 为 `false`（缓存明确非编排）时返回空工厂，否则 registerEntry。0.2.0 下宿主不保证重复调用 inject，仅作启动路径与防御，**不承担门控语义**。

## 4. 设计决策记录

| 决策 | 理由 |
|---|---|
| 注册/注销 entry 作显示/隐藏手段 | 宿主唯一通用机制（事件订阅驱动页签刷新）；label 空只回退 id，宿主无条件可见性 API |
| `retainedBy.mainView` 解析当前会话 | 与宿主 `publishMain()` 同源；0.2.0 删除 `current` 后唯一可从数据层判定的途径 |
| hero（无主视图会话）维持现状 | 页签属于「会话上下文」UI，无会话时既不强制显示也不强制清除，等下一次事件 |
| 投影未就绪维持现状 | `agentPreset` 异步投影，误判会导致闪烁；等下一次通知再判 |
| 哨兵 5s 保留 | ②的覆盖面依赖宿主 mutation 流的实现细节（upsert 通知），兜底防线成本低（未挂载时空转一次 Map 查） |
| 组件 definitiveNonWf 用「preset 已加载且非 wf」而非「非 wf」 | 避免投影加载间隙误注销（与 3.2 ② 的未就绪维持语义对齐） |

## 5. 验证基线（2026-10-03 用户真机验收）

- 切非编排会话 → 页签**即时消失**；切回编排会话 → **即时恢复**（无感知延迟、无闪烁）；
- O-2（空页签）消除；Console 无正常路径噪音；
- 603 单测 / verify-client-bundle / render-smoke / 发行断言全过。

## 6. 排障入口

- 异常路径日志前缀 `[wf-gate]`（仅 subscribe 抛错时出现）；
- 现场观察点：`disposeRef`（注册态）、`sessionGateMap`（判定缓存）、宿主 `~/.dsh-dev/logs/startup-*.log`；
- 若页签不回显：查 ② 链——sessions 服务可用性 → list.subscribe 是否触发（可在 console 手动 `ctx.get('sessions').list.getSnapshot()` 观察 retainedBy.mainView 变化）。
