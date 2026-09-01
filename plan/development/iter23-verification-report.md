# Iter-23 验证报告 — 方向 A：手工停 DSH 会话=权威停止

- **状态**：✅ **完成并关闭**（2026-09-02 手测通过；host v0.12.0 / client v0.6.0；单测 220 全绿）
- **前置**：探针报告 `iter23-probe-report.md`；设计定稿见 `development-plan.md` §Iter-23
- **手测环境**：web profile（3080），workflow-orchestrator 预设编排会话 + 任一多任务工作流（可用 default-demo 或带 loop 的模板）；子会话需有"跑得足够久"的任务（如长 processor 脚本）以便观察级联停止
- **结论**：V1/V2/V3 全部符合预期；V1-⑤ 按面板状态机语义复核通过（原表述"Start 被拒"为引擎层措辞不当，非缺陷）

---

## V1 场景一：停时 agent 正在干活 → 点击即权威停止

**步骤**：
1. 编排会话启动工作流，等待编排 agent 在回合中干活（正在派发任务/读子会话结果）
2. 点击 DSH 会话输入框旁的**停止按钮**（打断 agent 当前回合）
3. 观察面板实例状态（≤3 秒内，面板 2s 轮询）
4. 等后台子会话原本会跑完的时间过去后，向会话发一条"看下进度"
5. 尝试点面板 Start

**预期**：
- [x] 步骤 3：面板实例状态 **STOPPED**（非 RUNNING 残留）
- [x] metadata.json `stopReason` = `"user-stop"`
- [x] 正在跑的后台子会话**秒级消失**（面板会话树/apiProxy.subagents.list 无 running 条目）
- [x] 步骤 4：agent 可回复，但**工作流不推进**（通知免疫：P4 忽略 + stopReason=user-stop 永不自动恢复）
- [x] 步骤 5（语义修正后通过）：STOPPED 态面板**无 Start 键，仅 Resume**——面板状态机以"不提供 Start"直接保证"Stop 后唯一继续路径=显式 Resume"（Iter-21 R5 设计行为）

> 手测备注（2026-09-02）：步骤 5 因没有"Start"按钮无法按原表述验证；面板状态符合预期。

## V2 场景二：停时 agent 空闲等子会话 → 提示条引导

**步骤**：
1. 启动含后台长任务的工作流，让编排 agent 进入空闲等待（子会话在跑、面板显示子节点 running）
2. 观察面板：提示条应**已经出现**（状态触发，无需先点停止）
3. 点击会话停止按钮（预期对工作流无影响）
4. 按提示条引导，点击面板 **Stop**
5. 观察子会话与实例状态

**预期**：
- [x] 步骤 2：面板出现提示条"编排会话空闲等待中：会话内的停止按钮此刻无效。后台任务执行中——要停止工作流请点面板 Stop"
- [x] 步骤 3：实例保持 RUNNING（Case I 零痕迹，点击无效果——原理性边界，非缺陷）
- [x] 步骤 4-5：子会话秒级停止，实例 STOPPED，`stopReason=user-stop`
- [x] 子会话自然跑完后的对照：提示条消失，实例自然收敛 STOPPED（`stopReason=session-idle`）

## V3 回归：三条既有停止路径不变

- [x] **面板 Stop**（agent 干活时点）→ STOPPED(user-stop)+级联，行为与 Iter-SUBA T 手测一致
- [x] **自然语言"请停止工作流"** → agent 调 workflow_stop → 同上
- [x] **自然收敛**（子会话全部跑完、agent idle）→ STOPPED(session-idle) + 主会话活跃时自动 resume（P2）
- [x] workflow_resume 清 stopReason，可续跑

## 单测（已通过）

- 用例 17（27 条）：A1 判定矩阵（user 命中；parent/hook/disposed/legacy/completed/无 reason/非 turn-end/畸形排除）、log 尾扫（不可读/空/无终局/被覆盖）、A1 处置（STOPPED+user-stop+级联+幂等+未绑定跳过）、A2 兜底（权威性高于 P1、探针 undefined 降级 session-idle）、P1/P2 回归
- 全量 220 通过，0 失败（`node code/scripts/test-host.js`）

## 手测结果（2026-09-02 回填）

- V1/V2/V3 全部通过（上方勾选项）；无缺陷。
- V1-⑤ 记录：STOPPED 界面无 Start 按钮，无法按原表述验证"Start 被拒"——复核确认这是面板状态机设计行为（STOPPED 仅提供 Resume，Iter-21 R5），与设计承诺"Stop 后想继续只有一条路：明确说'继续'或点 Resume"一致。报告预期措辞已修正。
