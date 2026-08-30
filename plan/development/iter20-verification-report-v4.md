# Iter-20 手工验证报告（v4 — 预设门控 + BROKEN 展示，S5）

> 用途：部署 Iter-20 未决项（host v0.11.5 / client v0.5.4）后，由人工在 Web UI 逐条执行并填写**验证结果**与**问题**两列。
> 填写约定：验证结果填 `PASS` / `FAIL` / `N/A`；问题列填简要现象或留空。
> 说明：本文件为 v4（针对 Iter-20 未决项 S5=预设门控 + BROKEN 展示 + DONE 提示，以及 R1~R4/forSession 回归）。v3（R1/R2/R3/R4）见 `iter20-verification-report-v3.md`，保留不删。S1~S4 仍未修，见文末"遗留"节，不在本版验证范围。
> **结果**：14 通过 / 2 N/A（C1、D5）/ 5 问题（A4/A6/其他#1/#2/B2），问题已归入 **Iter-21**（前后台状态一致·v4 手测问题闭环 + Resume 提前，见 `iter21-report.md`）。

## 0. 部署前置（先完成）

- [x] `systemctl --user restart dsh.service`（加载 host v0.11.5；刷新浏览器只重载 Client）
- [x] 浏览器硬刷新（Ctrl+Shift+R，载入 client v0.5.4 bundle）
- [x] 开**新的 workflow-orchestrator 会话**与一个**非 workflow 会话**（旧会话不热更新）
- [x] 确认 `/wf/list` 正常 + 返回 `sessionState`（含 `BOUND/UNBOUND/BROKEN/DONE`）
- [ ] **默认模板已可执行**：「+创建」预选 `default-demo`（3 任务并发+汇总+门禁，免改免参），依赖工作区 `skills/spec-writer|data-prep|integrator|integrator-checker`；可直接创建→Start 验证 A~D

---

## A. 预设门控（仅 workflow-orchestrator 会话显示面板）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| A1 | 非编排会话占位 | 开启普通（非 workflow preset）会话，看 Workflow 页签 | 页签存在但面板显示占位 **「此会话不是 Workflow 编排会话，无监控面板。」**；无 DAG、无按钮 | 通过 | |
| A2 | 非编排会话轮询短路 | A1 会话下看 DevTools Network | **无** `/wf/list` / `/wf/status` 请求（不轮询） | 通过 | |
| A3 | workflow 会话 UNBOUND | 开启 workflow-orchestrator 会话（无绑定实例） | 显示**空态**提示 + **「创建」「采用」**按钮；不显示 Start/Stop/Reset | 通过 | |
| A4 | workflow 会话 BOUND | 会话已绑定实例 | 显示 DAG + 状态机控制按钮（依 stage） | 通过 | 问题：DAG只有起点和终点，没有步骤节点 |
| A5 | 跨会话切换 | 从 workflow 会话切到普通会话（同/异 workspace） | 面板切回占位 A1 表现，轮询停止；再切回 workflow 会话恢复 DAG | 通过 | |
| A6 | subagent 会话 | 打开 workflow 实例产生的 subagent 会话 | 视为非编排会话 → 占位 A1（不作为主面板视图） | 不通过 | 工作流会话的subagent的面板依然是工作流面板，有+和采用按钮 |

---

## B. BROKEN 展示（环境异常告警 + 隐藏操作按钮）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| B1 | CONFLICT → BROKEN | 构造同会话绑定多实例（两个实例 metadata.sessionId 相同）后，workflow 会话打开面板 | 显示 **「⚠ 环境异常，需新建 workflow 会话」** 告警卡 + 原因（含 CONFLICT）；**不显示** 创建/采用/Start/Stop/Reset | 通过 | |
| B2 | 骨架损坏 → BROKEN | 删除某实例 `metadata.json`（或破坏 `.workflow-agent/instances/`） | 显示 BROKEN 告警（原因含 CORRUPT/骨架缺场） | 不通过？ | 问题：第一次删除metadata.json能正确出现BROKEN告警。完成B3测试正确恢复。之后执行B4测试，再将metadata.json删除，界面无法给出BROKEN告警，我在会话中要求列表workflow实例，显示的列表中没有绑定的wf实例的ID。wf/status/轮询能返回绑定的wf实例的ID，状态始终是CREATED。Network中没有轮询的wf/list调用（我又测试了一遍，没有复现） |
| B3 | 恢复 | 修复冲突/损坏（回 UMBOUD 或重建实例）后刷新 | 面板恢复 正常态（UNBOUND 创建/采用 或 BOUND DAG） | 通过 | |
| B4 | 门控优先 | 非编排会话遇到 BROKEN 工作区 | 仍显示门控占位 A1（不因 BROKEN 覆盖门控） | 通过 | |
| B5 | BROKEN 后禁止控制 | BROKEN 面板上确认操作 | 无 Start/Stop/Reset/创建/采用 触发（仅告警） | 通过 | |

---

## C. DONE 展示（已归档）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| C1 | 归档会话 DONE | 会话对应实例已归档（archive 声明该会话） | 面板显示 **「该工作流实例已归档（完成）。如需新建请开启新的 Workflow 编排会话。」**；无 创建/控制按钮 | 无法测试 | DSH无查看归档会话的界面  |

---

## D. R1~R4 / forSession 回归（确认未破坏）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| D1 | create 即绑定 | workflow 会话点「创建」→ 模板创建 | 实例绑定本会话；空态消失；出现该实例控制 |通过 | |
| D2 | Start 状态权威 | 面板点 Start | 面板**不**先置 RUNNING；由编排会话 `workflow_start` 置 RUNNING（不报"仅 RUNNING 可 start"） | 通过 | |
| D3 | Session 启停同步 | RUNNING 时停会话（agent idle）→ `/wf/list` 显示 STOPPED；再启会话 → resume RUNNING | 列表始终一致，无过期 RUNNING | 不通过 | 问题：界面正确显示Stopped状态，但没有resume按钮，只有reset按钮 |
| D4 | forSession 归属 | 多会话各绑不同实例 | 每个会话面板只显示本会话绑定实例（不串、不回退最新） | 通过 | |
| D5 | 冲突自愈 | 同会话多实例工作区新建 | 触发 CONFLICT 自愈解绑 + 弹窗告知 |无法测试 | 暂通过界面入口无法构造此用例前提 |

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

## 其他问题

（保留留白，供人工填写本版新发现的问题）

## 遗留（Iter-21 S1~S4，未修，本版不验证）

- **S1** 自动 idle→stop 仍在：agent idle 时绑定实例会被置 STOPPED（含提问等待场景）。本版**预期仍存在**，无需复现。
- **S2** Resume 按钮 / wfListLoader 即时刷新未做：STOPPED 无 Resume 按钮，采用/创建后刷新依赖 10s 轮询。本版预期仍存在。
- **S3** 孤儿进采用池未做：采用池可能不含孤儿、或含莫名 STOPPED。本版预期仍存在。
- **S4** reset 清会话对话未做：reset 后重跑 LLM 仍会对比旧对话。本版预期仍存在。

以上项在 Iter-20/S5 之后继续（见 `development-plan.md` Iter-21）。

## 其他问题

- 新建会话后，有时按钮长时间未刷新为正常状态，显示Start，而不是+和采用。需要F5刷新浏览器才能正常显示。wf/status查询返回的是null。
- 同上，F5刷新后，点击采用，不会弹出孤儿实例绑定列表。此时/wf/list是能定时查询返回列表的。因为是新建会话，列表中没有当前session的实例数据。还有一个场景：我点击采用没有反应，点击创建新建实例后，显示DGA、Start按钮，这时候采用列表框才弹出。
