# PoC 概念原型设计（含实际验证结论）

## 目标

验证核心链路：**定义工作流 → 调度执行 → LLM 处理 → 质量门禁（独立会话） → 失败重试**。

## 验证结论：核心管道 ✅ 通过，编排方式需调整

| 层面 | 结果 |
|------|------|
| Task → 中间件 → Gate 数据流 | ✅ 可行 |
| subagent 隔离性 | ✅ Gate 子 Agent 不共享 Task 上下文 |
| 文件传递模型 | ✅ 子 Agent 可用 write/read 工具 |
| subagent 嵌套 | ✅ 子 Agent 可再调 subagent |
| 自动化编排（Cordis 插件内调 `subagents.start()`） | ❌ 子 Agent 报 `stopReason: error` |
| 自动化编排（Cordis 插件内调 `llm.stream()`） | ❌ 返回空流 |

**关键发现**：编排逻辑应从 Cordis 插件层（程序化 API）移到 Agent Loop 层（模型调 `subagent` 工具）。编排者是一个 Agent（LLM），不是一段代码。

---

## 验证的核心假设

| # | 假设 | 结果 | 说明 |
|---|------|------|------|
| H1 | Cordis Host 插件可实现工作流引擎 Service | ⚠️ 部分 | Service 可注册，但 `subagents.start()` 在 Tool 上下文中不可靠 |
| H2 | 插件可通过编程方式调用 LLM 执行 Task | ❌ | `subagents.start()` 和 `llm.stream()` 在 Tool execute 中均失败 |
| H3 | Task 指令可用 skill.md 格式，LLM 按指令读写文件 | ✅ | 子 Agent 正确读取 skill + 输入，写入输出文件 |
| H4 | Cordis Client 插件可在 Slot 中渲染 UI | ✅ | `conversation.input.dock` Slot 可用，状态面板渲染成功 |
| H5 | Host ↔ Client RPC 可用于工作流控制 | ✅ | RPC 可用，但编排逻辑本身不依赖 RPC（Agent Loop 直接控制） |
| H6 | 质量门禁在独立 LLM 会话中执行 | ✅ | Gate 子 Agent 不记得 Task 对话内容 |
| H7 | 门禁不通过时可自动重试 | ⚠️ 未自动化验证 | Agent Loop 模式下重试需要工作流 Agent 实现，管道已验证可行 |

---

## 执行架构（验证后的实际模式）

### 实际验证的流程

```
我（DSH 会话中的模型）
  │
  │ 调 start_poc_workflow 工具
  │
  ├──→ Cordis Tool execute 尝试自动编排 → 失败
  │
  │ 改为手动编排：
  │
  ├──→ 调 subagent 工具 → Task Agent（需求分析）
  │     输入：skill + ir-sample.md
  │     输出：PoC/output/analysis.md ✅（42行，5 FR + 4 NFR + 8 假设 + 8 模糊点）
  │
  ├──→ 调 subagent 工具 → Gate Agent（设计评审）
  │     输入：skill + analysis.md
  │     输出：PoC/output/gate-result.md ✅ PASS（5/5 检查通过）
  │
  └──→ 读 gate-result.md → 判 PASS → 无需重试
```

### 目标架构（需实现）

```
工作流 Agent（专用 DSH Preset）
  │ system prompt: "你是工作流编排 Agent..."
  │ 工具: subagent, read, write, skill, bash
  │
  ├──→ 调 subagent → Task Agent
  ├──→ 调 subagent → Gate Agent
  ├──→ 读文件 → 判 PASS/FAIL → 重试/继续
  └──→ 用户可随时对话介入
```

---

## 插件设计（原方案，部分验证）

### 已验证可用的能力

| 能力 | 验证方式 | 
|------|---------|
| `conversation.input.dock` Slot UI | Dashboard 成功渲染，含状态标签、重试计数、Start/Re-run 按钮 |
| Host/Client RPC | `host.call('workflow:status')` 轮询正常工作 |
| YAML 解析 | 正则解析器正确处理 workflow 定义（含 quality-gate 配置） |
| `fs.readText` / `fs.writeText` | Host 端文件读写正常 |
| `harness.defineTool` | 成功注册 `start_poc_workflow` 模型工具 |

### 不可用的能力

| 能力 | 问题 |
|------|------|
| `subagents.start()` 在 Tool 中 | 子 Agent start 成功但 `stopReason: error`，无 message 事件 |
| `llm.stream()` 在 Tool 中 | 返回空流（chunks 为 0），未抛异常但无内容 |
| `agents.requireInitiator()` 在 RPC | 无 initiating agent（RPC 从浏览器发起，不在 Agent Loop 中） |

### 技术细节发现

| 发现 | 详情 |
|------|------|
| `subagent/end` 事件格式 | `info.id` 是子 Agent 的 session ID，`info.sessionId` 是 undefined |
| `run.id` vs `run.sessionId` | `subagents.start()` 返回的 run 对象用 `run.id` 标识 session |
| `readSession` 事件类型 | 子 Agent 的 event log 包含 turn/start、subagent/descriptor、turn/end 等，但无 message 事件（说明 LLM 未实际调用） |
| fakeSignal | 需提供 `{aborted, addEventListener, removeEventListener}` 三个方法/属性 |

---

## 测试物料（保持不变）

### IR 样本（`PoC/test-data/ir-sample.md`）

```markdown
# 用户登录功能需求

## 功能描述
用户可以通过用户名和密码登录系统。登录成功后进入主页，
登录失败显示错误提示。连续失败 3 次锁定账户 15 分钟。

## 约束
- 支持 Chrome、Firefox 浏览器
- 密码最少 8 位，必须包含字母和数字
- 响应时间不超过 2 秒
```

### Task Skill（`PoC/skills/poc-analyzer/SKILL.md`）

需求分析指令：提取 FR/NFR、识别隐含假设、标注模糊点。

### Gate Skill（`PoC/skills/poc-reviewer/SKILL.md`）

设计评审指令：5 项检查（完整性/准确性/NFR归类/隐含假设/模糊点），输出 PASS/FAIL。

---

## PoC 成功标准达成情况

| # | 验证项 | 结果 |
|---|--------|------|
| 1 | 插件定义 | ✅ `cordis_define` 成功 |
| 2 | 插件运行 | ✅ 通过审批（双勾），多次更新成功 |
| 3 | 工作流定义解析 | ✅ YAML 含 quality-gate 配置正确解析 |
| 4 | UI 渲染 | ✅ Dashboard 在 `conversation.input.dock` 可见 |
| 5 | 工作流启动 | ✅ 点击按钮触发 RPC |
| 6 | Task 执行 | ✅ subagent 按 skill 指令产出 analysis.md |
| 7 | 门禁独立会话 | ✅ Gate 子 Agent 与 Task 子 Agent 隔离 |
| 8 | 门禁 PASS | ✅ 正常输入 → 门禁 PASS |
| 9 | 门禁 FAIL → 重试 | ⚠️ 管道可行，但自动化串未完成（编排需在 Agent Loop 层） |
| 10 | 重试上限 | ⚠️ 同上 |
| 11 | UI 状态同步 | ✅ 轮询 + 状态面板可用 |

---

## 架构结论

编排器不应是 Cordis 插件中的一段 JS 代码，而应是一个 **DSH Agent Preset**——用 system prompt 定义编排逻辑，用 `subagent` 工具执行 Task/Gate，用对话界面实现用户交互。这正好契合"用户可在执行过程中对话控制流程"的需求。