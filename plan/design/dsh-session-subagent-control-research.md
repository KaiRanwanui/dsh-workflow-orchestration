# DSH 会话与子会话控制机制 — 现象记录与探索规划

> 目的：记录（Iter-21 期间）关于 DSH 主会话/子会话（subagent）停止、继续控制的**已观测现象**与**已探索结论**，
> 并规划一个专门探索迭代，把 DSH 会话与子会话的控制接口彻底摸清，为工作流 Stop 真正级联停止子会话找到可行方案。
> 状态：🔄 探索规划（不改代码）。

---

## 1. 背景与目标

工作流由 workflow-orchestrator（主会话 agent）驱动，每个 Task 由它 spawn 的 **subagent 子会话**执行（一次性任务）。用户希望：
- 面板 **Stop** 能真正**停止主会话 agent + 其正在运行的 subagent 子会话**（仿 DSH 原生"停止"能力）。
- 面板 **Resume** 能继续（重新建立 subagent 或续跑）。

但当前只能停主会话的**后续派发**，正在跑的任务子会话**无法立即终止**，运行完还会触发主会话继续。本探索迭代聚焦把 DSH 主/子会话会话级的**控制接口**摸清。

## 2. 已观测现象（实测）

| # | 现象 | 说明 |
|---|------|------|
| P1 | 点面板 Stop 后，主会话状态变化**符合预期**（实例 STOPPED、按钮切 Resume、不再继续派发新任务） | stop 后 `getRunnableTasks()=[]` 生效 |
| P2 | 但**正在运行的 subagent 返回后，已 STOPPED 的主会话又被触发继续执行** | subagent await 不受 steer 打断；返回后 agent 短暂续跑（已用 getRunnableTasks=[] 抑制派发，但 agent 仍会处理返回结果） |
| P3 | **subagent 不能立即停止**，点 Stop 要等当前 subagent 执行完成才体现 | 推测为子会话 await 不可被主会话 steer 打断 |
| P4 | **进入 subagent 的子对话，在人共提示框输入"停止/继续"，子对话能停止/继续** | 关键线索：说明该子会话**可被 prompt/中断**（continuable） |

## 3. 已探索结论（源码级）

| # | 结论 | 证据 |
|---|------|------|
| C1 | **`session.cancel` 不能停工作流主会话**（其是 subagent 的父会话） | `dsh-host-apiproxy` cancel 处理有 `if (hasSubagentOwner(...)) return subagentOwnershipError(...)`；被拒 |
| C2 | **`subagent.interrupt` 仅对 continuable 子会话**生效（取消当前轮，fire-and-return）；one-shot 不可取消 | `subagents.d.ts` interrupt 文档（"live continuable child"）+ client-runtime cancel() 对 one-shot 报"uncancellable" |
| C3 | **`subagent.prompt`（continuable）投递内容给子会话**；one-shot 子对话为**只读**（`subagent-not-resumable`） | client-runtime line 7210-7234：one-shot → read-only；continuable → `subagents.prompt` |
| C4 | **`subagent.list`** 可枚举父会话的直接子会话（含 activity=running/inactive） | `subagents.list` API |
| C5 | **主会话 steer 打断不了 subagent await**：`sessions.prompt mode:'steer'` 只打断主会话 LLM 生成；agent 正处于 `subagent` 工具 await 时，steer 排队在其后 | P1/P2/P3 实测 |
| C6 | **引擎 stop 后 `getRunnableTasks()=[]`**（非 active 不派发） | 已修复（Iter-21 88d6ba0），抑制 stop 后继续派发，但**不杀已运行子会话** |

## 4. 关键判断（待探索验证）

- **任务 subagent 实际为 continuable**（P4 证明可被 prompt），而非 one-shot。因此理论上可通过
  `subagent.list(parentSessionId)` 枚举正在运行的子会话 → 逐个 `subagent.prompt`（注入"停止"）或
  `subagent.interrupt`（硬中断）来**级联停止**。
- 需确认：workflow-orchestrator spawn 的 task subagent 是 continuable 还是 one-shot；DSH UI 子对话的
  "停止"按钮 vs 输入"停止"分别走 interrupt 还是 prompt；以及从 Host（workflow-host）侧调用 subagent 控制 API
  的可行性与最佳方式。
- **主会话"steer 打断不了 await"是 DSH 层行为**，需确认是否有更底层或更合适的中断/级联接口。

## 5. 探索迭代规划（Iter-SUBA「DSH 子会话可控性探索」）

**目标**：摸清 DSH 主/子会话会话级控制接口，为"workflow Stop 级联停止子会话 / Resume 唤醒子会话"找到可行、可靠的实现方式。

**探索步骤（不改生产逻辑，用临时探针/最小改动）**：
1. **确认子会话模式**：用 `subagent.list(parentSessionId=workflowSessionId)` 观察 workflow 执行时子会话的
   `activity`（running/inactive）与 address mode（continuable/one-shot）；确认 task subagent 的可控性。
2. **验证两条中断路径**：
   - `subagent.interrupt`（硬中断当前轮）：对正在运行的 task subagent 调用，观察是否立即停止、其结果如何。
   - `subagent.prompt` 注入"立即停止"：观察 subagent LLM 是否照做并停止、耗时如何。
3. **复刻 DSH UI 子对话"停止/继续"机制**：定位 DSH 前端子对话的"停止"是走 `interrupt` 还是"输入停止"走 `prompt`；
   以此为蓝本，确认从 Host 侧调用哪种更贴近原生效果。
4. **主会话 await 中断**：确认 steer 是否真的无法打断 subagent await；若是，探索是否有取消/级联主会话 await
   的接口（或结合 subagent 中断来达到整体停止）。
5. **可行方案设计**（若验证通过）：
   - workflow Stop → `subagent.list` 枚举 running 子会话 → 逐个 `subagent.interrupt`（或 prompt"停止"）。
   - Resume 语义复核：子会话被中断后，任务状态如何（PENDING/重派），不产生重复。
   - 与现有 `getRunnableTasks=[]`、engine.stop 重置 RUNNING→PENDING、面板中间态协同。

**验证标准（探索产出的方案需满足）**：
- Stop 后正在运行的 task subagent **立即停止**（不再跑完），主会话不再被触发继续。
- Resume 后重新建立 subagent 续跑，且**不重复执行已产出任务**。
- 与现有 Stop/Resume/中间态/DAG 无回归；test-host 全绿。

**交付**：探索报告（子会话模式确认、interrupt vs prompt 实测、DSH UI 机制定位、可行方案）+ 如可行的方案选型说明。

## 6. 迭代排序建议

当前计划：Iter-22（剩余 S1/S3/S4）→ Iter-23（生命周期归档）→ Iter-24（编辑器）。
本探索迭代（Iter-SUBA）**建议放在 Iter-22 之后**（Iter-22 为增量修复，相对不复杂；探索结论若可行，可回填到后续
Stop/Resume 语义或独立成一功能迭代）。若你希望优先探索（因它可能影响 Stop 最终形态），可提前到 Iter-22 之前。
