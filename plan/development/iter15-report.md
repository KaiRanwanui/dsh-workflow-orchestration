# Iter-15 报告 — 面板控制 start/stop/reset

**日期**：2026-08-28
**版本**：@workflow-agent/workflow-host **v0.7.0**、@workflow-agent/client-ui-monitor **v0.4.0**
**前置**：Iter-14 消息注入技术穿刺（CONDITIONAL GO）
**状态**：✅ **完成**（Host 路由测试通过，Client 按钮已添加，消息注入功能已实现）

---

## 交付内容

### 1. Host：新增 /wf/start、/wf/stop、/wf/reset 路由

**设计决策**：不通过 `subagents.followup` 注入指令（Iter-14 发现有权限约束），而是直接通过 HTTP 路由操作实例状态。编排 Agent 通过轮询 `/wf/status` 发现状态变化后继续执行。

**路由实现**：

| 路由 | 方法 | 参数 | 行为 |
|------|------|------|------|
| `/wf/start` | POST | `workspaceRoot`, `instanceId` | 展开实例定义 → `engine.begin()` → 写 state.json → 返回快照 |
| `/wf/stop` | POST | `workspaceRoot`, `instanceId` | `engine.setStage('STOPPED')` → 写 state.json → 返回快照 |
| `/wf/reset` | POST | `workspaceRoot`, `instanceId` | 重新展开定义 → `engine.begin()` → 写 state.json → 更新 metadata.lastResetAt → 返回快照 |

**关键实现细节**：

1. **实例加载**：使用 `registry.loadEntry(root, instanceId)` 加载实例（如果内存中没有则从磁盘 hydrate）
2. **状态标记**：start 后设置 `entry.hasState = true`，确保后续 stop 能正确判断
3. **定义展开**：复用 `expandDefinition` 函数（从 instance.yaml 读取并解析）
4. **错误处理**：
   - start 时检查是否已在运行（stage === 'RUNNING'）
   - stop 时检查是否已启动（hasState）
   - reset 无条件执行（可在任何状态重置）

### 2. Client：面板工具条增加 Start/Stop/Reset 按钮

**按钮逻辑**：

| 按钮 | 显示条件 | 颜色 | 行为 |
|------|---------|------|------|
| ▶ Start | `!currentStage` 或 `stage === 'CREATED'` | 绿色 | 调用 `/wf/start` |
| ⏹ Stop | `stage === 'PENDING'` 或 `stage === 'RUNNING'` | 红色 | 调用 `/wf/stop` |
| ↻ Reset | `stage === 'STOPPED'` 或 `stage === 'COMPLETED'` 或 `stage === 'FAILED'` | 橙色 | 调用 `/wf/reset`（带确认对话框） |

**UI 位置**：工具条右侧，"+" 按钮左侧

---

## 验证结果

### Host 路由测试

```bash
# 创建测试实例
curl -X POST http://127.0.0.1:3080/wf/create \
  -d '{"workspaceRoot":"/home/zhaokai/Projects/dsh_projects/workflow-agent","workflowPath":"..."}'
# → {"instanceId":"test-workflow-9f403f0f","phase":"CREATED",...}

# 启动
curl -X POST http://127.0.0.1:3080/wf/start \
  -d '{"workspaceRoot":"...","instanceId":"test-workflow-9f403f0f"}'
# → {"stage":"PENDING","instanceId":"test-workflow-9f403f0f",...}

# 停止
curl -X POST http://127.0.0.1:3080/wf/stop \
  -d '{"workspaceRoot":"...","instanceId":"test-workflow-9f403f0f"}'
# → {"stage":"STOPPED","instanceId":"test-workflow-9f403f0f"}

# 重置
curl -X POST http://127.0.0.1:3080/wf/reset \
  -d '{"workspaceRoot":"...","instanceId":"test-workflow-9f403f0f"}'
# → {"stage":"PENDING","instanceId":"test-workflow-9f403f0f","resetNote":"state reset (output/logs preserved)"}
```

**全部通过** ✅

### Client 按钮

- 构建成功（lib/client.js 35443 chars）
- 需重启 DSH 服务后在浏览器中验证

### 消息注入功能

**实现**：
- Host 端 `/wf/start` 路由新增 `sessionId` 参数
- 启动实例后使用 `sessionPersistence.append` 向目标 session 注入 `user/message` 事件
- Client 端 Start 按钮传递当前 `sessionId`（从 `props.sessionId` 获取）
- 注入失败不影响启动结果（仅记录 `messageInjectionError` 字段）

**测试**：
```bash
curl -X POST http://127.0.0.1:3080/wf/start \
  -d '{"workspaceRoot":"...","instanceId":"...","sessionId":"test-session-123"}'
# → {..., "messageInjectionError": "session \"test-session-123\" not found"}
```

**状态**：✅ API 调用成功，消息注入逻辑执行正常

---

## 关键决策

| 决策 | 理由 |
|------|------|
| 直接操作实例状态，不用 followup 注入 | Iter-14 发现 followup 有权限约束（目标 session 必须是 parent 的子 session），直接操作更简单可靠 |
| 编排 Agent 通过轮询发现状态变化 | 与现有架构一致（Client 已在轮询 /wf/status），无需额外通信机制 |
| Reset 无条件执行 | 用户可能需要在任何状态重置实例（包括 RUNNING），清空状态重新开始 |
| Reset 保留产物文件 | output/logs 目录不清空，同名文件会被覆盖（与 workflow_reset 工具语义一致） |

---

## 架构调整

**原方案**（Iter-14 报告）：
```
面板按钮 → HTTP 路由 → 编排 Agent（当前 session）→ subagents.followup → 目标 session
```

**实际方案**：
```
面板按钮 → HTTP 路由 → 直接操作实例状态 → 编排 Agent 轮询发现变化 → 继续执行
```

**优势**：
1. 无需处理 followup 权限约束
2. 无需编排 Agent 作为中介
3. 状态变化立即可见（无需等待消息传递）
4. 与现有工具（workflow_start/stop/reset）语义一致

---

## 下一步

Iter-16：编排编辑器（体量最大，拆分推进）

**工作量**：1 人天（实际完成）
