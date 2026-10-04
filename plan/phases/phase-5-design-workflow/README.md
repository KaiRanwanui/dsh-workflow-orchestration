# 阶段 5 · 设计作业流专项（design-workflow）

**定位**（用户拍板 2026-09-20）：围绕**系统分析与设计作业流**制作全套资产并完整跑通，以真实使用磨炼 workflow-agent。llm-wiki 知识提取作业流留待后续阶段；阶段 5 运行情况决定是否在其后插入一个功能增强阶段。

## 阶段工作项（用户定义）

1. 定义系统分析与设计作业流（workflow 定义 YAML）；
2. 制作各活动需要的**模板**（输出文档模板）；
3. 制作各活动的**执行 skill + 门禁检查 skill**；
4. 提供设计作业相关的**知识资源**（方法论/规范资料）；
5. 完整跑通工作流，**通过文件衔接上下步骤**（前序产物 = 后序输入）。

## 资产形态

- 作业流：8 任务串行链（prep 环境准备 → 初始需求 → … → 分配需求）+ 阶段门禁（门禁自 Iter-45 引入）。设计细节见 `trial-workflows.md`（WF-1 节）+ `iteration-plan.md`（Iter-46 环境准备定位）。
- 资产目录（仓库内版本化，用户拍板 2026-09-20）：
  ```
  workflow_samples/sys-design/
    workflow.yaml             # 作业流定义
    skills/<activity>.md      # 各活动执行 skill
    skills/gate-<activity>.md # 各活动门禁检查 skill（或统一门禁 skill + 按活动检查单）
    templates/<activity>.md   # 各活动输出文档模板
    knowledge/                # 方法论知识资源（分析设计规范、示例、术语）
  ```
- 运行现场：独立工作空间 `/home/zhaokai/Projects/design-trial/`（与开发工作空间 dsh_projects 完全并列）——资产物化到该工作空间运行，实例 state/output 只落运行现场，不进插件仓库。

## 迭代计划

见 `iteration-plan.md`（用户总体拍板 Iter-44~57 + 46-2，次序可按执行情况调整）。当前：**Iter-44/45/46 ✅ 已关闭；Iter-46-2（Reset 注入修复，v0.27.1）编码部署完成，待用户重启 DSH 复验**（`iterations/iter-46-2-report.md`）。
非阻塞性待优化问题：`optimization-backlog.md`（O-1 DAG 连线交叉/遮挡，待开单）。

已有遗留（/wf/skill 围栏、权限矩阵对齐）保留在迭代池，视跑通情况插入。

## 工作方式

- 迭代照旧规则：先方案报确认 → 编码/制作 → 报告归档 `iterations/` → 用户验收 → 关闭；status.md 阶段收尾刷新。
- 跑通过程中的问题记 `findings.md`。


---

## 阶段总结（2026-10-04 收官归档；用户拍板：已进行部分总结，余量规划为阶段 7）

**打断背景**：阶段 5 进行中被开发设备故障与 DSH 0.2.0-rc.2 版本迁移（阶段 6）打断；阶段 6 完成后用户裁定不直接续跑，本阶段就此归档。

### 已完成并验收

| 迭代 | 交付 |
|---|---|
| Iter-44 | sys-design 作业流定义（12 任务串行链 + 全门禁，v0.4 终版）+ 24 技能（12 执行 + 12 门禁） |
| Iter-45 | 全任务质量门禁挂接（on-failure 语义矩阵：retry+max-retries / skip / block） |
| Iter-46 | design-init 环境初始化六步 + PRD 运行时检查语义（v0.3/v0.4 两轮验收修复） |
| Iter-46-2 | Reset 注入修复（F-1：注入目标改权威绑定 + 清理改引擎直执行；v0.27.1）——**阶段 6 MIG3 已复验关闭** |

**阶段 6 期间的资产验证**：sys-design 作业流在 DSH 0.2.0 完整跑通（终验 A 区块：12 任务全 DONE → COMPLETED，含 Stop/Resume 干预）——资产本体在迁移后可用性已实证。

### 未进行（→ 阶段 7）

- Iter-47 起的原计划余量：`templates/` 输出文档模板制作（现为占位）、`knowledge/` 方法论资源、多轮真实磨炼。

### 遗留移交（→ 阶段 7）

- 本目录 `optimization-backlog.md`：O-1（DAG 连线交叉）+ 阶段 6 验收转入的 O-3~O-12；
- `findings.md` 迭代池：/wf/skill 围栏收口、编辑权限矩阵对齐（阶段 4 遗留依赖项）。
