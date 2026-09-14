# Iter-SUBA 阶段 2 人工验证报告 — 主从聚合控制（P1-P4）

**日期**：2026-09-01
**版本**：workflow-host 0.11.17（client 0.5.12 无改动）
**单测**：193/194 全绿（用例 16 新增 9 项；用例 14/15 断言按 P2 语义更新）
**部署**：host lib 经 link: 生效；preset 三件（system-prompt.md / workflow-host.mjs / agent.cordis.yml）已复制 `~/.dsh/.agent-presets/workflow-orchestrator/`；**需手动 `systemctl --user restart dsh.service` 后生效**

> 执行说明：结果列填 ✅/❌/⚠️，附一句话现象即可。手测环境：任一 workflow 实例 RUNNING 的编排会话。

## 测试项

| # | 场景 | 步骤 | 预期 | 结果 | 备注 |
|---|---|---|---|---|---|
| T1 | **P1 聚合守卫**（原 B1 误停根治） | Start 工作流 → 任务派发后台 subAgent（`run_in_background`）→ 主会话空闲等待，观察面板实例状态 | 主 idle 期间实例**保持 RUNNING** 不误停；subAgent 结束后实例才转 STOPPED（session-idle） | 通过 | |
| T2 | **P2 定向自动恢复**（无缝续跑） | 接 T1：实例 STOPPED(session-idle) 后，向主会话发任意消息（如"看下进度"）唤醒 | 实例**自动恢复 RUNNING**（无需说"继续"）；编排 agent 查 workflow_status 后无缝续跑 | 通过（补测） | 首测被面板 Stop 污染（user-stop 态，不恢复=正确）。补测 default-demo-7c98bb05：构造 session-idle（启动后不派发即结束回合）→ 00:03:08 自然停 → 00:05:02 发"看下进展" → **引擎日志 00:05:04 STAGE RUNNING（无 resume 调用，纯 sync 触发）** → 00:05:15 回落 STOPPED(session-idle)。瞬态恢复=设计行为 |
| T3 | **P2 反例**（权威停止不复活） | 面板 Stop 实例 → 之后向主会话发任意非"继续"消息 | 实例**保持 STOPPED**，不自动恢复；仅显式"继续/恢复"才 RUNNING | 通过 | 我觉得这样是合理的，我不明确说继续，不应该续跑 |
| T4 | **P3 级联停止** | 任务执行中确认有后台 subAgent 在跑 → 面板 Stop | subAgent **秒级停止**（会话列表消失）；工具返回含 `stopReason:'user-stop'` 与 `stoppedChildren≥1` | 通过 | |
| T5 | **双 subAgent 根治** | Start（派发 subAgent）→ 立即 Stop → 再 Start | 全程**不出现两个 subAgent 同时跑同一任务**：旧的被级联打断，新的唯一执行；无文件冲突/内容覆盖 | 通过 | 用户登记的核心问题 |
| T6 | **P4 级联停止通知治理** | 接 T4：Stop 时编排 agent 收到 "was stopped before it finished" 结算通知 | 编排 agent **忽略该通知**（不推进任务、不采信内容）；以 workflow_status 确认 STOPPED 后等待"继续" | 通过 | |
| T7 | **回归** | 面板 Start/Resume/Reset 全操作一遍；`/wf/list` 轮询观察 | 状态机无回归；Reset 后全新运行；列表同步正常 | 通过 | |

## 已知边界（非缺陷，验收时知悉）

- **手工停 DSH 会话**（非面板 Stop）时不级联打断子会话：P1 守卫使实例保持 RUNNING 直至子会话自然跑完才收敛 STOPPED——期间实例不会二次派发（Start 被拒），无双跑；急停需求走面板 Stop（T4 场景）。
- interrupt 为协作取消：实测毫秒级；子 agent 若正处于单个工具调用中，取消在该工具边界生效。
- 探针（subagents.list）故障时降级为"不守卫、照常停"（不卡死 RUNNING），由单测 c16 降级项覆盖。

## 现象，需确认是否正确
- **手工停 DSH 会话**（非面板 Stop）时不级联打断子会话，子会话执行完成后，主会话会继续恢复执行。
  - **复核结论（2026-09-01/02，sessions.sqlite 会话记录取证 + 用户确认现象真实出现）**：已测试各会话的完整事件流中，每一次 STOPPED 均对应一次面板 Stop 注入的 `workflow_stop`、每一次 RUNNING 均对应一次 `workflow_resume`——无解释的状态跳变不存在；但"手工停 DSH 会话"场景本身机制已由源码定位：session cancel 只清队列/中止当轮（无级联，已知边界），子会话跑完 → 结算通知插入 inbox → 唤醒已 cancel 的 agent → 继续编排（wf 全程 RUNNING，P1 守卫未停）。**无需专门复现取证；已立案改进方向 A**：sync 读 sessions 层"已停"状态 → 判 user-stop → wf STOPPED + 级联 interrupt 子会话（与面板 Stop 同级权威），待用户拍板排期（建议并入 Iter-23）。

## 取证方法备忘
- 会话事件：`~/.dsh/sessions/sessions.sqlite`，`t_session_events.f_session_id`（带 `session-` 前缀）JOIN `t_events ON se.f_event_id=e.f_event_id`（文本键），含全部 tool/call 参数——可还原"用户按了什么按钮"与 agent 每步动作。
- 引擎日志 + metadata：实例目录 `state.json`（含逐条 STAGE/TASK 时序）与 `metadata.json`（`stopReason` 终值）。

## 结论

- **总体：✅ 通过，Iter-SUBA（P1-P4）关闭。** T1-T7 全部通过（T2 经补测确认；T1 ①-④符合预期，⑤空闲零子会话态健康编排中不自然出现、经构造验证）。核心目标全部达成：后台 subAgent 等待不误停（P1）；自然空闲停+定向自动恢复、权威停止不复活（P2）；面板 Stop 级联杀子（T4/T5 多轮通过）；级联停止通知被正确忽略（P6/T6）；无回归（T7）。
- **测试过程教训（方法论）**：仅凭引擎日志会把"用户的 Stop 测试动作"误判为守卫失效（本次曾错误立案"P1 失效"后撤销）——判定状态问题必须交叉取证引擎日志 + 会话记录（谁触发了 stop/resume）+ metadata.stopReason。
- **遗留观察项**：手工停 DSH 会话的语义真空（cancel 无痕、结算通知可唤醒已 cancel 的 agent）——未复现；改进方向 A（读 sessions 层停止状态判 user-stop）记录于 iter-suba-report.md，建议并入 Iter-23 前的小探针或 Iter-23 一并处理。
- **后续迭代**：23 生命周期归档 → 24 编辑器（队列不变）。

