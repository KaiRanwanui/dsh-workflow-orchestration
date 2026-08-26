# Software Requirements Specification — workflow-agent

## Document Control

| Field | Value |
|-------|-------|
| Project Name | workflow-agent |
| Version | 0.3 |
| Status | **DRAFT — 部分澄清，核心需求已确认** |
| Date | 2025-01 |
| Based on | `RR/需求-从PoC到正式开发.md` + `RR/Raw_Reqs.md` + PoC 验证结论 |

---

## 1. Introduction

### 1.1 Purpose

workflow-agent 是一个基于 DeepSeek Harness (DSH) 的通用工作流编排框架，通过 DSH 插件
和 Agent Preset 的协同，提供工作流的定义、编辑、执行、监控和人工干预能力。

### 1.2 Scope

本系统作为 DSH 的扩展（插件 + Agent Preset），不修改 DSH 内核。所有能力通过 DSH 原生
机制实现（Cordis Plugin、Agent Preset、SubAgent、Skill、Tool）。

### 1.3 Definitions & Acronyms

| 术语 | 含义 |
|------|------|
| DSH | DeepSeek Harness — 宿主运行环境 |
| Workflow | 一组 Task 按依赖关系编排形成的执行流程 |
| Task | 工作流中的最小执行单元（IPO 模型） |
| IPO | 输入(Input) → 处理(Processor) → 输出(Output) |
| Skill | DSH 技能文件（markdown 格式定义 LLM 指令） |
| Quality Gate | 质量门禁 — 对 Task 输出进行独立审查的环节 |
| Agent Preset | DSH Agent 的预设配置（persona + 工具 + prompt） |
| Gate | Quality Gate 的简称 |
| SubAgent | DSH 的 subagent 工具（独立 LLM 会话的 Agent 调用） |

### 1.4 参考文档

| 文档 | 位置 |
|------|------|
| 原始需求 | `RR/Raw_Reqs.md` |
| 目标调整后需求 | `RR/需求-从PoC到正式开发.md` |
| PoC 设计方案 | `PoC/design.md` |
| PoC 验证报告 | `PoC/REPORT.md` |
| 架构方案 | `solutions/architecture-proposal.md` |
| Pre-1.0 PoC 开发计划 | `PoC/development-plan.md` |

---

## 2. Overall Description

### 2.1 Product Perspective

workflow-agent 与 DSH 的关系：

```
┌──────────────────────────────────────────┐
│              DSH 宿主环境                  │
│  ┌────────────────────────────────────┐   │
│  │      workflow-agent 插件系统        │   │
│  │  ┌─────────┐   ┌──────────────┐   │   │
│  │  │ Host 端  │   │ Client 端 UI  │   │   │
│  │  │ (引擎+   │◄──►│ (DAG+监控+   │   │   │
│  │  │  Tool+   │ RPC│  会话交互)   │   │   │
│  │  │  RPC)    │    │              │   │   │
│  │  └────┬────┘   └──────────────┘   │   │
│  │       │ 调 Tool                    │   │
│  │  ┌────▼────────────────────────┐   │   │
│  │  │  工作流 Agent Preset (LLM)   │   │   │
│  │  │  - 读取 YAML 定义            │   │   │
│  │  │  - 调 subagent 执行 Task     │   │   │
│  │  │  - 调 subagent 执行 Gate     │   │   │
│  │  │  - 判断 PASS/FAIL → 重试     │   │   │
│  │  │  - 用户对话可直接干预流程     │   │   │
│  │  └─────────────────────────────┘   │   │
│  └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

**核心架构模式**（PoC 验证）：两层协作
- **编排层**：工作流 Agent Preset（LLM 驱动），使用 DSH 的 `subagent` 工具执行 Task/Gate
- **呈现层**：Cordis 插件，Host 端提供 Tool + RPC，Client 端提供 UI 面板

### 2.2 Product Functions (High-Level)

| 功能域 | 说明 |
|--------|------|
| **F1 工作流定义** | 支持 YAML 格式的工作流定义，包含串行/并行（max-concurrency控制）/循环（支持循环内并发迭代）/分支条件（后续迭代） |
| **F2 工作流编排** | Agent Preset 按定义驱动 Task 执行顺序 |
| **F3 Task 执行** | 每个 Task 为 IPO 模型，在独立 LLM 会话中执行 |
| **F4 质量门禁** | 每个 Task 可配置独立 LLM 会话的质量检查 |
| **F5 预置条件** | Tassk 可配置条件，决定是否执行或跳过 |
| **F6 执行监控** | 实时状态可视化、执行日志、Token 消耗统计 |
| **F7 人工干预** | 用户可通过对话控制流和裁决 |
| **F8 外部 Aent** | 可指定外部 Agent 执行（如 opencode、claude code） |
| **F9 多实例管理** | 可同时定义和运行多个工作流实例 |

### 2.3 User Characteristics

| 用户类型 | 特征 | 使用场景 |
|---------|------|---------|
| 工作流设计者 | 熟悉 YAML 和 DSH | 编写工作流定义文件、配置 Skill 和 Gate |
| 工作流执行者 | 使用 DSH Web/Desktop 交互 | 启动工作流、查看状态、人工干预 |
| 流程开发者 | 编写 Skill 文件 | 为 Task 和 Gate 编写处理指令 |

### 2.4 Operating Environment

| 维度 | 要求 |
|------|------|
| 宿主 | DSH Web 或 DSH Desktop |
| 浏览器 | Chrome、Firefox（与 DSH 兼容一致） |
| 操作系统 | Windows (已验证)、Linux、masOS |
| 交付形式 | DSH 插件包（`dsh plugin add` 安装） |

### 2.5 Constraints

| # | 约束 | 来源 |
|---|------|------|
| C1 | 不修改 DSH 内核源码 | 项目定位 |
| C2 | 编排逻辑不能写在 Cordis 插件的程序化 API 中 | PoC 验证：`subagents.start()` 在 Tool execute 中不可靠 |
| C3 | 编排逻辑必须使用 Agent Loop 层（模型调 `subagent` 工具） | PoC 验证结论 |
| C4 | 插件代码必须为纯 JavaScript（无 JSX/TypeScript/import） | DSH Cordis 插件限制 |
| C5 | Client 端 UI 必须通过 Slot 注入 | Cordis 插件开发规范 |
| C6 | Host 端插件没有会话上下文，fs 写操作需显式传 sandboxPolicy | PoC Desktop 迁移发现 |

---

## 3. Functional Requirements

### FR-01: 工作流定义（YAML Schema）

| 字段 | 值 |
|------|----|
| ID | FR-01 |
| 名称 | 工作流定义 |
| 优先级 | Must |
| 依赖 | 无 |

**描述**：支持以 YAML 格式定义工作流。定义包含工作流名称、版本、参数、任务列表。

**待澄清的问题** ❓：
- YAML schema 的详细字段（循环 `loop` 的控制结构语法、分支持件 `condition` 的表达式语法）需定义
- 参数注入（`${param_name}`）的解析范围需明确

**参考**：`solutions/architecture-proposal.md` 中的示例 schema

### FR-02: Task 执行（I PO Model）

| 字段 | 值 |
|------|----|
| ID | FR-02 |
| 名称 | Task 执行 |
| 优先级 | Mus t |
| 依赖 | F R-01 |

**描述**：每个 Task 遵循输入 → 处理 → 输出模型：
- **输入**：一组文件路径（支持参数注入）
- **处理**：指定 DSH Skill 文件，由 Agent 加载后通过 sub agent 工具执行
- **输出**：一组文件路径（Task 产出的工件）

**执行约束**：
- 每个 Task 必须在**独立 LLM 会话**中执行（通过 `subagent` 工具实现）
- 各个 Task 的 LLM 上下文互不干扰
- 支持设置超时时间

### FR-03: 任务依赖与执行顺序

| 字段 | 值 |
|------|----|
| ID | FR-03 |
| 名称 | 任务依赖与执行顺序 |
| 优先级 | Must |
| 依赖 | FR-02 |

**描述**：
- **串行**：Task 的 `depends-on` 列表定义前驱依赖，只有前驱完成后才能执行
- **并行/并发**：无相互依赖的 Task 可同时执行。`max-concurrency` 控制全局同时执行 Task 的上限
- **循环**：Task 配置 `type: loop` 后按 items 列表重复执行，支持循环内并发度控制
- **循环 + 并发**：循环的多次迭代可设置独立的 `max-concurrency` 控制同时跑几轮迭代
- **分支条件** ❓：需要定义条件表达式及其判断时机（后续迭代）

### FR-04: 质量门禁（Qualiy Gate）

| 字段 | 值 |
|------|----|
| ID | FR-04 |
| 名称 | 质量门禁 |
| 优先级 | Must |
| 依赖 | FR-02 |

**描述**：
- 每个 Task 可配置一个质量门禁（`quality-gate`）
- 门禁在**独立 LLM 会话**中执行（PoC 已验证）
- 检查结果分 PASS / FAIL
- 根据 `on-failure` 策略决定行为：`retry`（重试 Task）/ `block`（阻断流）/ `skip`（跳过）
- `max-etries` 限制重试次数
- 门禁技能（cheker）是 DSH Skill 文件

### FR-05: 前置条件（Precondition）

| 字段 | 值 |
|------|----|
| ID | FR-05 |
| 名称 | 前置条件 |
| 优先级 | Should |
| 依赖 | FR-02 |

**描述** ❓：Task 可配置前置条件，在执行前判断条件是否满足，决定跳过还是执行。
条件表达式语法需定义。

### FR-06: 执行状态上报与 UI 同步

| 字段 | 值 |
|------|----|
| ID | FR-06 |
| 名称 | 执行状态上报与 UI 同步 |
| 优先级 | Mus t |
| 依赖 | FR-02, 无 |

**描述**（PoC 已验证模式）：
- Agent 通过 `workflow_status` Tool 向 Host 上报状态
- Host 维护状态在内存 + 持久化到文件
- Client 通过 RPC 轮询获取状态更新 UI
- 状态颜色：PENDING(灰) / TASK_RUNNING(蓝) / GATE_RUNNING(橙) / CMPLETED(绿) / FAILD(红)

**待优化** ❓：是否支持 WebSocket/SSE 推送代替轮询？

### FR-07: 执行日志与统计

| 字段 | 值 |
|------|----|
| ID | FR-07 |
| 名称 | 执行日志与统计 |
| 优先级 | Should |
| 依赖 | FR-02, FR-06 |

**描述**：记录以下执行数据——
- 时间戳、动(如 Task 开始/完成/Gate PASS/FAIL）
- 执时长
- Token 消耗 ❓（需要 DSH 是否提供 Token 计量 API）
- 执行结果

**用途**：后续统计分析各环节的执行情况。

### FR-08: 人工决策节点

| 字段 | 值 |
|------|----|
| ID | FR-08 |
| 名称 | 人工决策节点 |
| 优先级 | Should |
| 依赖 | FR-03 |

**描述**：工作流可包含人工决策点（`human-decision` 类型 Task）：
- 流执行到此处暂停
- 等待用户在对话中给出决策（批准/驳回/修改意见）
- 用户回复后流继续执行

**实现方式**：Agent Preset 的天然能力——Agent 看到 `human-decision` Task 时停下载对话等待用户输。

### FR-09: 外部 Agent 集成

| 字段 | 值 |
|------|----|
| ID | FR-09 |
| 名称 | 外部 Agent 集成 |
| 优先级 | Could |
| 依赖 | FR-02 |

**描述** ❓：Task 可指定由外部 Agent 工具执行（如 opencode、claude code），而非 DSH subagent。
DSH 变成工作流执行调度器。

**关键问题**：
- 外部 Agent 如何启动？（通过 `bash` 工具调 CLI？通过 MCP？）
- 外部 Agent 的输入输出如何与 workspace 文件对接？
- 外部 Agent 的执行状态如何回传给工作流引擎？

### FR-10: 多工作流实例管理

| 字段 | 值 |
|------|----|
| ID | FR-10 |
| 名称 | 多工作流实例管理|
| 优先级 | Could || 依赖 | FR-01, FR-06 |

**描述** ❓：支持同时定义和运行多个工作流，每个在独立状态空间中运行。
这涉及：
- 每个实例的隔离状态存储
- UI 中实例切换/列表呈现
- 资源竞争管理（同一文件被多个流同时写入？）

### FR-11: 工作流 UI 编排编辑器

| 字段 | 值 |
|------|----|
| ID | FR-11 |
| 名称 | 工作流编排编辑器 |
| 优先级 | Could |
| 依赖 | FR-01 |

**描述**：图形化的工作流编辑界面：
- 节点拖拽、连线
- 参数配置面板
- YAML 源代码编辑与图形同步

---

## 4. Non-Functional Requirements

### 4.1 Peformance

| ID | 要求 | 优先级 |
|----|------|---------|| NF-01 | Task 执行超时可配置（默认 600s） | Must |
| NF-02 | UI 状态更新延迟不超过 2 秒（轮询间隔） | Should |

### 4.2 Security

| ID | 要求 | 优先级 |
|----|------|---------|
| NF-03 | 遵循 DSH Sandbox Policy（workspace-write 模式） | Must |

### 4.3 Compatibility

| ID | 要求 | 优先级 |
|----|------|---------|
| NF-04 | 兼容 DSH Web 和 DSH Desktop | Must |
| NF-05 | 纯 SVG DAG 渲染，无外部 JS 依赖 | Should |

### 4.4 Maintainability

| ID | 要求 | 优先级 |
|----|------|---------|
| NF-06 | 插件代码可固化并打包为 `dsh plugin add` 安装包 | Should |
| NF-07 | Skill 文件复用 DSH 标准 Skill 格式 | Must |

---

## 5. 决策记录

以下问题已确认：

| # | 问题 | 决策 |
|---|------|------|
| **Q1** | YAML Schema 控制结构范围 | **起步支持串行 + 循环，循环可配置并发**。分支持件后续迭代 |
| **Q2** | 外部 Agent 集成优先级 | 先完成 DSH subagent 执行 Task 的能力，再扩展 |
| **Q3** | Token 消耗统计 | 暂不纳入首批需求，后续确认 DSH API 后加入 |
| **Q4** | UI 优先级 | **LLM 会话交互界面重用 DSH 原生**。主要工作：监控面板(I-1) → 编辑器(I-3)。按迭代交付，每次完整前后台可验证 |
| **Q5** | 多工作流实例 | **执行只支持单实例运行**，可以同时定义多个，可在实例间切换（一个跑一半停下切到另一个） |
| **Q6** | Agent Preset 交付 | 插件包交付时包含 Agent Preset 配置，一起部署 |

---

## 6. Assumptions & Dependencies

### 已验证的假设（PoC 确认）

| # | 假设 | 状态 |
|---|------|------|
| A1 | subagent 可作为 Task 的隔离执行单元 | ✅ 已验证 |
| A2 | 文件传递模型可行（Task 写 → Gate 读） | ✅ 已验证 |
| A3 | 质量门禁在独立 LLM 会话中执行 | ✅ 已验证 |
| A4 | Cordis Client Slot UI 可用 | ✅ 已验证 |
| A5 | Host ↔ Client RPC 通信可用 | ✅ 已验证 |

### 未验证的假设

| # | 假设 | 风险 | 验证方式 |
|---|------|------|---------|
| A6 | subagent 可并行启动多个（无干扰） | 中 | 并行执行验证 |
| A7 | DSH 提供 Token 计量 API | 高 | DSH Service 探查 |
| A8 | bash 工具可启动并管理外部 Agent 进程 | 中 | 单独验证 |

### 依赖

| # | 依赖项 | 用途 |
|---|--------|------|
| D 1| DSH `subaget` 工具（模型层）| Task/Gate 执行 |
| D 2| DSH `fs` Service | 文件操作 |
| D 3| DSH `timer` Service | UI 轮询、Task 超时 |
| D 4| DSH `harness` Biultin | Tool 注册、RPC |
| D 5| DSH `slots` Service (Client) | UI 注入 |
| D 6| DSH `host.call` (Client) | 调用 Host RPC |