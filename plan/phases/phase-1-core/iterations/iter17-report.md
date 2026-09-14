# Iter-17 报告 — 绑定模型 + 完整性（Host）

**日期**：2026-08-29
**版本**：@workflow-agent/workflow-host **v0.9.0**（Client 不变）
**前置**：Iter-16（运行状态机）
**技术方案**：`plan/design/workflow-lifecycle-design.md` §2/§3
**状态**：✅ **代码完成**（125/125 单测通过，lib/index.js 构建通过；待重启部署验证）

---

## 交付内容

### 1. 工作区骨架物化（`instance-store.js` → `ensureWorkspaceSkeleton`）

首次挂接 workflow 会话时在 `<workspace>/.workflow-agent/` 物化 `instances/` + `archive/`（幂等，落 `.gitkeep` 标记，mock/真实 fs 均成立）。`beginInstance` 锚点自动触发。

### 2. 绑定语义（已按用户确认修订）

| 动作 | 语义 | 1:1 守卫 |
|------|------|---------|
| `create-bind` | 新建实例并写 `metadata.sessionId=S`（UNBOUND→BOUND） | 会话须 UNBOUND（否则拒） |
| `adopt` | 仅采用池中 `sessionId==null` 实例并写 S（UNBOUND→BOUND） | 会话须 UNBOUND；目标须 `sessionId==null`；RUNNING 实例先 stop 再采用 |

- 一会话一实例、一实例一会话、绑定后禁再绑/切换（仅删会话解绑，解绑语义属 Iter-18 孤儿回收）。

### 3. 派生会话状态（不侵入 DSH Session）

`deriveSessionState(cwd, sessionId)` → `UNBOUND|BOUND|DONE|BROKEN`，实时从实例+整树派生：

- `BOUND`：恰好一个结构完好实例声明 S
- `DONE`：无 BOUND 但 archive 声明 S（Iter-19 起成立）
- `UNBOUND`：骨架在场自洽、无任何声明
- `BROKEN`：整树损坏/冲突

### 4. 整树完整性判定（`checkWorkspaceTreeIntegrity`，纯完整性不设绑定指针）

- 骨架在场：agentRoot 有内容时须含 `instances/`（缺场→BROKEN）
- 每实例目录 metadata 合法（`instanceId` 匹配目录名；损坏→BROKEN）
- 1:1 冲突（两会话同 S）→ BROKEN

---

## 设计确认：孤儿判定基准（源码佐证，写入 §9.1）

- 孤儿 **= 绑定会话离开 live store**：`sessions.get(boundSessionId) === undefined` / 触发 `session/disposed`。
- **归档 ≠ 死亡**：`workspace.archiveSession` 仅加入 `archivedSessionIds`，会话仍存活 store，`get(id)` 仍返回 → 不判孤儿。
- 因此仅归档的实例仍 BOUND；"归档并删除"因删除成为孤儿；恢复(unarchive)不影响。
- 孤儿回收（stop+解绑→保留进度回池→新会话 adopt/resume）移至 **Iter-18**。

---

## 验证

### 单测（用例 12 新增 12 断言，总 125/125 ✅）

| 断言 | 结果 |
|------|------|
| create-bind: 新建实例 sessionId=sess-a | ✅ |
| create-bind: 派生 BOUND | ✅ |
| create-bind: 会话已绑定 → 拒绝(1:1) | ✅ |
| adopt 前置: 池实例 sessionId=null | ✅ |
| adopt: 绑定后 sessionId=sess-b | ✅ |
| adopt: 派生 BOUND | ✅ |
| adopt: 已占用实例 → 拒绝 | ✅ |
| 骨架缺场: check → not ok | ✅ |
| 实例目录损坏: derive → BROKEN | ✅ |
| 1:1 冲突: derive → BROKEN | ✅ |
| adopt: RUNNING 实例 → 拒绝 | ✅ |
| 未绑定会话: derive → UNBOUND | ✅ |

### 构建

- `code/plugins/workflow-host/instance-store.js` → 经 `sync-modules.js instance-store` 同步到 `workflow-host.mjs` → `packages/workflow-host/build.js` 重建 `lib/index.js`，`module.exports = {name, inject, apply}` 完整。

### 部署验证（已重启，通过）

1. `systemctl --user restart dsh.service` 后插件已加载 **v0.9.0**（profile symlink 指向源码，`/wf/list` 正常返回 29 实例，无崩溃）。
2. **骨架物化（Iter-17 observable）**：`POST /wf/create` 新建实例 `iter17-check-c25293ea` 触发 `beginInstance`→`ensureWorkspaceSkeleton`，`.workflow-agent/archive/`（含 `.gitkeep`）与 `instances/` 均已物化 ✅。
3. **新实例 metadata.sessionId=null**（UNBOUND 池，adopt 前置）✅。
4. **无回归**：`/wf/start`→PENDING/active=true；`/wf/stop`→STOPPED/active=false ✅。
5. **说明**：create-bind/adopt/1:1 守卫/派生状态（UNBOUND/BOUND/BROKEN）在运行态尚无法直接经 HTTP 触发——这些方法未接线到工具/路由（Iter-18 才接线），当前由单测 125/125 覆盖。

## 提交

- `feat(iter-17): 绑定模型 + 完整性（Host）`（骨架物化 + create-bind/adopt + 1:1 守卫 + 派生 UNBOUND/BOUND/DONE/BROKEN + 整树完整性；单测 125/125；host v0.9.0）。具体 hash 见 `git log --grep=iter-17`。

## 下一步

**Iter-18 流程控制工具 + 路由 + 孤儿回收（Host）**：`workflow_create/adopt/start/stop/resume/reset` + `/wf/*` 路由；结构化驱动；BROKEN 拦截；孤儿识别（`sessions.get()===undefined`）+ 回收（stop+解绑+保留进度回池→可 adopt/resume）。前置 go/no-go 探针（仿 Iter-9）验证 `get()===undefined` 与 `session/disposed`、归档不判死。
