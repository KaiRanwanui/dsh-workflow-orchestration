# PoC 验证报告

## 目标

验证软件设计工作流引擎核心架构：Task → 中间件 → Quality Gate → 重试。

## 执行结果：核心管道 ✅ PASS

| 阶段 | 结果 | 产出 |
|------|------|------|
| Task（需求分析） | ✅ | `PoC/output/analysis.md`（42行）：5 FR + 4 NFR + 8 假设 + 8 模糊点 |
| Gate（质量门禁） | ✅ PASS | `PoC/output/gate-result.md`：5/5 检查通过 |
| 重试 | — | 首次 PASS，无需重试（重试逻辑待工作流 Agent 实现） |

## 架构验证

### 已验证 ✅

1. **Workflow YAML 解析**：正则解析器正确处理含 quality-gate 配置的工作流定义
2. **subagent 作为 Task 执行单元**：模型层的 `subagent` 工具可用作 Task/Gate 执行器
3. **隔离性**：Task 和 Gate 在独立 LLM 会话中，Gate 只通过文件获取 Task 产出物
4. **结构化中间件**：analysis.md 作为 Task→Gate 传递的标准化接口
5. **门禁判定**：Gate 产出 PASS/FAIL，通过检查 gate-result.md 内容判定
6. **subagent 嵌套**：子 Agent 可再调 subagent（工作流 Agent 架构的基础）
7. **Cordis Client 插件**：Slot UI 可用，RPC 可用，`defineTool` 可用

### 不可用 ❌

| 方式 | 问题 |
|------|------|
| `subagents.start()` Service API（在 Tool execute 中） | 子 Agent `stopReason: error`，event log 无 message 事件 |
| `llm.stream()`（在 Tool execute 中） | 返回空流 |
| RPC 上下文中 `agents.requireInitiator()` | 无 initiating agent |

### 技术发现

| 发现 | 详情 |
|------|------|
| `subagent/end` 用 `info.id` 非 `info.sessionId` | API 文档与实际行为不一致 |
| `subagents.start()` 返回 `run.id` 非 `run.sessionId` | 同上 |
| `readSession` 可读子 Agent 事件日志 | 子 Agent 失败时 event log 有 turn 事件但无 message |
| `harness.defineTool` 可用 | 但 Tool execute 内无法可靠调 subagent/llm |

## 两层协作架构验证 ✅

### Agent + Cordis UI 桥接

验证了"Agent 驱动编排 + Cordis 插件 UI 呈现"的两层协作模式：

```
Agent Loop（编排层）              Cordis 插件（呈现层）
┌──────────────────────┐       ┌──────────────────────┐
│ 调 subagent → Task    │       │ Client: SVG DAG       │
│ 调 update_workflow_   │──→Tool│   ├ 需求分析 ● DONE   │
│   status({           │       │   └→质量门禁 ● PASS   │
│     status: 'GATE_   │       │                      │
│     RUNNING'         │       │ 轮询 RPC 刷新状态      │
│   })                 │       │ (1500ms interval)     │
│                      │       │                      │
│ 调 subagent → Gate   │       │ 颜色实时跟随:          │
│ 调 update_workflow_   │       │  蓝→橙→绿             │
│   status({           │       │                      │
│     status:'COMPLETED'│      └──────────────────────┘
│     gateResult:'PASS' │               ↑
│   })                 │         RPC 轮询
└──────────────────────┘      Host: insts map
```

| 组件 | 位置 | 职责 |
|------|------|------|
| `update_workflow_status` | Host Tool | Agent 调用的状态上报接口 |
| `workflow:status` | Host RPC | Client 轮询的状态查询接口 |
| `insts` map | Host 内存 | 轻量状态存储（PoC 不持久化） |
| Dashboard | Client Slot | SVG DAG + 状态标签呈现 |
| DAG 渲染 | Client 纯 SVG | 无外部依赖（Mermaid/CDN 不需要） |

### 图形化工作流 DAG

使用纯 SVG（`React.createElement('svg', ...)`）在 `conversation.input.dock` Slot 中渲染：

- **节点**：需求分析 → 质量门禁（后续可扩展为 N 节点 DAG）
- **颜色驱动**：PENDING(灰) / TASK_RUNNING(蓝) / GATE_RUNNING(橙) / COMPLETED(绿) / FAILED(红)
- **无外部依赖**：不引入 Mermaid JS，纯 SVG + React 原生渲染

---

## 架构结论

**编排器不应是 Cordis 插件中的 JS 代码，而应是一个 DSH Agent Preset。**

原方案假设可以在 Cordis 插件中通过 `subagents.start()` 编程式编排工作流，PoC 证明此路径不可行。但模型层的 `subagent` 工具完美工作，包括嵌套。

两层协作的核心模式：
- **Agent 层**：system prompt 定义编排逻辑，调 `subagent` 执行 Task/Gate，调 `update_workflow_status` 上报状态
- **Cordis 层**：Client Slot 渲染 DAG + 状态面板，RPC 轮询同步

用户通过对话与 Agent 交互——天然支持"执行中修改流定义"的需求。编排逻辑从"状态机代码"变为"Agent 的 system prompt"。UI 呈现从"DAG 静态图"变为"实时颜色跟随的状态可视化"。

**PoC 通过的信号是：** 管道（Task → 中间件 → Gate → 判定）可行，文件传模型正确，子 Agent 隔离生效，两层协作模式验证通过。下一步是用这些基块构建工作流 Agent Preset。

## 文件清单

```
PoC/
├── workflows/poc-with-gate.yaml     # 工作流定义
├── skills/poc-analyzer/SKILL.md     # Task 处理技能
├── skills/poc-reviewer/SKILL.md     # Gate 评技能
├── test-data/ir-sampel.md           # 测试输入（登录需求）
├── output/analysis.md              # Task 产物
├── output/gate-result.md           # Gate 门禁报告
├── design.md                       # PoC 设计（含实际验证结论）
├── develoment-plan.md              # 开发计划
└── REPOR.md                        # 本文
```