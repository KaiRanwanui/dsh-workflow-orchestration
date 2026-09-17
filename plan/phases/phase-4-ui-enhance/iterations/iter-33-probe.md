# Iter-33 探针 — sessions 服务「存在性」API（缺陷 #9 修复前置）

- **日期**：2026-09-16
- **问题**：`isSessionLive = !!sessions.get(sid)` 的 `sessions.get` 是**驻留（live）语义**，把「会话存在但未打开」误判为死会话 → 孤儿回收批量误解绑（#9）。修复需一个回答「会话是否存在（持久化库）」的 API。

## 探针结论

| API | 语义 | 可用作存在性判定 |
|---|---|---|
| `sessions.get(id)` | "Look up a **live** session"——仅驻留会话 | ✗（正是 #9 根因） |
| `sessions.list()` | "All **live** sessions"——同为驻留面 | ✗ |
| **`sessionQuery.listSessions()`** | `Promise<SessionRecord[]>`——**持久化会话记录**（含未驻留） | ✅ **采用** |

**证据**：
1. `dsh-session/lib/types/index.d.ts` L410-424：`get`/`list` 注释均限定 live（"no **live** session has that id" / "All **live** sessions"）。
2. `dsh-session-query/lib/index.js` L1040：服务注册名 **`sessionQuery`**（`super(ctx, "sessionQuery")`）；`types/index.d.ts` L47/L67：`observeSession(sessionId, options?)`（持久化冷读）与 `listSessions(signal?): Promise<SessionRecord[]>`。
3. web profile 经 `session-query-sqlite` 挂载（`dsh-web-app/cordis.patch.yml` L27）；官方 `dsh-api-session-controller` 以 `ctx.sessionQuery` 消费（L154/382/420/675）——第三方插件 `ctx.get('sessionQuery')` 同理可达。

## 修复采用形态（apply-prologue.js）

```js
const sessionExists = async (sid) => {
  if (!sid) return false
  if (sessions.get(sid)) return true                    // 驻留命中 → 快路径
  if (!sessionQuery?.listSessions) return true          // 服务不可用 → 保守不回收
  try {
    const records = await sessionQuery.listSessions()
    return (records || []).some((r) => r && (r.id === sid || r.sessionId === sid))
  } catch (e) { return true }                            // 查询异常 → 保守不回收
}
```

降级原则：**宁可漏回收（可手动归档），不可误回收（丢绑定）**。SessionRecord 的 id 字段以 `r.id ?? r.sessionId` 双形兼容。
