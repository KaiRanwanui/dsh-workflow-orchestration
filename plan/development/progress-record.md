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

## 已完成工作

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

### 下一优先：Iter-4 — 循环 + 循环展开

| 步骤 | 任务 |
|------|------|
| 1 | parser 支持 `type: loop`、`items-from`、`item-var` 字段解析 |
| 2 | engine 循环模板存储 + 展开为 N 个迭代实例 |
| 3 | system-prompt 循环处理逻辑提示增强 |
| 4 | Client DAG 循环展开后的多实例显示（折叠/展开）|
| 5 | `workflow_status` 支持迭代状态更新 |

### 迭代报告

| 文档 | 位置 |
|------|------|
| Iter-1 报告 | `plan/development/iter1-report.md` |
| Iter-2 报告 | `plan/development/iter2-report.md` |
| Iter-3 报告 | `plan/development/iter3-report.md` |

---

## 团队约定

行为准则见 `plan/development/team-conventions.md`。