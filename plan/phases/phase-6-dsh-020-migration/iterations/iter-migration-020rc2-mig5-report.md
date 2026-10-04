# Iter-MIG5 · 页签门控完善报告（阶段 6 收尾轮）

> **状态**：✅ 完成并验收（用户真机验收 2026-10-03：页签即时显示/隐藏，无延迟）
> **交付**：host **v0.29.0**（事件驱动终版）→ **v0.29.1**（启动重试日志清理）

## 1. 实包考据结论（dsh-client-ui-conversation / dsh-client-ui-slots / dsh-client-ui-session / dsh-api-session-controller）

1. **页签机制本就是事件驱动**：宿主页签条由 `slots.entries("conversation.view")` 投影生成，`slots.subscribe("conversation.view", refreshViews)` 对 entry 注册/注销**即时刷新**——注册/注销 entry 正是 0.2.0 隐藏/显示页签的正统机制。label 解析为 `resolveSlotLabel(label) ?? id`——空 label 只回退显示 id，**不是隐藏手段**（宿主对 trajectory 的隐藏是硬编码特例，无通用条件可见性 API）。
2. **「当前会话」的正确解析源**：list 快照 byId 条目的 **`retainedBy.mainView` 保留计数**——宿主 `ui-session` Controller 的 `publishMain()` 同源逻辑（主视图保留 >0 的会话即当前会话；无则取任一 mainView 保留会话）。
3. **B6 时代误判修正**：「订阅不推送」不成立——`svc.list.subscribe` 回调一直在触发，旧 applyGate 在 `snap.current`（0.2.0 已删除的字段）静默早退导致"零触发"假象。

## 2. 终版实现（0.1.5 精确语义在 0.2.0 的正确重建）

- **applyGate**：`ids.find(id => byId[id].retainedBy.mainView > 0)` 解析主视图会话 → 按其 `projectionValues.agentPreset` + `origin` 精确判定 → 注册/注销（替代 B6 的「存在编排会话即注册」粗判）；
- **组件 effect 恢复即时注销**（definitiveNonWf → disposeEntry）——死锁由主视图解析机制解除；
- **订阅成功立即首评**（启动时序覆盖，页签初始态即刻就位）；
- **哨兵降级兜底**：1.5s 高频轮询 → **5s 兜底**（仅防订阅未覆盖的边角），满足用户「事件驱动为硬要求、轮询不得为终态」。

## 3. 验证

| 项 | 结果 |
|---|---|
| 切非编排会话 → 页签消失 | ✅ 即时（组件 effect） |
| 切回编排会话 → 页签恢复 | ✅ 即时（list.subscribe 事件驱动，无感知延迟） |
| 空页签（O-2） | ✅ 消除（可从 backlog 摘除） |
| 603 单测 / verify-bundle / render-smoke / 发行断言 | ✅ 全过 |
| Console 噪音 | ✅ 清零（v0.29.1 移除启动重试日志；仅保留 subscribe 抛错异常日志） |

## 4. 遗留

无（哨兵兜底保留为可观测防线，5s 空转开销可忽略）。
