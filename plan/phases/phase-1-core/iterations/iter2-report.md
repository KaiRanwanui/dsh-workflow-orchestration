# 迭代 2 报告 — Agent Preset：串行编排

| 项 | 内容 |
|----|------|
| 迭代目标 | 编排 Agent Preset：串行执行 + quality-gate + 失败重试 |
| 迭代规模 | ≤ 1 人天 |
| 状态 | ✅ **完整验收通过（含真实会话端到端）** |
| 关联产物 | `code/agent-presets/workflow-orchestrator/`（+ preset 版工具源码与构建脚本） |

---

## 1. 交付内容

### 1.1 文件清单

| 层 | 文件 | 职责 |
|----|------|------|
| 源码 | `code/plugins/workflow-host-preset/tools-preset.js` | preset 形态工具（`ctx.tools.register` + sessionCwd 默认落盘） |
| 构建 | `code/scripts/build-preset.js` | 5 模块（schema/parser/engine/storage/tools-preset）→ ESM 插件 |
| 打包产物 | `code/agent-presets/workflow-orchestrator/workflow-host.mjs` | 自包含 ESM 插件（~900 行） |
| 编排指令 | `code/agent-presets/workflow-orchestrator/system-prompt.md` | persona 源文档（可评审） |
| 组成 | `code/agent-presets/workflow-orchestrator/agent.cordis.yml` | 10 行：persona + agent-instructions + delegation + workflow-host + fs/search + skill×2 + ask-user + todo |
| 元数据 | `code/agent-presets/workflow-orchestrator/preset.yml` | name/description（picker 显示） |
| 安装位置 | `~/.dsh/.agent-presets/workflow-orchestrator/` | roster 实际发现的副本 |

### 1.2 编排指令核心逻辑（v1 串行）

```
workflow_begin({workflowPath, params, workspaceRoot})
  → tasks[]（id/name/type/status=PENDING/processor 绝对路径/inputs 命名字典/outputs/gate）
  → 有 workflowBeginErrors 则报告并停止

就绪推导：dependsOn 全 DONE 才就绪；一次只执行一个 Task（串行，并发为独立维度）

执行 Task：
  workflow_status(RUNNING)
  → read processor skill 全文
  → 构造 subagent prompt（技能全文 + inputs 命名字典 + outputs 绝对路径）
  → subagent 前台执行 → read 校验 outputs 已生成

quality-gate（若配置）：
  独立 subagent 会话（不共享 Task 上下文）加载 checker skill
  → 读输出文件 → 只输出 PASS/FAIL（FAIL 给理由）
  PASS → DONE + gateResult=PASS；FAIL → 按 on-failure：
    retry → 重执行（retries 记录，至 max-retries 后 FAILED+阻断）
    block → FAILED+阻断（stage=FAILED，报告并等用户指示）
    skip  → SKIPPED+gateResult=FAIL，继续

完成：全 DONE/SKIPPED → workflow_status(COMPLETED) + 汇总产出
```

---

## 2. 关键架构决策（Iter-1 → Iter-2 移植）

### 2.1 注册机制差异

| 维度 | Iter-1 动态插件 | Iter-2 preset 本地插件 |
|------|------|------|
| 工具注册 | `harness.defineTool` + `harness.registerTool` | `ctx.tools.register`（**custom-bash.mjs / dsh-tool-workflow 同机制**，从部署源码确认） |
| 挂载 | `cordis_define`/`cordis_run`（会话级） | `agent.cordis.yml` 行 `name: ./workflow-host.mjs`（跨会话 standing scope） |
| 模块加载 | 单函数体内联（cordis_define code.host） | ESM 导出 `{name, inject, apply}`（`@deepseek-ai/dsh-agent-presets` 的 `PresetTree.import` 相对 specifier 随 preset 目录解析） |

### 2.2 落盘位置问题的根本解法

Iter-1 遗留「宿主无会话上下文 → sandboxPolicy fallback=部署根 → 写错目录」。Iter-2 确认了**工具执行上下文带会话**：

```js
async execute(args, exec) {
  const cwd = exec && exec.agent.session.header.cwd   // 会话工作区！
  if (cwd) storage.setWorkspaceRoot(cwd)              // 默认落盘根
}
```

- `dsh-tool-workflow`（内置）与 `custom-bash.mjs` 的 `execute(args, exec)` 均使用 `exec.agent.session`；
- `workflow_begin` 未显式传 `workspaceRoot` 时自动取会话工作区，**不再依赖调用方显式传参**；
- 显式传参仍优先（保留灵活性）。

### 2.3 编排指令承载方式

- persona 行 `text` 内联完整编排指令（software-design 先例）；
- `system-prompt.md` 保留**同一份文本**作源文档，便于评审与后续 Iter-4/5 增补；
- 单独文件不与 persona 绑定（dsh-persona 只接受 text 字符串），不引入额外机制。

---

## 3. 验证结果

| 验证层 | 方法 | 结果 |
|--------|------|------|
| YAML 语法 | 部署 js-yaml 解析 | ✅ agent.cordis.yml 10 行 / preset.yml 对象，全部合法 |
| roster 发现 | 动态插件探针 `ctx.agentPresets.list()` | ✅ `workflow-orchestrator` trust=user、路径正确、name/description 完整、无 broken 标记 |
| 相对路径插件 | 读 `dsh-agent-presets` 源码 `PresetTree.import` | ✅ `.` 开头 specifier 走 `super.import`，随 preset 目录解析 |
| ESM 加载 | Node `import()` workflow-host.mjs | ✅ 导出 name=workflow-host / inject=[fs,timer] / apply=function |
| apply 挂载 | fake ctx（fs+tools stub）调 apply | ✅ 注册 workflow_begin（5 参数）/ workflow_status（6 参数） |

---

## 4. 发现的问题与解决方式

| # | 问题 | 解决方式 |
|---|------|---------|
| 1 | `cordis_define` 动态插件里用 `module.exports = async function(){...}` 报 "module is not defined" | 动态插件 host 代码必须返回**函数体**（`return { inject, apply }`），无 module；改用 `async function inspect(){ return {...} } return inspect()` |
| 2 | 动态插件沙箱无 `setTimeout` | 换 `ctx.timer` 服务（inject 声明）或直接执行（探针改为无等待直接跑）——**验证新 preset 无需等待**，直接 `await ctx.agentPresets.list()` |
| 3 | 写 `~/.dsh/.agent-presets/` 被沙箱拒绝（目标在会话工作区外） | 沙箱升级（danger-full-access + justification）完成安装 |
| 4 | 曾遗留一个失败探针 `wpro-8` | 用户已清理；规范为：探针失败后应立即 `cordis_undefine` 不留残留 |

---

## 5. 遗留项与下一步

### 5.1 端到端验收 — ✅ 已完成（用户操作）

新会话选择 **Workflow Orchestrator** 预设，运行 `demo-ir-workflow.yaml` 完整跑通：

- `state.json` 终态：`stage=COMPLETED`、`active=false`、req-analysis/module-review 均 DONE、最终 `gateResult=PASS`；
- 执行日志完整：BEGIN → RUNNING → req-analysis RUNNING → GATE PASS → DONE → module-review RUNNING → COMPLETED → GATE PASS → DONE；
- 产出 8 个文件：`workflows/output/demo-project/{analysis.md, req-analysis-gate.md, review-{login,order,payment}.md, review-{login,order,payment}-gate.md}`；
- **Iter-2 完整验收通过。**

### 5.2 对后续迭代的提示

- **Iter-3**：Client 监控面板轮询 `wf:status` RPC——注意 preset 形态下 `harness.handle` 不可用，RPC 需另寻机制（或由 Client 直连宿主其他服务）；遗留待 Iter-3 设计。
- **Iter-4**：loop 的 items-from 展开已预留（`itemsFrom` 字段保留），编排 prompt 的循环段待深化。
- **Iter-5**：并发维度明确独立，persona 明确写「一次只执行一个 Task」；届时改此约束。

---

## 6. 结论

Iter-2 完整验收通过：编排 persona（串行 + gate + 重试/阻断/跳过）、preset 组成、本地 ESM 插件（含会话工作区自动落盘），经 roster 发现 → 模块加载 → apply 注册 → 引擎链路模拟 → **真实会话端到端**五级验证。剩余 loop 展开深化归 Iter-4，并发归 Iter-5。