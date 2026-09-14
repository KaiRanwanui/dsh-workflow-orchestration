# 阶段 2 — DSH 0.1.5-rc.2 迁移

- **时间**：2026-09-13（单日完成，5 个阶段任务）
- **DSH 基线**：`0.1.1-rc.2` → **`0.1.5-rc.2`**（全新安装；旧会话/插件/数据按用户决策全部丢弃）
- **交付**：`@workflow-agent/workflow-host` **v0.21.0** · `@workflow-agent/client-ui-monitor` **v0.9.1**
- **测试基线**：563 单测全绿 + GUI 行为回归通过（四键真实感知 / A1 停止链路 / demo 端到端 ×2）
- **状态**：✅ 已完成并冻结（本 README 封版；细节见各文档）

## 阶段目标

把已在 0.1.1-rc.2 上稳定运行的 workflow-agent 迁移到 DSH 0.1.5-rc.2：适配破坏性变更（APIProxy 退役、会话 V3、默认工具调整等），在全新环境重挂载，并做行为级回归。

## 5 个阶段任务（对应 Phase 0–4）

| # | 任务 | 内容 | 产物 |
|---|---|---|---|
| 1 | **影响评估与迁移计划** | 用 0.1.5-rc.2 实包逐项核对（主包 + 10 卫星包）；列出破坏性变更 B1–B8、§3.3 七项断裂点映射（before/after）、四阶段计划 | `iterations/dsh-0.1.5-rc-upgrade-impact-and-migration-plan.md`（另见前作 `alpha-0.1.2-migration-impact.md`） |
| 2 | **Phase 2 · 代码适配** | 七项映射落地（inject→sessionController、prompt×4 新签名 + delivery、listChildren/interruptByParent、probe sendMessage）；构建链同步；563 单测全绿；全新环境重挂载 | `iterations/iter-migration-015rc2-report.md` |
| 3 | **Phase 3 · 行为回归** | 面板四键「agent 真实感知」、A1 停止链路、demo 端到端、客户端面板、孤儿回收；**发现并修复 6 项迁移缺陷**（含 2 项架构修订） | `iterations/iter-migration-015rc2-verification-report.md` |
| 4 | **缺陷修复轮**（含在 Phase 3 内，多轮） | persona `prefix` schema、client projection 门控、prompt signal 必填、agents/activity 判活失效、**面板 Stop 改路由层权威直停**、重启后 `hasState` 磁盘水合 | 同上「缺陷表」 |
| 5 | **Phase 4 · 收尾** | 版本锁定矩阵落档、迁移计划状态/勾选闭合、`build-preset.js` 废弃化、已知限制归档 | 迁移计划 Phase 4 + 验证报告「版本锁定」「已知限制」节 |

## 关键结论（迁移后与 0.1.1 的语义差异）

| 主题 | 0.1.1-rc.2 | 0.1.5-rc.2（实证） |
|---|---|---|
| 远程调用 | `apiProxy`（已退役） | `sessionController` / `subagents` 服务 |
| `sessionController.prompt` | — | `requestId` 拍平；**signal 必填**（实包首行 `throwIfAborted()`） |
| 子代理判活 | `agents.get(child).status` | **子会话不进 agents store**；须用 `sessions.get(child)`（resident 语义） |
| 注入通道语义 | steer 可当场打断回合 | **不再保证即时性**（排队/可被移除）→ 停止类操作必须走直接调用 |
| 面板 Stop | steer 注入 → agent 调 `workflow_stop` | **路由层权威直停**：`engine.stop` + `sessionController.cancel` 原生级联（与 UI 停止同源） |
| 会话 preset 读取（Client） | `byId[id].agentPreset` | `byId[id].projectionValues.agentPreset` |
| persona 配置 | `config.text` | `config.prefix`（必填） |

## 归档索引

| 文档 | 性质 |
|---|---|
| `iterations/dsh-0.1.5-rc-upgrade-impact-and-migration-plan.md` | 迁移计划（Phase 0–4，含 §3.3 七项映射与执行期实证修正标注） |
| `iterations/alpha-0.1.2-migration-impact.md` | 前作：0.1.2-alpha 期反推分析（已被上者接替，保留作历史） |
| `iterations/iter-migration-015rc2-report.md` | Phase 2 适配报告（含构建链隐患修复、重挂载记录） |
| `iterations/iter-migration-015rc2-verification-report.md` | Phase 3 回归 + 6 项缺陷修复 + 版本锁定 + 已知限制 |
| `iterations/session-handover-dsh-migration.md` | 迁移启动时的交接 Prompt（新 Session 开场用，一次性文档，留档） |

## 阶段遗留

见 `../../status.md` §4「已知限制」。其中「构建链合并重构」已列为**阶段 3**。
