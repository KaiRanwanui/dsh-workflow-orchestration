# 阶段总览与归档索引

> 本目录按**阶段**归档 workflow-agent 的全部开发历史。每个阶段一个目录，内含阶段总结 README 与 `iterations/`（该阶段的迭代产物，**封版后不再修改**）。
>
> 当前状态见 `../status.md`；历史过程流水见 `progress-record.md`（冻结）。

## 阶段划分

| 阶段 | 目录 | 时间 | DSH 基线 | 交付 | 迭代数 |
|---|---|---|---|---|---|
| **阶段 0 · PoC 验证** | `phase-0-poc/` | ~2026-08 中旬 | 0.1.2-alpha 系列 | 原型验证结论（未发行） | — |
| **阶段 1 · 核心功能开发** | `phase-1-core/` | 2026-08-26 ~ 09-05 | 0.1.1-rc.2 | host v0.20.1 / client v0.9.0 | **30 迭代 + Iter-SUBA** |
| **阶段 2 · DSH 0.1.5-rc.2 迁移** | `phase-2-dsh-migration/` | 2026-09-13 | 0.1.1-rc.2 → 0.1.5-rc.2 | host v0.21.0 / client v0.9.1 | **5 个阶段任务**（Phase 0–4） |
| **阶段 3 · 构建链合并重构 + 发行工具** | `phase-3-build-chain/` | 2026-09-14 ~ 09-15 | 0.1.5-rc.2（不变） | host v0.22.0 / client v0.9.2 | **3 个子迭代**（3a/3b/3c）+ 缺陷 #7 修复 |

| **阶段 3 · 构建链合并重构 + 发行工具 + 单包化** | `phase-3-build-chain/` | 2026-09-14 ~ 09-15 | 0.1.5-rc.2（不变） | **host v0.23.0 单包** / client 退役 | **3a/3b/3c + 扩展 3e–3i + 缺陷 #7/#8 修复 + 实物验收** |

阶段 3 详情：方案 [`phase-3-build-chain/plan.md`](phase-3-build-chain/plan.md)、阶段总结 [`phase-3-build-chain/README.md`](phase-3-build-chain/README.md)、报告 [`phase-3-build-chain/iterations/iter-build-chain-report.md`](phase-3-build-chain/iterations/iter-build-chain-report.md)。

## 归档规则

1. **迭代状态只写在各迭代报告内**；阶段 README 只在阶段收尾时写一次，之后冻结。
2. 阶段内的迭代产物（报告 / 设计定稿 / 验证报告 / 探针存档）全部平铺在 `iterations/`，由阶段 README 建立索引。
3. 跨阶段的现行文档（设计 / 架构 / 需求 / 约定）不进本目录，留在 `plan/design`、`plan/architecture`、`plan/requirements`、`plan/development`。
4. 文件名保持历史原名（便于与 git 历史、既有引用对齐），不做重命名。

## 版本号速查（跨阶段）

| 迭代 | host | client | 主题 |
|---|---|---|---|
| Iter-5 | 0.3.0 | — | Host/Client 架构调整（webServer 路由取代 RPC） |
| Iter-10~12 | 0.4.0~0.5.0 | — | 实例目录/存储/前台界面 |
| Iter-16~19 | 0.8.0~0.11.0 | 0.5.0 | 状态机 / 绑定模型 / 路由 / 前后台联动 |
| Iter-21~23 | 0.11.6~0.12.0 | 0.5.6~0.6.0 | 前后台一致 / 子会话治理 / 权威停止 |
| Iter-24~26R | 0.13.0~0.16.0 | 0.6.1 | 预定义资产 / 数据流显性化 / items |
| Iter-27a~30 | 0.17.1~0.20.1 | 0.7.0~0.9.0 | 语义校验 / 编辑前台 / 实例管理 / DAG 分层 |
| **阶段 2** | **0.21.0** | **0.9.1** | DSH 0.1.5-rc.2 迁移（6 项缺陷修复） |

> 完整版本演进与单测基线见各迭代报告；阶段级基线见 `../status.md`。
