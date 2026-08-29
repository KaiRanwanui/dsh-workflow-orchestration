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
已完成: Iter-1(引擎) → Iter-2(编排) → Iter-3(监控) → Iter-4(循环) → Iter-5(架构) → Iter-6(错误处理) → Iter-7(并发引擎) → Iter-8(并发语义完善) → Iter-9(多实例技术验证) → Iter-10(实例目录与存储) → Iter-11(实例操控工具) → Iter-12(前台实例界面) → Iter-13(面板创建按钮+模板库v1) → Iter-14(消息注入技术穿刺) → Iter-15(面板控制) → Iter-16(运行状态机) → Iter-17(绑定模型+完整性) → Iter-18(控制工具+路由+孤儿回收) → Iter-19(WebUI↔workflow 配合调优)
当前:   Iter-20(前后台状态一致，Iter-19 收尾)   ← 待开发   （其后 Iter-21 生命周期闭环+归档 / 22 编排编辑器）
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
| **20** | 前后台状态一致（Iter-19 收尾 + 绑定体验） | R1(/wf/list 路由补 sessionState + Client create/start gating)、R2(面板 Start 不置 RUNNING，状态归 workflow_start)、R4(Session 启停同步覆盖列表路径)；实例列表并入创建界面（R3）；绑定/采用/锁定；预设门控；BROKEN 展示 | 端到端：面板建实例(绑定)→仅显示本会话绑定→Start 单权威 RUNNING→会话启停同步→列表无过期状态；前后台状态一致 | Iter-19 |
| **21** | 实例生命周期闭环 + 归档（Host+Client） | Host 归档（移出池/reset 备份/显式归档/list/download/delete）+ Client 状态机按钮(Start/Stop/Resume/Reset/Archive) + 归档 UI | 端到端：绑定→start→stop→resume→reset→archive 闭环；归档 list/download/delete | Iter-20 |
| **22** | 编排可视化编辑（体量最大，拆子迭代） | DAG 拖拽编辑 + YAML 生成，双模式（模板/实例，见 instance-creation-semantics.md §2） | 编辑器创建/编辑工作流→运行成功 | Iter-21 |

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

**交付**：
- **R2（状态权威）**：`/wf/start` 路由**不置 RUNNING**，只校验+注入消息；状态由编排侧 `workflow_start` 统一维护（消除双写冲突，B4）。
- **R1（gating 数据源）**：`/wf/list` 路由补 `sessionState`；Client create/start gating：会话 UNBOUND 才显示"+"，仅显示本会话绑定实例为当前项。
- **R4（同步覆盖列表路径）**：Session 启停同步从 `forSession` 扩展到 `/wf/list`（按派生状态对绑定实例 idle→stop、running→resume），避免列表过期 RUNNING。
- **R3（实例列表并入创建界面）**：实例选择从常驻切换条移入创建界面（可从模板创建或选一个未绑定实例）；面板只显示当前会话绑定实例。
- **绑定体验（Client）**：预设门控（仅 workflow-orchestrator 显示页签/DAG/控件）；绑定（新建/采用/锁定）；BROKEN 展示"环境异常，需新建 workflow 会话"。

**验证（端到端）**：面板建实例(绑定)→仅显示本会话绑定→Start 单权威 RUNNING→会话启停同步→列表无过期状态；前后台状态一致（A/B/C/E 场景全 PASS）。含绑定/门控/BROKEN 展示。

---

### Iter-21: 实例生命周期闭环 + 归档（Host+Client）

**技术方案**：`plan/design/workflow-lifecycle-design.md` §5/§7

**交付**：
- **Host 归档**：归档实例内容**移出池**进 `archive/<instanceId>/<ts>_<kind>_<state>/`（kind=reset|archive，state=归档时运行态）+ `manifest.json`；`listArchive`/`downloadArchive`(zip)/`deleteArchive` 工具+路由；归档后会话 BOUND→DONE；重置写 `reset_<state>`、显式归档用 `archive_<state>` 区分；
- **Client 状态机按钮**：按运行态渲染 start/stop/resume/reset/archive + 确认框（reset/归档确认）；
- **归档管理 UI**：list / download / delete。

**验证（端到端）**：绑定→start 执行 DAG→stop→resume→reset→archive 全闭环；归档 list/download/delete。

---

### Iter-22: 编排可视化编辑（体量最大，拆子迭代顺序推进）

**范围修订（v2，见 instance-creation-semantics.md §2）**：编辑器双模式——模板模式（读模板编辑 → 创建实例用）与实例模式（打开实例 `instance.yaml`；CREATED 可写回快照 + metadata.updatedAt，RUNNING 禁保存）。**实例 = 模板 + 配置，严格区分**。模板保持只读参照，已建实例不受模板后续编辑影响。

**输入**：Iter-21 生命周期闭环（编辑器"保存并启动"依赖控制通道）。

**拆分预案**（前台开发反馈周期长，按子迭代顺序交付、每个可用）：

| 子迭代 | 交付 | 验证 |
|--------|------|------|
| 22.1 | 画布骨架：节点拖拽 + 框选 + 只读渲染现有 YAML | 打开实例快照 → DAG 正确显示 |
| 22.2 | 连线编辑：depend-on 增删 | 图形关系 ↔ YAML 同步一致 |
| 22.3 | 节点配置面板：processor/inputs/outputs/gate/timeout | 配置项完整写回 YAML |
| 22.4 | 模板↔实例闭环：模板模式编辑 + "创建实例"入口；实例模式写回（CREATED） | 面板建实例 → 编辑 → start 编排成功 |

**验证标准**：

```
打开编辑器 → 拖入 2 个 Task 节 → 配 processor/inputs/outputs
→ 连定义依赖 → 加 Gate → 保存 YAML
→ 切换到监控式 → 启动 → 运行成功
```

---

## 4. 风险

| # | 风险 | 影响 | 被哪个迭代暴露 |
|--|------|------|--------------|
| R1 | `subagent` 并发启动多个是否稳定 | 高 | Iter-7 |
| R2 | Agent prompt 在复杂循环下的推理准确性 | 中 | Iter-6 |
| R3 | 多实例切换时的状态一致性 | 高 | Iter-11/12 |
| R4 | DSH 版本产生接口变化 | 中 | 随时 |
| R5 | webServer 路由冲突（`/wf/*` 与既有路由） | 中 | Iter-5 |
| R6 | fetch 轮询跨域/同源策略限制 | 中 | Iter-5 |
| R7 | concurrent 组级/工作流级 max 取最严格的调度执行 | 中 | Iter-8 |
| R8 | 实例=session 映射（sessionId↔instanceId via metadata）可靠性 | 中 | Iter-10 |
| R9 | 多 session 并行资源占用 / DSH 前端 session 切换跟随 | 中 | Iter-12 |