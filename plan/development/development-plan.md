# Development Plan — workflow-agent

## Document Control

| Field | Value |
|-------|-------|
| Project Name | workflow-agent |
| Version | 0.4 |
| Status | Active |
| 基准 | 1 人天/迭代（人类开发者） |

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| **≤ 1 人天** | 每个迭代工作量不超过一个人类开发者的 1 个工作日 |
| **完整前后台可验证** | 每个迭代结束时都有可演示的完整特性 |
| **承上启下** | 每个迭代产出是下一个迭代的输入，逐步增量 |
| **PoC 为起点** | PoC 已验证的能力（管道、两层协作模式）直接利用，不重复造轮子 |

---

## 2. 迭代全景

```
已完成: Iter-1(引擎) → Iter-2(编排) → Iter-3(监控) → Iter-4(循环) → Iter-5(架构) → Iter-6(错误处理) → Iter-7(并发引擎) → Iter-8(并发语义完善) → Iter-9(多实例技术验证) → Iter-10(实例目录与存储) → Iter-11(实例操控工具) → Iter-12(前台实例界面) → Iter-13(面板创建按钮+模板库v1) → Iter-14(消息注入技术穿刺) → Iter-15(面板控制) → Iter-16(运行状态机) → Iter-17(绑定模型+完整性) → Iter-18(控制工具+路由+孤儿回收) → Iter-19(WebUI↔workflow 配合调优) → Iter-20(前后台状态一致 + S5 预设门控/BROKEN 展示 + 内置默认模板可执行；v4 手测 14 通过/2 N/A/5 问题归 Iter-21)
已完成: …（同上）… → Iter-22 ✅ → **Iter-SUBA ✅ 完成（2026-09-02 关闭）**
已完成: …（同上）… → Iter-22 ✅ → Iter-SUBA ✅ → **Iter-23 ✅（2026-09-02 关闭：方向 A 手工停会话=权威停止，host v0.12.0/client v0.6.0，git 39ee656→15108af 已推送，总结 iter23-report.md）**
已完成: …（同上）… → Iter-23 ✅ → **Iter-24 ✅（2026-09-02 关闭：预定义目录与安装布局 ~/.dsh/workflow-agent/，物化模板2+技能5+两级解析链+模板下拉切源，host v0.13.0/client v0.6.1，250 单测，用户 GUI 全链路验证通过，git 7896bc3→8c65d10 已推送，总结 iter24-report.md）**
已完成: …（同上）… → Iter-24 ✅ → **Iter-25 ✅（2026-09-02 关闭：数据流显性化——begin/start/status 返回 inputs/outputs 绝对路径+skillDir 并落盘、目录变量两阶段注入、门禁拿 inputs、processor 可选（D4 创建关口校验不拦截），host v0.14.0/client v0.6.1，286 单测，用户 GUI 验证通过（数据流传递+运行时护栏），git 53f022d 已推送，总结 iter25-report.md；遗留=warnings 面板展示→Iter-28、缺 processor 错误级校验→Iter-27）**
已完成: …（同上）… → Iter-26 ✅ → **Iter-26R ✅（2026-09-03 关闭：运行时 items 展开，host v0.16.0，387 单测，GUI 验收通过；报告 iter26r-report.md，设计 iter26r-design.md）**
已完成: …（同上）… → Iter-26R ✅ → **Iter-27a ✅（2026-09-03 关闭：预定义目录结构与实例化——templates 按工作流分子目录自包含（实例级同构镜像 inputs/）、create/begin 1:1 复制静态文件（presetCopy）、items 解析链实例目录→defDir→两级链、扫描下钻+同名子目录赢、workflow-paths.js 共享模块（isAbsoluteishPath 前移）+后补丁 items-from/inputs 互斥（条目值经 _loopItem 随派发传入、新建 item-processor 技能、模板 7 处重复 inputs 清零），host v0.17.1，421 单测，用户 GUI 验收通过（四内建模板开箱即用+补丁复验），git 300923d→dd48ff0 已推送，报告 iter27a-report.md，设计 iter27-design.md（拆分版））**
已完成: …（同上）… → Iter-27a ✅ → **Iter-27b ✅（2026-09-04 关闭：语义校验——workflow-validate.js 校验引擎（8 错误码+2 警告：依赖环/缺 processor/缺 gate checker/技能或输入文件缺失/items 缺失或解析失败/preset 禁字面绝对+重复声明警告），create/begin 硬拦截（拒绝零副作用不建实例）、start/resume 实时闸门（重读 instance.yaml 防创建后退化）、reset 回传不拦、workflow_validate 只读工具（实例/定义两形态+preset 锚定）、/wf/create 同款关口、拒绝响应 hint=验收修正安全红线（被拦后 LLM 只许转告清单+停止，严禁自行搜索/替换技能或输入文件），host v0.18.0，485 单测，用户 GUI 验收通过（拦错/修复放行/删技能拦停含修正复验/零误报），git 585c5b1 已推送，报告 iter27b-report.md）**
已完成: …（同上）… → Iter-27b ✅ → **Iter-28 ✅（2026-09-04 关闭：实例编辑前台——DAG 下方可折叠双栏编辑器（任务列表+表单：技能下拉预定义/工作区合并同名顶替、inputs/outputs、重试/并发）+实例级 name/maxConcurrency/params 只读区、workflow-edit.js 共享模块（稳定序列化/权限矩阵/白名单补丁）+ /wf/skills·instance-yaml·validate-instance 路由（保存=Iter-27b 校验先于落盘+注释头保留）、创建对话框 params 键值行+成功呈现视图+warnings 面板（25 遗留清）、RUNNING 全禁用+外部 stage 即时刷新，host v0.19.0/client v0.7.0，529 单测，两轮 GUI 验收修正（inputs 添加态/workflow_status 挂 params/persona 内联双写踩坑→**persona 单源化 A 方案**：system-prompt.md 唯一源+sync-persona.js 构建期注入，rc2 内联限制记档 architecture-decisions §8），params 进 subagent 首条消息复验通过，git bc54fdf 已推送，报告 iter28-report.md）**
已完成: …（同上）… → Iter-27b ✅ → Iter-28 ✅ → Iter-29 ✅ → **Iter-30 ✅（2026-09-05 关闭：DAG 分层布局——最长路径分层+重心排序+非交叉锚点分配+沟道走廊直角路由+合并点正交/分支扇出贝塞尔；原型 PoC 多轮打磨后机械移植进 client.js；附加修复 4 项（创建弹窗模板路径+校验错误清单/哨兵任务渲染/延迟展开命名剥离后缀/下拉配色）；host v0.20.1/client v0.9.0，563 单测，用户 GUI 验收通过，git 已推送，报告 iter30-report.md）**
 当前:   **Iter-31 节点详情面板 + 交互增强 + 主题适配（规划中）**。
```

| 迭代 | 名称 | 核心交付 | 验证方式 | 依赖 |
|------|------|---------|---------|------|
| **1** | Host 插件 — 引擎基础 | 解析器 + 状态管理 + Tool/RPC | `workflow_begin` 返回正确结构 | PoC |
| **2** | Agent Preset — 串行编排 | 编排 Agent：串行执行 + Gate + 重试 | 2-Task 串行工作流端到端 | Iter-1 |
| **3** | Client 插件 — 监控面板 | conversation.view Tab + N 节点 DAG | 浏览器实时显示执行状态 | Iter-1,2 |
| **4** | 循环 + 循环展开 | Loop Task 解析、展开、串行迭代 | 循环 3 次的工作流执行 | ✅ **完成** |
| **5** | **Host/Client 架构调整** | **Client RPC 链路修复：webServer HTTP 路由 + fetch 轮询，废弃 harness RPC** | **DAG 面板经 HTTP 显示工作流状态** | ✅ **完成** |
| **6** | **循环错误处理 + DAG 布局优化** | **onError(break/continue) + >4 items 折叠/展开** | **中断/继续 + 折叠布局验证** | **Iter-5** |
| **7** | 并发执行引擎 | max-concurrency 生效，无依赖 Task 并行 | 并行 Task + 并发循环迭代 | ✅ **完成** |
| **8** | **并发语义完善 + concurrent 节点 + DAG 增强** | **组级/工作流级 max 取最严格；concurrent Task 类型；启动/结束节点；依赖同前驱节点垂直排列** | **concurrent 并发 + start/end 节点 + 垂直排列** | ✅ **完成** |
| **9** | 多实例技术验证（DSH Session 探索） | 验证插件内创建/监听 session、session cwd 定位实例目录 | session 探针 + 技术验证报告 | ✅ **完成** |
| **10** | 实例目录与存储（后台） | 实例目录结构（instance.yaml/state.json/metadata.json/output/logs）+ 按实例读写 state | 多实例独立 state.json | ✅ **完成** |
| **11** | 实例操控工具（后台） | workflow_create/start/stop/reset/list | 多实例全流程操作验证 | ✅ **完成** |
| **12** | 前台实例管理界面 | 实例列表 + 跟随 session 切换 DAG（useSessions+sessionId+cwd） | 切 session → DAG 跟随 | ✅ **完成**（待部署验证） |
| **13** | 面板"新建 workflow 实例"按钮 | POST /wf/create + Client 表单 + 模板库 v1（内置模板 + `<cwd>/templates/` 扫描；**只 create 不 start**，语义见 instance-creation-semantics.md §6.3） | 面板选模板建实例 → session 启动编排 | ✅ **完成** |
| **14** | 消息注入技术穿刺 | 验证插件向指定 session 注入指令（动态插件探针，先例 Iter-9；按通用指令消息形态验证） | go/no-go 结论 + API 形态报告 | ✅ **完成**（GO，subagents.followup API） |
| **15** | 面板控制（start/stop/继续） | 走 Iter-14 通道驱动编排 session；"继续"=hydrate 续跑 | 面板启动 → DAG 展示执行 → 面板停止/继续 | ✅ **完成**（直接操作实例状态，不依赖 followup） |
| **16** | 运行状态机（Host） | STAGE 补 STOPPED；engine 补 stop(保进度)/begin/resume(续跑)/active | 单测：PENDING→RUNNING→STOPPED→resume→RUNNING(保DONE)；RUNNING 先 stop 再 reset | ✅ **完成** |
| **17** | 绑定模型 + 完整性（Host） | 工作区骨架物化；create/adopt-bind；1:1 守卫；派生状态 UNBOUND/BOUND/DONE/BROKEN；整树完整性校验 | 单测：绑定/占用/1:1；骨架缺场/目录损坏/冲突→BROKEN | ✅ **完成** |
| **18** | 流程控制工具 + 路由 + 孤儿回收（Host） | workflow_create/adopt/start/stop/resume/reset（reset 含归档备份）/wf/* 路由；结构化驱动；BROKEN 拦截；**孤儿识别+回收**（绑定会话离开 live store → stop+解绑+保留进度回池 → 可被新会话 adopt/resume） | 单测+路由：控制全链路 + BROKEN 拦截 + 孤儿闭环 | ✅ **完成** |
| **19** | WebUI↔workflow 配合调优（前后台联动） | create 即绑定（/wf/create 绑 sessionId + Client 传 sessionId）；执行期=RUNNING（workflow_begin 补 start；编排用 workflow_start 驱动已绑定/面板实例）；Client Start/Stop gating（Start 仅 CREATED/PENDING、Stop 仅 RUNNING）；**Session 启停同步**（agent idle→stop、running→resume）；system-prompt 同步 | 单测+端到端：create 即绑定/执行期 RUNNING/Session idle→stop→running→resume | ✅ **完成** |
| **20** | 前后台状态一致（Iter-19 收尾 + 绑定体验） | R1(/wf/list 路由补 sessionState + Client create/start gating)、R2(面板 Start 不置 RUNNING，状态归 workflow_start)、R4(Session 启停同步覆盖列表路径)；实例列表并入创建界面（R3）；绑定/采用/锁定；**预设门控（仅 orchestration 会话显示面板）+ BROKEN 展示（环境异常需新建会话）+ DONE 提示**（S5）；**内置默认模板改为可执行（default-demo / serial-demo，免改免参）** | 端到端：面板建实例(绑定)→仅显示本会话绑定→Start 单权威 RUNNING→会话启停同步→列表无过期状态；前后台状态一致 | ✅ **完成**（v4 手测 14 通过 / 2 N/A / 5 问题归 Iter-21） | Iter-19 |
| **21** | 前后台状态一致·v4 手测问题闭环 + Resume 提前 | R1 CREATED 态 DAG 补任务节点（A4：loadStateFromFile 从 instance.yaml 生成 PENDING tasks）；R2 子会话门控（A6：isWorkflowSession 加 `origin !== 'subagent'`）；R3 会话切换状态一致（其他#1/#2：切会话重置 wfSessionState/wfInstances/latest + 重拉列表，cwd 相同也刷新，采用池即时更新）；R4 BROKEN 加固（B2：BROKEN 每次从 /wf/list 重派生，展示态不中断轮询，防御性重置）；R5 Client Resume 按钮（D3/原 S2：STOPPED 显示 Resume → /wf/resume） | 端到端：A4 新建实例 DAG 显示任务节点；A6 子会话占位；#1 同工作区切会话状态即时正确且 /wf/status 非空；#2 采用池即时列出；B2 反复删 metadata→BROKEN 始终正确；D3 STOPPED 显示 Resume 并续跑 | ✅ **代码完成**（host v0.11.6 / client v0.5.5；157 单测；awaiting 部署验证） | Iter-20 |
| **22** | 前后台状态一致·剩余修复轮（S1/S3/S4） | S1 去掉自动 idle→stop（状态由用户显式控制，避免提问等待误停）；S3 孤儿进采用池（recoverOrphan 解绑）+ 采用池只列 CREATED/标注；S4 reset 清理会话对话（或编排侧忽略旧对话） | 端到端：提问等待不停、孤儿可采用、reset 后重跑状态一致 | Iter-21 |
| **SUBA** | **DSH 子会话可控性探索（研究迭代）** | 摸清 DSH 主/子会话会话级控制接口：确认 task subagent 模式（continuable/one-shot）、`subagent.interrupt` vs `subagent.prompt` 停止子会话、主会话 await 中断/级联停止的可行方案；产出可行方案设计 | 探索报告 + 方案选型；目标：workflow Stop 级联停止运行中的 subagent、Resume 不重复 | Iter-22 |
| **23** | **方向 A：手工停 DSH 会话=权威停止（Host+Client）** | A1 session/event 事件驱动：绑定会话回合 aborted(user) → 即时 STOPPED(user-stop)+级联 interrupt 子会话；A2 syncInstanceState 轮询兜底（live log 尾扫）；A3 面板常驻提示条（RUNNING+主 idle+子在跑 → "会话内停止无效，请用面板 Stop"） | 端到端：场景一停会话→面板 3 秒内 STOPPED(用户停止)+子会话消失+通知免疫；场景二提示条出现+面板 Stop 秒停；三条既有停止路径回归 | ✅ **完成**（2026-09-02 手测 V1/V2/V3 通过；V1-⑤ 按 UI 状态机语义复核） | Iter-SUBA + 探针（iter23-probe-report.md） |
| **24** | **预定义目录与安装布局**（块1，R1-R4 地基） | 全局预定义目录（`~/.dsh/workflow-agent/`，templates/skills/samples/docs）+ 插件启动物化内建模板与内建技能（升级同名覆盖）+ 相对路径两级解析链（workspace 优先→预定义兜底）+ /wf/templates 源切预定义目录 | 空白工作区下拉建 default-demo 全程跑通（技能来自预定义目录）；既有工作区 workspace 同名优先不回归 | — |
| **25** | **数据流显性化（参数传递地基）**（块1） | begin/start/status 返回展开后 inputs/outputs（修契约漂移，persona 对齐）+ 目录变量 `${workspace}/${wf_dir}/${skills}/${skill_dir}` 展开期注入 + 派发附技能目录来源行 + 门禁拿 inputs+outputs（R16）+ processor/gateChecker 可选（**D4 修正：校验挂创建关口**，create 返回 warnings 不拦截；运行时 persona 护栏报告） | 工具返回可见 inputs/outputs 绝对路径；integrate 子会话 prompt 真实出现 analysis 输入；缺 processor 创建返回 warnings 且实例可存可启 | 24 |
| **26** | **items 结构化提取**（块1） | `items-format` 显式声明+扩展名推断+行文本兼容；markdown 列表/表格行、JSON/YAML 数组/并列对象提取器；`${item}` ID→名称→顺序编号默认语义 + `${item.字段}` 标量注入；空提取→占位迭代；reset 备份后清空 output | 三种格式各跑通 loop+concurrent（items-demo 模板）；对象 item 路径注入正确；旧行文本零改动可跑；✅ **完成**（2026-09-02 GUI 三组验收，host v0.15.0 / 349 单测） | 25 |
| **26R** | **运行时 items 展开**（块1，自 26 拆分） | 上游任务 output 作 items 的**延迟展开**：loop/concurrent 组占位节点（依赖就绪时读 items 展开 N 迭代，运行期动态插入任务表）+ 组完成语义 + 下游 `depends-on: [组id]` 引用修正（现架构迭代 id=`组id/item`，组 id 无对应任务节点，潜伏缺口一并修）+ DAG 晚现节点渲染 | 同运行 collect→output/module-list.md→loop 端到端；组依赖下游正确等待组完成 | ✅ **完成**（2026-09-03 GUI 验收，host v0.16.0 / 387 单测） | 26 |
| **27** | **语义校验**（块1，R8/R12） | workflow_validate：技能存在性（两级）/输入存在性（workspace 或上游 outputs）/上下游 outputs↔inputs 衔接/dependsOn 闭环无环/items 文件可解析；挂 create（警告）与 start（拦截）关口；结构化错误清单 | default-demo 破坏用例逐项报错可读；完好定义零误报 | 24、25 |
| **28** | **实例编辑前台**（块2，R5-R6/R9/R11/R14） | DAG 页下方双栏（左任务列表/右属性表单；顶部实例级名称+总并发+params）+ 技能下拉（扫预定义 skills/，名称+版本）+ 保存写回 instance.yaml 并触发校验 + RUNNING 可见禁用 | 新建实例→补缺 processor 任务→校验过→启动跑通；编辑不污染预定义目录 | 24、27 |
| **29** | **实例管理子页签 + 归档/下载/删除**（块4，R23-R25） | 实例管理子页签（活动/归档两段；名称/ID/状态/孤儿/进度/创建时间）+ 归档全链（archive 目录+manifest，沿用 lifecycle-design §5/§7）+ zip 多选打一个包下载 + 删除（RUNNING 禁删+自动解绑+丢失提醒） | 全生命周期：创建→运行→停止→归档→两段列表→下载 zip 完整→删除后解绑消失 | 独立（可提前/并行） |
| **30** | **DAG 美化与交互**（块3） | 节点详情面板（状态/inputs/outputs/技能/门禁）+ 视觉布局优化 + 按需交互增强（开工前细化确认） | 节点详情数据完整（依赖 25）；视觉与交互验收开工前定 | 25 |

---

## 3. 各迭代详述

### Iter-1: Host 插件 — 引擎基础（1 人天）

**输入**：PoC 插件源码（`PoC/plugin-source/swd-dashboard.js` Host 半边）

**产出文件**：`code/plugins/workflow-host/`

| 文件 | 行数估算 | 职责 |
|------|---------|------|
| `workflow-schema.js` | ~80 | YAML schema 常量定义（Task 类型、字段默认值、校验规则） |
| `parser.js` | ~120 | YAML 解析 + schema 校验 + 参数注入（重写 PoC 的正则解析器） |
| `engine.js` | ~150 | 工作流实例状态（N 节点状态表、阶段、日志缓冲区） |
| `storage.js` | ~80 | 状态持久化/恢复（解耦 PoC 硬编码路径） |
| `tools.js` | ~120 | `workflow_begin`、`workflow_status`（重构 PoC 的 Tool） |
| `rpc.js` | ~40 | `wf:status` RPC（状态查询） |
| `index.js` | ~50 | 组装各模块、`apply(ctx)` 入口 |

**验证标准**：

```bash
# 在 DSH 会话中
cordis_define(code.host=index.js) → cordis_run
# 调 workflow_begin({workflowPath: "..."})
# 期望返回: {name, tasks:[{id,name,status:'PENDING',processor,gate}],stage:'PENDING'}
```

**工作日分解**：

| 时段 | 工作 | 交付 |
|------|------|------|
| 上午 | schema 定义 + parser 重写 | 能从 YAML 解析出任务列表 |
| 下午 | engine + tools + storage + 集成 | define→run→验证通过 |

---

### Iter-2: Agent Preset — 串行编排（1 人天）

**输入**：Iter-1 的 Host 插件

**产出文件**：`code/agent-presets/workflow-orchestrator/`

| 文件 | 行数估算 | 职责 |
|------|---------|------|
| `system-prompt.md` | ~100 | 编排 Agent 核心指令 |
| `agent.cordis.yml` | ~60 | Agent Preset 配置（persona + 工具授权 + skill 路径）|

**system prompt 核心逻辑**：

```
1. 调 workflow_begin → 获 Task 列
2. 按 depends-on 顺序逐个执行 Task:
   - 调 subagen → 加载 processor skill → 产出输出文件
3. 有 quality-gate → 调独立 subagent 执行门禁
4. 读 gate-result.md → PASS/FAIL:
   - PASS → 继续下
   - FAIL & rety → 重执行 Task（上限 max-retries）
   - FAIL & block → 阻断，通知用户
5. 每步调 workflow_status 通知 UI
```

**验证标准**：

```
定义 2-Task 串行 + Gate 工作流
→ Agent 自动执行 Task1 → Gate1 → 读结判 PASS
→ Task2 → Gate2 → COMPLETED
验证: 执行日志正确、产出文件正确```

---

### Iter-3: Client 插件 — 监控面板（1 人天）

**输入**：Iter-2 的 Host + Agent 能跑通串行流程

**产文件**：`code/plugins/worflow-client/`

| 文件 | 行估算| 职责 |
|------|---------|------|
| `store.js` | ~60 | 模块级数据层（PoC 验证的闪烁根治模式）|
| `dag.js` | ~20| N 点 SVG DAG 渲染（自动坐标计算）|
| `paneljs`| ~80 | 状态条（阶段/门禁/重试）|
| `index.js` | ~100 | slot.inject + 主视图组合 |

**验证标准**：

```
启动工作流执行
→ DSH 浏览器的 conversation.view 出现"工作流" Tab
→ 显示 N 节点 DAG（灰色）
→ Task 执行时变蓝，Gate 时变橙，完成变绿
→ 选中节点显示 skill 全文```

---

### Iter-4: 循环 + 循环展开（1 人天 — ✅ 完成）

**输入**：Iter-3 的基础串行 + Gate 端到端通

**实际修改范围**：

| 组件 | 改动 |
|------|------|
| `workflow-parser.js` | 支持 `type: loop`、`items-from`、`item-var` 字段解析 |
| `workflow-schema.js` | 新增 `TASK_TYPES.LOOP` 常量定义 |
| `tools-preset.js` / `tools.js` | 新增 `expandLoopTasks()`：`workflow_begin` 时展开 N 个串行迭代，每迭代带 `_loopGroup` 等元数据 |
| `engine.js` | 无改动（接收展开后平面任务列表，天然支持）|
| `system-prompt.md` / `agent.cordis.yml` | 更新："已在 workflow_begin 时自动展开" |
| `client-body.txt` | 新增循环组 DAG 可视化：`_loopGroup` 检测 + 背景框 + "↻" 标签 |
| 动态插件 `wfd-12/pkg-17` | 经过 5 次迭代（v1~v5）后稳定运行 |

**验证结果**：
- Node 单元测试 41/41 通过
- expandLoopTasks 探针 18/18 通过
- ESM 插件加载验证通过
- 4-task 模拟执行：PENDING（灰）→ RUNNING（蓝）→ DONE（绿）✅
- 循环组背景框 "↻ 逐模块评审" 显示正确 ✅

---

### Iter-5: Host/Client 架构调整 — Client RPC 链路修复（1 人天 — ✅ 完成）

**背景**：Client UI 迁移到 npm 包后 RPC 链路断裂。`host.call` 是动态插件闭包注入的符号，npm 包无法使用。
决策详见 `plan/architecture/architecture-decisions.md` §5 与 `plan/design/client-host-communication.md`。

**输入**：Iter-4 循环展开 + 现有 npm 包架构（workflow-host / client-ui-monitor）

**修改范围**：

| 组件 | 改动 |
|------|------|
| `workflow-host` npm 包 | 新增 `ctx.webServer.register()` 路由：`GET /wf/status`（读 state.json，复用 `loadState` 逻辑）|
| `workflow-host/package.json` | `inject` 增加 `webServer`，版本升至 0.3.0 |
| `client-ui-monitor/src/client.js` | `host.call('wf:status', ...)` → `fetch('/wf/status?workspaceRoot=...')`；保留模块级数据层 + 指纹防抖 + 2s 轮询；`ctx.interval` → `window.setInterval` |
| `client-ui-monitor/build.js` | 移除 `require("@deepseek-ai/dsh-client-runtime").host`（该包不导出 host）；inject 改为 `['slots']` |
| `workflow-rpc.mjs`（preset） | 停用/归档（harness RPC 由 webServer 路由替代）|
| 安全 | loopback 检查：仅回环地址接受（仿 `@linxin666/dsh-tool-describe-image` 的 `isLoopbackRequest`）|

**验证标准**：

```
启动工作流执行
→ DAG 面板经 HTTP 轮询显示工作流状态（不再依赖 host.call）
→ 节点颜色随 state.json 变化刷新（PENDING 灰 → RUNNING 蓝 → DONE 绿）
→ 无 "Connecting..." 闪烁、无空白面板
→ 浏览器 DevTools Network 可见周期性的 /wf/status 请求
```

**验证结果**（✅）：路由单测全通过；安装到 desktop profile（0.3.0）；Client bundle 进入 boot 图（新 rev）；DAG 图显示（节点颜色绿/红/琥珀 + 循环组折叠框 + 状态条正确）。详见 `progress-record.md` §6。

**参考先例**：`@linxin666/dsh-tool-describe-image`（npm 包 + webServer + fetch，本机已运行）：
- Host：`src/attach-routes.ts`（`webserver.register` + `isLoopbackRequest`）
- Client：`src/client/attach.ts`（`fetch()` 同源相对路径）

---

### Iter-6: 循环错误处理 + DAG 布局优化（1 人天）

**输入**：Iter-5 Host/Client 架构调整完成

**修改范围**：

| 组件 | 改动 |
|------|------|
| `workflow-schema.js` | 新增 loop 类型 `onError: break \| continue` 可选字段 |
| `workflow-parser.js` | `normalizeTask()` 增加 `onError` 字段解析，默认 `break` |
| `tools-preset.js` / `tools.js` | `expandLoopTasks()` 将 `onError` 复制到每个展开迭代的 `_onError` |
| `engine.js` | 任务 FAILED 后检查 `_onError`：<br>— `break`：标记同组 PENDING → SKIPPED<br>— `continue`：继续执行<br>`getNextRunnableTask()` 跳过 SKIPPED 任务 |
| `client-body.txt` | 循环组统一使用**折叠/展开布局**（不区分 item 数量）：<br>— 折叠态：背景框 + "↻" 标签 + 进度条 + ✅🔄❌⏭ 计数<br>— 展开态：垂直列表，每行一个 item + 状态颜色点<br>— SKIPPED 状态：琥珀色 `#f59e0b` + 虚线边框 |

**验证标准**：

```
场景 1：onError=break
→ 定义 loop(items=5)，第 3 item 失败
→ item-1 ✅, item-2 ✅, item-3 ❌, item-4 ⏭, item-5 ⏭
→ 循环整体 FAILED

场景 2：onError=continue
→ 定义 loop(items=5)，第 3 item 失败
→ item-1 ✅, item-2 ✅, item-3 ❌, item-4 ✅, item-5 ✅
→ 循环整体部分成功

场景 3：折叠布局
→ 定义 loop(items=12)，折叠态显示进度条 + 计数摘要
→ 点击展开显示垂直列表
```

---

### Iter-7: 并发执行引擎（1 人天）

**输入**：Iter-6 循环错误处理完成

**修改范围**：

| 组件 | 改动 |
|------|------|
| engine.js | 就绪队列 + 并发调度器（Task 完成 → 检查就绪 → 按 mmax-concurrency 启动新 Task） |
| system-prompt | 并发策略：多个就绪 Task 的启动方式 |
| dag.js | 并发状态显示（多个 Task 同时蓝色）|
| workflow-schema | 确认并发语义（字段定义已就绪，现在实现）|

**验证标准**：

```
场景 1：2 个无依赖 Task + max-concurrency=2
→ A 和 B 同启动

场景 2：循 items=4 + max-concurrency=2
→ 先启 2 个迭代，完成 1 个立即启第 3 个
```

---

### Iter-8: 并发语义完善 + concurrent 节点 + DAG 增强（1 人天）

**输入**：Iter-7 并发执行引擎完成

**背景**：交付 Iter-7 后发现对"并发"的理解有偏差，需修正并新增伪并发场景能力。

**修改范围**：

| 组件 | 改动 |
|------|------|
| workflow-schema | 新增 `TASK_TYPES.CONCURRENT`；`REQUIRED.concurrent`（id/processor/items-from/item-var）；concurrent 节点新增 `max-concurrency` 字段 |
| workflow-parser | `normalizeTask` 支持 `type: concurrent`（同 loop 的 items-from/item-var/processor/inputs/outputs/quality-gate 解析） |
| tools-preset | 新增 `expandConcurrentTasks()`：展开为 N 个 item 迭代，迭代之间**无依赖**（区别于 loop 的串行依赖链）；复制 `max-concurrency` 到迭代元数据 `_concurrentGroup`/`_concurrentMax` |
| engine | `getRunnableTasks` 并发语义：concurrent 迭代就绪需同时满足**组级 `max-concurrency`**（组内 RUNNING < 组级 max）与**工作流级 `max-concurrency`**（全局 RUNNING < 全局 max），**取最严格者** |
| client DAG | ① 依赖同一前驱的多个节点：**撤销线框**（不打包成组），**保留垂直排列**（上下并列，各自独立） ② concurrent 节点：类似 loop 折叠框，标注"⚡ 并发" ③ **新增启动(start)/结束(end)节点**：start 发出箭头指向首节点/无依赖节点，end 汇聚所有终节点箭头 |

**执行需求**：
- 组级 `max-concurrency` 与工作流级 `max-concurrency` 取最严格者（两者都约束 concurrent 迭代）
- concurrent 节点：单输入/输出/过程/门禁设置，对 items-from 的每个 item 并发执行相同操作（每个 item 独立 subagent 会话 + 独立 gate）
- 依赖同一前驱的多个节点：垂直排列（无框），表示可并发执行
- 流程图增加启动(start)/结束(end)节点

**验证标准**：

```
场景 1：concurrent(items=4, max-concurrency=2)
→ 先启 2 个迭代，完成 1 个立即启第 3 个
→ 组内 RUNNING 数恒 <= 组级 max，且全局 RUNNING 数 <= 工作流级 max

场景 2：依赖同一前驱的 3 个节点
→ DAG 垂直排列（无线框），可同时 RUNNING（蓝色）

场景 3：流程图 start/end
→ 启动节点发出箭头指向首节点/无依赖节点；结束节点汇聚所有终节点箭头
```

---

### Iter-9: 多实例技术验证（DSH Session 探索）（1 人天 — ✅ 完成）

**输入**：Iter-8 完成

**背景**：多实例方案定稿为"复用 DSH Session"（见 `plan/design/multi-instance-session-design.md`），先做技术验证确认可行性。

**范围**：探针验证插件内 `ctx.sessions.create(id,{meta:{cwd}})` 创建 session、监听 `session/created`、用 `session.cwd` 定位实例目录；多 session 并行确认。

**验证标准**：

```
探针创建 2 个 session（不同 cwd）→ 独立存在、list 可见
监听 session/created → 事件触发
用 session.cwd 定位实例目录 → 可映射
输出技术验证报告（回注 development-plan / 架构决策）
```

**验证结果**（✅）：12 项探针全部通过（创建/事件监听/cwd 定位/并行共存/id 与 cwd guard/受控生命周期/flush 持久化），详见 `plan/development/iter9-report.md`。关键输入修正：实例存储路径必须从 session cwd 推导（动态插件上下文 `workspaceRoot`=HOME）；实例 session 生命周期用 `prepare+enter+announce` 持 detach（`create()` 无移除通道）。

---

### Iter-10: 实例目录与存储（后台）（1 人天）

**输入**：Iter-9 技术验证可用

**范围**：实例目录结构（`<cwd>/.workflow-agent/instances/<id>/{instance.yaml,state.json,metadata.json,output/,logs/}`）；storage 按实例读写 state；workflow-host 管理 `Map<instanceId,{engine,storage}>`（engine 零改造）；实例目录 metadata.json 存 instanceId↔sessionId（主）。

**Iter-9 约束**：目录路径从 `exec.agent.session.header.cwd` 推导，禁止依赖 `sandboxPolicy.workspaceRoot`；metadata.json 读写模式已被探针 P7 证实。

**验证结果**（✅）：实例注册表 + 实例目录布局 + 会话绑定 + 路由实例布局全部落地，Client 零改动。单测 79/79；部署 web profile v0.4.0 后路由验证 4 项全过。详见 `plan/development/iter10-report.md`。

**验证标准**：

```
创建实例 A/B → 各自实例目录 + 独立 state.json
A 运行写 A 的 state.json，B 写 B 的（互不干扰）
metadata.json 能还原 instanceId↔sessionId 映射
```

---

### Iter-11: 实例操控工具（后台）（1 人天）✅ 完成（2026-08-28，v0.5.0）

**输入**：Iter-10 实例目录可用

**范围**：`workflow_create`（从定义+参数建实例）/ `workflow_start` / `workflow_stop` / `workflow_reset`（清实例目录重跑）/ `workflow_list`；system-prompt 实例管理与重置能力提示。

**Iter-9 约束**：实例 session 用 `prepare+enter+announce` 创建并持有 detach disposer（`workflow_stop/reset` 需要移除通道；`create()` 便捷路径无 detach）；实例 id 用 `workflowName-uuid8`（id 唯一 guard 已证实，天然防撞）。

**验证标准**：

```
workflow_create(A 定义) → A 实例目录生成
workflow_start(A) → A 运行，写 A 的 state.json
workflow_stop(A) → A 标记 stopped
workflow_reset(A) → 清空 A 的 output/logs/state.json，重新可执行
workflow_list → 列出所有实例 + 状态
```

---

### Iter-12: 前台实例管理界面（1 人天）✅ 代码完成（2026-08-28，v0.2.0，待部署验证）

**输入**：Iter-11 实例操控可用

**范围**：client DAG 用 `useSessions` + `sessionId` 取当前 session 的 `cwd` → 定位实例目录 → 读 state.json 渲染（跟随 session 切换）；实例列表 UI（复用 DSH session 列表）+ 创建/启动/停止/重置按钮。

**验证标准**：

```
开 workflow preset 会话 → DAG 显示该实例状态
前台切 session（另一实例）→ DAG 自动跟随切换
实例列表可见所有实例 + 当前 active 状态
```

---

### Iter-13: 面板"新建 workflow 实例"按钮 + 模板库 v1（0.5~1 人天）✅ 代码完成（2026-08-28，v0.6.0/v0.3.0，待部署验证）

**输入**：Iter-11 create 工具语义、Iter-12 /wf/list + 切换条
**语义定稿**：`plan/design/instance-creation-semantics.md` §6.3——**按钮只 create 不 start**（start 驱动者是 session 内编排 Agent；面板 start 待 Iter-14/15 通道打通后再议）

**产出**：

| 项 | 职能 |
|------|------|
| Host `POST /wf/create` | 写操作 HTTP 化：loopback 校验 → parseWorkflow 校验 → `beginInstance`（sessionId=null）→ `{instanceId, dir, phase:"CREATED"}`；prefix handler 增加 method 判断 + POST body 收集 |
| 模板库 v1 | 内置基础流程模板（随插件分发）+ 可选扫描 `<cwd>/templates/*.yaml`；面板"从模板新建"入口（模板 → params 替换 → create；模板保持只读，实例=模板+配置严格区分） |
| Client "+" 按钮 | 切换条旁入口 → 表单（选模板或填 workflowPath + params JSON）→ 创建后 /wf/list 轮询自动带出 chip |
| 不做 | 面板 start/stop/reset（驱动者约束，Iter-15/16 处理）；模板 UI 指定目录/git 下载（后置） |

**验证标准**：

```
面板点"+" → 选模板（或填路径）→ 创建成功
→ 切换条出现 CREATED chip（无需 session 调工具）
→ 在 orchestrator session 里 workflow_start 该实例 → 编排正常驱动
```

### Iter-14: 消息注入技术穿刺（0.5 人天）

**输入**：Iter-12 面板就绪；用户拍板"要做技术穿刺，稳妥点"
**形态**：动态插件探针（先例 Iter-9，用后即 stop+undefine）

**验证目标**：插件能否向指定 session 注入用户消息/指令；API 形态是否支持**通用指令消息**（`{type, taskId, ...}` 而非硬编码 start/stop）——为远期"局部任务重跑"（对失败任务单独启动 subAgent、局部刷新总状态）预留架构。

**产出**：探针报告（go/no-go + API 形态 + 约束）；no-go 则面板维持"只 create，控制走 session"。

### Iter-15: 面板控制 start/stop/继续（1 人天，依赖 Iter-14 = go）

**输入**：Iter-14 通道
**产出**：面板 start/stop/继续按钮（注入指令驱动编排 session）；"继续"= hydrate 续跑（不清进度，persona 补教学）；产物列表（实例 output/ 列表展示，读侧小迭代可并入）
**验证**：面板启动 → DAG 展示执行 → 面板停止 → 面板继续 → 完成

### Iter-16: 运行状态机（Host）

**技术方案**：`plan/design/workflow-lifecycle-design.md` §4/§6

**交付**：
- schema / engine：STAGE 枚举补 `STOPPED`；`setStage('STOPPED')` 置 `active=false`；
- engine 补 `stop`（保留 DONE 进度、active=false）/ `resume`（hydrate 续跑、active=true）/ `begin`（全新 PENDING）语义；
- 单测补 STOPPED / resume / stop-then-reset 用例。

**验证（可验证）**：单测通过——`PENDING→RUNNING→STOPPED→resume→RUNNING(保 DONE)`；`RUNNING 先 stop 再 reset`；`STOPPED 不可 start`。

---

### Iter-17: 绑定模型 + 完整性（Host）（✅ 完成，报告 `plan/development/iter17-report.md`）

**技术方案**：`plan/design/workflow-lifecycle-design.md` §2/§3

**交付**：
- 工作区骨架物化：`<workspace>/.workflow-agent/{instances,archive}`（首次挂接 workflow 会话，幂等）；
- 绑定语义（已按用户确认）：`create-bind`（新建实例写 `metadata.sessionId=S`）/ `adopt`（仅采用池中 `sessionId==null` 实例）；1:1 守卫（一会话一实例、一实例一会话、绑定后禁再绑）；**仅删会话解绑**；
- 派生状态：`UNBOUND/BOUND/DONE/BROKEN`；整树完整性校验（骨架缺场、实例目录损坏、1:1 冲突→BROKEN）。

**验证（可验证）**：单测 125/125（用例 12 新增 12 断言：create-bind/adopt/重复绑定拒绝/已占用拒绝/RUNNING 拒绝/骨架缺场→BROKEN/目录损坏→BROKEN/1:1 冲突→BROKEN/UNBOUND）。

**范围**：未改运行状态机（Iter-16）、控制工具/路由（Iter-18）、归档（Iter-20）、Client（Iter-21）。孤儿回收（解绑/回池/adopt/resume）属 Iter-18；解绑语义=仅删会话（Iter-18 孤儿回收实现）。

---

### Iter-18: 流程控制工具 + 路由 + 孤儿回收（Host）（✅ 完成，报告 `plan/development/iter18-report.md`）

**技术方案**：`plan/design/workflow-lifecycle-design.md` §3/§5/§6

**交付**：
- 工具：`workflow_create` / `workflow_adopt`（新）/ `workflow_start` / `workflow_stop` / `workflow_resume`（新）/ `workflow_reset`（含 `_reset_<state>` 归档备份）；`workflow_list` 补派生状态 + orphans；
- 路由：`POST /wf/start|stop|resume|reset|adopt` + `/wf/list`；BROKEN 时拒绝 create/adopt/run 并返回状态；
- 孤儿识别 + 回收：判定 = 绑定会话离开 live store（`sessions.get()===undefined` / `session/disposed`）；**归档≠死亡**；惰性扫描触发；回收 = RUNNING 先 stop → 解绑(`sessionId→null`) → 保留 `state.json` 回 UNBOUND 池 → 可被新会话 adopt/resume；
- system-prompt/agent.cordis.yml：adopt→start 两步同步（start 前须先 adopt；STOPPED 用 resume、COMPLETED/FAILED 用 reset）。

**验证（可验证）**：单测 137/137（用例 13 新增 11 断言：控制全链路 + reset 备份 + status + 孤儿识别/回收）；lib/index.js 构建通过（v0.10.0）。

**决策（用户拍板）**：孤儿触发=惰性扫描；start 须先 adopt（非自动认领）；reset 备份在 Iter-18 写。

**注意**：`sessions.get()===undefined` 与 `session/disposed`、归档不判死 由源码佐证（`packages/host/apiproxy/src/api/workspace.ts`），未单独做动态插件探针（go/no-go 以源码为据）；若需可后续补。

---

### Iter-19: WebUI↔workflow 配合调优（前后台联动，1 人天 + buffer）（✅ 完成，报告 `plan/development/iter19-report.md`）

**背景**：Iter-15~18 打通了 Host 状态机/绑定/控制，但前台（面板/会话）与 Host 的**状态同步与驱动方式**存在联动问题（用户实测发现）：面板建实例未绑定会话、编排执行期 stage 停留 PENDING 导致 Stop 报"仅 RUNNING"、编排用 workflow_begin 重复新建实例等。此类问题跨 Host/system-prompt/Client，集中一个迭代（含 buffer，前台问题预期持续累积）。

**交付**：
- **create 即绑定**：`POST /wf/create` 路由绑定新实例到请求 `sessionId`（create-bind）；Client `/wf/create` 传入当前 `sessionId`；
- **执行期=RUNNING**：`workflow_begin` 工具 `begin(parsed)` 后补 `engine.start()` → RUNNING；编排 agent 对已绑定/面板创建的实例改用 **`workflow_start`** 驱动（不再 `workflow_begin` 重复新建）；仅自建新实例时用 `workflow_begin`（同样→RUNNING）；
- **Session 启停同步**：监听/惰性比对 `agents.get(sid).status`（agent idle⇄running）；idle→绑定实例 `engine.stop()`→STOPPED（保 DONE）；running→`engine.resume()`→RUNNING（续跑）。注入 `isAgentRunning`，`forSession` 观测时同步；
- **Client 按钮 gating**：Start 仅 `CREATED/PENDING`；Stop 仅 `RUNNING`（PENDING 为"已重置待启动"，非执行中）；
- **system-prompt / agent.cordis.yml**：编排模式同步（begin 创建新实例→RUNNING、start 驱动已绑定实例、Session idle-stop/running-resume 语义）；
- **预留 buffer**：前后台联动增量问题（状态刷新 / 实例切换跟随 / 面板 start 后 DAG 即时变化等）。

**验证（可验证）**：单测 143/143（用例 14 新增 6 断言：begin→RUNNING + 绑定 + Session idle→stop + running→resume + create 即绑定）；lib/index.js（v0.11.0）与 client bundle（v0.5.0）构建通过。awaiting 端到端部署验证。

---

### Iter-20: 前后台状态一致（Iter-19 收尾 + 绑定体验）

**背景**：Iter-19 打通了 create 即绑定/执行期=RUNNING/Session 启停同步，但手工验证暴露 R1~R4 阻塞（前后台状态不一致）。本迭代把"前后台状态一致"作为一整个可端到端验证的功能闭环收尾。

**问题定位（R1~R4 根因与证据，来自 `plan/development/iter19-verification-report-v2.md` 手测）**：
- **R1（`+`/Start gating 恒失效，A1a/A1b/B2）**：`/wf/list` **HTTP 路由**只走 `registry.listInstances`，**不返回 `sessionState`**（我只把 `sessionState` 加进了 `workflow_list` 工具）。Client `loadList` 用路由 → `wfSessionState` 恒 null → `canCreate = !wfSessionState || UNBOUND` 恒真 → `+` 永远显示；且 UNBOUND 无实例时 Start 也显示。
- **R2（Start 置 RUNNING vs workflow_start 拒 RUNNING，B4）**：面板 `/wf/start` 路由先 `engine.start()` → RUNNING，再注入消息；编排会话收到后调 `workflow_start`（工具）→ 见 `stage==='RUNNING'` → 拒绝（"正在运行中"）。同一实例双重触发，第二次必被守卫拦住。**决议：由编排侧 `workflow_start` 统一维护状态（面板路由不置 RUNNING）。**
- **R3（实例常驻切换条 UX，A1c）**：面板把 workspace 全部实例（含绑定其他会话 + UNBOUND 池）展示为常驻切换条，用户认为应**并入创建界面**（可从模板创建或选一个未绑定实例），面板只显示当前会话绑定实例。
- **R4（Session 启停同步只在 `forSession`，列表过期 RUNNING，E1 不可靠）**：Iter-19 的 idle→stop / running→resume 同步挂在 `forSession`（status 路径），而 `/wf/list` 用 `listInstances` **不触发** → 列表可能显示过期 RUNNING（实测 `test-demo-e775e9a6` RUNNING 但 active=false，`activeBySession` 重启后为空）。
- **附带**：实测工作区为多会话共享池（4 个会话各绑 1 实例 + 5 个 UNBOUND），前台需区分"本会话绑定 / 其余会话绑定 / UNBOUND 池"。

**交付**：
- **R2（状态权威）**：`/wf/start` 路由**不置 RUNNING**，只校验+注入消息；状态由编排侧 `workflow_start` 统一维护（消除双写冲突，B4）。
- **R1（gating 数据源）**：`/wf/list` 路由补 `sessionState`；Client create/start gating：会话 UNBOUND 才显示"+"，仅显示本会话绑定实例为当前项。
- **R4（同步覆盖列表路径）**：Session 启停同步从 `forSession` 扩展到 `/wf/list`（按派生状态对绑定实例 idle→stop、running→resume），避免列表过期 RUNNING。
- **R3（实例列表并入创建界面）**：实例选择从常驻切换条移入创建界面（可从模板创建或选一个未绑定实例）；面板只显示当前会话绑定实例。
- **绑定体验（Client）**：预设门控（仅 workflow-orchestrator 显示页签/DAG/控件）；绑定（新建/采用/锁定）；BROKEN 展示"环境异常，需新建 workflow 会话"。

**验证（端到端）**：面板建实例(绑定)→仅显示本会话绑定→Start 单权威 RUNNING→会话启停同步→列表无过期状态；前后台状态一致（A/B/C/E 场景全 PASS）。含绑定/门控/BROKEN 展示。手工清单见 `plan/development/iter19-verification-report-v2.md`。

---

### Iter-21: 前后台状态一致·v4 手测问题闭环 + Resume 提前（S2 提前）

**背景**：Iter-20（R1~R4 + forSession + S5 预设门控/BROKEN 展示 + 内置默认模板可执行）已修并通过单测；但 v4 手工验证（`plan/development/iter20-verification-report-v4.md`）又发现 A4/A6/其他#1/#2/B2 等问题，且 STOPPED 无 Resume 按钮（原 S2）。本迭代集中修复并端到端验证。

**交付（R1~R5）**：
- **R1（A4）CREATED 态 DAG 补任务节点**：`loadStateFromFile` 对 CREATED（无 state.json）不再返回 `tasks: []`，改为从 `instance.yaml` 解析并生成 **PENDING 任务快照**（复用 `begin()` 的任务字段），使面板在启动前即显示步骤节点。
- **R2（A6）子会话门控**：`isWorkflowSession` 从 `agentPreset === 'workflow-orchestrator'` 扩展为 **且 `origin !== 'subagent'`**（`useSessions(s=>s.byId[sid]?.origin)`）；子会话一律占位（不显示工作流面板/+采用）。
- **R3（其他#1/#2）会话切换状态一致**：切会话（含**同工作区**）时重置 `wfSessionState/wfInstances/latest` 并**重拉列表**（把 `sessionId` 纳入 workspaceRoot effect 依赖，`activeRoot` 不变也刷新）；消除按钮残留（误显示 Start）与采用池空/无反应；`/wf/status` 不再因 `boundId` 匹配失败返回 null。
- **R4（B2）BROKEN 加固**：BROKEN 判定每次从 `/wf/list` 经 `deriveSessionState` 重新派生（已在）；BROKEN 展示态**不中断轮询**；防御性重置模块级状态，避免 BROKEN→恢复→再 BROKEN 循环失同步。
- **R5（D3=原 S2）Client Resume 按钮**：STOPPED 显示 **Resume** 按钮 → `POST /wf/resume`（Host 已支持），续跑保 DONE 进度；并入 `wfListLoader` 即时刷新。

**验证（端到端）**：A4 新建实例面板 DAG 显示任务节点（PENDING）；A6 打开子会话→占位；其他#1 同工作区切会话按钮/状态即时正确且 `/wf/status` 非空；其他#2 采用池即时列出未绑定实例；B2 反复删 `metadata.json`→恢复→再删，BROKEN 始终正确；D3 STOPPED 显示 Resume 并点击续跑。详见 `plan/development/iter20-verification-report-v4.md`。

---

### Iter-22: 前后台状态一致·剩余修复轮（S1/S3/S4 + reset 修复）

**背景**：Iter-21 聚焦 v4 手测问题（A4/A6/#1/#2/B2）+ Resume 提前；本迭代收尾其余状态语义问题（原 S1/S3/S4）+ 新增 reset 修复。

**交付**：
- **S1 状态同步语义**（✅ 设计定稿）：
  - **idle→stop：保留 + 加 pendingInteraction 守卫**——仅当「agent idle **且 无 pendingInteraction（非等待用户输入）**」→ `engine.stop()`；「idle **且 有 pendingInteraction（提问等待）**」→ **不 stop**（wf 保持 RUNNING）。信号来源：**Host 读 `agents.get(sid).inbox.hasPending`**，**先最小探针确认**能否稳定区分"提问等待"vs"用户停止"。（AgentStatus 仅 idle/running 无法区分；不能简单移除 idle→stop，否则"手工点停止"失效。）
  - **running→resume：移除自动**（用户拍板 B）。wf 只能由 agent 依消息显式 `workflow_resume` 恢复；在 system-prompt 指引 agent：识别"继续执行/恢复/续跑"类指令时调 `workflow_resume`。避免"非继续消息（如'为什么停了?'）也自动把停止的 wf 拉回 RUNNING"。
- **S3 孤儿/采用池完整语义**（✅ 设计定稿）：`/wf/list` **自动 recover 孤儿**（`scanOrphans`→逐个 `recoverOrphan`：死会话孤儿解绑 `sessionId→null` 回 UNBOUND 池；RUNNING 先 stop——用户拍板 D4 仅 /wf/list，不做 adopt 兜底）；采用池 = 恢复后孤儿 + `sessionId==null` 实例；**允许"未启动(CREATED)"与"已停止·含进度"孤儿**（D3，采用后可 resume 续跑），**RUNNING 拒绝**；列表带状态标注（未启动/已停止·含进度），避免莫名 RUNNING/STOPPED 误导。
- **S4 会话对话（重置后不复述旧状态）**（✅ 设计定稿）：
  - **A**：面板 **reset 按钮注入"工作流已重置，忽略此前对话，按全新工作流执行"** 消息（agent 确认，不复述旧状态）。优先用对话提示，不用 `/new`（需实测）。
  - **C**：**system-prompt 强化**——"每次 begin/重置视为全新运行；以 workflow_begin/status 返回为准，勿将对话旧 stage/task 与新状态对比；收到'已重置'消息后不回溯旧进度"。
  - **agent 识别自然语言控制短语**："请启动/停止/继续/重置工作流"（无论面板注入还**是人工在会话输入**）→ 调对应工具（`workflow_begin/start/stop/resume/reset`）并只回一行确认。统一"面板注入 + 人工输入"两条控制入口。
- **reset 修复（单列，新发现）**：
  - **问题**：COMPLETED/STOPPED/FAILED 或 hydrate-only（引擎不在内存）实例 reset 失败——根因 `state.def`（reset 重新 begin 的解析定义）`save()` 未写、`hydrate()` 未恢复 → `engine.reset()` 抛"reset 需要已 begin 的定义"。（设计定义 §4 允许 COMPLETED→reset→PENDING，非设计问题；是代码 bug。）
  - **修复**：**reset 不依赖在内存 `state.def`，改为重置时从 `instance.yaml` 重新解析展开定义**（`registry.expandInstanceDefinition(entry)`）再重置（`engine.resetWithDefinition(parsed)` 或注入 def 后 `reset`）。对任何实例（含 COMPLETED/STOPPED/FAILED、历史会话、DSH 重启后）都能 reset。

**S1 剩余待办**：① 最小探针确认 `agents.get(sid).inbox.hasPending` 在"提问等待"vs"用户停止"的取值；② 移除 syncInstanceState 的 running→resume 分支；③ system-prompt 增"继续执行→workflow_resume"指引。

**验证（端到端）**：提问等待不被误停；孤儿实例可被采用并正常执行；reset 后重跑状态一致（且 COMPLETED/STOPPED/FAILED、历史会话、重启后实例均能 reset）；人工输入"请重置/请启动/请停止/请继续工作流"与面板注入等效。

---

### Iter-SUBA: DSH 子会话可控性探索（研究迭代）

**背景**：Iter-21 发现 DSH 限制——工作流 Stop 无法立即停止正在运行的 task subagent（one-shot 不可取消 / 主会话 await 无法被 steer 打断），且运行完会触发主会话续跑。实测发现**在 subagent 子对话输入"停止/继续"可控制它**，说明任务 subagent 实为 **continuable、可被 prompt/中断**——存在可探索的控制入口。详见 `plan/design/dsh-session-subagent-control-research.md`。

**目标**：摸清 DSH 主/子会话会话级控制接口，为"workflow Stop 级联停止子会话 / Resume 唤醒子会话"找到可行、可靠的实现方式。

**探索步骤（不改生产逻辑，用临时探针/最小改动）**：
1. 确认 task subagent 模式（`subagent.list` 观察 activity/mode=continuable/one-shot）。
2. 实测 `subagent.interrupt`（硬中断）vs `subagent.prompt`（注入"停止"）对运行中子会话的效果与耗时。
3. 定位 DSH 前端子对话"停止/继续"实际走的接口（interrupt 还是 prompt），以此为蓝本。
4. 确认主会话 await 中断是否可行；可行则设计"workflow Stop→枚举 running 子会话→逐个中断/提示停止"。
5. **（Iter-22 验证转入）会话树聚合状态探针**：确认 Host 侧 agents registry 中 child 条目的字段（是否带 parentSessionId）与枚举方式，验证"枚举某 parentSessionId 的 running subagent"可行。
6. **（2026-09-01 追加）同任务双 subAgent 检测探针**：验证能否建立"子会话 ↔ 任务 dispatch"对应关系（如派发时 prompt 内嵌任务 id + dispatch 序号，或 registry 条目元数据），识别"同一任务仍有 in-flight 旧 subAgent"。
7. 产出可行方案设计（含 Resume 语义复核、与 getRunnableTasks=[]/engine.stop 重置 PENDING/面板中间态协同）。

**Iter-22 验证转入的方案设计（已与用户拍板方向，2026-09-01）——会话树聚合守卫 + stopReason 定向恢复**：
- **聚合守卫**：`syncInstanceState` 的 idle→stop 条件从 `!isAgentPending(sid)` 推广为 `!isAgentPending(sid) && !hasRunningChildren(sid)`。语义：主 idle + 子 running → wf 保持 RUNNING；主 idle + 子全部完成 → STOPPED（`stopReason='session-idle'`）；主 running → RUNNING。解决 Iter-22 B1 实测的后台 subagent 等待被误停问题。
- **stopReason 定向恢复**：实例状态记录停止原因——`user-stop`（面板/自然语言/手工停会话）时主会话重新活跃**不**自动恢复（S1 语义保留）；`session-idle`（自然空闲停）时主会话新回合 running → **自动 resume**（精准恢复 S1 移除的自动恢复，仅限自然停场景）。消除"任务在推进、wf=STOPPED"失配（Iter-22 B1-3）。
- **边界**：文本提问（主 idle、无子）守卫覆盖不了，由 system-prompt 约束"编排期间提问必须用 ask 工具"配套（Iter-22 已先行落地止血）。
- **验证标准（追加）**：后台 subagent 等待期间 wf 保持 RUNNING；子完成后主恢复驱动 wf 自动回 RUNNING；手工停后任何唤醒均不自动 resume；test-host 全绿。

**追加问题（2026-09-01 用户提出，Iter-22 关闭时）——同任务双 subAgent 并发冲突**：
- **现象**：Start 派发 subAgent 执行任务 → Stop（RUNNING 任务重置 PENDING，Iter-21 死锁修复的设计行为；DSH 层无法取消 one-shot subAgent）→ 再 Start/Resume **新建 subAgent** 执行同一任务 → 新旧两个 subAgent 同时运行、读写同一任务文件 → **文件冲突 / 内容互相覆盖**。
- **设计路径（三线并行，根治优先）**：
  1. **根治·级联停止**（依赖探索步骤 2/4）：Stop 时枚举 running 子会话，对 continuable 子会话注入"停止"/interrupt，从源头消灭旧 subAgent；
  2. **根治·迟到回报丢弃**（依赖探索步骤 6）：dispatch 带纪元号/任务映射（探索步骤 6），旧 subAgent 完成回报时因 dispatch 不匹配被编排 agent 忽略（配合 stopReason/实例态校验），并同步旧子会话"你的结果已作废"；
  3. **兜底·任务产物 epoch 隔离**（不依赖 DSH 接口，可独立先行交付）：每次派发 subAgent 输出到 `output/<task>/<dispatchN>/` 独立子目录，编排 agent 采纳**最新 dispatch** 的产物为任务输出——旧 subAgent 无论跑多久只写自己的目录，物理消除文件冲突。
- **system-prompt 配套**：resume 派发前识别"刚被 stop 重置 PENDING 的任务可能有旧 subAgent 在跑"；对新派发声明产物子目录与"只采信本 dispatch"约束。
- **验证标准（追加）**：构造 Stop→Start 双 subAgent 场景：新旧 subAgent 各写各目录、无文件冲突；旧 subAgent 迟到回报被忽略不污染任务结果；若级联停止可行则同场景不产生双跑。

**验证标准**：Stop 后正在运行的 task subagent **立即停止**且主会话不再被触发继续；Resume 重新建立 subagent 续跑且**不重复**；**Stop→Start 双 subAgent 场景无文件冲突、迟到回报不污染**；与现有面板控制无回归；test-host 全绿。

**探索结论（2026-09-01 技术验证完成，报告 `iter-suba-report.md`，探针存档 `code/probes/suba-master-slave-probe.js`）**：源码侦察（packages/subagent + host/apiproxy，逐一对照部署版 rc.2 .d.ts）+ 运行时探针双重确认——①主从关系=持久 header（parentSession/origin/delegationDepth）；②`apiProxy.subagents.{list,interrupt,prompt,history}` rc.2 全量可用，list 的 activity 即官方 `agents.get(id)?.status==='running'` 重算（hasRunningChildren 现成实现）；③interrupt 实测毫秒级生效（stopReason='aborted'，子 agent 移出 registry，父收"was stopped before it finished"空 closing 通知）；④followup 可唤醒冷子会话（直调必须显式传 AbortSignal——工具内 exec.signal 可用）；⑤任务 subAgent 已配 `backgroundMode: continuable` 全链可控；⑥stopReason 枚举 completed/aborted/error/max-tokens；⑦事件 `subagent/start|end` Host 全局可达（响应式同步素材）。**主从状态控制方案定稿**：聚合守卫 P1 / stopReason 定向恢复 P2 / Stop 级联停止 P3 / 迟到回报治理 P4 / 事件驱动同步 P5——全部在 workflow-host 插件内闭环、Host 侧权威、不依赖 DSH 改动。

**阶段 2（实现迭代，✅ 2026-09-02 手测通过后关闭）**：P1+P2+P3+P4 四件套已交付并验证——instance-store（deps 注入 listRunningChildren/interruptChild；syncInstanceState 聚合守卫 + stopReason='session-idle' + 定向自动 resume；user-stop 永不自动恢复）、tools-preset（workflow_stop 级联 interrupt + stopReason='user-stop' + stoppedChildren 回传；workflow_resume/reset 清 stopReason）、mjs（apply 生产探针 apiProxy.subagents 实现 + 路由 reset 清标记 + 过时注释更新）、system-prompt（P4 级联停止通知识别 + 双跑不可能性语义）。**闭环不变式：子会话在跑 ⇔ wf RUNNING → Start 被拒 → 永无双 subAgent 派发**。单测 193 项全绿（用例 16 新增 9 项）；手测 T1-T7 全过（报告 `iter-suba-verification-report.md`；T2 构造 session-idle 补测，引擎日志实证瞬态 RUNNING；手测判读曾凭引擎日志误立案"P1 失效"，经 sessions.sqlite 会话记录取证撤销——方法论教训已写入报告）。遗留观察项：手工停 DSH 会话语义（cancel 无痕+结算通知唤醒，未复现；方向 A 见探索报告）。阶段 3 可选：P5 事件驱动同步、P4 的产物 epoch 隔离后备。

**交付**：探索报告（子会话模式确认、interrupt vs prompt 实测、DSH UI 机制定位、方案选型）+ 会话树聚合守卫/stopReason 方案落地 + 双 subAgent 冲突治理（级联停止/回报丢弃/产物 epoch 隔离，其中 epoch 隔离兜底可独立先行交付）。

> **排序**：本探索迭代**放在 Iter-22（S1/S3/S4）之后**（Iter-22 为增量修复、相对不复杂）；若探索结论会改变 Stop 最终形态，可提前到 Iter-22 之前。启动时先按约定确认设计。

---

### Iter-23: 方向 A — 手工停 DSH 会话 = 权威停止（Host+Client）

**状态**：✅ **完成关闭**（2026-09-02 手测通过，`iter23-verification-report.md`；host v0.12.0 / client v0.6.0）
**前置**：探针报告 `iter23-probe-report.md`（stopa-6 动态插件用后 undefine；代码存档 `code/probes/stopa-user-stop-signal-probe.js`）

**问题（现状执行效果）**：

- **场景一**（停时编排 agent 正在回合中干活）：点会话停止 → agent 回断，但 wf 仍 RUNNING；子会话跑完的结算通知把 agent 再次唤醒继续编排——"停了又动"。
- **场景二**（停时编排 agent 空闲等子会话，即"复活"实测场景）：点击对 Host 零痕迹（cancel 纯 no-op 且 RPC 假性 accepted:true）——"点了像没点"。

**交付（效果承诺）**：

- **A1 场景一权威停止（Host 事件驱动主路径）**：workflow-host `ctx.on('session/event')` 监听绑定会话 `turn/end` 且 `data.reason={kind:'aborted',reason:{kind:'user'}}` → 即时处置：wf STOPPED + stopReason='user-stop' + 级联 interrupt running 子会话（复用 Iter-SUBA P3 路径）。用户效果：点停止瞬间面板 STOPPED(用户停止)、子会话秒级消失、后续完成通知免疫（P4）、Start 被拒（闭环不变式）。
- **A2 轮询兜底（Host）**：`syncInstanceState` 在 wf RUNNING+主 idle 的将停分支，先检会话日志**末条回合终局**是否 aborted(user)（live `agents.get(sid).session.log` 尾扫；探针实证部署版事件 payload 在 `data` 包装下）；命中走同一权威停止处置。检测失败/无信号降级为现状 session-idle 语义（不卡停）。
- **A3 场景二常驻提示条（Client，纯插件 UI，不动 DSH）**：`/wf/list` 新增 `stopHint` 字段（本会话绑定实例 RUNNING + 主会话 agent idle + 有 running 子会话时激活）；面板在实例卡片上方渲染提示条"编排会话空闲等待中：会话内的停止按钮此刻无效。后台任务执行中——要停止工作流请点面板 Stop"；状态解除自动消失。触发条件是**状态组合**而非点击事件（点击本身无信号，探针实证）。

**边界（探针实证，用户知情确认）**：Case I（空闲停）Host 原理性不可检测——场景二只承诺"即时提示+引导面板 Stop"，不承诺点击即停。

**验证（端到端）**：

- **V1 场景一**：RUNNING+agent 驱动中 → UI 停会话 → 面板 3 秒内 STOPPED(用户停止)+子会话消失；发"看下进度"不复活（P2/P4 不回归）；Start 被拒。
- **V2 场景二**：RUNNING+子在跑+主 idle → UI 停 → 提示条出现；按引导用面板 Stop → 子会话秒停。
- **V3 回归**：面板 Stop / 自然语言"请停止" / 自然收敛，三条路径行为与现状一致；单测全绿（aborted 原因判定矩阵：user 命中，parent/hook/disposed/legacy/完成/无记录排除）。

**改动面**：`plugins/workflow-host/instance-store.js`（isUserAbortTurnEnd/detectUserAbortFromLog 纯函数 + applyUserStop/handleSessionUserStop + sync 分支）→ sync-modules 同步；`workflow-host.mjs`（session/event tap + detectUserAbort 注入 + /wf/list stopHint）直接编辑；`client.js`（提示条渲染）；单测用例 17。

---

### Iter-24 ✅: 预定义目录与安装布局（块1，2026-09-02 关闭）

> 详案来源：iteration-replan-draft.md Iter-24 节 + `iter24-design.md`。本节旧详述（实例生命周期闭环+归档，旧编号时代）已按需求定稿重排移除，归档范围顺延至 Iter-29。

**交付**：
1. 全局预定义目录 `~/.dsh/workflow-agent/`（`${DSH_HOME:-~/.dsh}` 定位），子目录 `templates/`、`skills/`、`samples/`、`docs/`；
2. 插件安装/升级时物化内建模板与技能（同名覆盖幂等；samples/docs 骨架 README 仅缺失写；任一失败不阻断启动）；
3. 相对路径两级解析链：workspace 优先 → 预定义目录兜底（processor/gate/items-from/inputs 统一；绝对/`~` 直通；双 miss 回退 workspace 相对保持报错语义）；
4. `/wf/templates` 下拉源=预定义目录扫描+内嵌兜底合并（同名去重，磁盘版赢）；工作区 `templates/` 退出下拉。

**验收要点**：空白工作区开箱即用 default-demo（技能全部读自预定义目录）；既有工作区 workspace 优先不回归。
**决策记录**：A1 全局唯一 / A2 物化+同名覆盖 / A4 两级查找链。
**总结**：`iter24-report.md`（host v0.13.0/client v0.6.1，250 单测，git 8c65d10）。

---

### Iter-25 ✅: 数据流显性化（块1，2026-09-02 关闭）

> 详案：`iter25-design.md`（D1-D4 用户拍板）。本节旧详述（编排可视化编辑画布方案，旧编号时代）已被需求定稿的双栏编辑器形态取代 → Iter-28。

**交付**：
1. begin/start/status 返回展开后 `inputs`（命名字典，绝对路径）/`outputs`（绝对路径数组）/`skillDir`，同步落盘 state.json；
2. 目录变量 `${workspace}`/`${wf_dir}`/`${skills}`/`${skill_dir}` 展开期注入（两阶段：expandDefinition + finalizeDataflow 纯函数，与 `${param}`/`${item}` 同一正则）；
3. 门禁同时拿 inputs+outputs（R16）；派发 prompt 首行附"本技能全文来自 `<skillDir>`"（R21a）；
4. processor/gateChecker 可选——**D4：校验挂创建关口，与执行事件解耦**（create 返回结构化 warnings 不拦截；begin/start 不拦截；persona 运行时护栏 processor null 不派发并报告用户）。

**决议记录**：D1 inputs/outputs 相对路径以实例目录为基准绝对化（workspace 引用用 `${workspace}` 显式）/ D2 目录变量保留字优先于 params / D3 无 processor 任务 `${skill_dir}` 占位保留。
**遗留**：warnings 面板展示→Iter-28；缺 processor 升错误级校验→Iter-27（用户表态）。
**总结**：`iter25-report.md`（host v0.14.0/client v0.6.1，286 单测，git 53f022d）。

---

### Iter-26: items 结构化提取（块1）

**状态**：✅ 已关闭（2026-09-02 GUI 三组验收通过，报告 `iter26-report.md`；host v0.15.0，349 单测）

**交付**：
1. `items-format` 显式声明（`lines|markdown|json|yaml`，非法值 error）+ 扩展名推断（`.md→markdown / .json/.jsonl→json / .yaml/.yml→yaml / 其余→lines`）+ 行文本向后兼容（`lines` 为逃生门）；
2. 提取器（新共享模块 `items-extract.js`）：markdown **表格>列表**（列名=字段名）；JSON 数组/并列对象/JSON Lines；YAML 数组/并列 map（键恒为 `id`，标量值→`{id:键, name:值}`）；
3. 注入语义：`${item}` 默认链 **ID/编号字段（id/no/num/number/编号/序号）→ 名称字段（name/title/名称/标题）→ 1-based 顺序编号**；`${item.字段}` 单层标量（`PARAM_PATTERN` 扩展 `/\$\{(\w+(?:\.\w+)?)\}/g` 单遍扫描，itemCtx 可选形参缺省行为不变）；
4. **空提取→占位迭代**（Q1-b 拍板）：0 items（markdown 无表格无列表/空文件/空数组）→ 展开 1 个 `<组id>/empty` 占位迭代正常派发，`${itemVar}` 注入空串，行为由技能自行处理；文件不存在/坏 JSON/顶层标量仍报错（现状"空文件报错"取消）；
5. items 文件=workspace 文件或**启动时刻已存在**的实例文件（start/reset 路径 `${wf_dir}` items-from 支持，`expandDefinition` 增 dirCtx 传 `entry.dir`；begin 不重排）；
6. reset 语义修正：归档备份后清空 output/logs——**fs 服务无删除 API（实证 dsh-fs-local 仅 read/write/list/stat）→ 工具返回 `pendingCleanup`（rm 命令），由编排会话按 persona 契约用 bash 执行**；
7. samples/items 三格式样例物化 + `items-demo` 内建模板（三格式×loop/concurrent=6 任务，items 经两级链引用预定义 samples，开箱即跑）。

**验收要点**：三种格式各跑通 loop+concurrent（items-demo 模板建实例）；对象 item 路径注入（`output/${item.slug}.md`）正确展开；空 items 占位迭代可跑通；旧行文本定义零改动可跑（286 基线全绿）。

**GUI 验收修复（两轮反馈，随本迭代关闭）**：①静态 input 物化——begin/start/reset 时两级链命中的 input 复制进实例 `inputs/<相对结构>/` 并改写绝对路径（实例自包含；上游 output 引用不复制；连带修 resolveRefPath 的 detectPredefinedRoot require 兜底）；②编排 agent preset 挂 `@deepseek-ai/dsh-tool-bash`（pendingCleanup 执行前提）；③writeArchiveBackup 递归复制（含子目录；备份范围 output/logs/inputs；教训：加形参须同步递归调用行）；④占位迭代 `${itemVar}` 注入 `'empty'`（原空串产生 `output/empty/.md`）；⑤items-demo 模板 v1.1（补 inputs、name 去字面占位符）；⑥面板 reset 注入通知携带 `[清理契约]` 命令。

---

### Iter-26R: 运行时 items 展开（块1，自 Iter-26 拆分）
**状态**：✅ **完成**（2026-09-03 GUI 验收，host v0.16.0，387 单测，报告 iter26r-report.md，设计 iter26r-design.md）

**背景（2026-09-02 拍板）**：loop/concurrent 迭代节点在启动/重置时刻一次展开定死——"同一次运行内上游任务 output 作 items"（如 collect 产出清单→下游 loop 按清单展开）需**运行期延迟展开**，属架构级变更，拆分独立迭代，排 Iter-27 之前。Iter-26 的提取器/注入语义/`${wf_dir}` 拼写为其复用地基。

**交付**：
1. **组占位节点**：items 文件在启动时刻不存在（或声明延迟）的 loop/concurrent，展开为 1 个组占位任务（`_pendingItems` 标记），不派发 subagent；
2. **运行期展开**：组占位依赖全部 DONE 时，Host 读 items 文件（复用 `extractItems`）动态插入 N 个迭代任务到引擎任务表，占位节点转"已展开"终态；
3. **组完成语义 + 下游组依赖修正**：下游 `depends-on: [组id]` 现架构无对应任务 id（潜伏缺口）——定义组完成判定（全部迭代 DONE/SKIPPED），依赖组 id 的任务等待组完成；
4. **DAG 晚现节点渲染**（Client）：运行期插入的迭代节点/组框动态出现；
5. system-prompt 契约同步（延迟派发时序）。

**验收要点**：同运行 collect→`output/module-list.md`→loop 端到端；组依赖下游正确等待组完成；Iter-26 既有语义零回归。

---

### Iter-27a ✅: 预定义目录结构与实例化（块1，2026-09-03 关闭，自 Iter-27 拆分）

> 详案：`iter27-design.md`（拆分版 27a/27b；四轮拍板落档：①create 硬拦截→27b、②items 双语境、Q1 create 物化、Q2 目录结构调整、Q3 绝对豁免收窄至实例层、四点静态文件模型）。

**交付**：
1. templates **子目录自包含布局**（每工作流一子目录=发布单元；`<名>.yaml`+`inputs/...`，与实例目录同构镜像；samples/ 转纯参考不被引用；templates/README.md 迁移说明）；
2. **create/begin 1:1 复制**（四点②③）：preset 来源整目录复制进实例（定义写 instance.yaml、静态文件原样保结构、相对引用零调整、文本 only），返回 `presetCopy={copied,failed}`；
3. **静态 items 解析链**：实例目录（1:1 副本）→ defDir（模板子目录自愈）→ 两级链兜底；技能恒两级链（R4）；
4. **绝对路径=用户指定产物**（四点④）：create 经 params 注入或人工调整，引擎直通保持原样；
5. `/wf/templates` 扫描下钻子目录+平铺 legacy 兼容（同名**子目录赢**）；`/wf/create` 200 补 presetCopy；
6. 共享模块 `workflow-paths.js`（isAbsoluteishPath 前移+isVariablePath+resolveStaticPath+presetTemplateDirOf）；persona 契约同步（模板布局/1:1 复制/绝对路径入口）。

**验证**：单测 387→419 全绿（用例 23 共 28 项+用例 18 增补；修 1 真 bug：start 路径 src 缺 predefinedRoot 致预定义端探测丢失）；GUI 验收（用户）：**四内建模板开箱即用通过**。
**总结**：`iter27a-report.md`（host v0.17.0，client 不动）。

**27a 后补丁（2026-09-03，GUI 验收后用户提出定义层问题，host v0.17.1）**：items-from 与 inputs **互斥**约定——items-from=专用条目获取输入（仅用于循环/并发控制，条目值经快照 `_loopItem` 随派发传入子会话）；inputs=业务内容来源，禁重复声明 items 文件。落地：模板 7 处重复 inputs 清零（items-demo×6 v1.3 + runtime-items-demo analyze）；新建专用逐 item 技能 `item-processor`（正文=按派发 item 值处理+empty 空清单占位语义；integrator 保持 default-demo 两输入汇总不被误伤）；persona 派发契约补「迭代任务 prompt 带 `item = <_loopItem>` 行」；27b 校验表记 **W-ITEMS-INPUT-DUP（警告级，用户拍板）**。421 单测。

---

### Iter-27b ✅: 语义校验（块1，R8/R12，2026-09-04 关闭）

> **设计已确认（2026-09-03，iter27-design.md 拆分版四轮拍板）**：缺 processor / gate 缺 checker 升**错误级**结构化清单；**拍板①=create 硬拦截**（begin 同拒；start/resume 闸门保留防创建后退化+legacy；reset 回传不拦；R11 流程变化=Iter-28 前补全=修定义/补技能后重新 create）；**拍板②=items 双语境**（preset 定义语境=模板子目录锚点+禁字面绝对路径 E-ABS-IN-DEF；实例语境=实例目录 1:1 副本优先→绝对直通）。

**交付**：
1. 校验引擎（Host 端纯函数 + 工具暴露 `workflow_validate`）：技能存在性（预定义+workspace 两级）、输入文件存在性（workspace 或上游 outputs）、**上下游 outputs↔inputs 衔接**、dependsOn 闭环/无环、items 文件存在与格式可解析、缺 processor 给出必须指定的错误；
2. 挂 create / start 关口（**create/begin 硬拦截**，start/resume 实时闸门，reset 回传不拦——拍板①=B）；
3. 校验结果**结构化返回**（错误清单：任务/字段/原因），供编辑界面与面板展示。

**验收要点**：default-demo 破坏性用例（删技能/删上游输出/造环/缺 processor）逐项报出可读错误；完好定义零误报。

**关闭（2026-09-04）**：host v0.18.0，485 单测全绿（用例 24 新增 59 项）。校验引擎 `workflow-validate.js`（第 10 同步 section；fs 缺失降级不误报；raw 禁绝对/展开值存在性双轨）+ create/begin 硬拦（零副作用）+ start/resume 实时闸门 + reset 回传 + `workflow_validate` 只读工具 + `/wf/create` 同款关口 + 拒绝响应 `hint`（**验收修正安全红线**：被拦后 LLM 只许转告清单+停止，严禁自行搜索/替换技能或输入文件——首次复验曾自行拿同名旧技能顶替）。GUI 验收通过。查找次序记档：技能两级链工作区→预定义，同名替代（工作区优先）用户拍板当前可接受、路径固化留作可选加固。遗留→Iter-28：warnings 面板展示、编辑保存触发校验。**总结**：`iter27b-report.md`。

---

### Iter-28: 实例编辑前台（块2）

**交付**：
1. **DAG 页下方双栏编辑器**：左侧任务列表（类型/状态），右侧选中任务属性表单（inputs 路径、outputs 路径、process 技能下拉、gateChecker 下拉、门禁重试、任务并发）；顶部实例级（名称、总并发、params 键值表）；
2. 技能下拉数据源：扫预定义 `skills/`，展示**名称+版本**（frontmatter）；
3. 保存=写回 instance.yaml（只作用于本实例）；保存时触发 Iter-27 校验并展示结果；
4. 状态门控：RUNNING **可见禁用**（提示运行中不可编辑）；COMPLETED/FAILED 同禁用（重跑走 reset）；
5. 创建弹窗展示 create warnings（承接 Iter-25 遗留）；模板下拉源=预定义目录（与 24 联动收尾）。

**验收要点**：新建实例→补全缺 processor 的任务→保存校验通过→启动跑通（R11 主链路）；编辑不污染预定义目录文件（R5）。

**关闭（2026-09-04）**：host v0.19.0 / client v0.7.0，529 单测全绿（用例 25 新增 44 项）。`workflow-edit.js`（第 11 同步 section：稳定序列化/权限矩阵/applyInstancePatch 白名单）+ /wf/skills·instance-yaml·validate-instance·instance-yaml 路由（保存=校验先于落盘，注释头保留）+ EditorPanel 双栏编辑器与创建对话框 params 键值行/warnings 面板（Iter-25 遗留清）。两轮验收修正：inputs「+添加」entries 中间态、RUNNING 编辑按钮灰禁+编辑器外部 stage 即时刷新、**params 传递**（workflow_status 快照挂 meta.params + persona 派发模板加 `params = <JSON>` 行——首修踩坑：persona 实际生效 agent.cordis.yml 内联 text，只改 md 无效）→ **persona 单源化 A 方案**（system-prompt.md 唯一源+sync-persona.js 注入，md 修 v1 串行残留→v2 并发；rc2 dsh-persona 内联限制记档 architecture-decisions.md §8 含 DSH 升级检查项）。GUI 验收通过（含 params 进 subagent 首条消息复验）。**总结**：`iter28-report.md`。遗留→Iter-29（实例管理子页签+归档/下载/删除，独立可提前）。

---

### Iter-29: 实例管理子页签 + 归档/下载/删除（块4，独立可提前/并行）

**状态**：✅ **完成关闭**（2026-09-05，`iter29-report.md`；host v0.20.0 / client v0.8.0）

> **平台边界（Iter-26 实证，2026-09-02）**：DSH fs 服务（dsh-fs-local）**无删除/移动 API**（公开方法面仅 resolve/readText/writeText/editText/listDir/stat/lstat/readBytes/withLock；node rm/rename 被 import 但服务面有意不暴露；bash 能力缝 `ctx.subprocess` 同样不对插件开放 inject）。本迭代"删除实例""打包下载"若 Host 侧无法直接实现，须复用 Iter-26 reset 的 **pendingCleanup 模式**（工具返回命令、编排会话 bash 执行）或届时评估扩展通道；备份/打包还需注意 writeArchiveBackup 只复制顶层文件不递归子目录的既有局限。

**交付（实作与原案差异见括注）**：
1. **实例管理子页签**：列表分**活动/归档**两段；列=名称、ID、状态、任务进度、绑定会话、创建时间（实作为「📋 管理」按钮与 DAG 互斥切换，非常驻列表）；
2. 归档全链（沿用已定稿设计 `workflow-lifecycle-design.md`：`archive/<id>/<时间戳>_<类别>_<状态>/` + manifest；**归档按钮覆盖 STOPPED/COMPLETED/FAILED**；绑定会话终态 DONE）。原案"归档后原始目录 pendingCleanup 清理"**改为 Host node:fs 直删**（用户拍板：Session 不越权删 workspace 级数据；npm 包 CJS 形态 require 完整可用，三重查证见报告）；
3. **打包下载**：多选（活动+归档跨段）打**一个 zip**（包内按实例/归档条目分目录），纯 JS STORE zip writer 零依赖；
4. **删除**：原案"非 RUNNING 可删（含活动实例）"**收窄为仅归档段可删**（用户拍板保守防误删；活动实例只能归档）。

**验收要点**：全生命周期走查——创建→运行→停止→归档→列表两段可见→下载 zip 内容完整→删除后列表消失。✅ GUI 验收通过（少量展示/交互小问题留待后续规划）。

---

### Iter-30: DAG 美化与交互（块3）

**交付**（范围待本迭代开工前细化确认）：
1. 节点详情面板（点击节点展示：状态、inputs/outputs、技能、门禁结果——数据依赖 Iter-25 落盘）；
2. 视觉与布局优化（配色/层次/进度表达/运行态动画/自动跟随）；
3. 交互增强按需取舍（缩放平移等）。

**依赖关系**：

```
24 预定义目录 ──→ 25 数据流显性化 ──→ 26 items 提取 ──→ 26R 运行时 items 展开 ✅
      │                │                                  │
      │                └──────────→ 27 语义校验 ──→ 28 编辑前台
      │                                                  
      └──────────────────────────────→ 28（技能下拉源）
                                              
29 归档/下载/删除（独立，可提前/并行）
30 DAG 美化 ←─ 25（节点详情数据）
```

---

## 4. 风险

| # | 风险 | 影响 | 被哪个迭代暴露 |
|--|------|------|--------------|
| R1 | `subagent` 并发启动多个是否稳定 | 高 | Iter-7 |
| R2 | Agent prompt 在复杂循环下的推理准确性 | 中 | Iter-6 |
| R3 | 多实例切换时的状态一致性 | 高 | Iter-11/12 |
| R4 | DSH 版本产生接口变化（已确认：alpha.2 退役 APIProxy） | 中 | 随时 |
| R5 | webServer 路由冲突（`/wf/*` 与既有路由） | 中 | Iter-5 |
| R6 | fetch 轮询跨域/同源策略限制 | 中 | Iter-5 |
| R7 | concurrent 组级/工作流级 max 取最严格的调度执行 | 中 | Iter-8 |
| R8 | 实例=session 映射（sessionId↔instanceId via metadata）可靠性 | 中 | Iter-10 |
| R9 | 多 session 并行资源占用 / DSH 前端 session 切换跟随 | 中 | Iter-12 |

---

## 5. 待规划：DSH 版本迁移（`0.1.2-alpha.x`+）

> **状态：待规划**。当前仍以 DSH `0.1.1-rc.2`（`latest` 稳定版）为基线迭代，**暂不迁移**。
> 本小节仅登记迁移事项，待 DSH `0.1.2` 出稳定版且时机成熟时再单独立项规划具体执行。

- **背景**：`0.1.2-alpha.2` 已确认**退役 `APIProxy`**，改用 Remote/Controller（Typert）架构。这属于破坏性变更。
- **对 workflow-agent 的直接影响**：插件 `inject` 把 `apiProxy` 声明为硬依赖（`code/packages/workflow-host/lib/index.js:7`、`code/agent-presets/workflow-orchestrator/workflow-host.mjs:8`），且面板控制（启动/停止/继续/重置）的消息注入依赖 `apiProxy.sessions.prompt` / `apiProxy.subagents.prompt`。
- **影响分析与迁移方案要点**：见 **`plan/development/alpha-0.1.2-migration-impact.md`**（已建，含详细定位、新旧接口对照、迁移 Checklist、初步方案）。
- **规划时点**：等 DSH `0.1.2` 进入稳定通道后再评估；alpha 属测试通道，不在其上进行功能迭代。
- **迁移前必做**：
  1. 确认 `ctx.get('sessionController')` 存在及其 `prompt` 精确签名（当前 GitHub 在本机不可达，需对照 alpha `.d.ts` 复核）。
  2. 先跑通 rc2 基线回归用例，锁定行为基线。
  3. 重点回归「面板 4 键 → agent 是否真正感知」（Iter-21 曾修「按钮无效/agent 不感知」）。