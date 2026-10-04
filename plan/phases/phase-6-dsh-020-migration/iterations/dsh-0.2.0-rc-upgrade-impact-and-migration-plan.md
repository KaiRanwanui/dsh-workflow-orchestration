# DSH 0.1.5-rc.2 → 0.2.0-rc.2 迁移影响评估（Iter-MIG0）

- 评估日期：2026-xx（Iter-MIG0）
- 基线：DSH tag `dsh-v0.1.5-rc.2` → 目标：DSH tag `dsh-v0.2.0-rc.2`
- 方法：只读分析。逐项核对 workflow-agent 耦合面实际调用的 DSH API 在两版实包实现（源码行级），面上扫描 `git diff --stat dsh-v0.1.5-rc.2 dsh-v0.2.0-rc.2 -- packages/`。**以实包实现为准**（类型注释与实现冲突时以实现为准并标注）。
- monorepo：`/Users/zhaokai/Projects/dsh_projects/deepseek-harness/`；workflow-agent：`/Users/zhaokai/Projects/dsh_projects/workflow-agent/`

---

## 1. 结论摘要

- **断裂项总数：2 项硬断裂（B1、B2）+ 1 项低风险提示项（B3）**。
  - 高危 1 项（B1：`subagents.listChildren` 返回结构重构，直接影响判活与面板 Stop 级联）。
  - 高危 1 项（B2：agent preset 交付/部署机制整体更换，`agent-presets` 包被删除）。
  - 低危 1 项（B3：`dsh.engines` 主动收窄建议 + 新版本兼容预检机制）。
- **已知初步发现修正**：
  - ❌「`sessionController.prompt` 在 0.2.0 变为 `prompt(request)` 单对象签名」——**证伪**。0.2.0-rc.2 实现仍是 `prompt(request: SessionPromptRequest, signal: AbortSignal)`（`packages/api/session-controller/src/index.ts:425-428`），signal 仍是第二个必填参数，与 0.1.5（同文件 :345-348）完全一致。**无需适配**。
  - ✅「`subagents.listChildren` 增加可选 signal（兼容）」——参数表兼容，但**返回值结构发生断裂**（见 B1），比初步发现严重。
- **危险等级分布**：🔴 高 2 / 🟡 低 1；其余全部核对 API（sessionController.prompt/cancel、subagents.prompt/interruptByParent/sendMessage/drainContinuableChildren、sessions.get、agents store、session/event、webServer.register、ctx.tools.register、cordis.patch.yml / dsh 字段、conversation.view / agentPreset 投影、persona config.prefix）均为**兼容**。
- **预计工作量**：
  - B1 适配：0.5～1 人日（两个调用点 + 探针回归）。
  - B2 适配：2～4 人日（preset 交付形态重做为 bundle/profile patch 声明式行、构建脚本 build.js 的 preset 打包链路、部署文档与真机验证）。
  - 回归验证：1 人日（面板 Stop 级联、孤儿回收、preset 会话启动）。
  - 合计约 **4～6 人日**。

---

## 2. 断裂点映射表

### B1 🔴 `subagents.listChildren` 返回结构重构（SubagentListEntry → SubagentCatalogEntry）

| 维度 | 内容 |
|---|---|
| **workflow-agent 触点** | `code/plugins/workflow-host/apply-prologue.js:71-85`（`listRunningChildren`：`e.kind !== 'child'` 过滤 + `e.activity === 'running'` 兜底）；`code/plugins/workflow-host/webserver-routes.js:1034-1039`（面板 Stop 级联：`.filter(c => c && c.kind === 'child' && c.id)`） |
| **0.1.5 行为（源码依据）** | `listChildren(parentSessionId, signal?): Promise<SubagentListEntry[]>`（`dsh-v0.1.5-rc.2:packages/subagent/subagent/src/index.ts:349`）。`SubagentListEntry` 为判别联合：`{ kind:'child', id, activity:'running'\|'inactive', hasChildren, mode, label? } \| { kind:'diagnostic', id, reason }`（`dsh-v0.1.5-rc.2:packages/subagent/subagent/src/control-types.ts:33-79`）。调用方以 `kind==='child'` 挑出子会话并以 `activity` 做判活兜底。 |
| **0.2.0 行为（源码依据）** | 返回类型改为 `Promise<SubagentCatalogEntry[]>`（`packages/subagent/subagent/src/index.ts:374`；`packages/subagent/subagent/src/list-children.ts:31-35`）。`SubagentCatalogEntry = { id, createdAt } & ({mode:'one-shot',label?} \| {mode:'continuable',label} \| {mode:'unknown',label?})`（`packages/subagent/subagent/src/projection-types.ts:10-20`）——**没有 `kind` 字段、没有 `activity` 字段、没有 `hasChildren` 字段**；`kind/activity` 形态的 `SubagentListEntry` 仅保留给递归 `listDescendants`（`control-types.ts:53-76`），且 `activity` 概念迁移到独立的 workspace 会话活动通道（`list-children.ts:116` 用 `sessions.get(entry.id)` 重算，不在返回值里）。 |
| **断裂后果** | ① `apply-prologue.js` 的 `e.kind !== 'child'` 使**全部条目被过滤**→ `listRunningChildren` 恒返回 `[]`→ 孤儿判定/停止级联守卫失效；② 面板 Stop 路由 `childIds` 恒空→ ③interruptByParent 级联与 ④drainContinuableChildren 全部空转——**运行中子会话将无法被面板停止**（0.1.5 迁移阶段 3 修过的「子会话迟迟不停」缺陷会复发，且更彻底）。 |
| **适配方案** | 两处调用点改为：直接以 `entry.id` + `entry.mode !== 'unknown'` 取子会话集合（catalog 语义=父目录的直接子，无需 kind 过滤；`mode:'unknown'` 是 0.2.0 新增第三态，保守起见仍纳入停止目标）；判活沿用现有 `sessions.get(child)` 主源（apply-prologue.js:76-78 已实现且 0.2.0 语义不变），删除 `e.activity` 兜底（字段已不存在，`isAgentRunning` 兜底可保留）。 |
| **风险等级** | 🔴 高（核心停止链路静默失效，无报错、难察觉） |

### B2 🔴 agent preset 交付/部署机制整体更换（agent-presets 包删除 → agent-preset-registry 声明式行）

| 维度 | 内容 |
|---|---|
| **workflow-agent 触点** | `code/agent-presets/workflow-orchestrator/`（`preset.yml` + `agent.cordis.yml` + `persona-file.mjs` + `system-prompt.md` 目录交付形态）；`code/packages/workflow-host/package.json` 的 `files` 含 `presets/workflow-orchestrator/`（npm 包随包分发 preset 目录的策略） |
| **0.1.5 行为（源码依据）** | `packages/preset/agent-presets/` 包：**目录扫描**——内置 `presets/` 根 + 用户根 `<dshHome>/.agent-presets`（`dsh-v0.1.5-rc.2:packages/preset/agent-presets/README.md:36`"presets shipped inside this package under `presets/`, and your own presets under `<dshHome>/.agent-presets`"）；每 preset = 目录（`preset.yml` 名册 + `agent.cordis.yml` 组合行），支持 copy/remove 到可写根；`agentPresetProjectionDefinition` 也由该包注册（`dsh-v0.1.5-rc.2:packages/preset/agent-presets/src/index.ts:48,84`）。 |
| **0.2.0 行为（源码依据）** | `packages/preset/agent-presets/` **整体删除**（diff：56 files, 7852 deletions），替换为新包 `packages/preset/agent-preset-registry/` + `packages/preset/agent-preset/`。新机制：preset 定义 = **普通 Cordis 插件行**（`PresetDefinition {id, name?, description?, order?, plugins:[EntryOptions 行]}`，`agent-preset/src/index.ts` Config schema；`agent-preset-registry/src/definition.ts:5-10` + `entryListProblem` 校验），由 bundle/profile patch 声明、注册进 `agentPresets` 服务，运行时挂到内存 EntryTree（`agent-preset-registry/src/mount.ts:7-10`"In-memory Loader tree; only the profile configuration editor persists definitions"）。README 明言：**registry "neither scans directories nor accepts preset paths"**（`agent-preset-registry/README.md:46`）——目录式 preset.yml/agent.cordis.yml 不再被发现。`agentPreset` 投影迁到 `agent-preset-registry/src/session.ts:40-50`（key 仍为 `agentPreset`，兼容）。 |
| **断裂后果** | workflow-orchestrator preset 以「目录 + 双 YAML」形态部署后，0.2.0 Host **不扫描、不挂载**——preset 在选择器中消失、会话无法以该 preset 启动。npm 包里的 `presets/` 目录同样不再被消费。 |
| **适配方案** | ① 把 preset 交付形态改为 **bundle 声明式行**：在 `@workflow-agent/workflow-host` 的 `cordis.patch.yml`（或新增独立 preset bundle 包）中插入一行 `agent-preset-registry` 定义行，`plugins:` 列表即原 `agent.cordis.yml` 的行原样搬入（行语法不变：`name`/`config`/`group`/`isolate` 均被 `definition.ts:20-31` 校验接受）；② `persona-file.mjs`（本地相对路径插件 `./persona-file.mjs`）不能跨包引用——改为随 npm 包分发（相对包内路径）或直接改用官方 `@deepseek-ai/dsh-persona` 行内联 `config.prefix`（`packages/preset/persona/src/index.ts:50` 仍为 `z.string().required()`，机制两版一致）；③ 构建脚本 `build.js`/`sync` 链与 `package.json files` 需同步调整；④ 部署文档更新。 |
| **风险等级** | 🔴 高（preset 完全不可见=功能整体失效，但故障是显性的、启动期即可发现） |

### B3 🟡 `dsh.engines` 收窄建议 + 0.2.0 新增插件版本兼容预检

| 维度 | 内容 |
|---|---|
| **workflow-agent 触点** | `code/packages/workflow-host/package.json` `dsh.engines: { dsh: ">=0.1.5-rc.1" }` |
| **0.1.5 行为（源码依据）** | `dsh.engines` 仅作为声明，无安装期强制（0.1.5 无 plugin-compatibility 模块）。 |
| **0.2.0 行为（源码依据）** | 新增 `packages/boot/app-boot/src/plugin-compatibility.ts`（"Evaluate plugin dsh peer requirements without importing plugin code"，semver 校验）+ `compatibility-preflight.ts`（启动预检）+ version-exemption 机制（`packages/boot/plugin-manager/src/index.ts:233-247` readProfileCompatibility / setProfileVersionExemption）。不满足 peers 的插件**阻止安装与激活**（`plugin_manager` 工具描述："Incompatible DSH peer dependencies block installation and activation"）。 |
| **适配方案** | `>=0.1.5-rc.1` 语义上满足 0.2.0，不会被拦；但建议适配版发布时收窄为 `>=0.2.0-rc.2`，避免旧 runtime 加载只兼容 0.2.0 的新产物被 exemption 机制绕过风险。 |
| **风险等级** | 🟡 低（提示项） |

---

## 3. 兼容确认表（核对过且无变化，均给出实包源码依据）

| API / 机制 | workflow-agent 调用形状 | 0.1.5 依据 | 0.2.0 依据 | 结论 |
|---|---|---|---|---|
| `sessionController.prompt(request, signal)` | `{requestId, sessionId, mode:'queue'\|'steer', content} , signal` → `{accepted:true}` | `api/session-controller/src/index.ts:345-348`；`types.ts:310-318`（mode 即为 queue/steer） | 同文件 `index.ts:425-428`；`types.ts:333-341` | ✅ 签名与请求体逐字段一致（**初步发现证伪**：signal 未删除、未进 request） |
| `sessionController.cancel({sessionId})` | `{sessionId}` → `{accepted:true}` | `index.ts:376-378`；`types.ts:373-379` | `index.ts:456-458`；`types.ts:373-379` | ✅ 兼容 |
| `subagents.prompt(request, signal)` | `{requestId, parentSessionId, childSessionId, mode:'continuable', delivery:'queue'\|'steer', content}, signal` → `{messageId}` | `subagent/src/index.ts`（@Remote('prompt')，delivery 字段已存在）；`control-types.ts:98-105`（delivery 已在 0.1.5 请求体） | `subagent/src/index.ts:415-416,416-470`；`control-types.ts:97-121` | ✅ 兼容（新增可选 `clientTimeZone`，不影响） |
| `subagents.interruptByParent(child, parent, 'continuable')` | 三参顺序 (child, parent, mode) | `subagent/src/index.ts`（@Remote('interruptByParent')） | `subagent/src/index.ts:482-489` 同签名同 no-op 语义 | ✅ 兼容 |
| `subagents.sendMessage(sender, targetId, content, {signal})` | `/wf/probe-inject` 探针 | `subagent/src/index.ts:246-252` | `subagent/src/index.ts:279-286` | ✅ 兼容 |
| `subagents.drainContinuableChildren(parentAgent, childIds)` | 面板 Stop ③硬释放 | `subagent/src/index.ts:326` | `subagent/src/index.ts:359`（absent/manager-less = accepted no-op 语义同） | ✅ 兼容 |
| `sessions.get(id)`（resident/live 判活） | `isSessionLive` / `liveChild` | `core/session/src/index.ts`（store get；live store 语义） | 同文件（store.get 于 :1127/:1216 等处，语义未变；两版均无「存在但未驻留」返回） | ✅ 兼容（resident 语义保持） |
| `agents` store：`get(id)`（`.status==='running'`、`.inbox.hasPending`、`.session.log`）、`list()`、`roots()`、`currentInitiator()` | apply-prologue.js:47-62, 99-108；webserver-routes.js:793-812 | `core/agent/src/index.ts`（currentInitiator/roots/inbox） | 同文件 `index.ts:295`（currentInitiator）、`:596`（roots）、`core/agent-loop/src/agent.ts:99`（inbox）、`:200,262`（hasPending） | ✅ 兼容 |
| `ctx.on('session/event', (session, event))`（turn/end aborted(user) 用户中止信号，payload 在 data 包装下） | apply-prologue.js:127-141 | `core/session/src/index.ts:77`（事件签名）、:759-764（发布） | 同文件 :77、:759-764，签名 `(Session, SessionEvent)` 未变；`core/agent-loop/src/agent.ts:385` turn/end 结构同 | ✅ 兼容 |
| `webServer.register({kind:'prefix', path, handler})` | `/wf/*` 全部路由 | `host/webserver/src/index.ts`（prefix/exact 表） | `index.ts:166-169`（kind 'exact'/'prefix'、重复注册抛错语义同） | ✅ 兼容 |
| `ctx.tools.register({name, description, parameters, output:{schema, render}, execute})` | `workflow_begin/workflow_status` 工具 | `core/tools/src/index.ts`（register） | `index.ts:1063`（register(definition)；tools-preset.js 的对象形状仍被接受，`defineTool` 只是包装） | ✅ 兼容 |
| `dsh.bundle.patch` / `cordis.patch.yml`（insert plugin 行） | workflow-host 双端 bundle | `bundle/base/src/index.ts:3`（manifest 字段）；app-boot profile.ts patch 组合 | `app-boot/src/profile.ts:59-61`（bundle.patch 可为 string 或 list，均支持）；`plugin-manager/src/operations.ts:77` | ✅ 兼容（0.2.0 还放宽为可声明多个 patch 文件） |
| `dsh.client.inject` / `dsh.client.platform` | `lib/client.js` 面板注入 | `client/modules/src/index.ts:193`（platform 必须为 string） | `client/modules/src/client/manifest.ts:167-176`（同校验 + inject 可选 string[]） | ✅ 兼容 |
| Client `slots`：`slots.register({name:'conversation.view', id, order, label}, Comp)` + `slots.inject(...)` | `src/client.js:2311-2352` | `extensions/cordis-client-runner/src/client/slot-catalog.ts`（conversation.view） | 同文件 `:1552`（key 'conversation.view' 仍在；register/inject 用法示例 :69-70） | ✅ 兼容 |
| 会话 preset 读取 `byId[id].projectionValues.agentPreset` / `entry.agentPreset` | `src/client.js:2329-2330, 2379-2381` | `agent-presets/src/index.ts:48`（agentPresetProjectionDefinition） | `agent-preset-registry/src/session.ts:40-50`（key 仍 'agentPreset'，state string\|null）；`api/session-controller/src/client/sessions/service.ts:50,625-627`（entry.projectionValues 仍在） | ✅ 兼容（投影迁包不改 key/形态） |
| `sessionQuery.listSessions()` → `SessionRecord{header:{id, parentSession,...}, live, persisted}` | 孤儿判定/主会话守卫（apply-prologue.js:28-45；tools-preset.js:703-716） | `session-query/session-query/src/index.ts` | 同文件 `:174`（listSessions(signal?)）；header.id/parentSession 形态未变 | ✅ 兼容 |
| persona `config.prefix` 必填（或 persona-file.mjs 的 systemPrompt.section 机制） | persona-file.mjs:29 | `preset/persona/src/index.ts:50` `prefix: z.string().required()` | 同文件 `:50` 未变 | ✅ 兼容 |
| `dsh --profile` / `$DSH_HOME/profiles/<name>` / `dsh plugin` CLI | 部署流程 | `boot/README.md:32`、`app-boot/src/profile.ts` | `app-boot/src/profile.ts:5,37`（`$DSH_HOME/profiles/<name>`）、`boot/cmdline/src/index.ts:5`（--profile 旗标）、`plugin-manager`（dsh plugin 命令族含 version-exemptions） | ✅ 机制保留（且增强，见 §4） |

---

## 4. 环境与部署差异（macOS）

1. **profile 机制：保留且增强**。`$DSH_HOME/profiles/<name>`（默认 `~/.dsh/profiles/`）与 `dsh --profile`、`dsh plugin` CLI 在 0.2.0 均存在（`packages/boot/app-boot/src/profile.ts:5,37`；`packages/boot/cmdline/src/index.ts:5`）。`dsh plugin --profile <profile> ...` 命令族扩展了 `version-exemptions` / `allow-version` / `revoke-version`（`packages/boot/plugin-manager/README.md:69`）。
2. **插件重启生效机制：0.2.0 有官方 HMR**。新增 `packages/boot/hmr/`（全新包：模块热重载、文件 watching、与 plugin 管理写操作串行化）。`dsh plugin` 安装/启停对 **live profile（patchReload: live）即时生效，无需重启进程**——0.1.5 时代用 systemd/launchd 重启 Host 使插件生效的做法可退役；startup-only profile 仍需重启（README.md:131"Startup-only profiles cannot remove packages used to start the current process; stop it and use `dsh plugin`"）。web profile（本 GUI 所用）0.1.5 起即为 live reload 模板。
3. **新增 Agent 工具 `plugin_manager` 与 Web 管理页**（`packages/boot/plugin-manager/src/tools.ts:24`：list_plugins/list_bundles/set_plugin/set_bundle/install_bundle/remove_bundle/version-exemptions；需 danger-full-access 或逐次审批）。迁移后可用它免 CLI 管理 workflow-host 包。
4. **版本兼容预检**：安装/激活前用 semver 校验插件 `dsh.engines`，不满足即拒绝（`plugin-compatibility.ts` + `compatibility-preflight.ts`），可用 version-exemption 显式豁免（有崩溃/数据丢失风险警告）。见 B3。
5. **preset 部署目录机制：已移除**（B2）。`<dshHome>/.agent-presets` 用户根与随包 `presets/` 目录扫描不复存在；preset 只能经 bundle/profile patch 声明式行交付（`agent-preset-registry`，"neither scans directories nor accepts preset paths"）。
6. **bundle patch 能力放宽**：`dsh.bundle.patch` 接受文件路径**列表**（`profile.ts:59-61`），一个包可声明多层 patch。
7. 其余面上大改域（见附录）：client/ui 全面重构（746 文件）、llm、api、session 修复链（repair/surface）、workspace 归档准入（ArchivedSessionGate：归档会话及其后代不跑模型步，直到恢复——对 workflow 子会话无影响，但需注意不要归档编排主会话）、workflow 域新增 `workflow-ptc`（与本项目无耦合）。

---

## 5. 建议的 Iter-MIG1 适配清单（按依赖顺序）

1. **[B1] 修 `listChildren` 消费点**（先于一切回归）：
   - `apply-prologue.js` `listRunningChildren`：去掉 `kind` 过滤与 `activity` 兜底，保留 `sessions.get` 判活主源 + `isAgentRunning` 兜底；`mode:'unknown'` 纳入目标集合。
   - `webserver-routes.js` Stop 路由 `childIds`：同规则改写。
   - 回归：启动含 continuable 子会话的工作流 → 面板 Stop → 验证子会话全部终止、stop-trace.log children 数 > 0。
2. **[B2] preset 交付形态迁移**：
   - 在 `@workflow-agent/workflow-host` 的 `cordis.patch.yml` 中新增 `agent-preset-registry` 行：`id: workflow-orchestrator`，`plugins:` = 现 `agent.cordis.yml` 全部行原样搬入（语法不变）。
   - persona：`persona-file.mjs` → 随包分发相对路径行，或改官方 `@deepseek-ai/dsh-persona` 行 + `config.prefix` 内联（后者可退役 persona-file 机制）。
   - `build.js` / `package.json files` / 部署文档同步；真机验证 preset 出现在选择器且会话可启动。
3. **[B3] `package.json` `dsh.engines` 收窄至 `>=0.2.0-rc.2`**，`dsh.bundle.patch` 可顺势保持单文件（无需用多 patch 能力）。
4. **回归矩阵**（收尾）：① 面板 Stop 级联（B1 主场景）；② 孤儿回收 /wf/list；③ /wf/probe-inject；④ session/event 用户中止 tap；⑤ Client conversation.view 面板与 agentPreset 门控（Iter-39 动态门控）；⑥ 0.2.0 新预检下的全新安装（`dsh plugin` 或 `plugin_manager` 工具）演练一遍。
5. **可选跟进**：评估用 `plugin_manager` 工具替代部署文档中的手工 `dsh plugin` 步骤；评估 live-profile HMR 下「改插件→重启」文档段落删除。

---

## 6. 附录：diff 统计与大改域清单

`git diff --stat dsh-v0.1.5-rc.2 dsh-v0.2.0-rc.2 -- packages/`：**5094 files changed, 356070 insertions(+), 103599 deletions(-)**。

按域（packages/\<域\>）改动文件数粗排（前 20）：

| 域 | 改动文件数 | 与 workflow-agent 相关度 |
|---|---|---|
| client | 746 | 中（slots/面板 API 兼容已核对；UI 内部重构不影响插件 API） |
| llm | 139 | 低 |
| api | 138 | **高**（session-controller：prompt/cancel 兼容；新增 ArchivedSessionGate、projections 接口） |
| experimental | 117 | 低 |
| core | 109 | **高**（agent/session/tools：API 面稳定；session repair/surface 内部重构） |
| session | 92 | 中（session-query：listSessions 兼容；session-title 等周边） |
| util / shell | 88/88 | 低 |
| boot | 86 | **高**（profile 保留；新增 hmr、plugin-manager、config-editor、compatibility-preflight——环境层最大变化） |
| subagent | 67 | **高**（listChildren 返回结构重构 = B1；prompt/interrupt/drain/sendMessage 兼容） |
| fs / ssh | 61/59 | 低（fs 服务 readText/writeText/listDir/stat 未动） |
| bundle | 56 | 低（bundle.patch 字段兼容 + 放宽多 patch） |
| host | 53 | 中（webserver 仅压缩中间件微调） |
| preset | 44 | **高**（agent-presets 删除 → agent-preset-registry + agent-preset = B2；persona 未变） |
| schedule / test-support | 44/50 | 低 |
| workflow | （新增 workflow-ptc，删 workflow-worker-thread） | 无（与本项目同名域但无代码耦合） |

其他值得关注的全局变化：`ArchivedSessionGate`（归档会话冻结，`api/session-controller/src/index.ts` 构造处 ctx.plugin）、`agent/status`→`api-session/status` 发布链扩展、web-app bundle patch 大幅扩充（+560 行注释处起）、`SubagentCatalogEntry`/`SubagentListEntry` 类型拆分（control-types vs projection-types）。

---

*报告完。Iter-MIG1 适配清单见 §5；两处断裂项（B1/B2）均已有源码行级定位与适配方案。*
