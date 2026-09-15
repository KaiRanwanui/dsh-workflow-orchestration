# Workflow-Agent 工程导览

> **给新会话 / 新成员的工程导航**：本文回答「代码在哪、机制怎么跑、改一处要动什么」。
> 项目是什么、当前进展 → 根 [`README.md`](README.md) 与 [`plan/status.md`](plan/status.md)；文档地图 → [`plan/README.md`](plan/README.md)。

**最后校订**：2026-09-14（对齐 DSH 0.1.5-rc.2 / host v0.21.0 / client v0.9.1）

---

## 1. 系统形态（一句话链路）

```
用户在 GUI 创建 workflow-orchestrator 会话
   ↓
编排 Agent（preset：persona + workflow_* 工具 + subagent 委托）
   → YAML 定义 → workflow_begin / workflow_status（工具上报）
   → 每个 Task 用 subagent 派发独立 LLM 会话（隔离上下文）
   ↓
workflow-host（npm 包插件）
   → 引擎/状态机/持久化（.workflow-agent/instances/<id>/）
   → webServer 路由 /wf/*（面板与外部探测入口）
   ↓
client-ui-monitor（npm 包插件，浏览器侧）
   → conversation.view 槽位渲染 DAG 面板；fetch 轮询 /wf/* ；四键控制
```

## 2. 阅读顺序（新会话必读）

| 顺序 | 文档 | 获得什么 |
|---|---|---|
| 1 | [`plan/status.md`](plan/status.md) | **当前状态**：阶段、DSH/项目版本基线、下一步、已知限制 |
| 2 | [`plan/phases/README.md`](plan/phases/README.md) → 阶段 README | 各阶段做了什么、迭代索引（查细节时进 `iterations/`） |
| 3 | [`plan/architecture/architecture-decisions.md`](plan/architecture/architecture-decisions.md) | 架构决策（插件加载、profile 布局、通信、多实例、生命周期） |
| 4 | [`plan/design/`](plan/design/) 对应篇目 | 数据模型（`workflow-schema-v1.md`）、生命周期、状态管理、通信 |
| 5 | [`plan/development/team-conventions.md`](plan/development/team-conventions.md) | **协作纪律**（先设计后开发、差分验证、上下文压力处理…） |
| 6 | 本文 §3–§5 | 代码结构、关键机制、构建与开发流程 |

## 3. 代码结构导航

```
workflow-agent/
├── code/
│   ├── packages/                          # ★ 交付物（npm 包，profile 以 link: 依赖）
│   │   ├── workflow-host/                 #   Host 插件：lib/index.js（CJS，运行时加载）+ cordis.patch.yml
│   │   └── client-ui-monitor/             #   Client 插件：src/client.js → lib/client.js（浏览器 bundle）
│   ├── plugins/                           # 源模块（由 module-manifest 拼入 Host 产物）
│   │   ├── workflow-host/                 #   apply-prologue.js（探针+A1 tap）、engine.js、storage.js、
│   │   │                                  #   instance-store.js、builtin-skills.js、webserver-routes.js（/wf/*）
│   │   └── workflow-host-preset/          #   tools-preset.js（workflow_* 十个工具）
│   ├── legacy/                            # ⚠️ 历史代码归档（非现役，见 legacy/README.md）
│   ├── shared/                            # schema / parser / paths / validate / edit / items-extract / zip-writer
│   ├── agent-presets/workflow-orchestrator/  # preset.yml + agent.cordis.yml + system-prompt.md（persona 单一源）
│   │                                         #   （阶段 3 后 preset 不再携带 mjs；Host 以 npm 包交付）
│   ├── scripts/                           # 构建/测试/同步脚本（见 §5）
│   └── probes/                            # 历史探针脚本（Iter-SUBA / Iter-23 实证留档）
├── plan/                                  # 管理文档（status / phases / design / architecture / requirements / development / build）
├── PoC/                                   # PoC 阶段资产（docs / solutions / legacy-root）
├── workflows → PoC/legacy-root/workflows  # 早期示例工作流（已归位）
├── README.md                              # 项目入口（3 分钟了解）
└── GUIDE.md                               # 本文（工程导览）
```

## 3.5 DSH 源代码与依赖位置

| 用途 | 位置 |
|---|---|
| 运行中的 DSH 安装（插件加载的实包） | `/home/zhaokai/.npm-global/lib/node_modules/@deepseek-ai/dsh/`（卫星包在该目录 `node_modules/@deepseek-ai/` 下） |
| 本地 DSH 源码镜像 / 升级调研包 | `~/Projects/dsh_projects/deepseek-harness-master/`、`~/Projects/dsh_projects/dsh-upgrade-lab/` |
| 进行中的 profile | `~/.dsh/profiles/web/`（`package.json` + `cordis.patch.yml` + `node_modules`） |
| Agent preset 部署点 | `~/.dsh/.agent-presets/workflow-orchestrator/` |
| 内建资产物化点 | `~/.dsh/workflow-agent/`（模板/技能/samples/docs） |

**查服务契约的正确姿势**：
```bash
DSH=~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
grep -n "prompt(request" $DSH/dsh-api-session-controller/lib/index.js      # 实现（看是否必填 signal 等）
cat $DSH/dsh-subagent/lib/typert.host.js | head -260                        # 服务成员与签名表
sed -n '1,80p' $DSH/dsh-subagent/lib/types/control-types.d.ts               # 结构化类型（字段语义注释）
```
**教训（0.1.5 迁移期实证）**：类型/文档常与实现有微妙差异，**以实包实现为准**——
- `sessionController.prompt(request, signal)` 的 `signal` 文档说可选，实现首行即 `signal.throwIfAborted()`（必填）；
- 子会话不进 `agents` store，`listChildren` 的 `activity` 也不可靠 → 判活要用 `sessions.get(child)`；
- Client 侧会话 preset 走投影：`byId[id].projectionValues.agentPreset`。

## 4. 关键机制速查

### 4.1 Client ↔ Host：HTTP 轮询（`/wf/*`）

```
Client（conversation.view 面板）
  → fetch GET /wf/list|status|templates|skills|instance-yaml|archives …
  → 轮询 + 指纹防抖 → 更新 DAG / 按钮态
Host（webserver-routes section）
  → 读实例目录（state.json / metadata.json）→ 返回 JSON
  → 写操作：/wf/create /wf/start /wf/stop /wf/reset /wf/resume /wf/adopt /wf/archive …
```
- 路由实现集中在 Host 产物的 **webserver-routes** section（源 = mjs 直编区，阶段 3 将抽成源文件）。
- 旧 RPC（`host.call('wf:status')`）自 Iter-5 起停用。

### 4.2 停止语义（0.1.5 起，重要）

| 路径 | 机制 | 效果 |
|---|---|---|
| 面板 Stop | `/wf/stop` 路由内：`engine.stop()` + 落盘 + **`sessionController.cancel({sessionId})`（原生级联）** + 兜底对所有子会话 `interruptByParent` | 主/子会话**立即**停止 |
| 会话 UI 停止 | DSH cancel → 回合 `aborted(user)` → `session/event` tap → `applyUserStop`（STOPPED + user-stop + 级联） | 同上 |
| 消息注入（steer/queue） | `sessionController.prompt` / `subagents.prompt`（`delivery`） | **不保证即时打断**——仅用于 Start/Resume/Reset 等非紧急指令与事后通知 |

> `interruptByParent` 返回 `accepted` 只代表"信号已受理"，活任务是否立即停下取决于其是否在步界观察到信号 —— 因此它是**兜底**，主通道是 cancel。

### 4.3 判活与孤儿

- 主会话存活：`sessions.get(sid)`；子会话存活：`sessions.get(childId)`（resident 语义）。
- 子会话枚举：`subagents.listChildren(parentSessionId)`（durable 条目；**不要**依赖 `activity` 或 `agents.get`）。
- 孤儿回收：重启后实例与死会话解绑回采用池（`/wf/list` 的 `recoveredOrphans`）。

### 4.4 插件加载与部署

- profile bundle 列表（`~/.dsh/profiles/web/package.json` = `dsh.profile.bundles`）→ 每个包的 `cordis.patch.yml` 声明 `insert` 行 → dsh 启动时按包 `main` 加载。
- 本仓库两包以 **`link:`** 依赖进 profile：**构建即生效**，无需重装。
- **Host 改动 → 重启 `dsh.service`；Client 改动 → 刷新页面**。
- 阶段 3 起 preset 目录**不再携带 `workflow-host.mjs`**（Host 一律以 npm 包交付；如需 preset 本地插件形态，产物在 `code/packages/workflow-host/dist/workflow-host.mjs`）。

## 5. 开发流程与构建链（阶段 3 起：单一生成器）

```
# Host：改源模块（按 module-manifest 拼入产物）→ 单一生成器 → 单测
node code/packages/workflow-host/build.js     # 源模块 → lib/index.js（CJS 交付物）+ dist/workflow-host.mjs（ESM）
node code/scripts/test-host.js                # 569 用例；启动时自动检查产物新鲜度并按需重建

# Client：改 src/client.js → 构建 → 产物级验证
node code/packages/client-ui-monitor/build.js
node code/scripts/verify-client-bundle.js

# persona：改 system-prompt.md → 注入 agent.cordis.yml
node code/scripts/sync-persona.js
```

| 你要改的东西 | 编辑文件 | 必跑命令 | 生效方式 |
|---|---|---|---|
| 引擎 / 状态机 | `code/plugins/workflow-host/engine.js` | build → test | 重启 `dsh.service` |
| 存储 / 注册表 / 归档 | `code/plugins/workflow-host/{storage,instance-store}.js` | 同上 | 同上 |
| 工具（`workflow_*`） | `code/plugins/workflow-host-preset/tools-preset.js` | 同上 | 同上 |
| `/wf/*` 路由、面板 Stop | `code/plugins/workflow-host/webserver-routes.js` | 同上 | 同上 |
| inject / 探针 / A1 tap | `code/plugins/workflow-host/apply-prologue.js` | 同上 | 同上 |
| 面板 UI | `code/packages/client-ui-monitor/src/client.js` | client build → verify | 刷新页面 |
| persona 提示词 | `code/agent-presets/workflow-orchestrator/system-prompt.md` | sync-persona | 新建/重载 preset 会话 |

> 构建链历史（sync-modules 两步链、build-preset.js）已退役，脚本在 `code/legacy/scripts/`。

> ⚠️ `code/scripts/build-preset.js` **已废弃**（运行即 exit 1，防止用陈旧模板覆盖现役 mjs）。
> ⚠️ Host 源码目前是「源模块 + 2 段手编区」混合体 —— **阶段 3 将合并为单一生成器**（详见 `plan/status.md` §3）。

## 6. 团队约定摘要

- **先设计后开发**：每个迭代先提交设计方案（含交付件/选型/验证标准），用户确认后才写代码。
- **差分验证**：一次只改一个维度，改完立即用最小手段验证。
- **上下文压力处理**：上下文紧张时主动告知，不擅自压缩/省略。
- **工作代码保护**：正常功能不因"精简"删除；偏离 PoC 模式先打桩验证。
- **环境边界探索**：未文档化约束先探针取证，再写正式代码。

完整约定与历史事故索引：[`plan/development/team-conventions.md`](plan/development/team-conventions.md)。
