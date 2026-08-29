# Iter-18 报告 — 流程控制工具 + 路由 + 孤儿回收（Host）

**日期**：2026-08-29
**版本**：@workflow-agent/workflow-host **v0.10.0**（Client 不变）
**前置**：Iter-16（运行状态机）、Iter-17（绑定模型+完整性）
**技术方案**：`plan/design/workflow-lifecycle-design.md` §3/§5/§6
**状态**：✅ **代码完成**（137/137 单测通过，lib/index.js 构建通过；待重启部署验证）

---

## 交付内容

### 1. 工具接线到 Iter-16 运行状态机（`tools-preset.js`）

| 工具 | 语义 |
|------|------|
| `workflow_start` | 须已绑定本会话（UNBOUND→报先 adopt；异会话→1:1 拒）；RUNNING/STOPPED/COMPLETED/FAILED 拒；CREATED 先 `begin(parsed)`；`engine.start()`→RUNNING |
| `workflow_stop` | `engine.stop()`（仅 RUNNING→STOPPED，保进度，active=false） |
| `workflow_resume`（新） | 仅 STOPPED→`engine.resume()`→RUNNING（续跑保 DONE） |
| `workflow_reset` | 仅 STOPPED/COMPLETED/FAILED；先写 `_reset_<state>` 归档备份→`engine.reset()`→PENDING |
| `workflow_adopt`（新） | 采用池中 `sessionId==null` 实例并绑定本会话（1:1） |
| `workflow_list` | 补派生状态 `sessionState`（UNBOUND/BOUND/DONE/BROKEN）+ `orphans` |

### 2. 路由（webserver-routes，内联）

- `POST /wf/start|stop|reset|resume|adopt`（原 start/stop/reset 改为走引擎方法；新增 resume/adopt）
- BROKEN 拦截：create/adopt/run 前 `checkWorkspaceTreeIntegrity`，不通过→500
- reset：先 `writeArchiveBackup(reset)` → `engine.reset()`

### 3. 孤儿识别 + 回收（`instance-store.js`，惰性扫描）

- 判定：`sessions.get(boundSessionId) === undefined`（归档≠死亡）
- 回收：RUNNING 先 stop → 解绑(`sessionId→null`) → 保留 `state.json` 回 UNBOUND 池 → 可被新会话 adopt/resume
- 生产接线：`apply()` 注入 `sessions` 服务，`isSessionLive(sid)`；sessions 不可用时保守返回 live（不误判孤儿）
- 触发：`workflow_list`/`status`/`adopt`/`start` 时的惰性派生扫描

### 4. system-prompt / agent.cordis.yml

- `adopt→start` 两步：start 前须先 adopt；STOPPED 用 resume、COMPLETED/FAILED 用 reset

---

## 关键决策（用户拍板）

| 决策点 | 选定 |
|--------|------|
| 孤儿触发 | 惰性扫描 |
| start 对 `sessionId==null` | 先 adopt 再 start（不自动认领） |
| reset 归档备份 | Iter-18 写（`_reset_<state>`） |

**孤儿判定基准**（源码佐证 `packages/host/apiproxy/src/api/workspace.ts`）：归档≠死亡；孤儿=绑定会话离开 live store。详见 lifecycle-design §9.1。

---

## 验证

### 单测（用例 13 新增 11 断言，总 137/137 ✅）

| 断言 | 结果 |
|------|------|
| c13 create: CREATED + 绑定 sess-a | ✅ |
| c13 start: RUNNING | ✅ |
| c13 stop: STOPPED + active=false | ✅ |
| c13 resume: RUNNING + 保 DONE | ✅ |
| c13 stop2: STOPPED | ✅ |
| c13 reset: PENDING + runnable 1 | ✅ |
| c13 reset: 备份目录 _reset_<state> 写入 | ✅ |
| c13 status: a RUNNING | ✅ |
| 孤儿识别: 死会话实例进 scanOrphans | ✅ |
| 孤儿回收: 解绑 sessionId=null | ✅ |
| 孤儿回收后: 不再被识别为孤儿 | ✅ |

### 构建

- `instance-store.js`/`tools-preset.js` → `sync-modules.js` 同步到 mjs → `build.js` 重建 `lib/index.js`（inject 含 `sessions`，`module.exports = {name, inject, apply}` 完整）。

### 部署验证（待执行）

1. `systemctl --user restart dsh.service`
2. 浏览器硬刷新
3. 面板/工具验证：adopt→start、resume、reset(备份)、孤儿回收在 Client（Iter-20/21）接线后前端可见；Host 侧工具语义需重启后生效

## 提交

- `feat(iter-18): 流程控制工具 + 路由 + 孤儿回收（Host）`（具体 hash 见 `git log --grep=iter-18`）

## 下一步

**Iter-19 归档存储 + 管理（Host）**：显式归档（`archive_<state>` 移出池）+ `listArchive`/`downloadArchive`(zip)/`deleteArchive` 工具与路由；归档后会话 BOUND→DONE（技术方案 `workflow-lifecycle-design.md` §7）。
