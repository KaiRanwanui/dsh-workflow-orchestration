# Iter-19 手工验证报告（前后台配合）

> 用途：部署 Iter-19（host v0.11.0 / client v0.5.0）后，由人工在 Web UI 逐条执行并填写**验证结果**与**问题**两列。
> 填写约定：验证结果填 `PASS` / `FAIL` / `N/A`；问题列填简要现象或留空。勾选进度自行在结果列标注。

## 0. 部署前置（先完成）

- [x] `systemctl --user restart dsh.service`（加载 host v0.11.0；刷新浏览器只重载 Client，不会重载 Host）
- [x] 浏览器硬刷新（Ctrl+Shift+R，载入 client v0.5.0 bundle）
- [x] 开**新的 workflow-orchestrator 会话**（preset 已同步，旧会话不热更新）
- [x] 确认 `/wf/list` 返回正常（插件健康）

---

## A. 创建与启动（create 即绑定 / Start→RUNNING / 按钮 gating）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| A1 | 创建即绑定 | Panel “+” 新建实例（选模板） | 实例 chip 出现，阶段 CREATED，仅显示 ▶ Start（不显示 Stop/Reset） | 通过但有其他问题 | workspace中已有的工作流实例数据存在，界面上全部显示了出来，创建实例按钮和Start按钮同时存在；我期望Session没有绑定wf实例时，只有创建实例按钮；如果有绑定的实例则不应该出现创建实例按钮。而且UI中不应展示已绑定Session的实例，只有未绑定的实例可以选择，选择后，创建实例按钮应隐藏 |
| A2 | Start→RUNNING | 点 ▶ Start | 直接 RUNNING（不再"先 adopt"）；显示 ⏹ Stop；状态条 RUNNING | 失败 | 提示“启动失败: workspace BROKEN: CONFLICT: 会话被多实例占用/session-ae3483ab-1c73-48a6-a1b8-8bfbd3621bc9”，可能是我点了两次+按钮创建实例导致，但没有回退的手段。新建一个Session，点击+之后选择新建的实例启动，依然报这个错误 |
| A3 | 执行中状态 | 观察执行过程 | stage 保持 RUNNING（非 PENDING）；DAG 节点蓝/绿推进 | | |
| A4 | RUNNING 不可重复 Start | 执行中再点 Start | Start 不显示（仅 Stop）；后端拒绝"已在运行" | | |

## B. 状态机控制（Stop / Resume / Reset / 守卫）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| B1 | Stop 保进度 | RUNNING 时点 ⏹ Stop | → STOPPED，active=false，显示 ⟳ Reset；已完成任务保留（保 DONE） | | |
| B2 | Resume 续跑 | STOPPED 时 resume（面板无按钮则会话内 `workflow_resume`） | → RUNNING，续跑保 DONE | | |
| B3 | 自然完成 | 跑到 COMPLETED | 显示 ⟳ Reset（可重跑） | | |
| B4 | Reset 重跑 | STOPPED/COMPLETED 时点 ⟳ Reset | → PENDING + 待启动，显示 ▶ Start；已写 `<ts>_reset_<state>/` 归档备份 | | |
| B5 | PENDING 守卫 | 刚 Reset（PENDING）时 | 仅显示 ▶ Start；Stop/Reset 不可点或后端拒绝 | | |
| B6 | 重复 Stop | RUNNING→STOPPED 后再点 Stop | 拒绝（"仅 RUNNING 可 stop"） | | |
| B7 | RUNNING 直接 Reset | RUNNING 时不先 Stop 而 Reset | 拒绝（"RUNNING 须先 stop"） | | |

## C. Session 启停同步（核心新增）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| C1 | 停会话→工作流停 | 工作流 RUNNING 时在 DSH 上**停止该会话**（agent idle） | 面板实例 → STOPPED（自动），保 DONE 进度 | | |
| C2 | 启会话→工作流续 | 之后**重新启动该会话**（agent running） | 面板实例 → RUNNING（自动 resume 续跑） | | |
| C3 | 已完成的会话停 | 工作流 COMPLETED 时停会话 | 不变（COMPLETED 不误改） | | |
| C4 | 新会话接手 | 会话停止后开新会话继续 | 新会话可 adopt/驱动该已停止实例 → resume | | |

## D. 孤儿 / 重启 / 边界

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| D1 | 孤儿识别 | 删除/回收绑定会话后，在该工作区新建会话 | 该实例不再被活跃会话持有（孤儿）；可被新会话 adopt | | |
| D2 | DSH 重启恢复 | 重启 DSH 后 | 实例按 sessionId 恢复到原状态（± Session 启停同步微调） | | |
| D3 | 损坏 → BROKEN | 手动删除实例目录/metadata | /wf/status、list 显示 BROKEN/孤儿；控制被拦截 | | |
| D4 | Start 后即时刷新 | 面板 Start 后观察 DAG | 立即出 RUNNING + 节点（不再停留 "Waiting…"） | | |

---

## 汇总

| 组 | 通过 | 失败 | N/A | 备注 |
|----|------|------|-----|------|
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |

**总体结论**：□ 全部通过　□ 存在需修复问题（见下方问题列表）

**问题清单**（编号 + 现象 + 复现步骤）：
