# Iter-3 报告：Client 监控面板 + 闪烁修复

> 对应 `progress-record.md` 第 8 节（Iter-3交付）和第 9 节（闪烁修复补丁）

---

## 1. 交付概要

| 项 | 值 |
|----|-----|
| 目标 | Workflow DAG 可视化 + 实时状态更新 + 闪烁修复 |
| 插件 ID | `wff-9` |
| 当前 Package | `pkg-14`（Host + Client） |
| 状态 | ✅ 运行中 |

## 2. 架构决策

| 维度 | Iter-3 |
|------|--------|
| 插件形态 | **独立动态 Cordis 插件**（Host + Client 半边），需 `harness.handle` / `host.call` RPC 机制 |
| 状态来源 | Host 通过 `fs` 读取 `state.json`，与预设引擎解耦 |
| 通信机制 | Client → Host：`host.call('wf:status')`，每 1500ms 轮询 |
| 挂载点 | `conversation.view` slot，`id=workflow`，`order=25` |
| 闪烁根治 | **模块级数据层**：`ctx.effect` 级单例轮询 + `listeners` 发布订阅 + 指纹防抖 |
| workspace 发现 | 优先 `window.__wfWorkspaceList`，兜底 `wf:config` 验证 |

## 3. 交付功能

| 功能 | 状态 |
|------|------|
| Tab "Workflow" 与 Chat 并列 | ✅ |
| SVG DAG 横向排列节点+箭头 | ✅ |
| 节点颜色（灰/蓝/绿/红/黄） | ✅ |
| 状态条（工作流名+阶段+门禁+重试+错误） | ✅ |
| 数据层指纹防抖 | ✅ |
| 工作区路径自动发现 | ✅ |
| 闪烁修复 | ✅ |

## 4. 闪烁修复专章

### 4.1 问题现象

LLM thinking 输出时 `conversation.view` 组件卸载重挂，`useState` 清零，短暂显示 "Connecting..." → 视觉闪烁。DAG 图形在修改后变为空白。

### 4.2 根因

| 层 | 根因 |
|----|------|
| 闪烁层 | `workspaceRoot` 和 `configLoaded` 在组件 `useState` 内 → remount 后清零 → 走 "Connecting..." 分支 → `useEffect` 重跑才恢复 |
| 空白层 | 部署过程中的代码截断、格式不匹配等问题（见 4.4） |

### 4.3 修复方案

**核心**：两个一次性状态从组件内 `useState` 提升到 `apply()` 作用域的模块变量

| 变量 | 修复前 | 修复后 |
|------|--------|--------|
| `workspaceRoot` | 组件 `useState`（remount 清零） | `apply()` 作用域变量（不受 remount 影响） |
| `configLoaded` | 组件 `useState` | `apply()` 作用域变量 |
| 数据读取 | `useState` 链式等待 | 直接读 `latest`（模块层持有） |
| 轮询 | `ctx.effect` 单例 | 不变 |
| 指纹防抖 | `pub()` 内计算 | 不变 |

**架构对比**（PoC vs 紧凑版 vs 最终版）：

| 维度 | PoC swd-1（工作） | 紧凑版 wfd-2（空白） | 最终版 wff-9（工作） |
|------|-------------------|---------------------|---------------------|
| 工作区发现 | 有 | ❌ 删除 | 有 |
| Host 返回格式 | 直接返回数据 | `{state:...,error:...}` | 直接返回数据 |
| Client 取值 | `var s=host.call(...)` | `var r=host.call(...);r.state` | `var s=host.call(...)` |
| Slot 注册回调 | `()=>React.createElement(W)` | `function(props){return function W(){...}}` | `function(){return React.createElement(W)}` |
| 代码长度 | ~4000 chars | ~5000 chars | ~1600 chars |

### 4.4 踩坑记录

#### 坑 1：cordis_define JSON 参数截断/损坏

**现象**：长于 ~3000 chars 的代码在通过 `cordis_define` 的 JSON 参数传输时被截断或损坏：括号丢失、`catch` 关键词变成 `catc h`（中间插入空格）、正则表达式中的反斜杠转义错误。

**根因**：Agent 工具调用的 JSON 参数对超长字符串（>4000 chars）存在不完整传输。每次代码 + 经 JSON 转义后的字符数远超安全阈值。

**解决方案**：把代码压缩到 1600 chars 以内（仅核心功能），确保 JSON 参数不被截断。

#### 坑 2：正则反斜杠 JSON 转义层级错误

**现象**：JS 源码 `replace(/\\/g,'/')`（匹配一个反斜杠）在 JSON 字符串中需要写 `replace(/\\\\/g,'/')`（每个 `\` 变 `\\\\`），但实际提交只有 `\\`，导致正则变成了匹配斜杠 `/`。

**解决方案**：用 `new RegExp('\\\\','g')` 代替正则字面量，避免字面量中的反斜杠转义问题。

#### 坑 3：Slot 注册回调返回类型错误

**现象**：有标签 "Workflow" 但页面空白无任何文字。

**根因**：Slot 系统 `s.register(meta, callback)` 的第二个参数回调期望返回 **React 元素**（`React.createElement(Component)`），不是函数组件（`function W(){...}`）。返回函数组件时 React 无法正确渲染，因为它被识别为一个对象而不是有效元素。

**PoC 的正确模式**：
```js
// ✅ 正确
slots.register({...}, function() {
  function MyView() { ... }
  return React.createElement(MyView)  // 返回元素
})
// ❌ 错误
slots.register({...}, function(props) {
  return function MyView() { ... }  // 返回函数
})
```

#### 坑 4：Host 返回格式不匹配

**现象**：Client 能收到 RPC 响应但数据不显示。

**根因**：Host 返回 `{state:JSON.parse(t), error:null}`，Client 用 `r.state` 提取，这一层包装导致数据提取失败。PoC 的 Host 直接 `return JSON.parse(t)`，Client 直接用 `host.call()` 的结果。

**解决方案**：严格匹配 PoC 的数据传输格式。

#### 坑 5：工作区路径发现（tryDiscover）被删

**现象**：第一个紧凑版 Host 把 `workspaceRoot` 默认设为空，试图在 Host 端用 DEFAULT_ROOT 兜底，但因 `fs` 沙箱权限问题读取失败。

**解决方案**：恢复 Client 端的工作区路径发现函数 `tryDiscover()`，优先从 `window.__wfWorkspaceList` 提取，兜底调用 `wf:config` 验证硬编码路径。

### 4.5 验证结果

| 检验项 | 结果 |
|--------|------|
| 标签 "Workflow" 显示 | ✅ |
| DAG SVG 图形（节点+箭头+状态行） | ✅ |
| 节点颜色 | ✅ 灰/蓝/绿 随状态变化 |
| 状态更新（模拟 RUNNING → GATE_RUNNING → COMPLETED） | ✅ 平滑变化 |
| 闪烁（模拟状态变化） | ✅ 无闪烁、无 "Connecting..." |

## 5. 当前部署

```yaml
pluginId: wff-9
packages:
  - pkg-13: Host minimal + Client text-only
  - pkg-14: Host + Client DAG SVG (current)
status: running
hostHandlers:
  - wf:status → 读 state.json 返回快照
clientFeatures:
  - conversation.view slot (id=workflow)
  - 1500ms 轮询 host.call('wf:status')
  - 模块级数据层（apply 级 latest + listeners）
  - SVG DAG (DagCanvas React.memo)
```