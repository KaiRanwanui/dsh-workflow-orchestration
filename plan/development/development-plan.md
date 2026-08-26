# Development Plan — workflow-agent

## Document Control

| Field | Value |
|-------|-------|
| Project Name | workflow-agent |
| Version | 0.3 |
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
Iter-1     Iter-2     Iter-3     Iter-4          Iter-5              Iter-6          Iter-7         Iter-8
  │          │          │          │               │                   │               │              │
  Host      Agent     Client     Loop +          循环错误处理 +      并发执行         多实例         编排编辑器
  插件       Preset    监控面板    循环展开         DAG 布局优化        引擎            管理
  (引擎)     (编排)    (UI)       ─── Iter-4 完成 ──
```

| 迭代 | 名称 | 核心交付 | 验证方式 | 依赖 |
|------|------|---------|---------|------|
| **1** | Host 插件 — 引擎基础 | 解析器 + 状态管理 + Tool/RPC | `workflow_begin` 返回正确结构 | PoC |
| **2** | Agent Preset — 串行编排 | 编排 Agent：串行执行 + Gate + 重试 | 2-Task 串行工作流端到端 | Iter-1 |
| **3** | Client 插件 — 监控面板 | conversation.view Tab + N 节点 DAG | 浏览器实时显示执行状态 | Iter-1,2 |
| **4** | 循环 + 循环展开 | Loop Task 解析、展开、串行迭代 | 循环 3 次的工作流执行 | ✅ **完成** |
| **5** | **循环错误处理 + DAG 布局优化** | **onError(break/continue) + >4 items 折叠/展开** | **中断/继续 + 折叠布局验证** | **Iter-4** |
| **6** | 并发执行引擎 | max-concurrency 生效，无依赖 Task 并行 | 并行 Task + 并发循环迭代 | Iter-5 |
| **7** | 多实例管理 | 定义多个流、暂停/切换/恢复 | 2 个流切换执行 | Iter-6 |
| **8** | 编排编辑器 | DAG 拖拽编辑 + YAML 生成 | 用编辑器创建并运行工作流 | Iter-7 |

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

### Iter-5: 循环错误处理 + DAG 布局优化（1 人天）

**输入**：Iter-4 循环展开功能已完成

**修改范围**：

| 组件 | 改动 |
|------|------|
| `workflow-schema.js` | 新增 loop 类型 `onError: break \| continue` 可选字段 |
| `workflow-parser.js` | `normalizeTask()` 增加 `onError` 字段解析，默认 `break` |
| `tools-preset.js` / `tools.js` | `expandLoopTasks()` 将 `onError` 复制到每个展开迭代的 `_onError` |
| `engine.js` | 任务 FAILED 后检查 `_onError`：<br>— `break`：标记同组 PENDING → SKIPPED<br>— `continue`：继续执行<br>`getNextRunnableTask()` 跳过 SKIPPED 任务 |
| `client-body.txt` | 循环组布局：<br>— ≤4 items：水平排列（同当前）<br>— >4 items：折叠态（进度条 + ✅🔄❌⏭ 计数）<br>— 点击展开：垂直列表<br>— SKIPPED 状态：琥珀色 `#f59e0b` + 虚线边框 |

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

### Iter-6: 并发执行引擎（1 人天）

**输入**：Iter-5 循环错误处理完成

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

### Iter-7: 多实例管理（1 人天）

**输入**：Iter-6 并发可用

**修改范围**：

| 组件 | 改动 |
|------|------|
| engine.js | 多实例状态 Map + 切换逻辑（暂停→换出→入→恢复）|
| tools.js | `workflow_list`、`workflow_switch` |
| rpc.js | 实例查询 RPC|
| system-prompt | 实例管理能力提示 |
| client | 实例列表 + 切换按钮 + 志面版 |

**验证标准**：

```
定义 WFA(3 Task) 和 WF-B(2 Tsk)
→ 启动 WFA，Task1 → 暂停
→ 切换到 WFB，执行 Task1→Taks2→完成
→ 切回 WFA，恢复 → Take→Tas3→完成
```

---

### Iter-8: 编排编辑器（1 人天）

**输入**：Iter-7 多实例可用

**产出**：`code/plugins/workflow-client/editor/`

| 文件 | 职能 |
|------|------|
| `canva.js` | 节点拖拽 + 框选 |
| `edg.js` | depend-on 连线 |
| `noode-configjs` | 节点配置面板 |
| `yam-sync.js` | 图形 ↔ YAML 同步 |

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
| R1 | `subagent` 并发启动多个是否稳定 | 高 | Iter-6 |
| R2 | Agent prompt 在复杂循环下的推理准确性 | 中 | Iter-5 |
| R3 | 多实例切换时的状态一致性 | 高 | Iter-7 |
| R4 | DSH 版本产生接口变化 | 中 | 随时 |