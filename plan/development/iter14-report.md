# Iter-14 报告 — 消息注入技术穿刺

**日期**：2026-08-28
**状态**：✅ **完成（技术穿刺成功，GO 结论）**
**前置**：Iter-12 前台实例界面

---

## 穿刺目标

验证插件能否向指定 DSH session 注入用户消息/指令，为 Iter-15 面板控制（start/stop/继续）探路。

**验证问题**：
1. 插件能否向指定 session 注入消息？
2. API 形态是否支持通用指令消息（`{type, taskId, ...}`）？
3. 能否为"局部任务重跑"预留架构？

---

## 技术方案

### 候选 API：`subagents.followup`

从 Host Service 目录发现 `subagents` 服务提供 `followup` 方法：

```typescript
followup(
  parent: Agent,           // 父 Agent（调用者）
  childId: SessionId,      // 目标 session ID
  content: ContentBlock[], // 消息内容
  options: SubagentFollowupOptions
): Promise<MessageId>
```

### 参数结构

**ContentBlock**（消息内容）：
```typescript
// 文本消息
{ type: 'text', text: '消息内容' }

// 推理消息
{ type: 'reasoning', text: '思考内容' }

// 工具调用/结果（略）
```

**SubagentFollowupOptions**：
```typescript
{
  source: MessageSource,   // 消息来源归因（coordinator / subagent-report）
  signal: AbortSignal      // 取消信号
}
```

---

## 源码分析

### followup 实现（dsh-subagent/lib/index.js）

```javascript
async followup(parent, childId, content, options) {
  this.assertAdmitting(parent);
  while (true) {
    const live = await this.locks.run(childId, async () => {
      const activation = this.activations.get(childId);
      if (activation === void 0) 
        return this.coldResume(parent, childId, content, options);
      if (activation.disposal !== void 0) 
        return activation.disposal.then(() => void 0, () => void 0);
      return this.submitAdmitted(activation, content, options.source, parent, options.signal);
    });
    if (live !== void 0) return live;
    this.assertAdmitting(parent);
    options.signal.throwIfAborted();
  }
}
```

**关键行为**：
1. ✅ 如果 activation 存在，直接提交消息到目标 session
2. ✅ 如果 activation 不存在，自动 cold resume（冷恢复 session）
3. ✅ 返回注入消息的 inbox id（MessageId）
4. ✅ 支持并发安全（locks.run 临界区）

---

## API 形态评估

### 1. 通用指令消息支持 ✅

`followup` 接受 `ContentBlock[]`，可以携带任意结构化内容：

```javascript
// 通用指令消息示例
const content = [
  { 
    type: 'text', 
    text: JSON.stringify({
      type: 'wf:start',
      instanceId: 'demo-wf-abc123',
      params: { output_dir: '/tmp/output' }
    })
  }
]

await ctx.subagents.followup(parent, targetSessionId, content, options)
```

### 2. 局部任务重跑架构 ✅

可以发送结构化指令，编排 Agent 解析并执行：

```javascript
// 局部任务重跑指令
const content = [
  { 
    type: 'text', 
    text: JSON.stringify({
      type: 'wf:retry-task',
      instanceId: 'demo-wf-abc123',
      taskId: 'task-2',
      reason: 'previous failed'
    })
  }
]
```

编排 Agent 的 system-prompt 可以扩展识别此类指令，执行局部刷新。

### 3. 面板控制场景映射

| 面板操作 | 注入指令 | 编排 Agent 行为 |
|---------|---------|----------------|
| Start | `{type: 'wf:start', instanceId}` | 调 `workflow_start` 工具 |
| Stop | `{type: 'wf:stop', instanceId}` | 调 `workflow_stop` 工具 |
| 继续 | `{type: 'wf:resume', instanceId}` | 调 `workflow_status` 恢复执行 |
| 重跑任务 | `{type: 'wf:retry-task', taskId}` | 局部刷新总状态 |

---

## 约束与风险

### 约束

1. **parent 权限**：调用者必须是目标 session 的父 Agent 或人类用户
   - 面板注入需要合适的 parent 身份（当前 session 的 Agent）
   
2. **source 归因**：需要提供 MessageSource（coordinator / subagent-report）
   - 面板注入可用 `kind: 'coordinator', form: 'relay', senderSessionId`

3. **session 必须存在**：目标 childId 必须是已创建的 session
   - Iter-13 面板创建已保证 sessionId 存在（虽然初始为 null）

### 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| parent 权限不足 | 注入失败 | 面板通过当前 session 的 Agent 注入，天然有权限 |
| 并发冲突 | 消息丢失 | followup 内部有 locks.run 保护 |
| session 已销毁 | 注入失败 | 面板先检查 session 存在性 |

---

## 结论

### ✅ GO — 技术穿刺成功

**理由**：
1. `subagents.followup` API 完全满足消息注入需求
2. 支持通用指令消息（ContentBlock[] 可携带结构化 JSON）
3. 自动处理 session 冷恢复（无需手动激活）
4. 并发安全，返回消息 ID 可用于追踪

**Iter-15 面板控制方案**：
- 面板按钮 → HTTP 路由（/wf/control）→ 插件调 `subagents.followup` → 注入指令 → 编排 Agent 执行

**API 形态定稿**：
```javascript
// 面板控制统一入口
POST /wf/control
{
  "action": "start" | "stop" | "resume" | "retry-task",
  "instanceId": "demo-wf-abc123",
  "params": { ... }  // 可选
}

// 插件内部
const content = [{ type: 'text', text: JSON.stringify({ action, instanceId, params }) }]
await ctx.subagents.followup(parent, targetSessionId, content, { source, signal })
```

---

## 下一步

**Iter-15 面板控制 start/stop/继续**：
1. Host：新增 `/wf/control` 路由，调 `subagents.followup` 注入指令
2. Client：面板工具条增加 Start/Stop/Resume 按钮
3. 编排 Agent：system-prompt 扩展识别 `{type: 'wf:*'}` 指令

**工作量**：1 人天
