# 项目状态（单一权威）

> **本文件是 workflow-agent「当前状态」的唯一权威**，回答「项目走到哪了、基线是什么、下一步做什么」。
> **维护频率：每阶段一次**（阶段启动/收尾时更新）。迭代级状态写在各自迭代报告里，**不回写本文件、不回写阶段 README**。
> 历史过程记录见 `phases/progress-record.md`（已冻结）。

**最后更新**：2026-09-20（**阶段 4 完成**——Iter-31~43 全部验收关闭：8 缺陷闭环 + 全文编辑/表单补全/params 单轨化/页签门控/运行视觉/DAG 数据源重构/主题适配。当前版本 v0.26.50，602 单测绿，探针清零。**待专项（用户发起）**：结构编辑权限矩阵对齐。队列：下一阶段待立项）

---

## 1. 阶段总览

| 阶段 | 时间 | DSH 基线 | 交付版本 | 测试基线 | 状态 |
|---|---|---|---|---|---|
| **阶段 0 · PoC 验证** | 2026-08 中旬前 | 0.1.2-alpha 系列 | 原型（未发行） | 无 | ✅ 已归档 |
| **阶段 1 · 核心功能开发**（Iter-1 ~ Iter-30 + Iter-SUBA） | 2026-08-26 ~ 09-05 | **0.1.1-rc.2** | host v0.20.1 / client v0.9.0 | 563 单测全绿 | ✅ 已完成并归档 |
| **阶段 2 · DSH 0.1.5-rc.2 迁移** | 2026-09-13（单日完成） | **0.1.5-rc.2** | host **v0.21.0** / client **v0.9.1** | 563 单测全绿 + GUI 回归通过 | ✅ 已完成并归档 |
| **阶段 3 · 构建链合并重构 + 发行工具 + 单包化** | 2026-09-14 ~ 09-15 | 0.1.5-rc.2 | **host v0.23.0 单包**（Host 插件 + 面板 bundle + preset 随包；client-ui-monitor 退役） | 567 单测全绿 + 真机冒烟 + GUI 验收 + **实物验收**（清除→tgz 重装→基本功能） | ✅ 已完成并归档 |
| **阶段 4 · 现有功能修复**（Iter-31 ~ 43） | 2026-09-16 ~ 09-20 | 0.1.5-rc.2（不变） | **host v0.26.50**（单包形态延续） | 602 单测全绿 | ✅ 已完成（13 个迭代全部验收关闭） |

阶段详情与迭代索引：`phases/README.md`。

---

## 2. 当前系统形态（已部署并运行）

| 项 | 现状 |
|---|---|
| DSH | **0.1.5-rc.2**（主包 + 10 个关键卫星包同版本） |
| 服务 | 用户级 systemd `dsh.service`，Web 3080（loopback + token 认证） |
| 部署形态 | web profile（`~/.dsh/profiles/web/`）：`link:` 依赖两个包 + `dsh.profile.bundles` 注册；preset 部署在 `~/.dsh/.agent-presets/workflow-orchestrator/` |
| 内建资产 | 插件启动时物化到 `~/.dsh/workflow-agent/`（4 模板 + 7 技能 + samples/docs） |
| 运行时插件来源 | **npm 包** `packages/workflow-host/lib/index.js`（CJS）；preset 目录中的 `workflow-host.mjs` 当前**未挂载**（见阶段 3） |
| GUI | orchestrator 会话的 `conversation.view` 面板（DAG/四键/编辑/管理）正常 |

版本锁定明细（含卫星包清单）见 `phases/phase-2-dsh-migration/iterations/iter-migration-015rc2-verification-report.md`「版本锁定」节。

---

## 3. 当前与下一步：阶段 4 — 现有功能修复（🚧 进行中）

> 阶段 3 已完成归档：`phases/phase-3-build-chain/README.md`（构建链合并 / 单包化 / 资产与 persona 文件化 / 发行工具 / 实物验收）。

**定位**（用户拍板 2026-09-16）：修复现有功能问题，**不增加新工作流能力**——真 skill 使用 / output→input 串联 / 变量引用 → 阶段 5。
**输入**：全功能人工验证（[`phases/phase-4-ui-enhance/verification-checklist.md`](phases/phase-4-ui-enhance/verification-checklist.md)：39 过 / 3 未过 / 7 无法构造 / 2 部分）开单 8 缺陷 + 6 改进项，已全部完成代码级根因分诊。
**方案**：[`phases/phase-4-ui-enhance/plan.md`](phases/phase-4-ui-enhance/plan.md)（v6，**11 个聚焦迭代**，后台 → 前台 → UI 交互排序；阶段合计约 7 人天）：

| 迭代 | 主题 | 状态 |
|---|---|---|
| Iter-31 | 面板控制指令语义（reset 停 PENDING + stopHint 移除） | ✅ 完成（host v0.24.0） |
| Iter-32 | 验证测试资产与补验（verify-* 测试模板 + 校验样例） | ✅ 完成（host v0.25.2；六项补验全过，连带修复缺陷 #10 引擎组依赖悬空） |
| Iter-33 | 实例完整性与采纳关口（含**孤儿回收误判 #9**：isSessionLive 驻留语义致存活会话实例被批量误解绑） | ✅ 完成（host v0.26.2；四项真机验收通过，含 U3 展示修复） |
| Iter-34 | 门禁真实执行（引擎软强制 + pendingGates + gateNote 反馈链 + 结论落盘；复用 verify-gate 模板） | ✅ 完成（host v0.26.5；两轮真机验证全项通过，缺陷 #8 闭环） |
| Iter-35 | 定义全文编辑（YAML 源码模式两态切换 + 创建弹窗去 yaml 编辑 + 技能全文只读浏览） | ✅ 完成（host v0.26.8；多错误合并呈现修复，用户验收通过） |
| Iter-36 | 编辑器表单补全（字段矩阵 + U2 + 配色 + W-GATE-RETRY-MISMATCH） | 🚧 编码完成（host v0.26.9），待真机验收 |
| Iter-36 ~ 37 | 编辑器表单补全（含 U2 模板下拉名称+说明）/ 全局参数编辑 | 待启动 |
| Iter-38 ~ 41 | 页签动态门控 / RUNNING 运行视觉（含 U1 门禁角点）/ 节点详情与文件预览 / 主题适配 | 待启动 |

**已拍板关键决策**：reset 后停留 PENDING 等用户手动 Start（注入文案改纯通知）；stopHint 提示条移除（Stop v4 后两通道等效）；采纳关口校验（缺失文件/不完整实例不允许正常采纳）；补验项独立成迭代并预置测试模板；详情+预览方案待全文编辑（Iter-35）效果评估后确定；items 空提取维持 Q1-b 派发、技能文案层识别空 items（v0.25.1）。

---

## 4. 已知限制（明确不做，留档）

| 限制 | 说明 | 记录 |
|---|---|---|
| delivery 两态 / probe-inject 完整冒烟未做真实拓扑实测 | 实际使用形态为根会话，无「orchestrator 作为子代理」拓扑；以单测覆盖 + API 可达性验证关闭 | 阶段 2 验证报告「已知限制」#1 |
| `interruptByParent` 的 accepted ≠ 实际中断 | 仅影响兜底通道；面板 Stop 主通道走 `sessionController.cancel` 原生级联 | 同上 #2 |
| 门禁 subagent 分支（PASS→COMPLETED）真实链路未在 0.1.5 环境复跑 | 引擎既有能力，阶段 3 或后续迭代顺带覆盖 | 阶段 2 迁移计划 Phase 3 勾选备注 |
| `build-preset.js` 已废弃（运行即 exit 1） | 防止误跑覆盖现役 mjs；建议阶段 3 一并退役 | `code/scripts/build-preset.js` 头部 |
| `interruptByParent` / legacy 脚本（`build-host.js`、`.ps1`、`dist/`）待退役 | 阶段 3 评估 | 阶段 3 设计文档 |

---

## 5. 文档地图（从本文件出发）

```
plan/status.md              ← 你在这里（当前状态唯一权威）
plan/README.md              ← 文档地图与阅读路径
plan/phases/README.md       ← 阶段总览 + 索引
plan/phases/phase-N-*/      ← 各阶段总结 + iterations/（冻结的迭代产物）
plan/design/                ← 现行设计（数据模型、生命周期、通信机制…）
plan/architecture/          ← 架构决策记录（ADR）
plan/requirements/          ← 需求基线
plan/development/           ← 团队约定 + 迭代计划/报告模板
plan/build/                 ← 构建、部署、环境文档
```
