# Workflow-Agent 工程导览

> **给新会话 LLM 的入口文档**：从本文开始阅读，按"阅读顺序"章节逐篇加载，即可获得迭代开发所需的完整上下文。
> 本文不重复文档内容，只指引位置与顺序。

---

## 1. 项目是什么

**Workflow-Agent** 是一个基于 DSH（DeepSeek Harness）的工作流框架：
- 用 DSH 启动 **subagent** 执行工作流（YAML 定义）的各个 Task
- 提供 **Web UI** 监控工作流执行（DAG 图）+ 定义工作流
- 通过 DSH 的**多个插件**完成前后台协同：
  - **Host 侧插件**（部署在 Agent 执行侧 / desktop profile）：引擎 + 工具 + webServer 路由
  - **Client 侧插件**（部署在 Web UI）：DAG 监控面板

## 2. 阅读顺序（新会话 LLM 必读）

> 按顺序读，每篇都是下一篇的上下文基础。

### 第 1 层：先读现状（2 篇）
| 顺序 | 文档 | 内容 |
|------|------|------|
| 1 | `plan/development/progress-record.md` | **最新进度**：已完成工作、当前待办、最近迭代细节 |
| 2 | `plan/development/iter13-report.md` | **最近迭代报告**：Iter-13 交付内容（面板创建按钮 + 模板库 v1）、验证结果、关键决策 |

### 第 2 层：理解方案与约束（6 篇）
| 顺序 | 文档 | 内容 |
|------|------|------|
| 3 | `plan/architecture/architecture-decisions.md` | **架构决策**：插件加载、profile 布局、Client↔Host 通信（§5 当前方案，§6 多实例复用 DSH Session，§7 实例生命周期） |
| 4 | `plan/design/multi-instance-session-design.md` | **多实例技术方案**：复用 DSH Session（实例=session、实例目录、映射、重置） |
| 5 | `plan/design/workflow-lifecycle-design.md` | **实例生命周期设计**：绑定/运行状态机/纯完整性+完整性/重置+归档（Iter-16 流程控制方案） |
| 6 | `plan/design/instance-creation-semantics.md` | **实例创建语义**：目录=定义快照、惰性创建、为何不做 session 创建自动建目录（preset 耦合分析）、创建动作定稿（含面板按钮边界） |
| 7 | `plan/design/client-host-communication.md` | **通信方案对比**：HTTP 轮询 vs Host 推送（当前用轮询） |
| 8 | `plan/development/team-conventions.md` | **团队约定**：上下文压力处理、差分验证、工作代码保护 |

### 第 3 层：理解数据模型与源码（2 篇）
| 顺序 | 文档 | 内容 |
|------|------|------|
| 9 | `plan/design/workflow-schema-v1.md` | **YAML Schema**：工作流定义格式（Task 类型、params、loop、concurrent） |
| 10 | `plan/development/client-rpc-research.md` | **官方源码研究**：DSH 插件机制、host.call 真相、webServer 验证 |

### 第 4 层：迭代规划（1 篇）
| 顺序 | 文档 | 内容 |
|------|------|------|
| 11 | `plan/development/development-plan.md` | **迭代计划**：Iter-1~23 全景、各迭代详述、风险表、多实例小步拆分 |

---

## 3. 代码结构导航

```
workflow-agent/
├── code/
│   ├── packages/                          # 正式 npm 包插件（当前部署形态）
│   │   ├── workflow-host/                 # Host 插件：引擎 + 工具 + webServer 路由
│   │   │   ├── src/ (无，源码在 agent-presets/workflow-host.mjs)
│   │   │   ├── build.js                   # 打包：workflow-host.mjs → lib/index.js
│   │   │   ├── package.json               # v0.3.0
│   │   │   └── cordis.patch.yml           # 声明 insert 行
│   │   └── client-ui-monitor/             # Client 插件：DAG 监控面板
│   │       ├── src/client.js              # 源码（React + fetch 轮询）
│   │       ├── build.js                   # 打包：src/client.js → lib/client.js
│   │       └── package.json               # v0.1.0
│   ├── agent-presets/
│   │   └── workflow-orchestrator/         # 编排 Agent preset
│   │       ├── agent.cordis.yml           # Preset 配置（工具授权、插件挂载）
│   │       ├── system-prompt.md           # 编排 Agent 指令
│   │       ├── workflow-host.mjs          # Host 插件源（含 webServer 路由）
│   │       └── workflow-rpc.mjs           # ⚠️ 已停用（harness RPC 被 webServer 替代）
│   ├── plugins/                           # 早期/动态插件开发残留（Iter-1~4 产物）
│   ├── shared/                            # 共享模块（schema、parser）
│   ├── scripts/                           # 构建/测试/部署脚本
│   │   ├── build-workflow-plugins.ps1     # 构建 npm 包插件
│   │   ├── install-workflow-plugins.ps1   # 安装到指定 profile
│   │   ├── verify-workflow-plugins.ps1    # 验证已安装插件
│   │   ├── test-host.js                   # Host 单元测试
│   │   └── simulate-exec.js               # 模拟执行
│   └── ui/                                # UI 相关（早期）
├── plan/                                  # 全部设计/文档（见 §3 阅读顺序）
├── workflows/                             # 示例工作流 YAML
├── skills/                                # 子 Agent 技能（处理器/门禁）
└── PoC/                                   # PoC 原型（Iter-0 产物）
```

---

## 3.5 DSH 源代码位置

**重要**：当遇到 DSH API 调用问题时（如 `apiProxy`、`sessions`、`agents` 等服务），需要查看 DSH 源代码中的测试用例来确定正确的调用方式。

**DSH 源代码目录**：`@deepseek-harness-master`（位于 `/home/zhaokai/Projects/dsh_projects/deepseek-harness-master`）

**查找测试用例**：
```bash
# 查找特定 API 的测试用例
grep -r "apiProxy.sessions.prompt\|sessions.prompt" @deepseek-harness-master --include="*.ts" --include="*.js"

# 查找特定服务的测试
grep -r "scaffold.ctx.apiProxy" @deepseek-harness-master/apps/web/tests/
```

**关键发现**（从源码测试用例中学到的）：
- `apiProxy.sessions.prompt` 调用必须包含 `rpcId` 和 `payload` 字段
- 格式：`{ rpcId: 'unique-id', payload: { sessionId, mode, content } }`
- 缺少 `rpcId` 会导致 "Cannot destructure property 'sessionId' of 'request.payload' as it is undefined" 错误

**教训**：DSH 的内部 API 文档不完整，遇到不确定的调用方式时，应该优先查看源码中的测试用例（特别是 `apps/web/tests/` 目录），而不是只看类型定义。

---

## 4. 关键机制速查（当前方案）

### 5.1 Client↔Host 通信：HTTP 轮询

```
编排 Agent (preset) → workflow_begin/workflow_status (tools)
    → workflow-host 引擎 → 写 .workflow-agent/state.json
    → webServer 路由 GET /wf/status（读 state.json 返回 JSON）
    → Client fetch('/wf/status') 每 2s 轮询 → 指纹防抖 → 更新 DAG
```

- Host 路由：`workflow-host.mjs` 的 `registerWebRoutes()`（/wf/status /wf/skill /wf/config）
- Client 轮询：`client-ui-monitor/src/client.js`（`window.setInterval` + fetch）
- 注意：DSH Desktop（43120）有 `x-dsh-desktop-renderer` 访问控制，外部脚本无法直接探测 HTTP 端点；验证在 Electron 渲染进程内或 WSL2 标准 web 环境进行

### 5.2 插件加载：npm 包 + cordis.patch.yml

- 插件以 npm 包形式安装到 profile 的 `node_modules/@workflow-agent/`
- `cordis.patch.yml` 声明 `insert` 行，profile 的 `cordis.patch.yml` 引用
- `host.call` 是动态插件专用，npm 包不可用（Iter-5 已用 webServer 路由替代）

---

## 5. 开发流程（当前）

1. 改源码（`code/packages/*/src/` 或 `code/agent-presets/.../workflow-host.mjs`）
2. `.\build-workflow-plugins.ps1` 打包（或各包目录 `node build.js`）
3. 安装到 profile：`.\install-workflow-plugins.ps1 -Profile <desktop|web>`
   - Desktop：需完全退出 DSH（文件锁）；web 无此限制
4. 验证：`.\verify-workflow-plugins.ps1 -Profile <desktop|web>`（或 `test-host.js`）
4. 验证：DAG 面板显示 / 单元测试（`test-host.js`）

---

## 6. 团队约定摘要

- **上下文压力处理**：上下文紧张时主动告知，不擅自压缩/省略
- **差分验证原则**：一次只改一个维度，改完立即验证
- **工作代码保护**：正常功能不因"精简"删除
- **参考代码使用**：偏离 PoC 模式先打桩验证
- **环境边界探索**：未文档化约束先探针探测
- **迭代设计确认**：每个迭代启动开发前先与用户确认设计实现方案，无误再开发

详细见 `plan/development/team-conventions.md` 与 `plan/build/team-conventions.md`。
