# Iter-5 报告：Host/Client 架构调整 — Client RPC 链路修复

> 对应 `progress-record.md` §6（Iter-5 交付）
> 决策文档：`plan/architecture/architecture-decisions.md` §5；方案对比 `plan/design/client-host-communication.md`
> 源码研究：`plan/development/client-rpc-research.md`

---

## 1. 交付概要

| 项 | 值 |
|----|-----|
| 目标 | 修复 Client UI RPC 链路：`host.call` → webServer HTTP 路由 + fetch 轮询 |
| 背景 | Client UI 迁移到 npm 包后 RPC 链路断裂（`host.call` 是动态插件闭包符号，npm 包无法使用） |
| 当前 Package | `@workflow-agent/workflow-host` v0.3.0 + `@workflow-agent/client-ui-monitor` v0.1.0 |
| 状态 | ✅ 完成并验证 |

## 2. 架构决策

| 维度 | Iter-5 |
|------|--------|
| 通信方案 | **HTTP 轮询**：Host 注册 webServer 路由，Client 用 `fetch()` 每 2s 轮询 |
| Host 侧 | `workflow-host` npm 包新增 `ctx.webServer.register()`（`/wf/*` 前缀路由） |
| Client 侧 | `fetch('/wf/status?workspaceRoot=...')` 同源调用 |
| 通知方向 | **Client 拉**（非 Host 推）；Host 每次请求时读 state.json，无需文件 watch |
| 定时器 | `window.setInterval`（npm 包 Client 无 timer 服务；官方 client 插件同用 setInterval） |
| 安全 | loopback 围栏：仅回环地址接受（仿 `dsh-tool-describe-image` 的 `isLoopbackRequest`） |
| 废弃 | `workflow-rpc.mjs`（preset 本地插件，harness RPC）停用 |

### 2.1 三备选方案评估（最终结论）

| 方案 | 结论 | 理由 |
|------|------|------|
| **1. HTTP 端点替代 RPC** | ✅ **采用** | 官方 webServer 已启用；`dsh-tool-describe-image` 是可运行先例 |
| **2. Cordis Service 跨边界** | ❌ 否决 | 进程内机制；官方跨边界唯一通道（Typert Remote）Client 装配构建时固定 |
| **3. 保持动态插件架构** | ⚠️ 过渡 | `host.call` 仅动态插件可用，与 npm 包迁移决策矛盾 |

## 3. 交付功能

| 功能 | 状态 |
|------|------|
| Host webServer 路由（`/wf/status` `/wf/skill` `/wf/config`） | ✅ |
| loopback 信任围栏（非回环 403） | ✅ |
| Client fetch 轮询（2s，替代 host.call） | ✅ |
| 模块级数据层 + 指纹防抖（保留） | ✅ |
| `window.setInterval` 替代 `ctx.interval` | ✅ |
| workflow-rpc.mjs 停用（agent.cordis.yml 注释） | ✅ |
| DAG 面板经 HTTP 显示工作流状态 | ✅ |

## 4. 修改清单

| 文件 | 改动 |
|------|------|
| `code/agent-presets/.../workflow-host.mjs` | 新增 webserver-routes 模块：`registerWebRoutes()` + loopback 围栏 + `writeJson` + `loadStateFromFile` |
| `code/packages/workflow-host/build.js` | inject 改为 `['fs','tools','webServer']` |
| `code/packages/workflow-host/package.json` | 版本 0.2.0 → 0.3.0 |
| `code/packages/client-ui-monitor/src/client.js` | `host.call('wf:status')` → `fetch('/wf/status?...')`；`ctx.interval` → `window.setInterval` |
| `code/packages/client-ui-monitor/build.js` | 移除 `require("@deepseek-ai/dsh-client-runtime").host`；inject 改为 `['slots']` |
| `code/packages/client-ui-monitor/package.json` | 移除 `dsh-cordis-client-runner` peerDependency |
| `code/agent-presets/.../agent.cordis.yml` | `workflow-rpc.mjs` 行停用（注释） |
| `code/scripts/build-and-install-all.ps1` | 说明更新（RPC 已停用） |
| `code/scripts/install-iter5.ps1` | 新建专用安装脚本（DSH 退出后执行） |

## 5. 验证结果

### 5.1 Node 层验证（构建产物 + 路由单测）

| 检验项 | 结果 |
|--------|------|
| workflow-host lib 语法检查 | ✅ |
| `/wf` 前缀路由注册 | ✅ |
| `GET /wf/status` → 200 + 正确状态 JSON | ✅ |
| 非 loopback → 403 拒绝 | ✅ |
| 未知路径 → 404 | ✅ |
| `GET /wf/config` → 200 验证工作区 | ✅ |
| `GET /wf/skill` → 200 读取技能文件 | ✅ |
| Client 产物格式（`window.__ModuleLoader__.load` + exports） | ✅ 与官方一致 |

### 5.2 DSH Desktop 集成验证（用户在界面确认）

| 检验项 | 结果 |
|--------|------|
| 安装到 desktop profile（workflow-host 0.3.0） | ✅ |
| Client bundle 进入 boot 图（新 rev `ffb8536f9dd7`） | ✅ |
| DAG 图显示 | ✅ |
| 节点颜色正确（绿 DONE / 红 FAILED / 琥珀 SKIPPED） | ✅ |
| 循环组折叠框 "↻ 逐模块评审 (8)" | ✅ |
| 状态条信息正确（demo-wf / COMPLETED / FAIL） | ✅ |

> 注：DAG 显示即证明 HTTP 轮询链路工作 —— Client 渲染逻辑"无数据时显示 Waiting for workflow..."，
> DAG 出现 = `fetch('/wf/status')` 成功返回数据。

## 6. 踩坑记录

### 坑 1：DSH Desktop 外部 HTTP 全部 403

**现象**：从 Node/PowerShell 请求 43120 的任意路径（含 `/`、`/wf/status`、WebSocket upgrade）都返回 403 `forbidden`。

**根因**：DSH Desktop 的 webServer 有**浏览器访问控制**（`dsh-src/desktop/lib/desktop-browser-access-*.js`）：
```js
const DESKTOP_RENDERER_ACCESS_HEADER = "x-dsh-desktop-renderer";
// 每次启动生成 32 字节随机 token，只注入 Electron 渲染进程
if (!this.permits(req)) return rejectBrowserRequest(res);  // → 403 "forbidden"
```

**解决方案**：确认这是 DSH Desktop 的访问控制（非插件问题）。HTTP 轮询在 Electron 渲染进程内**可行**（Client fetch 自动带头），验证改为界面观察（DAG 显示 + DevTools Network）。

### 坑 2：部署目录文件被锁

**现象**：`~/.dsh/profiles/desktop/node_modules/@workflow-agent/*` 无法覆盖（DSH 运行时文件被锁）。

**根因**：DSH Desktop 加载插件时持有文件句柄，运行期间不可替换。

**解决方案**：完全退出 DSH Desktop 后执行 `install-iter5.ps1`（复制新文件），重启 DSH 加载新版本。

### 坑 3：preset 部署未同步

**现象**：`~/.dsh/.agent-presets/.../agent.cordis.yml`（部署副本）中 workflow-rpc 行仍启用，与源码不一致。

**根因**：源码 `code/agent-presets/.../agent.cordis.yml` 已注释，但部署目录未同步（被锁）。

**待办**：DSH 完全退出时，将源码 agent.cordis.yml 复制到部署目录。

### 坑 4：PowerShell 编码与引号问题

**现象**：验证脚本用 GBK 读 UTF-8 package.json 报 ConvertFrom-Json 错误；`$` 嵌套引号解析失败。

**解决方案**：改用 `-Encoding UTF8` 读取；复杂检查用独立 node 脚本。

## 7. 架构认知（Iter-5 附带发现）

### 7.1 DSH Desktop 内核 = 官方 dsh Host（web-app 组合）

- `dsh-desktop-docs/architecture.md`："DSH Desktop 在 Electron main 进程中启动官方 DSH Host，Host 再通过 loopback HTTP/WebSocket 提供普通 Web UI"
- `dsh-src/desktop/lib/webserver.js`：`DesktopWebServer extends WebServer`（复用官方 `@deepseek-ai/dsh-host-webserver`）
- `desktop profile/package.json`：bundles 含 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`（与官方 web profile 相同组合）

### 7.2 43120 端口 = 内部 webServer

- `dsh-src/desktop/lib/desktop-port.js`：`DESKTOP_DEFAULT_WEB_PORT = 43120`
- 我们的 `/wf/*` 路由注册在 43120 的 webServer 上（外部 403 是访问控制，路由已生效）

### 7.3 dsh-web-ui 包装在 desktop profile

- `~/.dsh/profiles/` 只有 `desktop` 和 `node_modules`，无独立 web profile
- `@linxin666/dsh-web-ui-all` 等第三方包物理安装在 `~/.dsh/profiles/desktop/node_modules/`

## 8. 当前部署

```yaml
profile: desktop
packages:
  - @workflow-agent/workflow-host v0.3.0 (引擎 + 工具 + webServer 路由 /wf/*)
  - @workflow-agent/client-ui-monitor v0.1.0 (DAG 监控，fetch 轮询)
preset:
  - workflow-orchestrator (agent.cordis.yml，workflow-rpc.mjs 已停用待同步)
status: running
hostRoutes:
  - GET /wf/status → state.json 快照 {state, error}
  - GET /wf/skill → 技能文件 {text, error}
  - GET /wf/config → 工作区验证 {valid, workspaceRoot, error}
clientFeatures:
  - conversation.view slot (id=workflow)
  - 2000ms 轮询 fetch('/wf/status')
  - 模块级数据层（apply 级 latest + listeners + 指纹防抖）
  - SVG DAG (DagCanvas React.memo)
```

## 9. 参考文件

| 文件 | 说明 |
|------|------|
| `plan/architecture/architecture-decisions.md` §5 | HTTP 轮询决策 |
| `plan/design/client-host-communication.md` | 方案对比（轮询 vs Host 推送） |
| `plan/development/client-rpc-research.md` | 官方源码研究 + DSH Desktop 架构验证 |
| `deepseek-harness-master/docs/subsystems/web-server.zh.md` | 官方 webServer API |
| `~/.dsh/profiles/desktop/node_modules/@linxin666/dsh-tool-describe-image/` | HTTP 端点先例（Host 路由 + Client fetch） |
| `dsh-src/desktop/lib/webserver.js` | DesktopWebServer（访问控制包装） |
| `dsh-src/desktop/lib/desktop-browser-access-*.js` | x-dsh-desktop-renderer token 机制 |
