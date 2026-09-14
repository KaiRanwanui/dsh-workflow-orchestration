# Iter-23 前置探针报告 — 方向 A"手工停 DSH 会话"的 Host 侧可读停止信号

**日期**：2026-09-02
**状态**：✅ 探针完成（源码侦察 + 部署版运行时探针双重确认）
**探针**：动态插件 stopa-6/pkg-6（用后已 undefine；代码存档 `code/probes/stopa-user-stop-signal-probe.js`）
**方法**：①DSH 源码侦察（deepseek-harness-master：`packages/core/agent/src/runtime-types.ts`、`packages/core/session/src/types.ts`、`packages/host/apiproxy/src/api-proxy.ts`、`packages/api/remotes/src/agent-lookup.ts`、`packages/client/runtime/src/client/sessions/session.ts`）②运行时探针构造真实生命周期：创建会话 → 长任务运行中 cancel（Case R）→ 空闲再 cancel（Case I）→ 停后 prompt → live/持久层双路读日志交叉验证

---

## 一、停止链路（源码确认）

Web UI 停止按钮 → client `session.cancel()`（`session.ts:306`）→ `apiProxy.sessions.cancel` → **`agent.cancel({kind:'user'}, {keepInbox:true})`**（`api-proxy.ts:2518-2531`，要求 agent 已挂载，否则 `session-not-found`）。

## 二、四个探针问题的结论

### Q1（Case R：停在"回合进行中"）✅ 有持久可读信号

| 观测点 | 实测值 |
|---|---|
| 持久日志 | `turn/end` 事件 `data = {turn, reason:{kind:'aborted', reason:{kind:'user'}}}` |
| 中断的回合 | `assistant/message` 带 `interrupted:true`（已流出前缀固化），step/end 正常闭合 |
| agent | running→idle，**仍在注册表**（非移除）；`hasPending:false` |
| RPC | 返回 `accepted:true`（真实生效） |

### Q2（Case I：停在"agent 空闲"）❌ 零痕迹——"复活"现象机制确认

- cancel 对 idle agent 是**纯 no-op**（源码："With no active activity, cancellation is a no-op and does not arm later work"）。
- **RPC 仍返回 `accepted:true`（假性成功）**；无事件、无状态变化、日志长度不变（实测 540→540）。
- 即"手工停会话 → 子会话跑完 → 结算通知唤醒 agent 继续编排"的场景中，用户的点击在 Host 侧**原理性不可检测**（无任何信号；结算通知与正常完成通知不可区分）。

### Q3（停后 prompt）接受且立即唤醒

cancel 后 `sessions.prompt` 正常接受（`accepted:true`）并立即开启新回合（turn/start→user/message srcKind='user'→assistant 响应）。**Iter-21 线索"已停 session 拒绝 prompt 注入"证伪**（可能指 disposed 会话或 UI 输入禁用态）。

### Q4（插件读他者日志）双路可用

| 路径 | API | 实测 |
|---|---|---|
| live | `agents.get(sid).session.log`（不可变快照数组） | ✅（本会话 2.8 万事件可读） |
| 冷 | `sessionPersistence.readFrom(sid, 0, signal)` → `{meta, events}` | ✅（与 live 一致；**seq 不跨源一致**——chunk 类事件不持久化，live 539 ≠ cold 17，但 turn/reason 稳定） |

**关键实现差异**：部署版日志事件形态为 `{type, seq, time, data:{…}}`——**payload 在 `data` 包装下**；master 源码的类型签名（`'turn/end': {turn, reason}`）是解包后视角。**源码侦察必须对照运行时实测**（本次曾按顶层字段读取全部扑空，诊断后修正）。

**附加实证**：
- `user/message` 的 `data.source.kind` 可区分真实输入与合成注入：`user`（带 rpcId）/ `plugin`（如 dsh-mnemon 提醒）/ `skill-catalog` / `agent-instructions`。
- `session/event` 全局实时事件（所有会话、含 turn/end）Host 插件 `ctx.on` 可达——事件驱动 sync 的现成挂点。
- 测试会话经 `ctx.agents.create({sessionId, meta:{cwd}})` 创建（返回 `AgentHandle.dispose()` 可完整清理）；**裸 `sessions.prepare+enter+announce` 会话不能被 prompt 的 resume 路径接管**（报 "already exists"）。

## 三、对方向 A 的设计结论

1. **可根治的半边**：用户停在任何**活动回合**（编排 agent 正在驱动/处理）→ `aborted(user)` 持久信号明确 → 判 user-stop（wf STOPPED + 级联 interrupt 子会话）可行。
2. **不可根治的半边（边界，需用户知情拍板）**：停在**空闲等待期**（后台等子会话，正是"复活"实测场景）→ Host 侧无信号、无痕、RPC 假成功 → 不改 DSH 就无法检测。缓解：面板 UX 引导（实例 RUNNING 且主会话 idle 且有子在跑时显示"后台执行中，停止请用面板 Stop"），把权威停止显式收敛到面板 Stop。
3. **判定窗口**：aborted 记录之后若开新回合（如结算通知唤醒），"最后一条 turn/end"不再指向 abort → 轮询兜底有竞态。**推荐事件驱动为主**：`ctx.on('session/event')` 捕获绑定会话的 `turn/end(reason=aborted(user))` 即时触发 user-stop 处置；轮询读尾部作为兜底（漏过窗口时退化为现状，无害）。
4. **探针答案对验证标准的影响**：手测须分别构造"活动回合停"（可检测路径）与"空闲停"（确认边界提示出现）；后者不再承诺级联停止。

---

## 附：实验残留

- 空壳会话 `stopa-t-hymmr1`（bare 回退路径，仅 3 条 epoch 事件、无对话内容）留在持久层会话列表，无实害。
- 测试会话 `stopa-t-hyr7xi` 已 `AgentHandle.dispose()` 清理。
