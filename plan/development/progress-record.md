# 工作进展记录

| 日期 | 阶段 | 状态 |
|------|------|------|
| 今日 | 项目启动 + 需求对齐 + Schema 定稿 | ✅ 完成 |
| 今日 | **Iter-1 Host 插件 — 引擎基础** | ✅ 完成 |
| 今日 | **v1.1 Schema 增强 — 命名式 inputs** | ✅ 完成 |
| 今日 | **Iter-2 Agent Preset — 串行编排** | ✅ 完成 |
| 今日 | **Iter-3 Client 监控面板** | ✅ 完成 |
| 今日 | **Flicker 修复 — 模块级状态** | ✅ 完成 (`wff-9/pkg-14`) |

---

| 今日 | **Iter-4 循环 + 循环展开** | ✅ 完成 |

---

| 今日 | **架构调整 — Host 插件迁移至 desktop profile** | ✅ 完成 |

---

| 今日 | **Client RPC 链路方案定稿 — HTTP 轮询** | ✅ 完成（决策 + 参考文档） |

---

| 今日 | **Iter-5 Host/Client 架构调整 — Client RPC 链路修复** | ✅ 完成（webServer 路由 + fetch 轮询，DAG 验证通过） |

---

## 已完成工作

### 6. Iter-5: Host/Client 架构调整 — Client RPC 链路修复（✅ 完成）

**决策**：`plan/architecture/architecture-decisions.md` §5；方案对比 `plan/design/client-host-communication.md`

**背景**：Client UI 迁移到 npm 包后 RPC 链路断裂（`host.call` 是动态插件闭包符号，npm 包无法使用）。
Iter-5 采用 **HTTP 轮询方案**：Host 注册 webServer 路由，Client 用 fetch 轮询。

**修改清单**：

| 文件 | 改动 |
|------|------|
| `code/agent-presets/.../workflow-host.mjs` | 新增 webserver-routes 模块：`registerWebRoutes()` 注册 `/wf/*` 前缀路由（status/skill/config）+ loopback 围栏 + `writeJson` + `loadStateFromFile` |
| `code/packages/workflow-host/build.js` | inject 改为 `['fs','tools','webServer']` |
| `code/packages/workflow-host/package.json` | 版本 0.2.0 → **0.3.0** |
| `code/packages/client-ui-monitor/src/client.js` | `host.call('wf:status')` → `fetch('/wf/status?...')`；`ctx.interval` → `window.setInterval`（npm 包 Client 无 timer 服务，官方 client 插件同用 setInterval） |
| `code/packages/client-ui-monitor/build.js` | 移除 `require("@deepseek-ai/dsh-client-runtime").host`；inject 改为 `['slots']` |
| `code/packages/client-ui-monitor/package.json` | 移除 `dsh-cordis-client-runner` peerDependency |
| `code/agent-presets/.../agent.cordis.yml` | `workflow-rpc.mjs` 行停用（注释掉，由 webServer 路由替代） |
| `code/scripts/build-and-install-all.ps1` | 说明更新（RPC 已停用） |
| `code/scripts/install-iter5.ps1` | 新建专用安装脚本 |

**验证结果**：

| 检验项 | 结果 |
|--------|------|
| workflow-host 路由单测（/wf/status 200、loopback 403、404、/wf/config、/wf/skill） | ✅ 全部通过 |
| 构建产物语法/格式 | ✅ |
| 安装到 desktop profile（0.3.0） | ✅ |
| Client bundle 进入 boot 图（新 rev ffb8536f9dd7） | ✅ |
| DAG 图显示（节点颜色绿/红/琥珀） | ✅ |
| 循环组折叠框 "↻ 逐模块评审 (8)" | ✅ |
| 状态条（demo-wf / COMPLETED / FAIL） | ✅ |

**踩坑记录**：

| 坑 | 现象 | 解决方案 |
|----|------|---------|
| DSH Desktop 外部 HTTP 403 | 所有外部请求返回 403 "forbidden" | 发现是 `x-dsh-desktop-renderer` token 访问控制（`dsh-src/desktop/lib/desktop-browser-access-*.js`），非插件问题；验证走 Electron 渲染进程内 |
| 部署目录文件被锁 | `~/.dsh/profiles/desktop/node_modules/` 文件无法覆盖 | DSH 加载插件时锁定文件，需完全退出 DSH 后安装（install-iter5.ps1） |
| preset 部署未同步 | `~/.dsh/.agent-presets/.../agent.cordis.yml` 中 workflow-rpc 仍启用 | 源码已注释，部署目录需 DSH 停止后同步 |

**架构认知（Iter-5 附带发现）**：

- DSH Desktop 内核 = 官方 dsh Host（web-app 组合），43120 是内部 webServer 端口
- webServer 有 `x-dsh-desktop-renderer` token 访问控制（Electron 渲染进程专属）
- HTTP 轮询方案在 DSH Desktop 渲染进程内可行（Client fetch 自动带头）
- 详见 `plan/development/client-rpc-research.md` §7

---

## 待办（下次启动）

### Iter-5 收尾：同步 preset 部署

**背景**：`code/agent-presets/.../agent.cordis.yml` 已注释 workflow-rpc 行，但 `~/.dsh/.agent-presets/.../agent.cordis.yml`（部署副本）未同步（DSH 运行时被锁）。

**操作**：DSH Desktop 完全退出后，将源码 agent.cordis.yml 复制到部署目录。

### Iter-6: 循环错误处理 + DAG 布局优化（计划中）

**迭代计划**：`plan/development/development-plan.md`（Iter-6，原 Iter-5 后延）

**背景**：原来 Host 端插件（引擎 + 工具 + RPC）全部在 preset 的本地插件中。
为统一管理和简化架构，决定将 Host 和 Client 插件都迁移到 desktop profile 的 npm 包中。

**问题**：首次迁移失败。将完整代码（含 `harness.handle()` RPC）打包为 npm 包后，
重启 DSH 时插件加载崩溃，系统自动回退。

**根因分析**：
- `harness` 是动态插件 Builtin（`Builtin.listBuiltins` 描述为 "dynamic Host half"）
- npm 包由 Cordis Loader 直接加载，不经过动态插件沙箱
- 因此 npm 包中 `harness` 为 `undefined`，`harness.handle(...)` 抛出 TypeError

**解决方案 — 拆分架构**：

| 组件 | 位置 | 说明 |
|------|------|------|
| `@workflow-agent/workflow-host` | profile npm 包 | 引擎 + 工具注册（`workflow_begin`/`workflow_status`） |
| `@workflow-agent/client-ui-monitor` | profile npm 包 | Client DAG 监控面板 |
| `workflow-rpc.mjs` | preset 本地插件 | RPC 处理器（需要 `harness` Builtin） |

**修改清单**：

| 文件 | 改动 |
|------|------|
| `code/packages/workflow-host/build.js` | 不再合并 RPC 代码，仅打包工具部分 |
| `code/packages/workflow-host/package.json` | 添加 `dsh.bundle.patch`，版本升至 0.2.0 |
| `code/packages/workflow-host/cordis.patch.yml` | 新建，声明 insert 行 |
| `code/agent-presets/.../workflow-host.mjs` | 移除 `timer` 注入，改用 `tools` |
| `code/agent-presets/.../agent.cordis.yml` | 注释掉 `workflow-host.mjs`（由 npm 包替代），保留 `workflow-rpc.mjs` |
| `~/.dsh/profiles/desktop/cordis.patch.yml` | 添加 `workflow-host` insert 行 |
| `code/scripts/build-and-install-all.ps1` | 新建统一构建安装脚本 |
| `plan/architecture/architecture-decisions.md` | 更新架构决策文档 |

**关键学习**：
- `harness` Builtin 的作用域仅限于动态插件和 preset 本地插件
- npm 包可用的 Host 能力：`ctx.tools.register()`、`ctx.get('fs')`、`ctx.provide()` 等
- npm 包不可用的 Host 能力：`harness.handle()`（RPC）、`harness.defineTool()` 等

---

### 4. Iter-4 — 循环 + 循环展开（✅ 完成）

**设计决策**：循环展开在 `workflow_begin` 时由 tools 层完成，engine 收到的是展开后的平面任务列表。每个迭代有唯一 ID（`{loopId}/{item}`）、串行依赖链（iter-N 依赖 iter-N-1）、独立 quality-gate。

| 组件 | 改动 |
|------|------|
| `tools-preset.js` | 新增 `expandLoopTasks` 函数，读取 items-from 文件 → 展开 N 个迭代任务 |
| `tools.js` | 同步增加同逻辑 + 修复 `PARAM_PATTERN` Node 独立加载兜底 |
| `test-host.js` | 新增用例 4（9 断言：依赖链/ID/注入/engine 集成）|
| `engine.js` | 无改动（engine 接收展开后任务，已天然支持）|
| `workflow-host.mjs` | 重建（988 行），ESM 加载验证通过 |
| `host-body/bundle/verify` | 全部重建 |
| `system-prompt.md` | 更新：自动展开，"编排 Agent 无需特殊处理" |
| `agent.cordis.yml` | 同步更新 persona 文本 |
| `client-body.txt` | 新增循环组可视化：连续迭代显示背景框 + "↻" 标签 |

**Client 动态插件部署**：

| 版本 | 插件 | 状态 |
|------|------|------|
| v3 | `wfd-10/pkg-15` | ❌ 颜色不刷新 + 闪烁复发 |
| v4 | `wfd-11/pkg-16` | ❌ 文字刷新正常，图形全灰 |
| v5 | **`wfd-12/pkg-17`** | ✅ 颜色/文字均正常刷新，无闪烁 |

**v5 修复要点**：
- 指纹函数 `fp(st)` 检查 `st.state.tasks` 而非 `st.tasks`（Host 返回 `{ state: {...} }`）
- `mRoot`/`mLoaded` 提升到 `apply()` 级模块变量，根治 remount 闪烁
- 颜色 key 使用全名 `PENDING`/`RUNNING`/`DONE`，匹配 `t.status`

**验证结果**：
- Node 单元测试 41/41 通过（原 32 + 新增 9）
- expandLoopTasks 探针 18/18 通过
- ESM 插件加载验证通过
- 4-task 模拟执行：PENDING（灰）→ RUNNING（蓝）→ DONE（绿）✅
- 循环组背景框 "↻ 逐模块评审" 显示正确 ✅

### 1. Iter-3 — Client 监控面板（✅ 完成）

**架构决策**：

| 维度 | Iter-3 |
|------|--------|
| 插件形态 | 独立动态 Cordis 插件（Host + Client 半边），需 `harness.handle` / `host.call` RPC 通信 |
| 状态来源 | Host 通过 `fs` 读取 `.workflow-agent/state.json`，与预设引擎解耦 |
| 通信机制 | Client → Host：`host.call('wf:status')`，每 1500ms 轮询 |
| 挂载点 | `conversation.view` slot，id=workflow，order=25，与 Chat 并列 |
| 闪烁根治 | 模块级数据层：`ctx.effect` 级单例轮询 + `listeners` 发布订阅 + 指纹防抖 |
| 工作区发现 | 优先 `window.__wfWorkspaceList`，兜底 `wf:config` 验证 |

**交付插件**：

| 属性 | 值 |
|------|-----|
| pluginId | `wff-9` |
| pkg-13 | Host minimal + Client text-only |
| pkg-14 | Host + Client DAG SVG（当前运行） |
| 状态 | ✅ running |
| Host handlers | `wf:status` |

**功能特性**：标签页 "Workflow" | SVG DAG 节点+箭头 | 色（灰/蓝/绿/红/黄）| 状态条 | 指纹防抖 | 工作区自动发现

### 2. 闪烁修复（Iter-3 补丁）

**问题**：LLM thinking 时 `conversation.view` 组件 remount → `useState` 清零 → "Connecting..." 闪烁，DAG 变空白。

**根因**：`workspaceRoot` / `configLoaded` 在组件 `useState` 内，remount 后失效。

**修复**：提升到 `apply()` 级模块变量，组件直读 `latest` 快照。

**踩坑 5 个**（详见 `iter3-report.md` 第 4.4 节）：
| 坑 | 表现 | 解决方案 |
|----|------|---------|
| JSON 参数截断 | `catch`→`catc h`，括号丢失 | 压缩代码到 ~1600 chars |
| 反斜杠转义 | `/\\/g` 误匹配 `/` | 改用 `new RegExp()` |
| Slot 回调返回函数 | 有标签无内容 | 返回 `React.createElement(W)` |
| Host 返回格式 | `{state:data}` 多一层包装 | 直接返回数据 |
| 工作区发现删除 | Host `fs` 沙箱读取失败 | 恢复 `tryDiscover()` |

**验证**：DAG 图形正常显示 ✅ | 状态平滑变化 ✅ | 无闪烁 / 无 "Connecting..." ✅

---

## 下次启动时的工作

### 待完成：Client UI RPC 链路修复

**问题**：DAG 面板标签页可见但内容为空白，RPC 调用失败。

**根因**：`host.call` 是动态插件 Client 端的 Builtin，由 `@deepseek-ai/dsh-cordis-client-runner` 在闭包中注入（见 `dsh-cordis-client-runner/lib/client.js` 第 181 行）。它**不是**通过 `require` 导出的模块。

**错误代码**：
```js
// ❌ 错误：@deepseek-ai/dsh-client-runtime 不导出 host 对象
const { host } = require("@deepseek-ai/dsh-client-runtime")
host.call('wf:status', { workspaceRoot: wfRoot })
```

**动态插件中的正确用法**（来自 `dsh-cordis-client-runner/lib/client.js` 第 173-181 行）：
```js
// ✅ 动态插件闭包注入
const returned = await closure(
  react,
  taggedConsole(pluginId, ...),
  styles,
  { call: (method, args = null) => env.invoke(method, args) },  // host 对象
  harnessTrap(),
  ...
)
```

**影响**：
- ❌ Client UI 无法调用 `host.call('wf:status', ...)`
- ❌ RPC 链路断裂，面板无法获取状态数据
- ✅ Slot 注册正常（所以标签页能看到）
- ✅ 轮询逻辑正常（但调用失败）

### 备选方案

#### 方案 1：HTTP 端点替代 RPC（推荐）
- Host 端通过 `ctx.get('webServer').register()` 注册 HTTP 路由
- Client 端通过 `fetch()` 调用
- 参考：`@linxin666/dsh-tool-describe-image` 的 `/describe-image/attach` 端点
- 优点：有成功案例，不依赖动态插件的 `harness` Builtin
- 缺点：需要处理同源策略、认证等问题

#### 方案 2：Cordis Service 通信
- Host 端通过 `ctx.provide()` 提供服务
- Client 端通过 `ctx.get()` 获取服务
- 需要研究是否支持跨 Host-Client 边界
- 优点：符合 Cordis 架构
- 缺点：可能不支持跨边界

#### 方案 3：保持动态插件架构（保守）
- Client UI 继续使用动态插件（`cordis_define`）
- 只有 Host 工具迁移到 npm 包
- 优点：最小改动，立即可用
- 缺点：架构不统一，动态插件有 JSON 转义问题

### 下一步行动

1. 研究 `@linxin666/dsh-tool-describe-image` 的 HTTP 端点实现
2. 在 `workflow-rpc.mjs` 中添加 HTTP 路由注册（`webServer.register()`）
3. 修改 Client UI 代码，用 `fetch()` 替代 `host.call()`
4. 重新构建并安装 Client UI npm 包
5. 验证 DAG 面板能正常显示状态

### 迭代报告

| 文档 | 位置 |
|------|------|
| Iter-1 报告 | `plan/development/iter1-report.md` |
| Iter-2 报告 | `plan/development/iter2-report.md` |
| Iter-3 报告 | `plan/development/iter3-report.md` |
| Iter-5 报告 | `plan/development/iter5-report.md` |

---

## 团队约定

行为准则见 `plan/development/team-conventions.md`。