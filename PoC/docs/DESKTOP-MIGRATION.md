# Desktop 迁移记录

> 本文档记录软件设计工作流 PoC 从原开发环境迁移到 DSH Desktop 时的全部改动、
> 原因与验证结果。原始设计见 `REPORT.md`。

## 1. 背景

原 PoC 在开发环境验证通过，核心结论（`REPORT.md`）：
- **管道可行**：Task → 中间件(analysis.md) → Quality Gate → PASS 判定
- **编排器不应该是 Cordis 插件中的 JS 代码**，而是 DSH Agent Preset（模型层 `subagent` 工具完美工作，可嵌套）
- **两层协作**：Agent 层驱动编排 + 上报状态；Cordis 层（Client Slot + RPC + SVG DAG）做实时状态可视化
- 原插件仅验证 UI/工具可用性，状态存内存、不持久化

桌面环境落地时按相同架构重建，但补齐了原环境未验证的边界，并做工程化修正。

## 2. 改动总览

### 2.1 保持不变的架构决策

| 项 | 原 PoC | Desktop |
|---|---|---|
| Client Slot | `conversation.input.dock` | 相同 |
| DAG 渲染 | 纯 SVG（React.createElement），无外部依赖 | 相同 |
| 轮询 | 1500ms interval 轮询 RPC | 相同 |
| 颜色语义 | PENDING灰 / TASK_RUNNING蓝 / GATE_RUNNING橙 / COMPLETED绿 / FAILED红 | 相同 |
| 编排模型 | Agent 驱动，插件只做呈现 | 相同 |

### 2.2 接口重命名

| 项 | 原 PoC | Desktop | 原因 |
|---|---|---|---|
| 状态工具 | `update_workflow_status` | `workflow_status` | 参数规范化 |
| RPC | `workflow:status` | `wf:status` | 统一短名 |
| 启动工具 | （无） | **`workflow_begin`**（新增） | 需要真正的"解析 YAML + 初始化"入口 |

`workflow_status` 参数契约（新增字段支持重试演示）：
```
stage: PENDING | TASK_RUNNING | GATE_RUNNING | COMPLETED | FAILED
gateResult?: PASS | FAIL
task?: string            # 任务 id
taskStatus?: PENDING | RUNNING | DONE | FAILED
retries?: number
```

### 2.3 桌面特有的 API 适配（原环境未踩到的坑）

#### a) `harness.defineTool` 的 schema 校验（pkg-1 → pkg-3）

桌面上的 schema 编译器更严格：

| 规则 | 表现 |
|---|---|
| 嵌套 object schema 必须显式声明 `additionalProperties: true` 或 `false` | 省略 → `unsupported JSON schema: schema.additionalProperties must be explicitly true or false` |
| `parameters` 根级额外属性**必须为 true 或省略**（隐式根是开放的） | 写 `false` → `parameters.additionalProperties must be true or omitted because the implicit parameter root is open` |

**教训**：`output.schema` 的 object 加 `additionalProperties: true`；
`parameters` 根不写 `additionalProperties`。

#### b) `fs` 服务是 target 模型（pkg-3 → pkg-4）

```
错误：fs.readText({ path })            → "The path argument must be of type string"
正确：const target = await fs.resolve(path)   # resolve() 才是入口
      const text    = await fs.readText(target)
```

#### c) 无会话上下文的沙箱判定（pkg-6 → pkg-7/9，关键）

**现象**：插件 Host 侧 `fs.writeText` 写工作区文件报 `FS_SANDBOX_DENIED`，
即使目标路径就在会话工作区内。

**根因**：fs 沙箱按 `workspaceRoot` 判定可写范围，workspaceRoot 来自
`session.header.cwd ?? deployment 默认 root`。**Host 插件没有会话上下文**，
回落到 deployment 启动目录（非 `C:\Users\ranwa\dsh_workspace`），所以写工作区被判越界。

**修复**：`writeText` 显式传沙箱策略，把 workspaceRoot 指到会话工作区：

```js
const WRITE_POLICY = { mode: 'workspace-write', workspaceRoot: 'C:/Users/ranwa/dsh_workspace' }
await fs.writeText(target, content, undefined, undefined, WRITE_POLICY)
```

### 2.4 工程化增强

| 增强 | 说明 |
|---|---|
| **状态持久化**（新增） | 状态落盘 `.swd-workflow-state.json`，每次变更即写；插件启动 `loadState()` 恢复。原 PoC 明确"不持久化"，桌面演示暴露了"插件更新/重启会清空内存状态 → 颜色序列断裂"的问题 |
| **相对路径存在性探测** | 工作流 YAML 中的相对路径（`processor`/`gate`）相对工程根书写，而非 YAML 所在目录。从 YAML 目录逐级向上探测，取第一个真实存在的文件 |
| **persist 回显** | `workflow_begin`/`workflow_status` 输出含 `persist: "ok"|"err: …"`，可观测持久化是否成功 |
| **面板兜底** | workflow 为空时不再显示灰色占位符，渲染当前阶段色，杜绝"以为没在跑" |

### 2.5 Client 渲染修复（pkg-4 → pkg-5）

原实现变量名不一致：定义 `nodeColors`、引用 `nodeColor`（少个 s），
Client 渲染时 `ReferenceError: nodeColor is not defined`，Slot 崩溃退出。

## 3. 迭代清单（pkg-1 → pkg-10）

| 包 | 内容 | 动机 |
|---|---|---|
| pkg-1 | 初始实现 | 工作流解析 + 2 工具 + RPC + DAG 面板 |
| pkg-2 | schema 加 additionalProperties | 嵌套 object 必须显式 |
| pkg-3 | parameters 根去掉 additionalProperties:false | 参数根开放语义 |
| pkg-4 | fs 改 resolve→readText；相对路径转绝对 | fs 是 target 模型 |
| pkg-5 | nodeColor→nodeColors | Client 渲染崩溃 |
| pkg-6 | （定义时分配异常，未运行） | — |
| pkg-7 | saveState/loadState 持久化；面板兜底 | 插件重启丢状态 |
| pkg-9 | writeText 显式 sandboxPolicy | 无会话沙箱判定 |
| pkg-10 | 相对路径存在性探测 + persist 回显 | 路径正确性 + 可观测性 |

## 4. 预设落地（REPORT 的"下一步"）

按 REPORT 架构结论"编排逻辑放 Agent Preset"，在桌面创建 `software-design`
preset（`~/.dsh/.agent-presets/software-design/`）：
- persona：软件设计工作流编排 Agent（调 subagent 执行 Task/Gate，调
  `workflow_status` 上报 UI）
- 工具：subagent（spawn, continuable）、fs、fs-search、ask-user、todo
- 6 个技能：4 设计方法论 + `poc-analyzer`/`poc-reviewer`

**预设挂载校验发现**（原环境未暴露）：`tool-fs-search` 必须显式配置
`sampleOverCapGlobResults: false`，否则 `agentPresets.standingKeyFor(id)`
报 invalid config。

## 5. 验证结果（Desktop 实测）

| 项 | 结果 |
|---|---|
| 工作流解析 | ✅ `poc-with-gate`：1 任务（analyze-req） |
| Task 执行 | ✅ `analysis.md` 落盘（FR/NFR/假设/模糊点） |
| Gate 评审 | ✅ `gate-result.md` 落盘，5/5 检查 PASS |
| 颜色序列 | ✅ 灰 → 蓝(TASK_RUNNING) → 橙(GATE_RUNNING) → 绿(COMPLETED+PASS) |
| 状态持久化 | ✅ `.swd-workflow-state.json` 落盘，`persist: "ok"` |
| 路径解析 | ✅ `processor/gate` → `...\software-design-agent\PoC\skills\...\SKILL.md` |
| 重启恢复 | ✅ 插件重启后状态仍为 COMPLETED+PASS（loadState 生效） |

## 5b. 视图版迭代（v1 面板 → v2 工作流视图，sswd-1 pkg-1 重建后 pkg-1…pkg-7）

桌面侧把 Dashboard 从"输入条上方 dock 面板"升级为"会话顶部独立视图"，
并完成两轮缺陷根治。源码固化于 `plugin-source/swd-dashboard.js`（v2 最终版）。

### 迭代清单（视图版）

| 包 | 内容 | 动机 |
|---|---|---|
| pkg-1 | 重建版（重启丢失后） | 恢复能力 |
| pkg-2→pkg-3 | conversation.view 新视图：上栏 DAG + 下栏 skill | 用户要求侧边/顶部视图、点节点看 skill |
| pkg-4 | 指纹防抖 + DAG memo + marker 唯一 id | 修复图形闪烁（第一次尝试） |
| pkg-5 | hooks 全部提到条件 return 前 | React error #310（hook 数量不一致） |
| pkg-6 | 失败保留上次数据 + 稳定骨架 | 空态↔DAG 切换闪烁 |
| pkg-7 | **模块级数据层**（latest+listeners+单例轮询） | 根治：父级 remount 导致 state 清零 |

### 关键经验：闪烁的根因链与根治（pkg-7，用户实测验证）

**现象**：LLM 执行（Think / tool call 子代理）期间视图持续闪烁并闪现
"连接中"；输出文字结论时停止。

**根因链**：LLM 执行时会话快照高频更新 → 父级把 conversation.view 组件
**整体卸载重挂（remount）** → 组件内 `snap` state 清零 → 闪回骨架 →
轮询恢复 → 再次重挂 → 循环。

**前三次修复为何不够**：指纹防抖只防"组件自身 setState 重渲染"，
挡不住父级把组件销毁重建；hooks 顺序修复只解决渲染崩溃，与闪烁无关。

**根治方案**：数据持有层从组件内 **外置到 apply 级模块变量**——
轮询只在插件激活时启动一次（`ctx.effect` 单例），快照存模块 `latest`，
组件只订阅投影（`useReducer` force + listeners 注册/注销）。组件重挂
1000 次也不丢数据、不闪骨架；防抖下沉到模块层（`publish` 指纹相同不通知）。

**教训**：Slot 子视图若依赖高频刷新的父级容器，state 绝不能放组件内，
要么外置数据层，要么要求父级 key 稳定。

### 视图版实测结果（v2，pkg-7）

| 项 | 结果 |
|---|---|
| conversation.view 新视图 | ✅ 会话顶部出现「工作流」Tab（与聊天/轨迹并列） |
| 上下两栏布局 | ✅ 上栏 DAG+状态行，下栏选中节点 skill 文本 |
| 点节点看 skill | ✅ 点击节点后 host `wf:skill` 读全文（analyzer/reviewer SKILL.md） |
| 指纹防抖 | ✅ fingerprint 仅真实状态变化时变化，静态零重渲染 |
| remount 闪烁根治 | ✅ 用户实测：LLM 执行期间不再闪烁、不再闪现"连接中" |
| 完整流程 | ✅ 灰→蓝→橙→绿 + PASS，persist: "ok" |

## 6. 与原有结论的关系

- 管道可行性、两层协作、Agent 编排结论**全部保持成立**
- 本次补充的是：**桌面运行时的严格性适配**（schema/fs/沙箱三处）与
  **状态可靠性的工程化**（持久化/路径探测）
- 尚未做（可在后续 PoC 中验证）：插件打包为 npm 包经 `dsh plugin add`
  装入 profile、状态从文件升级为会话存储