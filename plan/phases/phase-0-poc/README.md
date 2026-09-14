# 阶段 0 — PoC 验证（概念原型）

- **时间**：~2026-08 中旬（正式开发启动前）
- **DSH 基线**：`0.1.2-alpha` 系列（PoC 期）
- **交付**：原型与验证结论（未发行）；架构选型定案
- **状态**：✅ 已归档（文档与原型代码集中在仓库 `PoC/`）

## 阶段目标

验证「在 DSH 上用 Cordis 插件做工作流编排」的技术可行性，并在两个候选架构中选型：

- 候选 A：Host 插件自持状态机 + Client 面板直连
- 候选 B（**选中**）：**DSH Agent Preset + Agent 驱动编排** —— 编排逻辑交给 LLM Agent（用 `workflow_*` 工具上报），Host 插件只做引擎/持久化/路由，Client 只做呈现

选型结论与依据：`PoC/solutions/architecture-proposal.md`（推荐方案）、`PoC/solutions/architecture-comparison.md`（对比）。该结论在阶段 1 全程成立，是现行架构的起点。

## 产出与去向

| 内容 | 位置 |
|---|---|
| PoC 概念设计 / 开发计划 / 总结报告 / 桌面迁移记录 | `PoC/docs/`（`design.md`、`development-plan.md`、`REPORT.md`、`DESKTOP-MIGRATION.md`、`poc-development-plan.md`） |
| 架构方案与对比、PoC 验证计划 | `PoC/solutions/` |
| PoC 期技能 / 工作流 / 测试数据 / 插件原型 | `PoC/skills/`、`PoC/workflows/`、`PoC/test-data/`、`PoC/plugin-source/` |
| DAG 分层布局原型（Iter-30 移植来源） | `PoC/dag-layered-prototype.html` |
| PoC 期运行产物 | `PoC/output/` |

## 归档说明：`PoC/legacy-root/`

2026-09-14 文档整理时，仓库根目录下属于 `software-design-agent` / PoC 时代的遗留文件统一移入 `PoC/legacy-root/`，**不属于现行工程结构**：

| 项 | 原用途 | 现状 |
|---|---|---|
| `package.json`、`pnpm-workspace.yaml`、`cordis.yml`、`cordis.patch.yml` | PoC 期「以仓库根为 DSH profile」的清单与 patch | 已废弃；现役 profile 在 `~/.dsh/profiles/web/` |
| `bin/sd-agent` | 早期命令行入口 | 已废弃 |
| `RR/` | 原始需求原件（软件设计工作流 + 转向通用工作流的调整需求） | 需求正文已收录进 `plan/requirements/`；原件留档于此 |
| `skills/`（api-design、architecture-patterns、design-review、uml-modeling）、`templates/`（SAD/SRS 模板） | `software-design-agent` 时代的领域技能与文档模板 | 已被现行内建资产取代（`code/plugins/workflow-host/builtin-skills.js` → 物化到 `~/.dsh/workflow-agent/`） |
| `workflows/`（demo 工作流 + 输出样例） | 阶段 1 早期的端到端样例工作区 | 已被内建模板（default-demo / items-demo 等）取代 |

> 相关需求文档的现行位置：`plan/requirements/`（含 `Raw_Reqs.md`、`需求-从PoC到正式开发.md`、工作流数据管理需求系列、`SRS-draft.md`）。
