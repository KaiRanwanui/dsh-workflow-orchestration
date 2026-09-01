# workflow 与 Session/subagent 状态管理 — 技术总结

- **定位**：workflow 执行状态机已基本完善，本文在开始新迭代前对该机制做一次面向人的技术总结——从使用场景出发描述用户能感受到的状态变化与前台交互，并给出一句话可查的 DSH API 对照。
- **读者**：后续维护者、评审者、需要理解"面板上那个状态到底怎么变的"的人。
- **配套**：`workflow-lifecycle-design.md`（生命周期与归档设计）、`dsh-session-subagent-control-research.md`（子会话控制探索）、`plan/development/iter23-probe-report.md`（停止信号实证）。

---

## 1. 三层状态，一条主线

系统里同时存在三套"状态"，分清它们是理解一切的基础：

| 层 | 谁维护 | 存在哪 | 取值 |
|---|---|---|---|
| **工作流实例状态（权威）** | workflow 引擎 | 实例目录 `state.json`（磁盘） | `CREATED`（已建未启动）→ `PENDING`（已启动待跑）→ `RUNNING` → `STOPPED` / `COMPLETED` / `FAILED`；附 `stopReason` 说明停止原因 |
| **编排会话状态（观察）** | DSH 运行时 | 内存 | agent 只有 `running`（正在执行回合）/ `idle`（回合间隙）两态，**没有"已停止"状态** |
| **子会话状态（观察）** | DSH 运行时 | 内存 | 每个任务子会话的 `activity: running / inactive` |

一条主线：**插件持续把"观察到的会话/子会话状态"翻译成"引擎权威状态"的变更**。用户在面板上看到的状态，永远读自引擎权威状态（磁盘），因此重启不失真、跨会话可追溯。

## 2. 停止原因（stopReason）——决定"还能不能自己活过来"

| stopReason | 何时写入 | 之后的行为 |
|---|---|---|
| （空） | 正常运行/显式 Resume 后 | — |
| `session-idle` | 编排会话空闲、且没有子会话在跑时的自然暂停 | 编排会话再次活跃时**自动恢复**（用户发任意一句话即可续跑，无需说"继续"） |
| `user-stop` | 面板 Stop 按钮，或会话内的停止按钮 | **永不自动恢复**；子会话发回的完成通知也不再推动工作流；只能显式点 Resume |

这一对语义是整个状态机的灵魂：**自然暂停要顺滑，用户停止要彻底**。

## 3. 使用场景走查

每个场景按「你做什么 → 你看到什么 → 背后发生了什么」描述。背后部分列出真实 DSH API 调用形状。

### 场景 1：在面板上创建实例

- **你做什么**：在 workflow 编排会话里点「+ 创建」，选模板（默认 default-demo），可改参数，确认。
- **你看到**：DAG 面板立即画出任务节点（灰色待执行）；按钮区从「创建/采用」切换为「Start」；工作区磁盘出现 `.workflow-agent/instances/<实例id>/` 目录。
- **背后**：浏览器 `POST /wf/create`（body 含 `workspaceRoot`、模板/定义、`sessionId`）→ 插件写三份文件：`instance.yaml`（定义快照）、`metadata.json`（含 `instanceId`、`sessionId`、`sessionCwd`）、`output/`、`logs/` 骨架。`metadata.json` 里的 `sessionId` 就是**实例与编排会话 1:1 绑定**的落点——之后所有状态同步、指令注入都靠它寻址。此时尚未启动，实例停在 `CREATED`。

### 场景 2：点 Start 启动

- **你做什么**：点 Start。
- **你看到**：按钮短暂进入"Starting"过渡态（防重复点击）；DAG 开始流转。
- **背后（单权威设计的关键）**：面板**不直接改状态**。`POST /wf/start` 只做两件事：
  1. 校验阶段：`RUNNING` 拒绝（"已在运行"）、`STOPPED` 拒绝（"请用 resume"）、终态拒绝（"请先 reset"）；
  2. 向编排会话注入一条启动指令消息：

  ```js
  apiProxy.sessions.prompt({
    rpcId: 'wf-start-<时间戳>',
    payload: { sessionId, mode: 'queue', content: [{ type: 'text', text: '请启动工作流实例 …' }] }
  })
  ```

  编排 agent 收到消息后调用 `workflow_start` 工具 → 引擎置 `RUNNING` → 落盘。若实例绑定的是子会话形态，注入改用 `apiProxy.subagents.prompt({ rpcId, payload: { parentSessionId, childSessionId, mode: 'continuable', content } })` 寻址。
- **为什么这样设计**：面板运行在浏览器侧、agent 运行在会话侧，两边都改状态必然打架（历史上真打过）。所以**状态只允许引擎工具写入，面板只是"递纸条的人"**。

### 场景 3：任务派发与子会话执行

- **你做什么**：观察（或催促）。
- **你看到**：节点 灰(PENDING)→蓝(RUNNING)→绿(DONE)；并发受工作流定义里 `max-concurrency` 限制（同时最多几个节点变蓝）。
- **背后**：编排 agent 每一步调用 `workflow_status` 工具，引擎返回**就绪任务清单**。就绪判定 `getRunnableTasks()` 两条硬规则：
  - 任务的 `depends-on` **全部**处于 DONE/SKIPPED（编排定义里的依赖声明是调度唯一依据——曾有人把"汇总先于深度分析完成"报成 bug，实际是定义里漏写了依赖）；
  - 并发槽未满（`max-concurrency` − 当前 RUNNING 数）。
  agent 对每个就绪任务派发一个 **continuable 子会话**执行（可被中断、可被追问——这是后续一切"级联控制"的前提），子会话完成后 agent 用 `workflow_status` 把任务标 DONE。DONE 进度随时落盘。

### 场景 4：编排会话空闲了，工作流"自己暂停"又"自己续上"

- **你做什么**：什么都不做，或随便发一句"看下进度"。
- **你看到**：agent 回合结束、且没有后台任务在跑时，实例可能变为 STOPPED（同时面板出现 Resume 按钮）；你再发一句话后，实例**自动回到 RUNNING** 继续跑——不用说"继续"。
- **背后**：状态同步点 `syncInstanceState` 在三个时机被触发：①绑定会话每次调用 workflow 工具前；②面板每次 `GET /wf/list` 轮询；③会话中止事件到达（见场景 6）。同步逻辑一次读齐三类观察信号：
  1. `agents.get(sessionId).status` —— 会话不在了就不动作；
  2. **聚合守卫**：`apiProxy.subagents.list({ rpcId, payload: { parentSessionId } })` 若返回 `activity === 'running'` 的子会话 → **保持 RUNNING 不停**（后台任务在跑不等于空闲）；
  3. `agents.get(sessionId).inbox.hasPending` —— 用户输入已排队但还没被 agent 认领的瞬间 → **不动作**（防误停，这个间隙很短但真实存在）；
  4. 确认真空闲 → `engine.stop()` + 落盘 + `metadata.stopReason = 'session-idle'`；
  5. 反方向：agent 重新 `running` 且 `stopReason === 'session-idle'` → `engine.resume()` 自动续跑（`user-stop` 永不享受此待遇）。

### 场景 5：面板 Stop（权威急停）

- **你做什么**：点 Stop。
- **你看到**：在跑的子会话**秒级消失**；DAG 停止；状态 STOPPED；之后子会话再发回什么完成通知，工作流都不再动。
- **背后**：`POST /wf/stop` 注入停止指令——注意 `mode` 用 **`'steer'`**（打断 agent 当前回合让停止尽快生效），而 start/resume 用 `'queue'`（等 agent 空闲时投递）：

  ```js
  apiProxy.sessions.prompt({ rpcId, payload: { sessionId, mode: 'steer', content: [{ type: 'text', text: '请停止…' }] } })
  ```

  agent 调用 `workflow_stop` 后做三件事：`engine.stop()` + 落盘 + `metadata.stopReason = 'user-stop'`；随后**级联打断**——list 出所有 running 子会话，逐个 `apiProxy.subagents.interrupt({ rpcId, payload: { parentSessionId, childSessionId } })`。
- **一个容易忽视的细节**：停止时 RUNNING 中的任务会被**重置回 PENDING**（DONE 保留）。否则这些任务占着并发槽，Resume 后引擎认为"都在跑"而派不出新任务——这是早期踩过的真实死锁。

### 场景 6：会话输入框旁的停止按钮（行为分两种，务必分清）

这是全系统最容易被误解的按钮，DSH 对它的支持是不对称的：

- **情形一：agent 正在回合中干活时点击。** DSH 打断当前回合，并在会话日志里留下一笔**持久的中止记录**：`turn/end` 事件，`data.reason = { kind: 'aborted', reason: { kind: 'user' } }`。插件用全局事件监听实时捕获：

  ```js
  ctx.on('session/event', (session, event) => {
    // 关注 event.type === 'turn/end' 且 event.data.reason.kind === 'aborted'
    // 且 event.data.reason.reason.kind === 'user'（其余 parent/hook/disposed/legacy 原因一律忽略）
  })
  ```

  命中后立即执行与面板 Stop 完全相同的处置：STOPPED + `user-stop` + 级联打断子会话。**点击即全停。**另有日志尾扫兜底：每次状态同步检查会话日志（`agents.get(sessionId).session.log`，事件形态 `{type, seq, time, data:{…}}`，业务字段在 `data` 包装下）**末条回合终局**是否为用户中止——覆盖插件重启等漏听窗口；末条被更新的回合覆盖时以更新者为准。
- **情形二：agent 空闲等待时点击。** DSH 对空闲会话的取消是**无效果操作**：主机收不到任何信号，接口还返回"已接受"。这是 DSH 层的原理边界（探针实证，不是本项目的缺陷）。插件的弥补：`GET /wf/list` 返回 `stopHint` 字段（绑定实例 RUNNING + 主会话 idle + 有子会话在跑时激活），面板显示常驻提示条——"会话内的停止按钮此刻无效，要停止请点面板 Stop"。**触发条件是状态组合，不是点击事件**；状态解除后提示条自动消失。
- 两种情形的共同底线：停止后子会话的结算通知对 STOPPED 实例无效，工作流绝不会被"复活"。

### 场景 7：Resume 与 Reset

- **Resume**：STOPPED 状态点 Resume → 注入恢复指令 → agent 调 `workflow_resume` → `engine.resume()`：RUNNING 任务从 PENDING 继续、DONE 保留、`stopReason` 清空。双保险防止误 Start：`POST /wf/start` 对 STOPPED 直接拒绝，面板按钮也按阶段裁剪（STOPPED **不显示 Start，只显示 Resume**）。
- **Reset**：`POST /wf/reset` → 注入重置指令 → `workflow_reset` 从 `instance.yaml` 重新解析定义 → `engine.resetWithDefinition(parsed)` → 全新 PENDING，产物文件保留。注入的提示会明确告诉 agent"旧进度作废，勿回溯对比"。

### 场景 8：DSH 重启后、以及"会话死了"之后

- **重启自愈**：实例状态从不依赖内存——首次访问时按 `metadata.json` 的 `sessionId` 精确匹配，从 `state.json` 调 `engine.hydrate()` 恢复；没有 `state.json` 的 CREATED 实例从 `instance.yaml` 构造默认状态。所以重启后面板第一次轮询就能显示正确状态。
- **孤儿回收**：绑定的编排会话已不存在（`sessions.get(sessionId)` 返回空）但实例还标 RUNNING → 每次 `/wf/list` 轮询时自动执行：stop（保 DONE 进度）+ 解绑（`sessionId → null`）+ 进入**采用池**，面板标注"已停止·含进度，可采用后 resume 续跑"。新会话点「采用」即可绑定续跑。
- **环境异常**：`metadata.json` 缺失/损坏时面板显示"环境异常，需新建 workflow 会话"并隐藏操作按钮，不给出会误导的状态。

---

## 4. 关联方式总纲（机制层一页看懂）

1. **绑定是前提**：`metadata.json` 的 `instanceId ↔ sessionId`（1:1）。没有绑定就没有状态同步、没有指令注入。
2. **同步触发点只有三个**：绑定会话调用 workflow 工具前；面板 `/wf/list` 轮询；会话中止事件到达。全部收敛到同一个 `syncInstanceState` 入口，规则只写一处。
3. **状态翻译规则**（观察信号 → 引擎动作）：

| 观察信号（DSH 运行时） | 判定 | 引擎动作 |
|---|---|---|
| `agents.get(sid).status === 'running'` 且实例 STOPPED 且 `stopReason='session-idle'` | 用户唤醒了编排会话 | `resume()`（自动恢复） |
| `status === 'idle'` + `subagents.list` 有 running 子会话 | 后台任务在跑 | 保持 RUNNING（聚合守卫） |
| `status === 'idle'` + 无子会话 + `inbox.hasPending === false` | 自然间隙 | `stop()` + `session-idle` |
| `inbox.hasPending === true`（输入已排队未认领） | 投递间隙 | 不动作（防误停） |
| `turn/end` 且中止原因是 user（事件实时，或日志末条兜底） | 用户手工停了会话 | 权威停止：`stop()` + `user-stop` + 级联打断 |
| `sessions.get(sid)` 不存在 | 会话已死 | 孤儿回收：stop + 解绑进采用池 |

4. **闭环不变式**：有子会话在跑 ⇔ 实例 RUNNING。由此保证引擎永远不会对同一任务重复派发——子会话被停时任务回 PENDING，重派有据可依。

---

## 5. 难点与解决方案

| 难点 | 解决方案 |
|---|---|
| 面板与 agent 都能改状态，双写打架（历史真实缺陷） | **单权威**：状态只由引擎工具写入并落盘，面板只注入指令消息 |
| agent "提问等待"期间被误判空闲而误停 | 探针实证提问等待时 status 仍为 running；另加 `inbox.hasPending` 守卫覆盖"已排队未认领"的投递间隙 |
| 后台子会话在跑、主会话恰好空闲 → 误停 | 聚合守卫：派发子会话清单里有 running 就不停 |
| STOPPED 后 agent 仍能看到"可派发"任务而继续驱动 | `getRunnableTasks()` 在非 active（STOPPED/COMPLETED/FAILED）时直接返回空 |
| Stop→Resume 死锁：RUNNING 任务占满并发槽，Resume 后派不出新任务 | Stop 时把 RUNNING 任务重置回 PENDING（DONE 保留） |
| 手工停会话在空闲时**完全无信号**（DSH 原理边界，接口还假报成功） | 事件驱动捕获活动回合的中止记录（主路径）+ 会话日志末条尾扫（兜底）+ 状态触发的面板提示条引导正确操作；空闲点击无效这一点如实告知用户 |
| 停止后子会话结算通知把 agent "复活"继续编排 | 对 STOPPED 实例忽略结算通知；`user-stop` 永不自动恢复 |
| DSH 重启丢内存态 | 权威状态全部落盘，首次访问惰性恢复（hydrate） |
| 绑定会话已死但实例卡在 RUNNING | 列表轮询顺带孤儿回收：stop + 解绑进采用池，进度不丢 |
| 前端轮询导致重渲染闪烁、切换会话后状态残留 | 面板数据层模块级缓存（防重挂载闪烁）+ 切会话显式重置派生态并重拉列表 |

---

## 6. 设计决策及其理由

| 决策 | 理由 |
|---|---|
| 权威状态只存在于实例目录（磁盘），引擎是唯一写入者 | 重启自愈、可审计、从根上消灭双写冲突 |
| 用 `stopReason` 区分"为什么停"，并以此决定恢复策略 | 自然空闲可自动恢复（体验顺滑）；用户停止必须显式恢复（尊重意图） |
| 面板定位为"指令注入者"而非状态修改者 | 面板不在 agent 回合内，直接改状态会造成两边视角分裂 |
| 会话内停止按钮与面板 Stop 同级权威 | 用户心智是"停了就是停了"，不应因按钮位置不同而不同 |
| 任务子会话一律用 continuable 模式 | 可中断、可追问是级联急停的前提（one-shot 无法停止） |
| 空闲无效提示用"状态触发"而非"点击触发" | 空闲点击在 DSH 层无信号可捕，只有状态组合是可观察的 |
| 孤儿回收进采用池而非直接删除 | 保住 DONE 进度，支持跨会话续跑 |

---

## 7. DSH API 速查

### 7.1 Host 侧（ctx 注入的服务）

| API | 调用形状 | 用途 |
|---|---|---|
| `agents.get` | `agents.get(sessionId)` → `{ status: 'running'\|'idle', inbox: { hasPending }, session: { log: [...] } }` | 会话运行判定、排队输入守卫、会话日志尾扫 |
| `sessions.get` | `sessions.get(sessionId)` → 存在即存活 | 孤儿识别 |
| `apiProxy.sessions.prompt` | `{ rpcId, payload: { sessionId, mode: 'queue'\|'steer', content: [{ type: 'text', text }] } }` | 向编排会话注入指令（queue=空闲投递；steer=打断当前回合，用于停止） |
| `apiProxy.subagents.prompt` | `{ rpcId, payload: { parentSessionId, childSessionId, mode: 'continuable', content: [...] } }` | 向子会话形态的目标注入（仅限父-子关系） |
| `apiProxy.subagents.list` | `{ rpcId, payload: { parentSessionId } }` → `entries: [{ kind: 'child', id, activity: 'running'\|... }]` | 聚合守卫、级联目标发现 |
| `apiProxy.subagents.interrupt` | `{ rpcId, payload: { parentSessionId, childSessionId } }` | 级联打断子会话当前回合 |
| `ctx.on('session/event')` | 回调 `(session, event)`；关注 `event.type === 'turn/end'` 且 `event.data.reason = { kind: 'aborted', reason: { kind: 'user' } }` | 会话中止事件驱动（用户手工停的唯一实时信号） |
| `webServer.register` | `prefix: '/wf'` 路由（loopback 之外一律 403） | 面板 HTTP 数据源 |
| `fs` | `writeText / readText / listDir / resolve`（路径须经 `fs.resolve`） | 实例目录持久化 |

**两个信封约定**：①代理调用必须带 `rpcId + payload`，缺 `payload` 直接被拒；②会话日志事件形态是 `{type, seq, time, data:{…}}`，业务字段在 `data` 包装下（与上游源码的顶层签名不同，读日志时勿按顶层取）。

### 7.2 引擎内部 API（`createWorkflowEngine()` 产物）

`begin / hydrate / start / stop / resume / reset / resetWithDefinition / updateTask / getRunnableTasks / setStage / setGateResult / snapshot / setPersist`；配套 `createWorkflowStorage(ctx, engine)` 的 `save() / setInstanceDir()`（落盘到实例目录 `state.json`）。

### 7.3 磁盘契约（实例目录）

```
<会话工作区>/.workflow-agent/instances/<instanceId>/
├── instance.yaml   # 定义快照（Reset/恢复时的定义来源）
├── metadata.json   # { instanceId, sessionId, sessionCwd, ... } —— 绑定主映射
├── state.json      # 引擎快照 —— 权威状态
├── output/         # 任务产物
└── logs/
```

### 7.4 面板 HTTP 路由（/wf/*，仅 loopback）

`GET /wf/list`（实例列表 + 会话派生状态 + 空闲停止提示）、`GET /wf/status`（单实例引擎快照）、`GET /wf/templates`（内建+工作区模板）；`POST /wf/create | /wf/adopt | /wf/start | /wf/stop | /wf/resume | /wf/reset`。所有 POST 都只做"校验 + 注入指令"，不改引擎状态。

---

## 8. 相关文档

- `plan/design/workflow-lifecycle-design.md` — 实例生命周期与归档设计
- `plan/design/dsh-session-subagent-control-research.md` — 子会话控制能力探索（结论：continuable 可中断/可追问是级联控制的前提）
- `plan/development/iter23-probe-report.md` — 会话停止信号实证（活动回合可检测/空闲零痕迹）
- `plan/development/iter22-report.md`、`plan/development/iter23-report.md` — 状态同步语义与权威停止的实现过程
