# 架构方案对比

## 方案概览

本文档对比 `software-design-agent` 的两种技术架构路线：

- **方案 A**：DSH Agent Preset + Agent 驱动编排（在 DSH 内通过 Agent Loop 编排）
- **方案 B**：独立应用 + DSH 集成（独立 Node.js 服务，DSH 作为 Agent 执行后端）

---

## 架构图

### 方案 A：DSH Agent Preset + Agent 驱动编排

```
┌──────────────────────────────────────────────┐
│              Browser (DSH Web GUI)             │
│  ┌────────────────────────────────────────┐  │
│  │         对话界面 = 编排控制台            │  │
│  │                                        │  │
│  │  用户: "启动 IR 设计工作流"             │  │
│  │  Agent: "已启动。执行需求分析..."        │  │
│  │  用户: "把 max-retries 改成 3"          │  │
│  │  Agent: "已更新。继续执行..."           │  │
│  │                                        │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │ Slot: 工作流状态面板               │  │  │
│  │  │  Task A ✅ → Gate A ✅           │  │  │
│  │  │  Task B ◐ → Gate B ⏳           │  │  │
│  │  └──────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│        DSH Process                            │
│   ┌──────────────────────────────────────┐   │
│   │  Agent Loop（工作流 Agent）            │   │
│   │  ├ 读 YAML → 解依赖 → 排序            │   │
│   │  ├ 调 subagent → Task 子 Agent        │   │
│   │  ├ 调 subagent → Gate 子 Agent        │   │
│   │  ├ 读 gate-result.md → 判 PASS/FAIL   │   │
│   │  └ 接受用户介入 → 改定义/手动裁决      │   │
│   └──────────────────────────────────────┘   │
│   ┌──────────────────────────────────────┐   │
│   │  DSH 原生层                            │   │
│   │  ├ subagent 工具（嵌套可用）           │   │
│   │  ├ skill 加载                         │   │
│   │  ├ workspace 文件系统                  │   │
│   │  └ 沙箱                               │   │
│   └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

### 方案 B：独立应用 + DSH 集成

```
┌─────────────────────────────────────────────┐
│          Browser (独立 React App)             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │DAG Editor│ │Dashboard │ │Chat      │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│         │ REST/WebSocket API                 │
├─────────────────────────────────────────────┤
│     Workflow Engine (独立 Node.js 服务)       │
│  ┌────────┐ ┌────────┐ ┌──────────────┐     │
│  │Scheduler│ │Template│ │Metrics/Audit │     │
│  └────────┘ └────────┘ └──────────────┘     │
│  ┌──────────────────────────────────────┐   │
│  │       Task Executor (适配器层)        │   │
│  │  ┌──────────┐ ┌────────┐ ┌───────┐  │   │
│  │  │DSH 子进程│ │OpenCode│ │Hermes │  │   │
│  │  │(headless)│ │  CLI   │ │  MCP  │  │   │
│  │  └──────────┘ └────────┘ └───────┘  │   │
│  └──────────────────────────────────────┘   │
│  ┌────────────────────────────────────────┐ │
│  │         PostgreSQL / SQLite             │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## 多维度对比

| 维度 | 方案 A：Agent Preset | 方案 B：独立应用 |
|------|:--:|:--:|
| **开发总量** | 🟢 较小：只定义 Agent Preset（system prompt + 工具），复用 DSH Web GUI 作为交互界面 | 🔴 较大：需独立开发 Web 前端、REST API、身份认证、WebSocket 等 |
| **用户交互** | 🟢 天然对话式：用户通过聊天控制流程、修改定义、手动裁决 | 🔴 需自研聊天/控制 UI，并设计"暂停-干预-恢复"协议 |
| **动态流程修改** | 🟢 对话中直接改 YAML/参数，Agent 自适应 | 🔴 需 API + 状态重建逻辑 |
| **subagent 嵌套** | 🟢 已确认可用：工作流 Agent 调 Task/Gate 子 Agent | 🔴 需 DSH headless 模式（不存在）或 HTTP API（待开发） |
| **编排开销** | 🟡 编排消耗 LLM token（但对话式编排正是用户期望的） | 🟢 零 token 开销 |
| **可预测性** | 🟡 依赖模型推理质量 | 🟢 确定 |
| **适合场景** | 🟢 交互式设计流程、需人类判断 | 🟢 批处理、CI/CD 自动化 |
| **与 skill 体系兼容** | 🟢 原生兼容：Task/Gate 复用 DSH skill.md | 🟡 需桥接 |
| **部署运维** | 🟢 极简：`dsh --profile sd-agent --port N` | 🔴 复杂 |
| **持久化** | 🟡 依赖 DSH 会话持久化 | 🟢 原生可控 |
| **外部 Agent 集成** | 🟡 通过 bash 工具调用 CLI/MCP | 🟡 适配器在服务中实现 |
| **DSH 升级影响** | 🟡 依赖 subagent 工具和 Agent Loop | 🟢 仅依赖 DSH 的外部接口 |

---

## 推荐方案

**推荐方案 A（DSH Agent Preset + Agent 驱动编排）。**

### 方案 B 的关键风险（未变）

DSH 当前不具备 headless 模式或稳定的外部 HTTP API。方案 B 需等待这些能力或自行扩展。

### PoC 发现：编排方式的关键转变

PoC 验证过程中发现：

| 方式 | 结果 |
|------|------|
| Cordis 插件 `subagents.start()` Service API | ❌ 子 Agent 报 `stopReason: error`，无 LLM 产出 |
| Cordis 插件 `llm.stream()` | ❌ 返回空流 |
| 模型层 `subagent` 工具 | ✅ Task 和 Gate 均成功执行，输出文件正确 |
| subagent 嵌套 | ✅ 子 Agent 可再调 subagent |
| **Agent + Cordis UI 桥接** | ✅ Agent 调 `update_workflow_status` Tool → Host 状态 → Client SVG DAG 实时跟随 |

**结论**：编排逻辑应放在 Agent Loop 层（模型调 `subagent` 工具），UI 呈现放在 Cordis 层（Client Slot 渲染 DAG），通过 Model Tool + RPC 桥接两层。二者互补，不是互斥。

### 核心架构决策：Agent Preset 而非 Cordis 插件

```
software-design-agent/
├── presets/
│   └── workflow-agent/
│       ├── cordis.yml              ← DSH Preset 定义
│       ├── system-prompt.md        ← 工作流编排 Agent 的系统指令
│       └── tools.yaml              ← 工具配置（subagent, skill, read, write, bash）
│
├── skills/                          ← Task/Gate 指令 = DSH Skills
│   ├── requirement-analysis/SKILL.md
│   ├── functional-design/SKILL.md
│   ├── req-review/SKILL.md
│   └── ...
│
├── workflows/                       ← 工作流定义
│   └── ir-design.yaml
│
├── templates/                       ← 设计文档模板
└── README.md
```

---

## 下一步

PoC 已验证核心管道（Task → 中间件 → Gate → 判定）。下一步：
1. 设计工作流 Agent Preset（system prompt + 工具配置）
2. 定义完整 YAML schema
3. 3-Task 端到端验证（含并行 + 人工决策）