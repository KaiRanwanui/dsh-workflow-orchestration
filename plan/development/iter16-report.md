# Iter-16 报告 — 运行状态机（Host）

**日期**：2026-08-28
**版本**：@workflow-agent/workflow-host **v0.8.0**（Client 不变）
**前置**：Iter-15（面板控制）
**技术方案**：`plan/design/workflow-lifecycle-design.md` §4/§6
**状态**：✅ **代码完成**（113/113 单测通过，lib/index.js 构建通过；待重启部署验证）

---

## 交付内容

### 1. schema：STAGE 枚举补 STOPPED

`code/shared/workflow-schema.js`（及 engine 兜底 `E_STAGE`）：`PAUSED` → `STOPPED`：

```js
const STAGE = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED', // 停止（保留进度，可 resume/reset/archive；Iter-16）
}
```

> 旧 `PAUSED` 仅为占位（后续迭代），无任何生效代码路径引用，安全替换。遗留的
> `code/plugins/workflow-host/dist/host-*.js` 为动态插件时代产物，非本次部署形态，未改动。

### 2. engine：运行状态机动作

`code/plugins/workflow-host/engine.js`：

- `setStage(s)`：`STOPPED` 与 `COMPLETED`/`FAILED` 一样，置 `active=false`（此前 `workflow_stop` 落盘 STOPPED 却残留 active=true 的隐患在此修正）
- 新增 4 个转移动作（非法转移抛错）：
  - `start`：仅 `PENDING` → `RUNNING`（active=true）
  - `stop`：仅 `RUNNING` → `STOPPED`（active=false，**保留 DONE 进度**）
  - `resume`：仅 `STOPPED` → `RUNNING`（active=true，hydrate 续跑保 DONE）
  - `reset`：仅 `STOPPED`/`COMPLETED`/`FAILED` → 全新 `PENDING`（丢弃进度；`RUNNING` 须先 stop，`PENDING` 无内容）
- `begin` 保留解析定义 `state.def`，供 `reset` 重新 begin（无需外部重传 parsed）

### 3. 未改（越界保护）

绑定/完整性、流程控制工具/路由、归档均为 Iter-17/18/19 专属；本迭代**未改** tools/tools-preset/routes/Client，符合"一次只改一个维度"的差分验证约定。

---

## 构建链说明

- 源码真值：`code/shared/workflow-schema.js` + `code/plugins/workflow-host/engine.js`
- 内联副本 `code/agent-presets/workflow-orchestrator/workflow-host.mjs` 的 schema/engine section 已从源码重新生成（剥离 module 导出块，与 build-preset.js 一致）
- `packages/workflow-host/build.js` 重建 `lib/index.js`（CommonJS），profile 中为 symlink，重建即同步

---

## 验证

### 单测（用例 11 新增 9 断言，总 113/113 ✅）

| 断言 | 结果 |
|------|------|
| begin: PENDING + active=true | ✅ |
| start: RUNNING + active=true | ✅ |
| stop: STOPPED + active=false | ✅ |
| stop: 保留 DONE 进度 | ✅ |
| resume: RUNNING + active=true | ✅ |
| resume: 续跑保 DONE | ✅ |
| STOPPED 不可 start（抛错） | ✅ |
| stop->reset: 全新 PENDING + active=true | ✅ |
| PENDING 不可 reset（抛错） | ✅ |

### 构建

- `node code/packages/workflow-host/build.js` → `lib/index.js` 构建通过，`module.exports = {name, inject, apply}` 完整
- `require` 冒烟：`inject = [fs, tools, webServer, subagents, agents, apiProxy]`，apply 为函数 ✅

### 部署验证（已重启，部分通过）

1. `systemctl --user restart dsh.service` 后，插件已加载 v0.8.0（`/wf/list`、`/wf/status` 正常）
2. 实测（Client UI 可观察部分）：
   - `POST /wf/start` → `stage=PENDING, active=true` ✅
   - `POST /wf/stop` → `stage=STOPPED, active=false` ✅（Iter-16 的 active 修正生效）
   - `POST /wf/reset` → `stage=PENDING, active=true, tasks 全 PENDING` ✅
   - `POST /wf/resume` → **404**（无该路由，属 Iter-18）
3. **说明**：resume（STOPPED→RUNNING 续跑保 DONE）与引擎方法守卫（STOPPED 不可 start / PENDING 不可 reset）当前 UI 到达不了——现行 `/wf/start|stop|reset` 仍直接调 `engine.begin()/setStage('STOPPED')`，未接线到新引擎方法。完整 UI 验证留待 Iter-18（控制工具/路由接线）+ Iter-21/22（Client 按钮）。`/wf/list` 的 `active` 为会话绑定语义，非引擎运行态，故迭代修正不在列表体现。

## 提交

- `2233a11` feat(iter-16): 运行状态机（Host）（schema STAGE→STOPPED + engine start/stop/resume/reset + 单测 113/113 + 文档，host v0.8.0）

## 下一步

**Iter-17 绑定模型 + 完整性（Host）**：工作区骨架物化、create-bind/adopt、1:1 守卫、派生状态 UNBOUND/BOUND/DONE/BROKEN、整树完整性校验（技术方案 `workflow-lifecycle-design.md` §2/§3）。
