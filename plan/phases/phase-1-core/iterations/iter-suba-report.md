# Iter-SUBA 探索报告 — DSH 主/子会话关系与主从执行状态控制方案

**日期**：2026-09-01
**状态**：✅ **技术验证完成**（源码侦察 + 运行时探针双重确认；方案设计定稿，待确认后进入实现）
**探针**：动态插件 suba-4/pkg-4（用后已 undefine；代码存档 `code/probes/suba-master-slave-probe.js`，含部署方式与全部实测结论）
**方法**：①DSH 源码侦察（`deepseek-harness-master`，packages/subagent + host/apiproxy，与部署版 rc.2 的 `.d.ts` 逐一对照）②本会话真实派发后台 subagent 做生命周期实验（start/interrupt/唤醒/正常完成四场景）

---

## 一、主/子会话关系模型（源码结论）

| 维度 | 事实 |
|---|---|
| 父子关联 | session header 持久字段：`parentSession`（直接父）、`origin:'subagent'`、`delegationDepth`、`seedLength` |
| 枚举 | `ctx.subagents.listChildren(parentSessionId)` / `listDescendants(rootSessionId)`：live 会话存储 + 持久化合并枚举，含历史冷会话；entry = `{kind:'child', id, mode:'one-shot'\|'continuable', label, activity, hasChildren}` |
| 活跃判定 | 官方实现就是 `ctx.agents.get(childId)?.status === 'running'`（apiProxy.subagents.list 内部对每条 entry 重算 activity） |
| 生命周期 | continuable 子会话**回合结束即从 agents registry 移除**（ActivationState: running→waiting→settled，settled 即 dispose AgentHandle）；两回合之间 `agents.get→null`，不代表死亡，只代表"无活跃回合" |
| 事件 | `subagent/start`（runId/id/provider/local）与 `subagent/end`（+stopReason: completed/aborted/error/max-tokens）——Host 插件 `ctx.on` 全局可达；同一 childId 每个回合一对新 runId 的 start/end |
| 服务面 | `ctx.subagents`：startContinuable / followup / interrupt / reportFrom / listChildren / listDescendants / start(one-shot) |
| apiProxy 面 | `apiProxy.subagents.{list, history, prompt, interrupt}`、`apiProxy.sessions.{prompt, cancel}`——**部署版 rc.2 全部具备** |

## 二、运行时实证（探针实测，2026-09-01）

| # | 实验 | 结果 |
|---|---|---|
| 1 | start/end 事件 | 即时可达；start 与 agent/status:running 相邻毫秒级 |
| 2 | subagents.list | 返回本会话全部历史子会话（含 continuable 历史 + one-shot）；当前运行中对象 `activity:'running'`；调用形状 `{rpcId, payload:{parentSessionId}}` → 返回 `{rpcId, result:{ok, value:{entries, parentAvailable}}}`（需解包 result.value） |
| 3 | **interrupt 级联停止** | accept → **~23ms** agent/status→idle → **~21ms** 后 subagent/end `stopReason:'aborted'`；子 agent 随即从 registry 移除；**父会话收到结算通知 "was stopped before it finished"，closing message 为空** |
| 4 | followup 唤醒 | 对 interrupt 后的冷子会话 `subagents.prompt` → 冷恢复 → 新 runId 的 start/end（`completed`）→ 回复送达父会话（"已唤醒"）；**注意：直调必须显式传 AbortSignal（内部读 signal.aborted），工具内用 `exec.signal`** |
| 5 | 正常完成对照 | `stopReason:'completed'`；父会话通知文案 "finished and will do no further work..." + closing message 有内容——**编排 agent 可凭通知文案区分级联停止与正常完成** |
| 6 | 任务可控性 | workflow-orchestrator preset 已配 `backgroundMode: continuable`（agent.cordis.yml tool-subagent config）→ 任务 subAgent 全部可 interrupt/prompt |

## 三、主从执行状态控制方案（设计定稿）

> 设计原则：全部在 **workflow-host 插件内闭环**——不依赖 DSH 改动、不依赖编排 agent 自觉（Host 侧权威），编排 agent 只需已有的 S1 止血语义配合。

### P1 聚合守卫（根治 B1 误停）
`syncInstanceState` 的 idle→stop 分支增加子会话聚合判定：

```
stage==='RUNNING' && 主会话 idle && !hasPending && !hasRunningChildren(sid)  →  才允许自动 STOPPED
hasRunningChildren = apiProxy.subagents.list({parentSessionId:sid}).entries
    .some(e => e.kind==='child' && e.activity==='running')
```

- 触发频率：仅在"将要停"的分支调用（低频）；可加 1–2s 结果缓存对冲面板 2s 轮询。
- 语义落点：主 idle + 子 running → wf 保持 RUNNING（后台 subagent 等待不再误停）；主 idle + 子全部结束 → STOPPED。

### P2 stopReason 定向恢复（消除"任务推进 vs wf=STOPPED"失配）
- 实例 state 增 `stopReason`：`workflow_stop` 工具/`/wf/stop` 路由/自然语言"请停止" → `'user-stop'`；`syncInstanceState` 自动停 → `'session-idle'`；reset 后清空。
- `syncInstanceState` 检测主会话 running 时（S1 移除的自动恢复位置）：`stage==='STOPPED' && stopReason==='session-idle'` → `engine.resume()`（保 DONE）；`'user-stop'` 不动。
- 效果：自然空闲停 = "编排间隙"，主会话回来自动续跑；用户手工停 = 权威停止，任何唤醒不自动恢复（S1 语义保留）。

### P3 Stop 级联停止（根治双 subAgent 文件冲突）
- `workflow_stop` 工具内：`engine.stop()` 后枚举 running 子会话，逐个 `apiProxy.subagents.interrupt({parentSessionId:sid, childSessionId})`（fire-and-return，无需等待；one-shot/不存在=no-op 安全）。
- 手工停 DSH 会话路径（agent 已死、无人调工具）：`syncInstanceState` 的 idle→stop 分支同样执行级联 interrupt——三条停止路径（面板/自然语言/手工停会话）全部收敛到 Host 侧权威级联。
- 实测延迟毫秒级，双 subAgent 场景从源头消灭。

### P4 迟到回报治理（配合 P3 的唤醒面）
- interrupt 后父编排会话会收到 "was stopped before it finished"（closing 空）结算通知并被唤醒——两级防线：
  1. **Host 侧**：P2 保证此时 stopReason='user-stop'，引擎不自动 resume；`getRunnableTasks` 非 active 不派发（Iter-21 已有）——旧 subAgent 的迟到与通知都不能让工作流"复活"。
  2. **编排 agent 侧（system-prompt 增补）**：结算通知文案含 "was stopped before it finished"（closing 为空）→ 判为级联停止通知，**忽略之**，不做任务推进/不采信其内容；正常完成通知才按 dispatch 结果处理。
- 可选强化（暂缓）：派发 prompt 内嵌 `[task:<id> #<N>]` dispatch 序号 + 产物子目录隔离（`output/<task>/<dispatchN>/`）——P3 根治后预计无必要，留作 P3 失效时的后备。

### P5 响应式同步（体验优化，可选）
- Host 插件 `ctx.on('subagent/end')` → 反查 childId 所属 RUNNING 实例 → 立即触发一次 `syncInstanceState`。
- 收益："子全部结束→父 idle→wf STOPPED" 与 "子仍在跑→wf 不误停" 的收敛从轮询周期（~2s）降到事件即时。

## 四、边界与风险

| 边界 | 说明 | 缓解 |
|---|---|---|
| interrupt 仅 continuable | one-shot 不可 interrupt（no-op 安全） | 本 preset 任务 subAgent 已全量 continuable；其他 preset 的 one-shot 子会话不在 wf 治理范围 |
| 协作式取消 | fire-and-return：目标观察到信号才停（实测毫秒级；工具执行中则到工具边界） | 级联循环 fire 后即返回；极端长工具调用窗口由 P4 兜底 |
| 孙辈会话 | interrupt 只打断目标回合，不级联孙辈 | 编排任务 subAgent 一般无孙辈；list 的 `hasChildren` 可检测，出现时告警 |
| apiProxy 直调 signal | `subagents.prompt/history` 必须显式传 AbortSignal（内部读 signal.aborted） | 工具内用 `exec.signal`；`list` 亦建议传 |
| 面板感知 | 级联停止后子会话 UI 消失（agent 移除） | 符合预期（Iter-22 B4 已确认该表现） |

## 五、落地建议

- **阶段 2（功能实现，建议下一迭代）**：P1+P2+P3+P4 四件套一次交付——改动面：instance-store（stopReason 字段+sync 分支）、tools-preset（workflow_stop 级联）、workflow-host.mjs 同步、system-prompt（级联停止通知语义）、单测（守卫/stopReason/级联 mock）。验证标准：后台 subagent 等待不误停；Stop 后 running 子会话秒级消失；Stop→Start 双 subAgent 场景无冲突；手工停后任何唤醒不自动 resume；自然空闲停后主会话活跃自动续跑。
- **阶段 3（可选优化）**：P5 事件驱动同步；P4 的 epoch 隔离后备（仅在 2a 手测发现冲突残留时启用）。
