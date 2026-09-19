# Iter-39 设计 — 页签动态门控（非编排会话隐藏 Workflow 页签）

- **阶段**：阶段 4（现有功能修复/补全）
- **日期**：2026-09-17
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.26.20` → 发行时阶段内第三格顺延
- **状态**：**待用户确认后编码**
- **来源**：改进项（原队列「页签动态门控」；用户验证反馈「非编排会话不应看到 Workflow 页签」）

---

## 1. 现状与增量边界（代码级踏勘，2026-09-17）

### 1.1 已实现（Iter-20(S5) / Iter-21，不再重做）

| 能力 | 位置 | 行为 |
|---|---|---|
| preset 读取 | client.js L1426-1440 | `projectionValues.agentPreset`（官方路径）+ `byId[].agentPreset` 兜底 |
| 会话判定 | L1445 | `isWorkflowSession = preset === 'workflow-orchestrator' && origin !== 'subagent'` |
| 渲染层占位 | L1904-1908 | 非编排会话 → 面板内容替换为占位文案「此会话不是 Workflow 编排会话」 |
| 轮询短路 | L1446 / R3 | 非编排会话停实例列表轮询；preset 异步加载（false→true）自动恢复 |

### 1.2 增量缺口（本迭代目标）

**conversation.view 的 slot entry 常驻注册表** → 页签列表（`viewTabs` 遍历 `slots.entries('conversation.view')`）**始终含「Workflow」页签**——非编排会话/子会话用户看到一个占位空 tab。目标：**非编排会话完全不出现该页签**（编排会话正常显示）。

### 1.3 契约探针结论（dsh-client-ui-slots / dsh-client-ui-conversation 实读）

| 契约 | 证据 |
|---|---|
| 页签构建 | conversation 包 `viewTabs()`：遍历 `slots.entries('conversation.view')`，`resolveSlotLabel(entry.options)` 产 label → **entry 存在即有页签，label 无法隐藏 tab** |
| 注销 API | `register()` **返回 disposer**：`rec.entries.filter(...); this.markDirty(name, rec)` → 注销即触发页签刷新 |
| 变更订阅 | conversation 包已 `slots.subscribe('conversation.view', refreshViews)` + `sessions.list.subscribe` → 注册/注销/会话切换都会重建 viewTabs |
| 作用域 | conversation.session 声明 `children: { 'conversation.view': { kind: 'list', scope: 'session' } }` → **每个会话 scope 独立 entries** |
| 同 id 冲突 | list slot 重复注册同 id 抛错（"already has an entry"）→ 重注册前必须先 disposer |

## 2. 技术方案

### 2.1 主路径：条件注册（inject factory 内按会话判定）

`slots.inject('conversation.view', factory)` 的 factory 在每个会话 scope 实例化时调用（session-scoped slot 语义）。改造 factory：

```js
slots.inject('conversation.view', (scopeCtx) => {
  // 探针点（编码第一步）：确认 scopeCtx 是否携带 sessionId/preset
  const gate = isWorkflowScope(scopeCtx)            // 判定函数（复用 L1445 同款逻辑）
  if (!gate) return () => {}                        // 非编排会话：不注册 → 页签不存在
  const dispose = slots.register({ ...原 options }, WfComponentFactory)
  return dispose
})
```

**前置 spike（编码第 1 步，30 分钟探针定成败）**：打印 inject factory 的实参与环境，确认 ①factory 每会话 scope 调用一次 ②scopeCtx 可得 sessionId/preset。**若 factory 无会话上下文 → 降级路径 B**。

### 2.2 降级路径 B：常驻传感器 + disposer 管理

factory 无会话上下文时：保持常驻注册，另在**面板组件渲染层**（props.sessionId 可得）用 useEffect 监听 isWorkflowSession 翻转：
- false → 调用注册时保存的 disposer（模块级持有）→ 页签消失
- true → 重新 slots.register → 页签出现
- **风险**：注销后组件卸载，传感器随之消失 → 需把传感器放在**非 workflow 的常驻位置**（如 register 的 component 始终渲染一个 0 高度哨兵 div，仅内容条件化）——即「entry 常驻、组件自管 disposer」。与主路径二选一，spike 后定。

### 2.3 交互细节

| 场景 | 行为 |
|---|---|
| 编排会话（preset=workflow-orchestrator） | Workflow 页签正常显示（现状不变） |
| 非编排会话 / 子会话（origin=subagent） | **页签不出现**（无占位 tab） |
| preset 异步加载 | 判定翻转 → 注册/注销自动跟随（slots.subscribe 刷页签）；首次短暂无页签属预期 |
| 同 id 重注册 | 先 disposer 再 register（契约要求） |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `src/client.js` | inject factory 条件注册改造 + 判定函数提取复用；渲染层占位文案保留（防御：注册门控失效时仍占位） |
| 服务端 | **零改动** |

## 4. 执行顺序与差分验证

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | spike：inject factory 时机/上下文探针 | 控制台输出确认（主路径/降级路径定案） |
| 2 | 条件注册实现 | 构建 + verify-client-bundle |
| 3 | 全量单测 + 真机验收 | §5 |
| 4 | 发行部署 + 报告 | 内容断言 |

## 5. 验证标准（完成线）

- [ ] 单测全绿（无回归）
- [ ] 产物级：bundle + verify-client-bundle + 发行内容断言
- [ ] 真机：①workflow-orchestrator 主会话：页签正常显示、面板功能不回归 ②普通 preset 会话：**无 Workflow 页签** ③子会话：无页签 ④会话切换：页签随会话出现/消失，无残留、无重复注册报错

## 6. 决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 非编排会话呈现 | a) 完全隐藏页签（本方案） b) 维持占位文案 | **a**（占位 tab 对非编排用户是噪音） |
| 2 | 子会话（origin=subagent） | a) 同样隐藏（现状占位） b) 保持占位 | **a**（同属非编排会话） |
| 3 | preset 异步加载期的页签闪烁 | a) 接受首帧短暂无页签（判定翻转后出现） b) 加载中先隐藏 | **a**（实现简单，闪烁仅一次且 <1s） |

## 7. 工作量估计

**约 0.5 人天**（spike 0.1 + 条件注册 0.2 + 真机回归 0.2）。
