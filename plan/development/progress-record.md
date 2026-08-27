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

| 今日 | **WSL2 迁移 — 插件打包/安装/端到端验证** | ✅ 完成（web profile + link 依赖，修复迁移残留 + _loopIndex bug） |

---

| 今日 | **Iter-6 循环错误处理 + 日志清理** | ✅ 完成（onError=break/continue，50 单测通过） |

---

| 今日 | **Iter-7 并发执行引擎 + DAG 并发组可视化** | ✅ 完成（getRunnableTasks + max-concurrency，59 单测通过） |

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

### 7. Iter-6: 循环错误处理 + 日志清理（✅ 完成）

**迭代报告**：`plan/development/iter6-report.md`

**核心交付**：
- `updateTask` 在任务 FAILED 时自动检查 `_onError`：`break` → 同组 PENDING 标记 SKIPPED；`continue` → 继续执行
- `hydrate` 恢复循环元数据（消除重启后 processBreak 失效的隐患）
- `getNextRunnableTask()`（跳过 SKIPPED，预留 Iter-7 并发引擎）
- `begin()` 清空历史日志（避免重新 begin 工作流时日志跨实例残留）
- DAG 布局（循环组折叠 + SKIPPED 琥珀色）在 Iter-4 已就绪，本轮仅做在线验证

**验证**：单测 50/50（新增用例 5 共 9 断言）；在线验证 order FAILED → payment 自动 SKIPPED（BREAK 日志正确）。

**提交**：`05f85aa`（核心）+ `00285ef`（测试 + 日志清理）

---

### 8. WSL2 迁移 — 插件打包/安装/端到端验证（✅ 完成）

**背景**：项目从 Windows dsh-desktop 迁移到 WSL2，迁移后未做打包/安装，需验证 Windows 既有成果被完整继承。

**环境差异**：
- WSL2 无 desktop profile（Windows Electron 形态），实际是 web(3080) + headless profile，用 pnpm 管理（nodeLinker: hoisted）
- 插件接入方式：link: 依赖 + `dsh.profile.bundles`（先例 `@yejiming/dsh-data-agent`）
- DSH 用用户级 systemd 管理（`systemctl --user restart dsh.service` 重启 Host）

**修复的迁移 bug**：
- 硬编码 Windows 路径 `C:/Users/ranwa/dsh_workspace` → `/home/zhaokai/Projects/dsh_projects`（提交 `659d87e`）
- `_loopIndex: undefined` 导致 workflow_begin 返回非 lossless JSON（提交 `fa9732f`）

**验证**：打包 + 安装 + compose + 端到端（workflow_begin → DAG 循环组折叠 → HTTP 轮询）全部通过。

---

### 9. Iter-7: 并发执行引擎 + DAG 并发组可视化（✅ 完成）

**迭代报告**：`plan/development/iter7-report.md`

**核心交付**：
- `getRunnableTasks()`：就绪 = 前驱全 DONE/SKIPPED，槽位 = maxConcurrency - 当前 RUNNING；snapshot 输出 `runnable` 列表
- 工作流级 `max-concurrency` 字段（默认 1=串行，>1 并发）
- system-prompt 执行模型 v1 串行 → v2 并发（以 `runnable` 为准）
- DAG 并发组可视化：dependsOn 相同的连续任务垂直并列 + 虚线线框 + 箭头指向后继

**验证**：单测 59/59（用例 6 共 9 断言）；在线验证 concurrent-demo 的 runnable 动态变化 + DAG 并发组显示。

**提交**：`c6b140f` + `ff3a334` + `1b2ece0` + `ec1f0f0`

---

## 待办（下次启动）

### Iter-8: 多实例管理（计划中）

**迭代计划**：`plan/development/development-plan.md`（Iter-8）

**目标**：多个工作流实例并行管理（定义多个流、暂停/切换/恢复）。

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

### 迭代报告

| 文档 | 位置 |
|------|------|
| Iter-1 报告 | `plan/development/iter1-report.md` |
| Iter-2 报告 | `plan/development/iter2-report.md` |
| Iter-3 报告 | `plan/development/iter3-report.md` |
| Iter-5 报告 | `plan/development/iter5-report.md` |
| Iter-6 报告 | `plan/development/iter6-report.md` |
| Iter-7 报告 | `plan/development/iter7-report.md` |

---

## 团队约定

行为准则见 `plan/development/team-conventions.md`。