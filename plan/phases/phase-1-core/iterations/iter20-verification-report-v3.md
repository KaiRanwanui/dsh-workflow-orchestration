# Iter-20 手工验证报告（v3 — R1/R2/R3/R4 前后台状态一致）

> 用途：部署 Iter-20（host v0.11.2 / client v0.5.2）后，由人工在 Web UI 逐条执行并填写**验证结果**与**问题**两列。
> 填写约定：验证结果填 `PASS` / `FAIL` / `N/A`；问题列填简要现象或留空。
> 说明：本文件为 v3（针对 Iter-20 R1/R2/R3/R4 修复）；v1/v2 见 `iter19-verification-report.md`、`iter19-verification-report-v2.md`，保留不删。

## 0. 部署前置（先完成）

- [x] `systemctl --user restart dsh.service`（加载 host v0.11.2；刷新浏览器只重载 Client）
- [x] 浏览器硬刷新（Ctrl+Shift+R，载入 client v0.5.2 bundle）
- [x] 开**新的 workflow-orchestrator 会话**（旧会话不热更新）
- [x] 确认 `/wf/list` 正常 + 返回 `sessionState`（可选 `?sessionId=` 时）

---

## A. R1 gating（创建/采用/Start 按钮按会话状态）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| A1 | UNBOUND 空态 | 新会话无绑定实例 | 显示**空态**提示 + **「创建」「采用」**按钮；**不显示** Start/Stop/Reset | 不通过 | DAG有“起草->定稿”流程图，状态未STOPPED，并非**空闲**提示，创建、空闲两个按钮存在 |
| A2 | 创建即绑定 | 点「创建」→ 模板创建 | 创建成功后实例绑定本会话；空态消失，出现该实例控制（Start） | 通过 | |
| A3 | BOUND 隐藏创建/采用 | 会话已绑定实例 | 不再显示「创建」「采用」；只显示状态机控制按钮（依 stage） | 通过 | |
| A4 | Start 仅 BOUND | UNBOUND 状态下不应出现 Start | 只有「创建」「采用」；无 Start | 通过 | |

## B. R3 交互（移除常驻切换条 + 创建/采用弹窗）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| B1 | 无常驻切换条 | 面板主区 | 不再显示"实例切换条"；只显示当前会话绑定实例的状态/DAG | 不通过 | 未绑定状态也有DAG，见A1 |
| B2 | 创建弹窗 | 点「创建」 | 弹出模板创建窗（从模板生成）；仅模板来源 | 通过 | |
| B3 | 采用弹窗 | 点「采用」 | 弹出"选未绑定实例"窗：列出所有 `sessionId==null` 实例；点一个即**绑定本会话** | 未通过 | 列表中多出一个STOPPED状态的实例 |
| B4 | 无未绑定实例 | 采用弹窗 | 提示"当前没有未绑定实例，请先创建" | 通过 | |
| B5 | 采用后 | 采用一个未绑定实例 | 该实例绑定本会话；空态消失；出现其控制按钮 | 通过 | 问题：界面刷新隐藏按钮、显示Start很慢，8秒钟左右 |

## C. R2 Start 状态权威（/workflow_start 统一维护）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| C1 | Start 不预置 RUNNING | 面板点 Start | 面板不先置 RUNNING；编排会话收到"请启动"后由 `workflow_start` 置 RUNNING；不再报"仅 RUNNING 可 start" | 通过 | |
| C2 | DAG 即时性 | Start 后观察 | DAG 转 RUNNING（由会话响应驱动；若会话已运行则即时） | 通过 | |
| C3 | Start→Run | 执行中 | stage=RUNNING；Stop 可用 | 通过 |  |

## D. R4 Session 启停同步（列表路径）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| D1 | 停会话→列表同步 | 工作流 RUNNING 时停止该会话（agent idle） | `/wf/list` 显示该实例 **STOPPED**（不再停留 RUNNING） | 未通过 | Session执行过程中停止，比如提出问题需要人工选择时，DAG的状态会同步显示停止，有reset按钮（不是resume）；在UI的STOP按钮上点击没有任何反应 |
| D2 | 启会话→列表同步 | 重新启动该会话（agent running） | `/wf/list` 显示该实例 **RUNNING**（resume 续跑） | 未通过 | 同上，在对话框的按钮上重启会话，UI的状态会跟着变化。但暂停的UI上没有resume按钮 |
| D3 | 已完成不变 | 工作流 COMPLETED 时停会话 | 仍为 COMPLETED（不误改） | 通过 | |
| D4 | 会话级 list 无过期 | 轮询 /wf/list | 始终反映（idle→STOPPED / running→RUNNING），无过期 RUNNING | | |

## E. 状态机控制（回归）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| E1 | Stop 保进度 | RUNNING 点 Stop | → STOPPED；已完成保留 | 未通过 | 点Stop按钮无反应，会话继续执行 |
| E2 | resume | STOPPED resume | → RUNNING 续跑 | 未通过 | 无resume按钮 |
| E3 | reset | STOPPED/COMPLETED reset | → PENDING；写 `_reset_<state>` 备份 | 通过 | |
| E4 | 守卫 | STOPPED 直接 start / RUNNING 直接 reset | 拒绝 | 无法验证 | 没有按钮 |

## F. 孤儿 / 重启 / 边界（回归）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| F1 | 孤儿识别 | 删会话后新建会话 | 被识别为孤儿，可被新会话采用 | 未通过 | 物理删除归档Session，采用列表中没有孤儿Session |
| F2 | DSH 重启恢复 | 重启 DSH | 实例按 sessionId 恢复（± Session 启停同步） | | |
| F3 | 冲突自愈 | 同会话多实例的工作区 | 新建实例触发 CONFLICT 自愈解绑 + 弹窗告知 | | |

---

## 汇总

| 组 | 通过 | 失败 | N/A | 备注 |
|----|------|------|-----|------|
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |
| E | | | | |
| F | | | | |

**总体结论**：□ 全部通过　□ 存在需修复问题（见下方问题列表）

**问题清单**（编号 + 现象 + 复现步骤）：

## 其他问题

1. 切换Session时，WebUI刷新速度不快，3秒左右才根据实例状态完成页面刷新。

2. 采用孤儿实例后，执行时依然会存在状态错误的问题。`目标实例 serial-demo-a3cbc69a 是本会话已绑定的实例（sessionId 与本会话一致）。不过列表显示它当前 stage=RUNNING，按规则 workflow_start 对 RUNNING 实例会拒绝。`。

3. 严重：workflow执行后，出现传递的实例ID已跟别的sessionid绑定的问题。`serial-demo-88d3543e：sessionId = session-8556bf88-8843-456b-99ec-3e6c81c5e162（绑定到另一个会话），phase=READY / stage=PENDING，可启动但归属错误`。我发现，我不同Session绑定了不同的Sessionid，但在start启动时，几个Session的启动指令中的实例id是一样的`请启动工作流实例 serial-demo-88d3543e，工作区：/home/zhaokai/Projects/dsh_projects/workflow_test_ws`，几个Session都是serial-demo-88d3543e。

>目标实例 serial-demo-88d3543e 当前状态为：phase=READY，stage=PENDING，taskTotal=2，active=true。但注意到它绑定的是 session-8556bf88-...（≠当前会话 session-684325b1-...，当前会话被 sessionState 标为 BOUND 到 test-demo-d6a72d46），并被列入 orphans。

4.  reset是，会话中之前的对话没有清除。导致重新执行的时候LLM认为前后状态不一致，反复对比。