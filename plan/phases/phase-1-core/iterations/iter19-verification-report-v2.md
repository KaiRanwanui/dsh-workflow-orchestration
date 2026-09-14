# Iter-19 手工验证报告（v2 — 含 A1/A2 修复）

> 用途：部署修复版（host v0.11.1 / client v0.5.1）后，由人工在 Web UI 逐条执行并填写**验证结果**与**问题**两列。
> 填写约定：验证结果填 `PASS` / `FAIL` / `N/A`；问题列填简要现象或留空。
> 说明：本文件为 v2（在第 1 版基础上补充 A1/A2 修复后的回归与恢复场景）；第 1 版见 `iter19-verification-report.md`，保留不删。

## 0. 部署前置（先完成）

- [x] `systemctl --user restart dsh.service`（加载 host v0.11.1；刷新浏览器只重载 Client）
- [x] 浏览器硬刷新（Ctrl+Shift+R，载入 client v0.5.1 bundle）
- [x] 开**新的 workflow-orchestrator 会话**（旧会话不热更新）
- [x] 确认 `/wf/list` 返回正常（插件健康）

---

## A. 创建与展示 gating（A1 修复）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| A1a | UNBOUND 显示创建 | 会话无绑定实例时 | 显示"+"创建按钮；不显示已绑定其他会话的实例 | 不通过 | 界面同时展示 + 和 start 按钮 |
| A1b | BOUND 隐藏创建 | 会话已绑定实例后 | 不再显示"+"创建按钮；显示该实例的控制按钮（Start/Stop） | 不通过  | 新建实例，提示已解绑其他实例后，+ 和 start 依然同时出现。此时既然已经绑定的最新的，就不该显示 + |
| A1c | 可选池仅未绑定 | 实例切换条 | 仅列未绑定（`sessionId==null`）实例；已绑定实例不出现 | 不通过 | 新建实例，提示已解绑其他实例后，展示了多个实例列表。此时应该已绑定了刚刚创建的实例，其他的实例都该隐藏。这个列表应该移动到创建界面里，可以从模版创建，也可选择未绑定的实例。放在UI里又不应该随时切换，用户体验不好 |
| A1d | Create 即绑定 | Panel 点"+“新建实例 | 返回 CREATED；实例已绑定本会话（可从 /wf/list 的 sessionId/派生状态确认） | 通过 | |

## B. 创建自愈（A2 修复，核心回归）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| B1 | 正常新建不误解绑 | 干净工作区，会话 UNBOUND 新建 1 个实例 | 正常 CREATED；无"已解绑"弹窗；无 BROKEN | 未验证 | |
| B2 | 已绑定会话再新建被拒 | 会话已有绑定实例时再点"+" | "+"按钮不出现（A1b）；即便绕过，后端拒绝"已绑定" | 不通过 | + 按钮始终出现 |
| B3 | CONFLICT 自愈 | 存在冲突实例（同会话被多占用）的工作区，新建 1 个实例 | 触发自愈：弹窗告知"已自动解绑冲突实例 X,Y 回未绑定池"；新实例绑定当前会话；工作区不再 BROKEN | 通过 | |
| B4 | 恢复后可驱动 | B3 后点 Start | 正常 RUNNING（不再报 BROKEN: CONFLICT） | 不通过 | workflow_start的启动逻辑似乎存在问题：“按状态机规则, RUNNING 中的实例调用 workflow_start 会被拒绝(须先 stop 或 reset)”，如果我们已经在点Start按钮的时候设置为RUNNING状态，执行workflow_start就不应该检查，或者点Start按钮的时候不设置RUNNING状态，让workflow_start自己维护状态  |
| B5 | 旧冲突实例回池 | B3 后 /wf/list | 原冲突实例的 sessionId=null（未绑定），可再被其他会话 adopt | | |

## C. 创建与启动（create 即绑定 / Start→RUNNING / 按钮 gating）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| C1 | Start→RUNNING | 点 ▶ Start | 直接 RUNNING（不再"先 adopt"）；显示 ⏹ Stop；状态条 RUNNING | 通过 | |
| C2 | 执行中状态 | 观察执行 | stage 保持 RUNNING（非 PENDING）；DAG 节点蓝/绿推进 | 被阻塞 | |
| C3 | RUNNING 不可重复 Start | 执行中再点 Start | Start 不显示（仅 Stop）；后端拒绝"已在运行" | 通过 | 后端接口行为未进行验证 |
| C4 | Start 后即时刷新 | Start 后观察 DAG | 立即出 RUNNING + 节点（不再停留 "Waiting…"） | 通过 | |

## D. 状态机控制（Stop / Resume / Reset / 守卫）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| D1 | Stop 保进度 | RUNNING 时点 ⏹ Stop | → STOPPED，active=false，显示 ⟳ Reset；已完成任务保留（保 DONE） | | |
| D2 | Resume 续跑 | STOPPED 时 resume（面板无按钮则会话内 `workflow_resume`） | → RUNNING，续跑保 DONE | | |
| D3 | 自然完成 | 跑到 COMPLETED | 显示 ⟳ Reset（可重跑） | | |
| D4 | Reset 重跑 | STOPPED/COMPLETED 时点 ⟳ Reset | → PENDING + 待启动，显示 ▶ Start；已写 `<ts>_reset_<state>/` 归档备份 | | |
| D5 | PENDING 守卫 | 刚 Reset（PENDING）时 | 仅显示 ▶ Start；Stop/Reset 不可点或后端拒绝 | | |
| D6 | 重复 Stop | RUNNING→STOPPED 后再点 Stop | 拒绝（"仅 RUNNING 可 stop"） | | |
| D7 | RUNNING 直接 Reset | RUNNING 时不先 Stop 而 Reset | 拒绝（"RUNNING 须先 stop"） | | |

## E. Session 启停同步（核心新增）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| E1 | 停会话→工作流停 | 工作流 RUNNING 时在 DSH 上**停止该会话**（agent idle） | 面板实例 → STOPPED（自动），保 DONE 进度 | | |
| E2 | 启会话→工作流续 | 之后**重新启动该会话**（agent running） | 面板实例 → RUNNING（自动 resume 续跑） | | |
| E3 | 已完成的会话停 | 工作流 COMPLETED 时停会话 | 不变（COMPLETED 不误改） | | |
| E4 | 新会话接手 | 会话停止后开新会话继续 | 新会话可 adopt/驱动该已停止实例 → resume | | |

## F. 孤儿 / 重启 / 边界

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| F1 | 孤儿识别 | 删除/回收绑定会话后，在该工作区新建会话 | 该实例不再被活跃会话持有（孤儿）；可被新会话 adopt | | |
| F2 | DSH 重启恢复 | 重启 DSH 后 | 实例按 sessionId 恢复到原状态（± Session 启停同步微调） | | |
| F3 | 损坏 → BROKEN | 手动删除实例目录/metadata | /wf/status、list 显示 BROKEN/孤儿；控制被拦截 | | |
| F4 | BROKEN 可恢复 | F3 后新建实例 | 若为 CONFLICT → 自愈解绑；若为损坏（CORRUPT）→ 提示需新建会话 | | |

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
