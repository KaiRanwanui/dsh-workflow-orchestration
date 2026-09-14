# 阶段 1 — 核心功能开发（Iter-1 ~ Iter-30 + Iter-SUBA）

- **时间**：2026-08-26 ~ 2026-09-05
- **DSH 基线**：`0.1.1-rc.2`（web profile + systemd `dsh.service`；期间评估过 0.1.2-alpha，未升级）
- **交付**：`@workflow-agent/workflow-host` **v0.20.1** · `@workflow-agent/client-ui-monitor` **v0.9.0**
- **测试基线**：563 单测全绿（收尾时）
- **状态**：✅ 已完成并冻结（本 README 封版；迭代状态见各报告）

## 阶段目标

在 DSH 上把「通用工作流编排」从 PoC 推进到可用产品：定义（YAML schema）→ 编排（agent 驱动 + 子代理隔离）→ 执行（状态机 / 并发 / 循环）→ 呈现（GUI DAG 面板 + 四键控制）→ 治理（绑定 / 生命周期 / 归档 / 语义校验）。

## 交付能力清单（阶段结果）

| 能力域 | 交付内容 |
|---|---|
| **定义** | YAML schema v1（串行/并发/循环/分支/门禁）；语义校验（错误码硬拦 + 警告）；实例编辑前台（双栏编辑器 + 权限矩阵） |
| **编排** | Agent Preset（persona + `workflow_*` 工具 + subagent 委托）；主从聚合控制（P1-P4）；权威停止（A1 事件 + A2 轮询 + A3 提示条） |
| **执行** | 引擎状态机（CREATED/PENDING/RUNNING/STOPPED/COMPLETED/FAILED）；并发组（`max-concurrency`）；循环/并发节点展开；门禁任务 |
| **数据流** | inputs/outputs 绝对路径显性化；目录变量两阶段注入；items 四格式提取 + 运行时展开（`_loopItem`） |
| **呈现** | `conversation.view` DAG 面板（分层布局 + 直角/贝塞尔路由）；四键（Start/Stop/Resume/Reset）；实例管理子页签（归档/下载/删除） |
| **资产** | 预定义目录 `~/.dsh/workflow-agent/`（4 模板 + 7 技能 + samples/docs，启动物化）；模板子目录 1:1 复制 |
| **存储** | 实例目录 `.workflow-agent/instances/<id>/`（state.json / instance.yaml / metadata.json / output / logs）；归档 + zip 下载 |

## 迭代索引

### 主干迭代（Iter-1 ~ Iter-30）

| 迭代 | 主题 | host | client | 报告 |
|---|---|---|---|---|
| Iter-1 | Host 插件：引擎基础 | — | — | `iterations/iter1-report.md` |
| Iter-2 | Agent Preset：串行编排 | — | — | `iterations/iter2-report.md` |
| Iter-3 | Client 监控面板 + 闪烁修复 | — | — | `iterations/iter3-report.md` |
| Iter-4 | 循环 + 循环展开（无独立报告，见 development-plan §Iter-4） | — | — | — |
| Iter-5 | Host/Client 架构调整（webServer 路由取代 RPC） | 0.3.0 | — | `iterations/iter5-report.md` |
| Iter-6 | 循环错误处理 + 日志清理 | — | — | `iterations/iter6-report.md` |
| Iter-7 | 并发执行引擎 + DAG 并发组可视化 | — | — | `iterations/iter7-report.md` |
| Iter-8 | 并发语义完善 + concurrent 节点 + DAG 增强 | — | — | `iterations/iter8-report.md` |
| Iter-9 | 多实例技术验证（DSH Session 探针） | — | — | `iterations/iter9-report.md`（+ `iter9-probe-results.json`） |
| Iter-10 | 实例目录与存储（多实例后台） | 0.4.0 | — | `iterations/iter10-report.md` |
| Iter-11 | 实例操控工具（后台） | — | — | `iterations/iter11-report.md` |
| Iter-12 | 前台实例界面（DAG 跟随 session + 实例列表） | 0.5.0 | — | `iterations/iter12-report.md` |
| Iter-13 | 面板「新建实例」按钮 + 模板库 v1 | — | — | `iterations/iter13-report.md` |
| Iter-14 | 消息注入技术穿刺 | — | — | `iterations/iter14-report.md` |
| Iter-15 | 面板控制 start/stop/reset | — | — | `iterations/iter15-report.md` |
| Iter-16 | 运行状态机（Host） | 0.8.0 | — | `iterations/iter16-report.md` |
| Iter-17 | 绑定模型 + 完整性（Host） | 0.9.0 | — | `iterations/iter17-report.md` |
| Iter-18 | 流程控制工具 + 路由 + 孤儿回收 | — | — | `iterations/iter18-report.md` |
| Iter-19 | WebUI↔workflow 配合调优（前后台联动） | 0.11.0 | 0.5.0 | `iterations/iter19-report.md`（+ 验证报告 ×2） |
| Iter-20 | 前后台状态一致（预设门控 + BROKEN 展示） | — | — | 验证报告 ×2（v3/v4） |
| Iter-21 | 前后台一致·v4 手测闭环 + Resume 提前 | 0.11.6 | 0.5.6 | `iterations/iter21-report.md`（+ 验证报告 ×2） |
| Iter-22 | S1 状态同步语义 + S3 孤儿采用池 + S4 重置语义 | 0.11.16 | 0.5.12 | `iterations/iter22-report.md`（+ 验证报告） |
| Iter-23 | 方向 A：手工停 DSH 会话 = 权威停止（A1/A2/A3） | 0.12.0 | 0.6.0 | `iterations/iter23-report.md`（+ 探针报告 + 验证报告） |
| **Iter-SUBA** | DSH 子会话可控性探索 + 主从聚合控制 P1-P4（研究迭代，插在 Iter-22/23 之间） | 0.11.17 | — | `iterations/iter-suba-report.md`（+ 验证报告） |
| Iter-24 | 预定义目录与安装布局（`~/.dsh/workflow-agent/`） | 0.13.0 | 0.6.1 | `iterations/iter24-report.md`（+ 设计定稿 + fs 探针） |
| Iter-25 | 数据流显性化（参数传递地基） | 0.14.0 | 0.6.1 | `iterations/iter25-report.md`（+ 设计定稿） |
| Iter-26 | items 结构化提取（四格式） | 0.15.0 | — | `iterations/iter26-report.md`（+ 设计定稿） |
| Iter-26R | 运行时 items 展开（`_loopItem` + 占位节点） | 0.16.0 | — | `iterations/iter26r-report.md`（+ 设计定稿） |
| Iter-27a | 预定义目录结构与实例化（templates 子目录自包含 + 1:1 复制） | 0.17.1 | — | `iterations/iter27a-report.md`（+ 拆分设计稿） |
| Iter-27b | 语义校验（错误级清单 + 关口硬拦 + `workflow_validate`） | 0.18.0 | — | `iterations/iter27b-report.md` |
| Iter-28 | 实例编辑前台（编辑器 + 权限矩阵 + persona 单源化） | 0.19.0 | 0.7.0 | `iterations/iter28-report.md` |
| Iter-29 | 实例管理子页签 + 归档/下载/删除（node:fs 直删 + zip writer） | 0.20.0 | 0.8.0 | `iterations/iter29-report.md` |
| Iter-30 | DAG 分层布局算法 + GUI 附加修复 | 0.20.1 | 0.9.0 | `iterations/iter30-report.md` |

### 附带产物索引（设计定稿 / 验证报告 / 探针）

| 类型 | 文件 | 对应迭代 |
|---|---|---|
| 设计定稿 | `iterations/iter24-design.md` | Iter-24 预定义目录与安装布局 |
| 设计定稿 | `iterations/iter25-design.md` | Iter-25 数据流显性化 |
| 设计定稿 | `iterations/iter26-design.md` | Iter-26 items 结构化提取 |
| 设计定稿 | `iterations/iter26r-design.md` | Iter-26R 运行时 items 展开 |
| 设计定稿 | `iterations/iter27-design.md` | Iter-27 语义校验（拆分版：27a 结构 / 27b 校验） |
| 探针 | `iterations/iter9-probe-results.json` | Iter-9 DSH Session 探针原始数据 |
| 探针 | `iterations/iter23-probe-report.md` | Iter-23 前置探针：手工停会话的可读停止信号 |
| 探针 | `iterations/iter24-probe-fs.md` | Iter-24 步骤 0：Host fs 写 `~/.dsh` 能力验证 |
| 验证报告 | `iterations/iter19-verification-report.md`、`iter19-verification-report-v2.md` | Iter-19 前后台配合（v2 含 A1/A2 修复） |
| 验证报告 | `iterations/iter20-verification-report-v3.md`、`iter20-verification-report-v4.md` | Iter-20 前后台状态一致（S5 预设门控 + BROKEN 展示） |
| 验证报告 | `iterations/iter21-verification-report.md`、`iter21-verification-report-v2.md` | Iter-21 Stop/Resume 经 Session 指令 + DAG 闪烁 |
| 验证报告 | `iterations/iter22-verification-report.md` | Iter-22 S1/S3/S4 + reset 修复 |
| 验证报告 | `iterations/iter23-verification-report.md` | Iter-23 权威停止（方向 A） |
| 验证报告 | `iterations/iter-suba-verification-report.md` | Iter-SUBA 阶段 2 主从聚合控制 P1–P4 |

### 阶段级文档

| 文档 | 说明 |
|---|---|
| `development-plan.md` | 阶段 1 迭代详案（818 行，含设计原则 / 迭代全景 / 各迭代详述；**状态字段为历史快照，勿据此判断现状**） |
| `iteration-replan-draft.md` | Iter-24~30 重排草案（需求定稿后的规划参考，历史） |
| `client-rpc-research.md` | Iter-5 期 Client↔Host RPC 链路官方源码研究（被 webServer 路由方案取代后留档） |

## 关键决策与教训（指向现行文档）

| 主题 | 现行权威 |
|---|---|
| 架构选型（Agent Preset + Agent 驱动编排） | `plan/architecture/architecture-decisions.md`（PoC 期方案原文见 `PoC/solutions/`） |
| 生命周期 / 绑定模型 / 归档语义 | `plan/design/workflow-lifecycle-design.md`、`instance-creation-semantics.md` |
| 数据模型（YAML schema v1） | `plan/design/workflow-schema-v1.md` |
| workflow ↔ Session/subagent 状态管理 | `plan/design/workflow-session-state-summary.md` |
| Client↔Host 通信（HTTP 轮询定案） | `plan/design/client-host-communication.md` |
| 协作纪律（差分验证 / 先设计后开发 / 上下文压力处理） | `plan/development/team-conventions.md` |

**阶段教训（已沉淀为约定）**：
1. 一次只改一个维度（Iter-3 五处并改致空白，排查成本 ×3）；
2. 改源模块后必须同步内联副本（Iter-8/24 因漏同步翻车）——**该纪律在阶段 3 将被构建链重构消除**；
3. 面板控制必须验证「agent 真实感知」而非仅看实例态（Iter-21 核心教训）；
4. 探针先行：环境边界（fs 写 ~/.dsh、沙箱、事件 payload 形态）先用探针取证再写正式代码。

## 阶段遗留（已转入后续阶段处理）

| 遗留 | 去向 |
|---|---|
| 节点详情面板 / 交互增强 / 主题适配（原 Iter-31 backlog） | 阶段 3 之后的功能迭代队列 |
| 构建链同步纪律 + mjs 中间产物 + `lib` 导出面缺陷 | **阶段 3（构建链合并重构）** |
| 门禁 subagent 分支真实链路复跑 | 阶段 3 或后续迭代 |
