# 迁移迭代验证报告 — DSH 0.1.5-rc.2 Phase 3 行为回归

- **状态**：✅ 完成（2026-09-13，用户 GUI 验收通过）
- **版本**：host v0.21.0 / client v0.9.1
- **测试**：563 单测全绿；`verify-client-bundle.js` 通过
- **报告**：配套 `iter-migration-015rc2-report.md`（Phase 2 记录）

## 验证环境

- orchestrator preset 会话（session-c0e182c4…）× 工作区 `~/Projects/dsh_wf_ws/`，模板 default-demo（4 任务，deep-analysis 长任务留停止窗口）
- 探针手段：`/wf/*` 路由直调（与面板同参）+ 临时 wf-debug 日志（收尾已移除）+ 会话 V3 日志解包（node:zlib 多帧 zstd）

## 回归结果

| # | 项 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | 面板 Start（queue）真实感知 | ✅ | `{accepted:true}`；agent 调 workflow_begin → RUNNING 4 任务装载 |
| 2 | 面板 Stop（steer）真实感知 | ✅ | steer 消息 `agent/inbox/spliced` 当场插入进行中回合 → agent 调 workflow_stop → STOPPED + stopReason=user-stop 落盘 |
| 3 | 面板 Resume 保进度 | ✅ | 2/4 → RUNNING → 3/4 → COMPLETED 4/4 |
| 4 | 面板 Reset | ✅ | COMPLETED→PENDING，备份归档，output 清理生效 |
| 5 | A1 UI 停止链路 | ✅ | `turn/end {aborted, reason:{kind:'user'}}` 形态 0.1.5 存续 → tap 命中 → STOPPED(user-stop)；子会话收到 `aborted(parent)`（0.1.5 cancel 原生级联） |
| 6 | demo 端到端 | ✅ | 完整跑通 ×2（COMPLETED 4/4，产物落盘） |
| 7 | 客户端面板/DAG | ✅ | 修复缺陷 #3 后正常渲染 |
| 8 | probe-inject 新 API | ✅（受限） | 路由+lineage 校验正常（对根会话目标正确拒绝）；完整冒烟需子代理拓扑，留观 Iter-31 |
| 9 | 孤儿回收/多实例 | ✅ | 重启后实例自动解绑入池、多实例并存、归档/采用流程正常 |

## Phase 3 发现并修复的迁移缺陷（4+2 项）

| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| 1 | preset 切换报 `$.prefix missing` | `dsh-persona` 0.1.5 Config：`text` → 必填 `prefix` | sync-persona.js 生成键名改 prefix（旧形态兼容识别）；重部署 |
| 2 | 面板「此会话不是 Workflow 编排会话」 | session preset 改经 projection 下发：`byId[id].projectionValues.agentPreset`（旧直读字段恒 undefined） | client.js 门控改 projection 读取+旧字段兜底 |
| 3 | prompt 注入抛 `throwIfAborted of undefined` | `sessionController.prompt(request, signal)` 的 signal 实为必填（迁移计划 §3.3 "可选"与实包不符） | 4 处调用传真实 `AbortController().signal` |
| 4 | 停止链路失效（判活） | 0.1.5 子会话不进 agents store（`agents.get(child)` 恒 undefined）、`listChildren.activity` 亦不可靠 | 守卫判活主源改 `sessions.get(child)`（resident 语义）；级联放弃判活、全量下发 interrupt（服务端 no-op 保证） |
| 5 | 面板 Stop 子会话不终止（#4 修复后仍不彻底） | 「steer 注入→LLM 调 workflow_stop」链路 0.1.5 下不可靠（注入被 inbox 移除/排队） | **架构修订**：`/wf/stop` 路由层权威直停——engine.stop+落盘 → `sessionController.cancel({sessionId})` 原生级联（与 UI 停止同源）→ interruptByParent 全量兜底 → 注入仅作事后通知 |
| 6 | 重启后 Stop 报「未启动(CREATED)」 | 重启后内存 entry `hasState=false`（缓存丢失） | stop 分支前置磁盘水合（与 recoverOrphan 同款） |

## 设计决议记录

- **面板 Stop 语义修订（缺陷 #5）**：放弃 Iter-21「仅注入、由 agent 落 STOPPED」的间接语义，改为路由层权威直停（engine.stop + cancel 原生级联 + 通知注入）。理由：0.1.5 注入通道不再保证即时性，用户期望与实际能力对齐；Iter-20(R2) 防双写的顾虑由「注入降级为通知」消除。
- **判活语义修订（缺陷 #4）**：`sessions.get(child)`（resident）为主源，`activity`/`agents.get` 仅兜底——0.1.5 子会话生命周期由 subagent continuation manager 管理，不进 agents store。
- **探针未动的盲区**：`interruptByParent` accepted≠实际中断（signal 观察依赖子会话步界）——主通道已绕开；留档备查。

## 遗留与建议

1. delivery 两态 + probe-inject 完整冒烟需 orchestrator 作为 continuable 子代理的真实父子拓扑 → 留观 Iter-31（单测已覆盖两态语义）。
2. `scripts/build-preset.js` 为过时生成器（运行会覆盖现役 mjs），建议删除或标注废弃。
3. 测试工作区 `dsh_wf_ws` 遗留 4 个已归档/停止实例与 1 个空实例（44d0d90b），不影响功能，可手动清理。
