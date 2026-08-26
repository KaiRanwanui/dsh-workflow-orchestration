# 架构方案（推荐）：DSH Agent Preset + Agent 驱动编排

## 设计目标

基于 `RR/Raw_Reqs.md` 中的原始需求，`software-design-agent` 的整体架构遵循以下原则：

1. **以 DSH 为宿主**：所有运行时能力通过 DSH Agent Preset 注入
2. **Agent 驱动的流程调度**：工作流编排由专用 Agent（LLM）执行，用户可通过对话实时介入
3. **兼容 skill 体系**：Task 处理指令和质量门禁指令复用 DSH skill.md 格式
4. **渐进式交付**：先做概念验证，再分阶段实现

---

## 核心运行时模型

### 编排模式：Agent 驱动的对话式编排

```
用户
  │ 对话
  │ "启动 IR 设计工作流"
  │ "把 max-retries 改成 3"
  │ "这个 Gate 结果不对，手动通过"
  ▼
┌──────────────────────────────────┐
│     工作流 Agent (DSH Preset)     │
│                                  │
│  System Prompt:                  │
│  "你是一个工作流编排 Agent。      │
│   读取工作流 YAML 定义，           │
│   按步骤调用 subagent 执行 Task，  │
│   读取 Gate 结果判 PASS/FAIL，     │
│   必要时重试。用户可随时介入。"    │
│                                  │
│  工具：subagent, read, write,    │
│        skill, bash               │
└──────────────────────────────────┘
  │
  │ 调 subagent 工具（嵌套子 Agent）
  │
  ├──→ Task Agent: 需求分析
  │     │ processor: skill.md
  │     │ inputs: ir-sample.md
  │     │ outputs: analysis.md
  │     └── (独立 LLM 会话，已确认嵌套可用)
  │
  ├──→ Gate Agent: 质量门禁
  │     │ checker: skill.md
  │     │ inputs: analysis.md
  │     │ outputs: gate-result.md
  │     └── (独立 LLM 会话，不共享 Task 上下文)
  │
  └──→ 读 gate-result.md → 判 PASS/FAIL → 决定重试/继续/暂停
```

### 与"确定性引擎"方案的对比

| | 确定性引擎（原方案） | Agent 驱动编排（当前方案） |
|---|---|---|
| **编排者** | JavaScript 代码（状态机） | LLM Agent（对话 + 工具调用） |
| **触发方式** | RPC `workflow:execute` | 用户对话 / Tool 调用 |
| **用户介入** | 需单独设计"暂停-干预-恢复"机制 | 天然支持：对话就是交互界面 |
| **流程修改** | 需解析 YAML + 重建状态机 | 对话中直接改定义，Agent 自适应 |
| **编排开销** | 零 LLM token | 编排本身消耗 token |
| **可预测性** | 确定 | 依赖模型推理质量 |
| **适合场景** | 批处理、CI/CD | 交互式设计、需要人工判断 |

### 调度架构：Agent Loop 内的 subagent 嵌套

```
DSH Agent Loop（工作流 Agent）
  │
  │ ctx.tool('subagent', { prompt: task_prompt })
  │
  ├──→ subagent session #1（Task A: 需求分析）
  │     │ 独立 LLM 上下文
  │     │ 读写 workspace 文件
  │     │
  │     └──→ subagent session #1.1（如需要，可嵌套）
  │
  ├──→ subagent session #2（Gate A: 需求分析评审）
  │     │ 独立 LLM 上下文
  │     │ 只能读 Task A 的输出文件
  │     │ 不记得 Task A 的对话
  │
  ├──→ subagent session #3（Task B: 功能设计）
  │     │ depends-on: [Task A]
  │
  └──→ subagent session #4（Gate B: 功能设计评审）
```

**关键验证（PoC 已确认）：**
- ✅ subagent 嵌套可用 → 工作流 Agent 可以调子 Agent
- ✅ 子 Agent 可用 `write` 工具写文件 → 中间件序列化可靠
- ✅ 子 Agent 之间 LLM 上下文隔离 → 门禁不污染 Task 上下文
- ❌ `subagents.start()` Service API 在插件 Tool 中不可靠（子 Agent `stopReason: error`）
- ❌ `llm.stream()` 在插件 Tool 中返回空流

---

## 工作流定义格式（YAML）

```yaml
name: ir-design-workflow
version: "1.0"
description: "从初始需求 IR 到分配需求 AR 的标准设计工作流"

params:
  ir_document:
    type: string
    description: "IR 文档路径"
  project_name:
    type: string
    description: "项目名称"

tasks:
  - id: req-analysis
    name: "需求分析"
    processor: skills/requirement-analysis/SKILL.md
    inputs: ["${ir_document}"]
    outputs: ["output/${project_name}/req-analysis.md"]
    depends-on: []
    timeout: 600
    quality-gate:
      checker: skills/req-review/SKILL.md
      on-failure: retry
      max-retries: 3

  - id: func-design
    name: "功能设计"
    processor: skills/functional-design/SKILL.md
    inputs:
      - "output/${project_name}/req-analysis.md"
      - "context/tech-stack.yaml"
    outputs: ["output/${project_name}/func-design.md"]
    depends-on: [req-analysis]
    quality-gate:
      checker: skills/func-design-review/SKILL.md
      on-failure: block

  - id: func-decomp
    name: "功能分解 → AR"
    processor: skills/func-decomposition/SKILL.md
    inputs: ["output/${project_name}/func-design.md"]
    outputs: ["output/${project_name}/allocated-requirements.md"]
    depends-on: [func-design]

  - id: human-approval
    name: "人工确认 AR"
    type: human-decision
    inputs: ["output/${project_name}/allocated-requirements.md"]
    depends-on: [func-decomp]
    prompt: "请审核上述分配需求(AR)，确认是否合理。批准请回复 'APPROVED'，需要修改请给出具体意见。"
```

### Task 类型

| 类型 | 说明 | 执行方式 |
|------|------|---------|
| `llm-task`（默认） | LLM 处理任务 | 工作流 Agent 调 `subagent` 工具，子 Agent 加载 `processor` skill |
| `quality-gate` | 质量门禁（由 `quality-gate` 配置自动触发） | 工作流 Agent 调 `subagent` 工具（独立会话），子 Agent 加载 `checker` skill |
| `human-decision` | 人工决策点 | 工作流 Agent 等待用户回复 |
| `external-agent` | 调用外部 Agent 工具 | 通过 bash/HTTP 适配器调用 CLI/MCP |

---

## Agent Preset 设计

### 工作流 Agent 的 System Prompt（核心）

```markdown
你是一个软件设计工作流编排 Agent。你的职责是：

1. 读取工作流 YAML 定义，理解 Task 依赖关系和执行顺序
2. 按顺序（或并行）调用 subagent 工具执行每个 Task
3. 每个 Task 结束后，如果配置了 quality-gate，调用独立的 subagent 执行门禁
4. 读取 gate-result.md 判定 PASS/FAIL：
   - PASS → 继续下一个 Task
   - FAIL → 根据 on-failure 策略（retry/block/skip）执行
   - retry 时重新执行 Task，达到 max-retries 上限后标记 FAILED
5. 用户可以随时介入：
   - 修改工作流定义（"把 max-retries 改成 3"）
   - 手动裁决门禁（"这个 PASS"）
   - 跳过/暂停 Task
   - 查看任意子 Agent 的会话记录
```

### 工作流 Agent 的工具箱

| 工具 | 用途 |
|------|------|
| `subagent` | 启动 Task/Gate 子 Agent（独立会话） |
| `read` | 读 YAML 定义、Skill 文件、中间产出物 |
| `write` | 更新工作流定义、写状态日志 |
| `skill` | 加载 Skill 获取 Task 处理指令 |
| `bash` | 外部工具调用（opencode、hermes 等） |

---

## 数据流（IPO 模型）

```
Task A (Producer)                    Task B (Consumer)
┌──────────────┐                    ┌──────────────┐
│ processor:   │                    │ processor:   │
│  skill.md    │                    │  skill.md    │
│              │                    │              │
│ inputs:      │                    │ inputs:      │
│  - ir.md ────┼── 从 workspace ────┼── 读取文件    │
│              │    读取            │              │
│ ── LLM 处理 ─│                    │ ── LLM 处理 ─│
│              │                    │              │
│ outputs:     │                    │ outputs:     │
│  - result.md─┼── 写入 workspace ──┼── 读取文件    │
└──────────────┘                    └──────────────┘

所有 Task 通过 workspace 文件交换数据
不共享 LLM 上下文，不传递内存对象
保证隔离性和可追溯性
工作流 Agent 负责协调，但不参与 Task 的具体处理
```

---

## 两层协作：Agent 编排 + UI 呈现

PoC 已验证的两层模式：

```
Agent Loop（编排层）              Cordis 插件（呈现层）
┌──────────────────────┐       ┌──────────────────────┐
│ 调 subagent → Task    │       │ Client Slot           │
│ 调 update_workflow_   │──→Tool│  SVG DAG:             │
│   status({           │       │   需求分析 ● DONE     │
│     status:'GATE_    │       │        ↓              │
│     RUNNING'         │       │   质量门禁 ◐ RUNNING  │
│   })                 │       │                       │
│                      │       │  RPC 轮询 (1500ms)     │
│ 调 subagent → Gate   │       │  颜色实时跟随          │
│ 调 update_workflow_   │       └──────────────────────┘
│   status({           │               ↑
│     status:'COMPLETED'│       Host: insts map
│     gateResult:'PASS' │       ← RPC handler
│   })                 │
└──────────────────────┘
```

| 桥接组件 | 机制 | 方向 |
|---------|------|------|
| `update_workflow_status` | Model Tool（Agent 调用） | Agent → Host |
| `workflow:status` | RPC（Client 轮询） | Host → Client |
| SVG DAG | 纯 React SVG（无外部依赖） | Client 渲染 |
| 颜色驱动 | PENDING 灰 / RUNNING 蓝橙 / COMPLETED 绿 / FAILED 红 | Client 逻辑 |

### DAG 渲染方案

不使用 Mermaid（动态插件不支持 npm import），用纯 SVG 实现：

- `React.createElement('svg', ...)` 画节点矩形 + 箭头
- 节点坐标硬编码或从 Host 状态中获取 DAG 结构
- 颜色由 `status` + `gateResult` 字段驱动
- 可扩展为 N 节点：只需增加节点数组遍历 + 坐标计算

---

## 与 DSH 原生的关系

本方案**不修改 DSH 源码**。所有能力通过 DSH 原生机制实现：

| 需求能力 | DSH 机制 |
|---------|---------|
| 工作流编排 | Agent Preset 的 system prompt + 工具调用 |
| Task 隔离 LLM 会话 | `subagent` 工具（模型层，已确认嵌套可用） |
| Task 处理指令 | `skill` 加载机制 |
| 用户交互 | 对话本身就是交互界面 |
| 中间件传递 | workspace 文件（`write`/`read` 工具） |
| 沙箱安全 | DSH Sandbox Policy |

---

## 下一步

PoC 已验证核心数据流（Task → 中间件 → Gate → PASS/FAIL）。下一步：

1. 设计工作流 Agent 的 DSH Preset（system prompt + 工具配置）
2. 定义完整的 YAML schema（支持并行、条件分支、人工决策）
3. 实现 3-Task 工作流端到端验证