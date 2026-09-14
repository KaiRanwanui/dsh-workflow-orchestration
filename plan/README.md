# plan/ —— 项目管理文档地图

> 本目录是 workflow-agent 的全部管理与技术文档。**本文件回答「文档在哪、该读哪些」；「项目走到哪了」看 [`status.md`](status.md)。**

## 三种阅读路径

| 你是 | 读这些（按顺序） |
|---|---|
| **新会话 / 新成员快速接手** | ① 根 [`README.md`](../README.md)（3 分钟了解）② [`status.md`](status.md)（现状与下一步）③ [`../GUIDE.md`](../GUIDE.md)（代码结构与机制速查）④ [`architecture/architecture-decisions.md`](architecture/architecture-decisions.md)（架构决策） |
| **要开发某个功能** | ① [`status.md`](status.md) → ② [`design/`](design/) 中对应设计文档 → ③ [`development/team-conventions.md`](development/team-conventions.md)（**先设计后开发**等纪律）→ ④ 用 [`development/iteration-plan-template.md`](development/iteration-plan-template.md) 写迭代方案报用户确认 |
| **查历史（某功能怎么来的）** | ① [`phases/README.md`](phases/README.md) 定位阶段 → ② 阶段 README 的迭代索引 → ③ `iterations/` 内对应报告；过程流水见 [`phases/progress-record.md`](phases/progress-record.md) |

## 目录说明

| 目录 / 文件 | 用途 | 刷新频率 |
|---|---|---|
| `status.md` | **当前状态唯一权威**：阶段表 / 版本基线 / 下一步 / 已知限制 | 每阶段一次 |
| `phases/` | **阶段归档**：`phase-N-*/README.md`（阶段总结）+ `iterations/`（迭代产物，冻结） | 阶段收尾写一次，之后冻结 |
| `design/` | 现行设计：生命周期、schema、Client↔Host 通信、状态管理等 | 设计变更时 |
| `architecture/` | 架构决策记录（ADR） | 决策发生时 |
| `requirements/` | 需求基线（原始需求、澄清定稿、SRS 草案） | 需求变更时 |
| `development/` | 协作纪律（`team-conventions.md`）+ 迭代计划/报告模板 | 约定变更时 |
| `build/` | 构建、部署、环境搭建文档 | 流程变更时 |

## 文档维护规则（避免"每次迭代都要回改一堆文档"）

1. **状态只在一处**：阶段与版本状态写 `status.md`；迭代状态写各迭代报告。**不维护跨迭代的勾选清单**。
2. **阶段 README 封版**：阶段收尾时写一次，之后不再修改；后续发现的问题写进新阶段的文档。
3. **历史冻结**：`phases/*/iterations/` 内的报告与设计是历史证据，**不回改**（如需更正，在新文档中说明）。
4. **现行与历史分离**：现行设计/架构/需求留在 `design|architecture|requirements`；PoC 期与阶段内产物归 `phases/` 或 [`../PoC/`](../PoC/)。

## 相关入口

- 项目根：[`../README.md`](../README.md) · 工程导览：[`../GUIDE.md`](../GUIDE.md)
- 代码结构：[`../code/README.md`](../code/README.md)
- PoC 阶段资产：[`../PoC/`](../PoC/)
