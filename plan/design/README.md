# plan/design/ —— 现行设计文档

> 存放**当前有效**的设计文档（数据模型、生命周期、通信机制、状态管理等）。
> PoC 期与阶段内的设计定稿已归档：架构选型原文见 [`../../PoC/solutions/`](../../PoC/solutions/)；各迭代设计定稿见 `../phases/phase-1-core/iterations/`。

## 现行文档

| 文件 | 主题 | 说明 |
|---|---|---|
| `workflow-schema-v1.md` | 数据模型 | Workflow Definition YAML Schema v1（任务/依赖/门禁/items/inputs/outputs 全字段） |
| `workflow-lifecycle-design.md` | 生命周期 | 实例生命周期：绑定模型、状态机、归档、删除权限 |
| `instance-creation-semantics.md` | 创建语义 | 实例创建语义与生命周期决策（create/begin/adopt/1:1 守卫） |
| `multi-instance-session-design.md` | 多实例 | 多实例管理 —— 复用 DSH Session 的技术方案 |
| `workflow-session-state-summary.md` | 状态一致性 | workflow 与 Session/subagent 状态管理的技术总结（权威停止、聚合守卫、同步语义） |
| `client-host-communication.md` | 通信 | Client↔Host 通信方案对比与定案（HTTP 轮询 `/wf/*`） |
| `definition-pipeline-discussion.md` | 定义管线 | 流程定义文件技术讨论纪要：定义读取/传递全过程与内核缺口 |
| `dsh-session-subagent-control-research.md` | 子会话控制 | DSH 会话与子会话控制机制：现象记录与探索规划（Iter-SUBA 起点） |

## 架构选型与决策（非本目录）

| 主题 | 位置 |
|---|---|
| 架构决策记录（ADR，**现行权威**） | [`../architecture/architecture-decisions.md`](../architecture/architecture-decisions.md) |
| PoC 期架构方案与对比（历史依据） | [`../../PoC/solutions/architecture-proposal.md`](../../PoC/solutions/architecture-proposal.md)、`architecture-comparison.md` |

## 维护规则

- 设计变更时**就地更新**本目录文档（并在文档头部注明修订日期）；被替代的历史结论移入 `phases/` 或 `PoC/`，避免同一主题两说。
- 重大决策同时记入 `../architecture/architecture-decisions.md`。
