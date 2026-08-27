# Client UI RPC 链路修复 — 官方源码研究报告（v2）

> 更新：基于官方仓库 `deepseek-harness-master`（zip 解包）+ 本机 DSH Desktop 内置官方包双重源码验证
> 目的：回答"Client UI 如何从 Host 获取工作流状态"，评估三备选方案
> 结论先行：**方案 1（HTTP 端点）合格且已有官方生态可运行先例；方案 2（Cordis Service 跨边界）不可行；方案 3（动态插件）可作过渡非终局。另有官方推荐的会话事件流模式（方案 4）可作远期演进。**

---

## 1. 问题根因（源码级确认）

### 1.1 `host.call` 是动态插件闭包专用符号

`deepseek-harness-master/packages/cordis/...` 及本机 `dsh-cordis-client-runner/lib/client.js`（第 172-182 行）：

```js
const returned = await closure(
  react,
  taggedConsole(...),
  styles,
  { call: (method, args = null) => env.invoke(method, args) },  // ← host 对象在此闭包注入
  harnessTrap(), ...
)
```

- `host.call(method, args)` → `env.invoke` → `dynamicCordisRunner` Remote namespace → Host 半 `harness.handle()`
- **npm 包（静态插件）没有闭包注入**，`@deepseek-ai/dsh-client-runtime` 不导出 `host`
- 我们 `client-ui-monitor/build.js` 中的 `const { host } = require("@deepseek-ai/dsh-client-runtime")` 必然得到 `undefined`

### 1.2 Client 插件加载机制（官方确认）

`docs/subsystems/client-modules.zh.md`：npm 包经 `package.json` 的 `dsh.client` 声明（`platform: 'web'`）+ `exports["./client"]` 导出 bundle，Host 扫描组合 `window.__DSH_BOOT__` 图，经 `/plugins/<id>/client.js` 提供。我们 `client-ui-monitor` 的 package.json 声明正确，加载链路本身没问题 —— 问题只在数据获取方式。

---

## 2. 官方 Client↔Host 通信通道全景（源码 + 文档）

| 通道 | 机制 | 第三方 npm 包可用 | 官方源码依据 |
|------|------|:---:|------|
| **HTTP 路由** | `ctx.webServer.register({kind,path,handler})` + Client `fetch()` 同源 | ✅ **有可运行先例** | `docs/subsystems/web-server.zh.md`；`@linxin666/dsh-tool-describe-image` 本机已运行 |
| **会话事件流** | Host `session.append(type,data)` 写日志 → 下行 WS → Client `conversationEvents.register()` 折叠 → `conversation.chat.node` 渲染 | ✅ 官方 workflow 自身用 | `docs/subsystems/workflow.zh.md`；`docs/cookbook/adding-a-conversation-node.zh.md`；`packages/workflow/tool-workflow/src/index.ts` |
| **Typert Remote** | Host `@Remote` decorator → 构建时生成描述符 → Client `ctx.remote.<ns>` 调用 | ⚠️ **需官方 api-remotes 装配显式挂载**（第三方不可自行扩展） | `docs/api-gateway.zh.md`："Client 不会在运行时发现 Host 中已启用的服务或 Remote 定义" |
| **包内 RPC** | `harness.handle` / `host.call` | ❌ 仅动态插件 | `dsh-cordis-client-runner/lib/client.js` |
| **Cordis Service** | `ctx.provide` / `ctx.get` | ❌ 进程内机制，Host(Node)/Client(浏览器) 不跨边界 | `docs/api-gateway.zh.md`（Remote 是唯一跨边界方式，且受装配限制） |

### 2.1 关键证据

1. **webServer 官方文档**（`docs/subsystems/web-server.zh.md`）：`register(route): () => void`，`kind: 'exact'|'prefix'`，重复 `(kind,path)` 抛错；web profile 组合已挂载 `webserver`（`packages/bundle/web-app/cordis.patch.yml`）。
2. **describe-image 可运行先例**（本机 `~/.dsh/profiles/desktop/node_modules/@linxin666/dsh-tool-describe-image/`）：
   - `cordis.patch.yml`：单包双半，`insert: [{id: describe-image, name: '@linxin666/dsh-tool-describe-image'}]`
   - Host：`inject: ['tools', 'webServer']`，`webserver.register({kind:'prefix', path:'/describe-image', handler})`（`src/attach-routes.ts`）
   - Client：`fetch('/describe-image/attach', {method:'POST', body: JSON.stringify(...)})` 同源相对路径（`src/client/attach.ts`）
   - 含 loopback 检查（`isLoopbackRequest` → 403）—— 安全模式参考
3. **官方 workflow 会话事件流**（`packages/workflow/tool-workflow/src/index.ts`）：
   - `ctx.on("workflow/agent-start", ...)` → `session.append('tool-workflow/run-start'|'agent-start'|'agent-end'|'run-end', data)`
   - Client 端 `dsh-client-ui-workflow-run`：`conversationEvents.register(workflowRunDefinition)`（match/start/update/buildViewNode）+ `slots.inject('conversation.chat.node', ...)` keyed renderer
4. **Typert Remote 装配限制**（`docs/api-gateway.zh.md` 第 78 行）："任何 Client 装配能看到的 Host 方法都只限于生成时选择的 Remote 方法"；第三方要加入自己的 Remote 必须改官方 `api-remotes` 组合 —— 不可行。

---

## 3. 三备选方案评估（最终）

### 方案 1：HTTP 端点替代 RPC — ✅ 合格，推荐

- **官方 webServer 服务已启用**；`@linxin666/dsh-tool-describe-image` 是**本机正在运行**的完整先例（npm 包、webServer + fetch、loopback 安全）
- 实施：`workflow-host` npm 包新增 `ctx.webServer.register()` 路由（复用 `loadState`），Client `client.js` 用 `fetch('/wf/status?workspaceRoot=...')` 替换 `host.call`
- 保留模块级数据层（`latest`/`listeners`/指纹防抖），只换数据源
- 注意：路由前缀 `/wf/*` 防冲突；loopback 安全围栏仿 describe-image

### 方案 2：Cordis Service 跨边界 — ❌ 不可行

- `ctx.provide()/ctx.get()` 是进程内注册表，Host 与 Client 是两个独立 Cordis 运行时
- 官方跨边界唯一机制是 Typert Remote，但其 Client 装配（api-remotes）**构建时固定**，第三方不能自行挂载
- 结论：无官方支持路径

### 方案 3：保持动态插件架构 — ⚠️ 可作过渡，非终局

- 动态插件确实有 `host.call` + `harness.handle`（Iter-3 已验证）
- 但与团队"迁移 npm 包"决策（architecture-decisions.md §1/§4）矛盾；动态插件有 JSON 转义/截断问题
- 仅作短期兜底

---

## 4. 补充：方案 4 — 官方推荐的会话事件流（远期演进）

官方 `dsh-workflow` + `dsh-client-ui-workflow-run` 的标准模式：

```
Host 引擎                          Client 浏览器
  │  session.append('wf/xxx/start', {...})   ──下行 WS──▶ conversationEvents.register(definition)
  │  session.append('wf/xxx/progress', {...})            （match → start → update → buildViewNode）
  ▼                                                        ▶ slots.register({name:'conversation.chat.node',
会话日志（持久化、可回放）                                   key:'workflow-run'}, Panel)
```

- **优点**：完全官方、推送式（无轮询）、状态持久化、会话内历史可回放
- **代价**：引擎需改为写 session 事件（当前是独立 `state.json`），改造量大
- **建议**：本轮用方案 1 快速修复；若后续"工作流状态进会话记录"成为需求，演进到此模式

---

## 5. 落地步骤（方案 1）

| 步 | 内容 | 参考 |
|----|------|------|
| 1 | `workflow-host` npm 包新增 `ctx.webServer` 路由模块（GET `/wf/status` 等） | `describe-image/src/attach-routes.ts`、`docs/subsystems/web-server.zh.md` |
| 2 | handler 读取 `.workflow-agent/state.json`（复用 `workflow-rpc.mjs` 的 `loadState`） | `workflow-rpc.mjs` |
| 3 | Client `client.js` 移除 `host.call`，改 `fetch('/wf/status?workspaceRoot=...')` | `describe-image/src/client/attach.ts` |
| 4 | 保留模块级数据层 + 指纹防抖 + 1500~2000ms 轮询，仅换数据源 | `client-ui-monitor/src/client.js` |
| 5 | 构建、安装、验证 DAG 刷新 | `build-and-install-all.ps1` |

---

## 6. 参考文件（官方仓库 + 本机）

| 文件 | 说明 |
|------|------|
| `deepseek-harness-master/docs/subsystems/web-server.zh.md` | webServer register API |
| `deepseek-harness-master/docs/subsystems/client-modules.zh.md` | Client 插件 dsh.client 声明与加载 |
| `deepseek-harness-master/docs/api-gateway.zh.md` | Typert Remote（跨边界唯一机制，装配受限） |
| `deepseek-harness-master/docs/subsystems/workflow.zh.md` | 官方 workflow 事件与持久 Chat 记录 |
| `deepseek-harness-master/docs/cookbook/adding-a-conversation-node.zh.md` | 官方 Conversation Node 完整教程 |
| `deepseek-harness-master/packages/workflow/tool-workflow/src/index.ts` | 官方 session.append 写入模式 |
| `deepseek-harness-master/packages/client/ui-workflow-run/` | 官方 workflow UI（conversationEvents + conversation.chat.node） |
| `~/.dsh/profiles/desktop/node_modules/@linxin666/dsh-tool-describe-image/` | 本机可运行 HTTP 端点先例（Host 路由 + Client fetch） |
| `dsh-src/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js` | host.call 闭包注入机制 |

---

## 7. DSH Desktop 架构验证（Iter-5 实施中发现）

> 本节记录 Iter-5 实施验证时对 DSH Desktop 环境的深入调查结论，回答两个关键疑问。

### 7.1 疑问 1：DSH Desktop 内核是否运行 web 版 dsh？

**是。** 源码与文档双重证实：

1. **`dsh-desktop-docs/architecture.md`**（官方）："DSH Desktop 是一个薄的 Electron 宿主。它在 Electron main 进程中启动官方 DSH Host，Host 再通过 loopback HTTP/WebSocket 提供普通 Web UI。"
2. **`dsh-src/desktop/lib/webserver.js`**：`DesktopWebServer extends WebServer`（复用官方 `@deepseek-ai/dsh-host-webserver`），只是包装了浏览器访问控制。
3. **`dsh-src/desktop/lib/desktop-port.js`**：`DESKTOP_DEFAULT_WEB_PORT = 43120` —— 43120 就是内部 webServer 的端口。
4. **`desktop profile/package.json`**：bundles 包含 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` —— 与官方 web profile 相同的组合。

**结论**：DSH Desktop = Electron 壳 + 完整官方 dsh Host（web-app 组合），通过 43120 端口提供 Web UI。

### 7.2 为什么外部 HTTP 请求全部 403？

`dsh-src/desktop/lib/desktop-browser-access-*.js`：

```js
const DESKTOP_RENDERER_ACCESS_HEADER = "x-dsh-desktop-renderer";  // Electron 渲染进程专属头
// 每次启动生成 32 字节随机 token
function decideDesktopBrowserAccess(access, request) {
  if (sameToken(exactHeaderValue(request.headers), access.rendererHeader.value)) return "renderer";
  if (!access.ordinaryBrowserEnabled || desktopBrowserUrlHasRendererMarkers(request.url)) return "denied";
  return "browser";
}
```

- DSH Desktop 的 webServer 要求请求携带 `x-dsh-desktop-renderer: <随机token>` 头
- 该 token 每次启动随机生成，只注入 Electron 渲染进程的网络会话
- **外部 HTTP 客户端（Node/PowerShell/普通浏览器）不带该头 → 一律 403 "forbidden"**
- `webserver.js` 的 `rejectBrowserRequest` 正是返回 9 字节 "forbidden" 的实现

**推论**：我们的 HTTP 轮询方案在 DSH Desktop 的 Electron 渲染进程内**可行**（Client fetch 会带上该头），但**无法从外部脚本验证**（没有 token）。验证必须走 Electron 渲染进程内部（浏览器 DevTools Network 观察 /wf/status 请求），或在官方 web 环境（无此访问控制）。

### 7.3 疑问 2：dsh-web-ui 插件包装在 web 还是 desktop profile？

**desktop profile**。证据：

1. `~/.dsh/profiles/` 下只有 `desktop` 和 `node_modules`，**没有独立 web profile**（`Test-Path profiles/web` = False）。
2. `desktop profile/package.json` 的 `dsh.profile.bundles` 显式包含 `@linxin666/dsh-web-ui-all`。
3. 所有 `@linxin666/*` 插件（dsh-web-ui-all、dsh-tool-describe-image 等）实际安装在 `~/.dsh/profiles/desktop/node_modules/`。

**结论**：DSH Desktop 运行的就是 desktop profile，其中已组合 web-app 官方 UI + dsh-web-ui-all 第三方 UI 增强包。**官方 web profile（3080 端口的 wslrelay 实例）是另一个独立环境，未安装这些包。**

### 7.4 对 Iter-5 验证的影响

| 环境 | webServer 路由可达性 | Client fetch 可行性 | 验证方式 |
|------|---------------------|--------------------|----------|
| DSH Desktop (43120) | ✅ 已注册（但需 renderer token） | ✅ Electron 渲染进程内 fetch 自动带头 | 浏览器 DevTools 观察 /wf/status |
| 官方 web (3080) | ❌ 未注册（独立实例无我们的插件） | — | 需先安装插件到该 profile |

**Iter-5 验证策略**：在 DSH Desktop 的 Electron 渲染进程内验证（打开 Workflow tab，DevTools Network 观察 /wf/status 轮询请求），外部 HTTP 探测因访问控制不可用（已排除，非插件问题）。

### 7.5 参考文件

| 文件 | 说明 |
|------|------|
| `dsh-desktop-docs/architecture.md` | DSH Desktop 官方架构（Electron 壳 + web Host） |
| `dsh-src/desktop/lib/webserver.js` | DesktopWebServer（复用官方 webServer + 访问控制包装） |
| `dsh-src/desktop/lib/desktop-browser-access-*.js` | x-dsh-desktop-renderer token 机制 |
| `dsh-src/desktop/lib/desktop-port.js` | 43120 默认端口 |
| `dsh-src/desktop/lib/profile-service.js` | desktopProfiles 服务 |
| `~/.dsh/profiles/desktop/package.json` | desktop profile bundles（含 dsh-web-app + dsh-web-ui-all） |
