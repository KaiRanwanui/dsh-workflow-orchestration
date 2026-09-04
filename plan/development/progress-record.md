# 工作进展记录

> **职责**：已完成各迭代的**一句话总结**与报告索引。详情一律读对应迭代报告；
> 迭代队列/验收标准见 `development-plan.md`；架构决策见
> `../architecture/architecture-decisions.md`。

## 当前状态（截至 2026-09-04）

- 最新关闭：**Iter-28 实例编辑前台 + persona 单源化**（host v0.19.0 / client v0.7.0，529 单测，git `534992d`）
- 下一迭代：**Iter-29** 实例管理子页签+归档/下载/删除（独立可提前）；Iter-30 DAG 美化排队
- 基线：DSH `0.1.1-rc.2`（WSL2，web 3080 + headless profile；版本迁移见文末备注）

---

## 一、基础引擎与编排可视化（Iter-1~8，2026-08-26 ~ 08-27）

- **前置**：项目启动+需求对齐+Schema 定稿；v1.1 Schema 增强（命名式 inputs）。
- **Iter-1 Host 插件—引擎基础**（08-26）：Cordis npm 形态 Host 插件，YAML 解析+引擎核心。报告 `iter1-report.md`。
- **Iter-2 Agent Preset—串行编排**（08-26）：workflow-orchestrator preset（persona+workflow_begin/status 工具+subagent 委托）。报告 `iter2-report.md`。
- **Iter-3 Client 监控面板**（08-26）：动态插件 DAG SVG 轮询面板（`wff-9/pkg-14`）。报告 `iter3-report.md`。
- **Flicker 修复**（08-26，Iter-3 补丁）：组件 state 提升模块级变量，根治 remount 闪烁——此后成为 client.js 固定纪律。见 `iter3-report.md` §4.4。
- **Iter-4 循环+循环展开**（08-26）：`expandLoopTasks` begin 期展开 N 迭代（唯一 ID/串行依赖链/独立 gate）+ 循环组 DAG 可视化；41 单测。无独立报告（交付并入 development-plan 记录）。
- **架构调整**：Host 插件迁移 desktop（Windows Electron）profile；Client RPC 链路方案定稿=HTTP 轮询（决策 `../architecture/architecture-decisions.md` §5）。
- **Iter-5 Host/Client 架构调整**（08-27）：webServer 路由 `/wf/*` + Client fetch 轮询替代 RPC。报告 `iter5-report.md`。
- **WSL2 迁移**（08-27）：web(3080)+headless profile、link: 依赖接入；修硬编码路径+lossless JSON。见 `iter6-report.md` 前记录。
- **Iter-6 循环错误处理**（08-27）：`_onError` break/continue+hydrate 循环元数据；50 单测。报告 `iter6-report.md`。
- **Iter-7 并发引擎**（08-27）：`getRunnableTasks`+工作流级 max-concurrency+DAG 并发组；59 单测。报告 `iter7-report.md`。
- **Iter-8 concurrent 节点**（08-27）：组级并发最严格语义+concurrent 展开（迭代无依赖）+DAG ⚡ 节点；65 单测。报告 `iter8-report.md`。

## 二、多实例与生命周期（Iter-9~20，2026-08-28 ~ 08-31）

- **Iter-9 多实例技术验证**（08-28~29）：12 项 DSH Session 探针全过（动态插件用后 undefine），确认实例=会话 cwd 下 `.workflow-agent/instances/` 布局可行。报告 `iter9-report.md`（探针数据 `iter9-probe-results.json`）。
- **Iter-10 实例目录与存储**（08-29）：instance-store 注册表+实例目录布局+惰性恢复；79 单测，host v0.4.0。报告 `iter10-report.md`。
- **Iter-11 实例操控工具**（08-29）：workflow_list/create/start/stop/reset；93 单测，host v0.5.0。报告 `iter11-report.md`。
- **Iter-12 前台实例界面**（08-29）：DAG 跟随 session cwd+实例切换+/wf/list，client v0.2.0。报告 `iter12-report.md`。
- **Iter-13 面板创建+模板库 v1**（08-29~30）：POST /wf/create+内置模板+表单 overlay；修 ESM→CommonJS 等部署问题；104 单测，host v0.6.0/client v0.3.0。报告 `iter13-report.md`。
- **Iter-14 消息注入穿刺**（08-30）：subagents.followup 验证（约束=目标须为 parent 子会话）。报告 `iter14-report.md`。
- **Iter-15 面板控制 start/stop/reset**（08-30）：控制路由+工具条按钮+sessions.prompt 注入（rpcId+payload 格式确认）；host v0.7.0/client v0.4.0。报告 `iter15-report.md`。
- **Iter-16 运行状态机**（08-30）：STOPPED 语义+start/stop/resume/reset 引擎动作+非法转移抛错；113 单测，host v0.8.0。报告 `iter16-report.md`。
- **Iter-17 绑定模型+完整性**（08-30）：工作区骨架物化+create-bind/adopt 1:1 守卫+UNBOUND/BOUND/DONE/BROKEN 派生；125 单测，host v0.9.0。报告 `iter17-report.md`。
- **Iter-18 流程控制+孤儿回收**（08-30）：workflow_adopt/resume+reset 归档备份+孤儿惰性扫描回收；137 单测，host v0.10.0。报告 `iter18-report.md`。
- **Iter-19 WebUI↔workflow 联动**（08-30）：create 即绑定+begin 即 RUNNING+Session 启停同步；手测暴露阻塞后追加 createBind CONFLICT 自愈；host v0.11.x/client v0.5.x。报告 `iter19-report.md`（验证 `iter19-verification-report*.md`）。
- **Iter-20 前后台状态一致**（08-30~31）：R1~R4 修复+forSession 根因修复+预设门控（非编排会话不显示面板）+内置模板可执行化+v4 手测；host v0.11.5/client v0.5.4。验证 `iter20-verification-report-v4.md`（无独立主报告，问题清单归 Iter-21）。

## 三、面板控制定稿与子会话治理（Iter-21 ~ Iter-23，2026-08-30 ~ 09-01）

- **Iter-21 面板控制定稿**（08-30）：v4 手测问题闭环（R1~R5）+Client 稳定组件热修（v0.5.6）+**injectSessionCmd 统一注入**（stop=steer 打断/start/resume=queue）+控制中间态 wfPendingCmd+死锁修复（stop 重置 RUNNING→PENDING）；host v0.11.12/client v0.5.10，160 单测。报告 `iter21-report.md`（验证 `iter21-verification-report*.md`）。
- **Iter-22 修复轮**（08-31）：S1 idle→stop 守卫+删自动恢复、S3 孤儿自动进采用池、S4 reset 注入"已重置"+**verify-client-bundle 求值级验证纪律**（部署事故产物）、B1 误停根因=回合结束即 idle（止血进 persona，聚合守卫设计转出）；179 单测。报告 `iter22-report.md`（验证 `iter22-verification-report.md`）。
- **Iter-SUBA 主/子会话控制**（08-31~09-01）：源码侦察+四场景实验摸清 subagents.{list,interrupt,prompt} 全链；实现 P1 聚合守卫/P2 stopReason 定向恢复/P3 Stop 级联停止/P4 迟到回报治理——**闭环不变式"子在跑⇔wf RUNNING→Start 被拒→永不双跑"**；193 单测，host v0.11.17，手测 T1-T7 关闭。报告 `iter-suba-report.md`（验证 `iter-suba-verification-report.md`）。
- **Iter-23 用户停止权威化（方向 A）**（09-01）：前置探针证实 Case R 可根治/Case I 原理性不可检测（`iter23-probe-report.md`）；session/event tap+log 尾扫双路判定 user-stop→权威停止+级联 interrupt+stopHint 面板提示；220→221 单测，host v0.12.0/client v0.6.0。报告 `iter23-report.md`（验证 `iter23-verification-report.md`）。

## 四、需求定稿与预定义资产（2026-09-02 ~ 09-03）

- **需求澄清+迭代重排**（09-02）：流程定义技术讨论（发现工具返回从未携带 inputs/outputs 的契约漂移）→用户 25 条需求逐条澄清定稿（`../requirements/工作流数据管理需求.md`）→迭代队列重排 **Iter-24~30**（`iteration-replan-draft.md` 批准版）。
- **Iter-24 预定义目录与安装布局**（09-01~02）：目录=`~/.dsh/workflow-agent/`+启动物化（模板 2+技能 5）+两级解析链 workspace 优先+模板下拉切源；250 单测，host v0.13.0/client v0.6.1；**新纪律=重启 dsh 由用户执行**。报告 `iter24-report.md`（设计 `iter24-design.md`、探针 `iter24-probe-fs.md`）。
- **Iter-25 数据流显性化**（09-02）：begin/start/status 返回 inputs/outputs 绝对路径+skillDir 并落盘、目录变量两阶段注入、门禁拿 inputs、processor 可选；286 单测，host v0.14.0。报告 `iter25-report.md`。
- **Iter-26 items 结构化提取**（09-02）：items-from 四格式提取（markdown 表格/列表/JSON/YAML）。报告 `iter26-report.md`。
- **Iter-26R 运行时 items 展开**（09-03）：items 文件缺省时占位节点+上游完成后引擎自动展开（面板虚线琥珀组框）；387 单测，host v0.16.0。报告 `iter26r-report.md`。
- **Iter-27a 预定义目录结构与实例化**（09-03）：templates 子目录自包含+create/begin 1:1 复制（presetCopy）+静态 items 解析链实例目录→defDir→两级链+共享模块 workflow-paths.js；后补丁 items-from/inputs 互斥（条目值经 `_loopItem` 随派发传入）；421 单测，host v0.17.1。报告 `iter27a-report.md`（设计 `iter27-design.md` 拆分版）。

## 五、语义校验与编辑前台（Iter-27b ~ Iter-28，2026-09-04）

- **Iter-27b 语义校验**（09-04）：workflow-validate.js 校验引擎（8 错误码+2 警告）+create/begin 硬拦截（零副作用）+start/resume 实时闸门+reset 回传+workflow_validate 只读工具+/wf/create 同款关口；**验收修正安全红线**=被拦后 LLM 只许转告清单+停止（hint 权威提示）；485 单测，host v0.18.0。报告 `iter27b-report.md`。
- **Iter-28 实例编辑前台**（09-04）：workflow-edit.js（稳定序列化/权限矩阵/白名单补丁）+/wf/skills·instance-yaml·validate-instance 路由（保存=校验先于落盘+注释头保留）+EditorPanel 双栏编辑器（DAG 下方可折叠；RUNNING 全禁用+外部 stage 即时刷新）+创建对话框 params 键值行/warnings 面板（Iter-25 遗留清账）；**验收修正**含 params 进 subagent 派发 prompt（workflow_status 快照挂 meta.params+persona 加行）；**persona 单源化 A 方案**（rc2 dsh-persona 仅内联 text=系统限制记档 `../architecture/architecture-decisions.md` §8；system-prompt.md 唯一源+sync-persona.js 注入）；529 单测，host v0.19.0/client v0.7.0。报告 `iter28-report.md`。

---

## 迭代报告索引

`plan/development/` 下：`iter1/2/3/5/6/7/8/9/10/11/12/13/14/15/16/17/18/19/21/22/23/24/25/26/26r/27a/27b/28-report.md` 与 `iter-suba-report.md`；验证报告同名 `*-verification-report*.md`；探针/设计文档在各条目内标注。Iter-4 无独立报告。

---

## 团队约定

行为准则见 `plan/development/team-conventions.md`。

---

## 备注：DSH 版本迁移（待规划）

- **状态**：待规划。项目仍以 DSH `0.1.1-rc.2`（`latest` 稳定版）为基线迭代，暂不迁移。
- **触发背景**：`0.1.2-alpha.2` 已确认**退役 APIProxy**，改用 Remote/Controller（Typert）架构，属破坏性变更。
- **影响分析与迁移要点**：见 `plan/development/alpha-0.1.2-migration-impact.md`。
- **计划**：本项不并入迭代节奏；待 DSH `0.1.2` 出稳定版、且时机成熟时，再单独立项规划（先探针确认 `ctx.get('sessionController')` 签名 → 跑通 rc2 基线回归 → 迁移 inject + 两处 prompt 调用 → 回归面板 4 键）。
