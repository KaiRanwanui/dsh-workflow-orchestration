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

## 已完成工作

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

### 下一优先：Iter-5 — 并发执行引擎

### 迭代报告

| 文档 | 位置 |
|------|------|
| Iter-1 报告 | `plan/development/iter1-report.md` |
| Iter-2 报告 | `plan/development/iter2-report.md` |
| Iter-3 报告 | `plan/development/iter3-report.md` |

---

## 团队约定

行为准则见 `plan/development/team-conventions.md`。