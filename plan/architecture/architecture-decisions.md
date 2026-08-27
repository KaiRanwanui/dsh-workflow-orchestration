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
