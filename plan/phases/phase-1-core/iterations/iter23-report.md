# Iter-23 报告 — 方向 A：手工停 DSH 会话=权威停止（A1 事件驱动 + A2 轮询兜底 + A3 面板提示条）

- **状态**：✅ 完成关闭（2026-09-02）
- **版本**：host v0.12.0 / client v0.6.0
- **提交**：39ee656（设计定稿+实现）→ e077344（手测关闭）→ 7fd8648（default-demo 依赖后续修复）
- **配套**：`iter23-probe-report.md`（探针）、`iter23-verification-report.md`（手测验证）

## 背景

用户实测 Iter-22 后遗留观察项：手工停 DSH 会话后编排 agent 被"复活"继续推进工作流。方向 A 的目标=把「会话内停止按钮」升级为与面板 Stop 同级的**权威停止**。Iter-22 结论已知 AgentStatus 只有 idle/running、cancel 无独立状态可读，故先做前置探针再定方案。

## 探针结论（stopa-6 动态插件，用后 undefine）

- **Case R（停在活动回合）**✅：持久留 `turn/end {data:{reason:{kind:'aborted',reason:{kind:'user'}}}}`；live `session.log` 与冷 `sessionPersistence.readFrom` 双路可读（seq 不跨源一致、turn/reason 稳定）；部署版事件 payload 在 `data` 包装下（与 master 源码顶层签名不同）。
- **Case I（停在空闲）**❌：零痕迹（cancel 纯 no-op、RPC 假性 accepted:true）——Host 侧原理性不可检测；停后 prompt 接受且立即唤醒。
- `ctx.on('session/event')` 全局实时事件=事件驱动 sync 现成挂点。

## 设计定稿（2026-09-02 用户确认，效果级）

队列重排：**Iter-23=方向 A → Iter-24=生命周期闭环+归档（原 23 归档范围）→ Iter-25=编辑器（原 24）**。方案三件套：

- **A1 场景一权威停止（主路径）**：mjs `ctx.on('session/event')` tap 判定绑定会话回合 aborted(user) → `registry.handleSessionUserStop` 即时处置（STOPPED + stopReason='user-stop' + 级联 interrupt 子会话 + 通知免疫）。
- **A2 轮询兜底**：`syncInstanceState` idle 将停分支先查 `detectUserAbort`（live log 尾扫 `detectUserAbortFromLog`），命中走 `applyUserStop`；权威性高于 P1 守卫；探针故障降级既有 session-idle 语义。
- **A3 场景二常驻提示条（纯插件 UI）**：`/wf/list` 新增 `stopHint`（绑定 RUNNING+主 idle+子会话在跑）→ 面板提示条引导用面板 Stop；**状态触发非点击触发**（Case I 点击本身无信号）。

## 交付

- `plugins/workflow-host/instance-store.js`：`isUserAbortTurnEnd`/`detectUserAbortFromLog` 纯函数 + `applyUserStop`/`handleSessionUserStop` + sync A2 分支（sync-modules 同步进 mjs）。
- `workflow-host.mjs`：A1 事件 tap（`ctx.effect` 挂靠可卸载）+ `detectUserAbort` 注入 + `/wf/list stopHint`（直接编辑）。
- `client.js`：`wfStopHint` 数据层 + 面板常驻提示条（会话切换重置）。
- `tools-preset.js`：workflow_stop 注释对齐（面板 Stop 与 UI 停止按钮同级权威）；system-prompt 无需改（P2/P4 已覆盖）。

## 过程问题与修复

1. **用例 17 首跑失败**：漏调 `registerWorkflowToolsPreset`（工具未注册进 mock bag）→ 补上后 220 全绿。
2. **V1-⑤ 验收预期层级写错**：手测发现 STOPPED 面板无 Start 键（仅 Resume）——这是 Iter-21 R5 按钮状态机设计行为，面板以"不提供 Start"保证"Stop 后唯一路径=显式 Resume"；报告措辞由"Start 被拒"修正为状态机语义。**教训：写验收预期须对照 UI 状态机实际按钮集。**
3. **default-demo「集成先于深度分析完成」（用户报 bug）**：根因=**编排定义缺依赖**，非状态 bug——`integrate` 的 `depends-on` 只含 `[write-spec, prep-data]`，`deep-analysis` 是旁路长任务；引擎 `getRunnableTasks` 严格按 depends-on 阻塞（engine.js:176-177）。修复：integrate 加 `depends-on: [write-spec, prep-data, deep-analysis]` + `inputs.analysis`；模板断言加防回退项（221 单测）；用户重启实测确认集成等满三前驱才执行。

## 手测结论（iter23-verification-report.md）

V1/V2/V3 全过，无缺陷：场景一点击即停（面板 3 秒内 STOPPED(user-stop)+子会话秒级消失+通知免疫）；场景二提示条出现+面板 Stop 秒停；三条既有停止路径（面板 Stop/自然语言/自然收敛）行为不回归。

## 验证

- 单测 221 全绿（用例 17 新增 27 条：A1 判定矩阵 parent/hook/disposed/legacy/completed 排除、log 尾扫、A1 处置+幂等+未绑定跳过、A2 兜底+权威性高于 P1+降级、P1/P2 回归；模板断言 +1）。
- `verify-client-bundle.js` 求值级通过；`node --check` lib/index.js 与预设副本均通过。

## 遗留与下一步

- Case I（空闲停）原理性不可检测为边界，A3 提示条覆盖；空探针会话 `stopa-t-hymmr1` 残留会话列表（无内容，待清理）。
- **下一步：Iter-24 生命周期闭环+归档**（开工前按团队约定先设计确认）→ Iter-25 编辑器。
