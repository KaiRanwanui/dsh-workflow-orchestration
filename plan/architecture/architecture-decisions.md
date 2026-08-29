# Workflow Agent 架构决策

## 1. 插件加载方式：从动态插件转向 npm 包

### 决策
不再使用动态插件（`cordis_define`），改为通过 npm 包安装插件。

### 原因
动态插件在传递大量代码时存在 JSON 转义问题：
- 代码中的 `\n`、`\u` 等转义字符容易出错
- 大量字符串拼接导致解析失败
- 调试困难，错误信息不清晰

### 实现方式
- 插件代码存储在文件中（`src/client.js` 或 `lib/index.js`）
- 通过构建脚本（`build.js`）生成 DSH 模块格式
- 使用 npm 包方式安装到 profile 的 `node_modules`
- 在 `cordis.patch.yml` 中通过 `insert` 启用插件

### 优势
- 代码可版本控制，便于维护
- 避免 JSON 转义问题
- 符合标准 npm 包管理流程
- 构建过程可重复

## 2. 插件安装位置：Profile 级别

### 决策
插件包安装在 profile 中，而非全局或 preset 中。

### 当前状态
开发测试阶段：安装在 `desktop` profile 中
- 路径：`~/.dsh/profiles/desktop/node_modules/@workflow-agent/`
- 配置：`~/.dsh/profiles/desktop/cordis.patch.yml`

### 未来规划
独立 `workflow` profile：
- 路径：`~/.dsh/profiles/workflow/`
- 包含所有 workflow agent 相关的插件和配置
- 可通过 `dsh --profile workflow` 启动专用环境

### 优势
- 隔离性好，不影响其他 profile
- 便于测试和开发
- 未来可独立部署和分发

## 3. Preset 策略：精简为编排专用

### 决策
Agent Preset 仅保留编排相关配置（persona、工具授权、RPC 本地插件），
工具注册和 Client UI 迁移至 profile 级别的 npm 包。

### 原因
- Preset 主要用于定义 agent 的工具集和 persona
- 工具注册（`ctx.tools.register`）在 profile 级别 npm 包中同样有效
- Profile 可以同时管理 Host 端和 Client 端插件
- 简化架构，减少配置层级

### 当前架构（Iter-4 后）

| 组件 | 位置 | 说明 |
|------|------|------|
| `@workflow-agent/workflow-host` | profile npm 包 | 引擎 + 工具注册（`workflow_begin`/`workflow_status`） |
| `@workflow-agent/client-ui-monitor` | profile npm 包 | Client DAG 监控面板 |
| `workflow-rpc.mjs` | preset 本地插件 | RPC 处理器（`wf:status`/`wf:skill`/`wf:config`） |
| `system-prompt.md` | preset persona | 编排 Agent 指令 |

### 关键约束：harness Builtin 的作用域

`harness` Builtin（提供 `harness.handle()` RPC 注册）**仅在动态插件和 preset 本地插件中可用**。
npm 包由 Cordis Loader 直接加载，不经过动态插件沙箱，因此无法访问 `harness`。

这意味着：
- ✅ 工具注册（`ctx.tools.register`）→ npm 包可用
- ✅ 文件操作（`ctx.get('fs')`）→ npm 包可用
- ❌ RPC 注册（`harness.handle`）→ npm 包**不可用**，必须在 preset 本地插件中

### 未来考虑
根据实际开发需求再判断是否创建新的 preset：
- 如果需要定义特定的 agent persona 和工具集，可以创建 preset
- Preset 应该专注于 agent 行为定义，而非插件加载
- 插件加载统一在 profile 级别管理

## 4. Host 插件迁移记录（Iter-4 → Iter-5 之间）

### 背景
原来 Host 端插件（引擎 + 工具 + RPC）全部在 preset 的 `workflow-host.mjs` 本地插件中。
迁移目标：将 Host 插件注册到 desktop profile 的 npm 包中。

### 问题
首次迁移失败：将完整代码（含 `harness.handle()` RPC）打包为 npm 包后，
重启 DSH 时插件加载崩溃，系统自动回退。

### 根因
`harness` 是动态插件 Builtin，npm 包中不可用。`harness.handle(...)` 调用时
`harness` 为 `undefined`，导致 `TypeError`。

### 解决方案
拆分架构：
1. **npm 包**（`@workflow-agent/workflow-host`）：仅包含引擎 + 工具注册
2. **preset 本地插件**（`workflow-rpc.mjs`）：保留 RPC 处理器

### 修改清单
| 文件 | 改动 |
|------|------|
| `code/packages/workflow-host/build.js` | 不再合并 RPC 代码 |
| `code/packages/workflow-host/package.json` | 添加 `dsh.bundle.patch`，版本升至 0.2.0 |
| `code/packages/workflow-host/cordis.patch.yml` | 新建，声明 insert 行 |
| `code/agent-presets/.../workflow-host.mjs` | 移除 `timer` 注入，改用 `tools` |
| `code/agent-presets/.../agent.cordis.yml` | 注释掉 `workflow-host.mjs` 行（已由 npm 包替代） |
| `~/.dsh/profiles/desktop/cordis.patch.yml` | 添加 `workflow-host` insert 行 |

## 5. Client↔Host 通信：HTTP 轮询方案（当前决策）

### 背景
Client UI（DAG 监控面板）迁移到 npm 包后 RPC 链路断裂：
`host.call` 是**动态插件**闭包注入的符号，npm 包无法使用
（`dsh-cordis-client-runner` 的闭包参数，非 `@deepseek-ai/dsh-client-runtime` 的导出）。
详见 `plan/development/client-rpc-research.md`。

### 决策
采用 **HTTP 轮询方案**：

| 维度 | 决策 |
|------|------|
| Host 侧 | `workflow-host` npm 包新增 `ctx.webServer.register()` 路由（`GET /wf/status` 等） |
| Client 侧 | `client-ui-monitor` 用 `fetch('/wf/status?workspaceRoot=...')` 每 2s 轮询 |
| 状态来源 | `.workflow-agent/state.json`（引擎写入，路由读取） |
| 通知方向 | **Client 拉**（非 Host 推）；Host 每次请求时读文件，无需文件 watch |
| 安全 | loopback 检查（仿 `@linxin666/dsh-tool-describe-image` 的 `isLoopbackRequest`） |
| 参考先例 | `@linxin666/dsh-tool-describe-image`（npm 包 + webServer + fetch，本机已运行） |

### 依据
1. `webServer` 在官方 web profile 已启用（`dsh-web-app/cordis.patch.yml` 的 `webserver` 行）
2. `@linxin666/dsh-tool-describe-image` 是**可运行先例**：npm 包 `inject: ['tools','webServer']`，
   Host 半 `webserver.register({kind:'prefix', path:'/describe-image', handler})`，
   Client 半 `fetch('/describe-image/attach')` 同源调用，含 loopback 安全围栏
3. `host.call` 仅动态插件可用（`dsh-cordis-client-runner/lib/client.js` 闭包注入）；
   npm 包从 `dsh-client-runtime` 无法获得 `host`
4. Cordis service（`ctx.provide/get`）是进程内机制，Host(Node)/Client(浏览器) 不跨边界；
   官方跨边界唯一 RPC 通道（Typert Remote）Client 装配构建时固定，第三方不可扩展

### 被否决的备选
| 方案 | 否决原因 |
|------|---------|
| Cordis Service 跨边界 | 进程内机制无跨边界通道；Typert Remote 需改官方 api-remotes |
| 保持动态插件架构 | 与 npm 包迁移决策矛盾；动态插件有 JSON 转义/截断问题 |
| Host 推送（SSE/WS/会话事件流） | 当前阶段复杂度高，留作远期演进（见 `plan/design/client-host-communication.md`） |

### 部署位置
- **当前**：`workflow-host` + `client-ui-monitor` 安装到 `desktop` profile
- **未来**：独立 `workflow` profile（`~/.dsh/profiles/workflow/`），
  包含所有 workflow 相关插件与配置，通过 `dsh --profile workflow` 启动专用环境

### 修改清单（✅ Iter-5 已实施）
| 文件 | 改动 |
|------|------|
| `code/packages/workflow-host/` | 新增 webServer 路由模块（`/wf/status` `/wf/skill` `/wf/config` GET），复用 `loadState` 逻辑 |
| `code/packages/workflow-host/package.json` | `inject` 增加 `webServer`，版本升 0.3.0 |
| `code/packages/client-ui-monitor/src/client.js` | `host.call` → `fetch('/wf/status')`，保留模块级数据层；`ctx.interval` → `window.setInterval` |
| `code/packages/client-ui-monitor/build.js` | 移除 `require("@deepseek-ai/dsh-client-runtime").host`；inject 改为 `['slots']` |
| `code/agent-presets/.../workflow-rpc.mjs` | 停用/归档（harness RPC 由 webServer 路由替代） |

**验证结论（Iter-5）**：DAG 面板经 HTTP 轮询显示工作流状态（节点颜色绿/红/琥珀 + 循环组折叠框 + 状态条正确），详见 `plan/development/progress-record.md` §6 与 `plan/development/client-rpc-research.md` §7。

---

## 6. 多实例管理：复用 DSH Session（决策）

> 详见 `plan/design/multi-instance-session-design.md`（技术方案全文）

### 背景
当前为单实例：一个编排 Agent 会话运行一个工作流实例，`workflow_begin` 会覆盖旧状态。需求：多工作流实例独立运行、切换查看。

### 决策
**实例 = 一个 DSH Session（workflow preset）**，实例选择/切换完全复用 DSH 的 session 列表/切换：
- 每实例一个 workflow-orchestrator session，实例目录按 session.cwd 隔离
- DSH 支持多 session（agent）并行（每 agent 独立 sessionId/cwd/loop），多个实例**天然并行可切换查看**
- 不再强制"一个活跃 + 人工 stop 再切换"
- 实例运行状态记在实例目录 `state.json`；实例切换用 DSH session 列表；实例映射用实例目录 `metadata.json`（主），`session.header.meta` 后备

### 依据
1. DSH `sessions` 服务（dsh-session）是 event-sourced append-only log，支持 `create/list/get/fork`，`session.append` 记轨迹（官方 workflow 即用 session 事件流）
2. `agents` 配置支持多 agent，每个独立 sessionId/cwd/agent loop，可并行（`const { session } = agent`，agent-session 一一绑定）
3. `conversation.view` slot 提供 `useSessions` + `sessionId`，能取当前 session 的 `cwd`（`byId[sessionId].cwd`）——DAG 面板可用它跟随 session 切换

### 被否决
- 单引擎 + 多 state Map（engine 大改造，易破坏现有逻辑）
- 依赖 DSH `session-switch` 全局事件（调研：无此事件）
- 依赖 DSH `/new` 重置工作流（`/new` 是 UI 新建对话，不保证清空实例目录）

### 重置工作流
在 workflow 层实现 `workflow_reset`：清空实例目录 `output/`/`logs/`/`state.json` → 重读定义 → `workflow_begin` 重跑。

### 验证结论（✅ Iter-9 探针）
12 项探针全部通过，决策可行（详见 `plan/development/iter9-report.md`）：
1. `sessions` 服务全链路可用：create（id 唯一 + cwd 绝对路径 guard）、list/get 多 session 并行共存、`prepare+enter+announce+detach` 受控生命周期、flush 持久化检查点
2. `session.header.cwd → <cwd>/.workflow-agent/instances/<id>/metadata.json` 定位链路读写验证一致
3. 自定义 session 事件类型可直接 append（轨迹记录可用）
4. **约束**：实例存储路径必须从 session cwd 推导（动态插件上下文 `workspaceRoot`=HOME）；实例 session 生命周期必须用 `prepare+enter+announce` 持 detach（`create()` 无移除通道）

---

## 7. 工作流实例生命周期：绑定 / 状态机 / 完整性 / 归档（决策）

> 完整设计见 `plan/design/workflow-lifecycle-design.md`；迭代落地在 development-plan.md Iter-16。

### 7.1 数据模型与绑定
- **workspace 与 Session = 1:N**：workspace 是共享存储单元（会话创建时显式指定的 `cwd` 即工作区根），同 workspace 的会话共享实例池。
- **Session 与 workflow 实例 = 1:1 永久绑定**：绑定后禁再绑/切换（除非会话删除；删除时若 RUNNING 先 STOP，再解绑回 UNBOUND 池）。
- **权威在实例侧**：绑定真相 = `instances/<id>/metadata.json.sessionId`；运行态 = `state.json`；归档态 = 归档 metadata。
- **Session 状态一律派生**，不侵入 DSH Session。派生：BOUND（一结构完好实例声明 S）/ DONE（归档声明 S）/ UNBOUND（树自洽、无声明）/ BROKEN（整树缺场/退化/冲突）。

### 7.2 纯完整性判定（重点修订，取代 Iter-15 的脆弱自由文本驱动）
- **不设独立"绑定指针"**（避免一份可被一起删除的记录成为判断依据）。
- 判断标准是 **`.workflow-agent` 整棵树完整性**而非某个文件记录：工作区首次挂接会话即物化骨架 `instances/` + `archive/`；骨架在场且自洽 → 按导出状态判；骨架缺场/退化/冲突 → BROKEN（需新建会话，不静默重建）。
- 沿用"文件即状态"：删记录后重读文件即重新派生，无内存态不一致；运行中损坏会报错，重启 DSH / 刷新浏览器触发内存重载，按简单处理。

### 7.3 运行状态机
- 状态：`PENDING | RUNNING | STOPPED | COMPLETED | FAILED`；STAGE 枚举补 `STOPPED`。
- start 仅 PENDING（全新 begin）；resume 仅 STOPPED（hydrate 续跑保进度）；stop 仅 RUNNING（保进度、active=false）。
- reset/archive 仅 STOPPED/COMPLETED/FAILED；**PENDING 不支持 reset/archive**；RUNNING 须先 stop（优雅释放资源）。reset 到 PENDING（从头跑）。

### 7.4 重置与归档
- **重置**：确认框 → 先写 `reset_<state>` 归档备份 → 清 run 态 → 全新 begin。
- **归档**：仅 STOPPED/COMPLETED/FAILED 可归档 → 实例目录**移出池**进 `archive/<instanceId>/<ts>_<kind>_<state>/`（`kind`=reset|archive，`state`=归档时运行态，便于用户判断是否删归档）；配套 `manifest.json`；归档后会话 BOUND→DONE（不再执行工作流，新执行须新建会话）。
- 归档管理：人工 copy，或归档 UI（list / download(zip) / delete）。

### 7.5 预设门控
- 仅 `workflow-orchestration` preset 会话显示 workflow 页签 / DAG / 控制按钮（Client 按当前 session 的 preset 类型门控）。

### 7.6 待探针确认
1. 会话 preset 类型字段路径（页签门控）。
2. 会话删除检测（主动 stop+解绑；无事件则惰性孤儿清理）。
3. 会话存活判定（`sessions.list`）。

## 总结

### 架构层次
1. **Profile 层**：管理插件安装和加载（Host 端 + Client 端 npm 包）
2. **Preset 层**：定义 agent 的 persona、工具授权、以及需要 `harness` 的本地插件
3. **插件层**：具体功能实现（npm 包形式或 preset 本地 .mjs）

### 开发流程
1. 在 `workflow-agent/code/packages/` 中开发插件
2. 使用 `build.js` 构建生成 DSH 模块格式
3. 安装到 `~/.dsh/profiles/desktop/node_modules/`
4. 在 `cordis.patch.yml` 中配置启用
5. 重启 DSH Desktop 加载插件

### 目录结构
```
workflow-agent/
├── code/
│   ├── packages/
│   │   ├── workflow-host/            # Host 端引擎 npm 包
│   │   │   ├── src/                   # （源码在 agent-presets 中）
│   │   │   ├── build.js               # 构建脚本
│   │   │   ├── package.json           # npm 包配置
│   │   │   ├── cordis.patch.yml       # Bundle patch
│   │   │   └── lib/index.js           # 构建输出
│   │   └── client-ui-monitor/         # Client UI 监控面板 npm 包
│   │       ├── src/client.js          # 源代码
│   │       ├── build.js               # 构建脚本
│   │       ├── package.json           # npm 包配置
│   │       ├── cordis.patch.yml       # Bundle patch
│   │       └── lib/client.js          # 构建输出
│   └── agent-presets/
│       └── workflow-orchestrator/
│           ├── agent.cordis.yml       # Preset 配置
│           ├── system-prompt.md       # 编排 Agent 指令
│           ├── workflow-host.mjs      # （已弃用，由 npm 包替代）
│           └── workflow-rpc.mjs       # RPC 本地插件（harness 必需）
└── plan/
    └── build/
        ├── client-ui-plugin-guide.md  # 开发指南
        └── team-conventions.md        # 团队约定
```

## 参考命令

### 构建并安装所有插件（推荐）
```powershell
cd workflow-agent/code/scripts
.\build-workflow-plugins.ps1          # 构建
.\install-workflow-plugins.ps1 -Profile desktop   # 安装（DSH 需退出）
.\verify-workflow-plugins.ps1 -Profile desktop    # 验证
```

### 单独构建 Host 插件
```powershell
cd workflow-agent/code/packages/workflow-host
node build.js
```

### 单独构建 Client 插件
```powershell
cd workflow-agent/code/packages/client-ui-monitor
node build.js
```

### 手动安装到 desktop profile
```powershell
$src = "C:\Users\ranwa\dsh_workspace\workflow-agent\code\packages\workflow-host"
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@workflow-agent\workflow-host"
Copy-Item -Path $src -Destination $dst -Recurse -Force
```
