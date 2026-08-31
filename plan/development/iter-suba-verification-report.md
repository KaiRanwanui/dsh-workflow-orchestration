# Iter-SUBA 阶段 2 人工验证报告 — 主从聚合控制（P1-P4）

**日期**：2026-09-01
**版本**：workflow-host 0.11.17（client 0.5.12 无改动）
**单测**：193/194 全绿（用例 16 新增 9 项；用例 14/15 断言按 P2 语义更新）
**部署**：host lib 经 link: 生效；preset 三件（system-prompt.md / workflow-host.mjs / agent.cordis.yml）已复制 `~/.dsh/.agent-presets/workflow-orchestrator/`；**需手动 `systemctl --user restart dsh.service` 后生效**

> 执行说明：结果列填 ✅/❌/⚠️，附一句话现象即可。手测环境：任一 workflow 实例 RUNNING 的编排会话。

## 测试项

| # | 场景 | 步骤 | 预期 | 结果 | 备注 |
|---|---|---|---|---|---|
| T1 | **P1 聚合守卫**（原 B1 误停根治） | Start 工作流 → 任务派发后台 subAgent（`run_in_background`）→ 主会话空闲等待，观察面板实例状态 | 主 idle 期间实例**保持 RUNNING** 不误停；subAgent 结束后实例才转 STOPPED（session-idle） | | |
| T2 | **P2 定向自动恢复**（无缝续跑） | 接 T1：实例 STOPPED(session-idle) 后，向主会话发任意消息（如"看下进度"）唤醒 | 实例**自动恢复 RUNNING**（无需说"继续"）；编排 agent 查 workflow_status 后无缝续跑 | | |
| T3 | **P2 反例**（权威停止不复活） | 面板 Stop 实例 → 之后向主会话发任意非"继续"消息 | 实例**保持 STOPPED**，不自动恢复；仅显式"继续/恢复"才 RUNNING | | |
| T4 | **P3 级联停止** | 任务执行中确认有后台 subAgent 在跑 → 面板 Stop | subAgent **秒级停止**（会话列表消失）；工具返回含 `stopReason:'user-stop'` 与 `stoppedChildren≥1` | | |
| T5 | **双 subAgent 根治** | Start（派发 subAgent）→ 立即 Stop → 再 Start | 全程**不出现两个 subAgent 同时跑同一任务**：旧的被级联打断，新的唯一执行；无文件冲突/内容覆盖 | | 用户登记的核心问题 |
| T6 | **P4 级联停止通知治理** | 接 T4：Stop 时编排 agent 收到 "was stopped before it finished" 结算通知 | 编排 agent **忽略该通知**（不推进任务、不采信内容）；以 workflow_status 确认 STOPPED 后等待"继续" | | |
| T7 | **回归** | 面板 Start/Resume/Reset 全操作一遍；`/wf/list` 轮询观察 | 状态机无回归；Reset 后全新运行；列表同步正常 | | |

## 已知边界（非缺陷，验收时知悉）

- **手工停 DSH 会话**（非面板 Stop）时不级联打断子会话：P1 守卫使实例保持 RUNNING 直至子会话自然跑完才收敛 STOPPED——期间实例不会二次派发（Start 被拒），无双跑；急停需求走面板 Stop（T4 场景）。
- interrupt 为协作取消：实测毫秒级；子 agent 若正处于单个工具调用中，取消在该工具边界生效。
- 探针（subagents.list）故障时降级为"不守卫、照常停"（不卡死 RUNNING），由单测 c16 降级项覆盖。

## 结论

（手测完成后填写：总体结论 / 遗留问题 / 后续迭代建议）
