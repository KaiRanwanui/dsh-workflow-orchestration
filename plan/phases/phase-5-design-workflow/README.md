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

见 `iteration-plan.md`（用户总体拍板 Iter-44~57，次序可按执行情况调整）。当前：**Iter-44 ✅（2026-09-22）、Iter-45 ✅（2026-09-22）相继关闭**，下一迭代 **Iter-46 环境准备**（design-init 任务滚动充实，方案待出）。
非阻塞性待优化问题：`optimization-backlog.md`（O-1 DAG 连线交叉/遮挡，待开单）。

已有遗留（/wf/skill 围栏、权限矩阵对齐）保留在迭代池，视跑通情况插入。

## 工作方式

- 迭代照旧规则：先方案报确认 → 编码/制作 → 报告归档 `iterations/` → 用户验收 → 关闭；status.md 阶段收尾刷新。
- 跑通过程中的问题记 `findings.md`。
