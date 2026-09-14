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

## 版本锁定（Phase 4，2026-09-13 复核）

**DSH 运行时**（`/home/zhaokai/.npm-global/lib/node_modules/@deepseek-ai/dsh`）

| 包 | 版本 |
|---|---|
| `@deepseek-ai/dsh`（主包 / CLI） | **0.1.5-rc.2** |
| dsh-api-session-controller | 0.1.5-rc.2 |
| dsh-subagent | 0.1.5-rc.2 |
| dsh-session | 0.1.5-rc.2 |
| dsh-agent | 0.1.5-rc.2 |
| dsh-tools | 0.1.5-rc.2 |
| dsh-host-webserver | 0.1.5-rc.2 |
| dsh-client-ui-cordis | 0.1.5-rc.2 |
| dsh-persona | 0.1.5-rc.2 |
| dsh-sandbox-policy | 0.1.5-rc.2 |
| dsh-fs | 0.1.5-rc.2 |

**本项目**

| 项 | 值 |
|---|---|
| `@workflow-agent/workflow-host` | **0.21.0**（`dsh.engines.dsh: >=0.1.5-rc.1`） |
| `@workflow-agent/client-ui-monitor` | **0.9.1** |
| 单测基线 | 563 通过 / 0 失败 |
| 客户端产物验证 | `verify-client-bundle.js` 通过（inject=["slots"]） |

**部署形态**（全新环境重挂载）

- web profile（`~/.dsh/profiles/web/`）：`dependencies` 两条 `link:` 指向本仓库两个包；`dsh.profile.bundles` = base + web-app + client-ui-monitor + workflow-host；`patchReload: live`；`cordis.patch.yml` 保持空数组（挂载由 bundle patch 承担）
- agent preset：`~/.dsh/.agent-presets/workflow-orchestrator/`（preset.yml / agent.cordis.yml / system-prompt.md / workflow-host.mjs / workflow-rpc.mjs）
- 内建资产物化：`~/.dsh/workflow-agent/`（4 模板 + 7 技能 + samples/docs，26 文件）
- 服务：用户级 systemd `dsh.service`，Web 3080（loopback，token 认证对 loopback 无影响）

## 已知限制（明确不做，留档备查）

1. **delivery 两态 + probe-inject 完整冒烟未做真实拓扑实测**：`injectSessionCmd` 的 `parentSessionId` 分支（`subagents.prompt` + `delivery: queue|steer`）与 `/wf/probe-inject`（`subagents.sendMessage`）只在「orchestrator 会话本身是某会话的 continuable 子代理」时才会走到，而本项目的实际使用形态是用户在 GUI 直接创建 orchestrator 会话（根会话），不存在该拓扑；且客户端面板对 `origin === 'subagent'` 会话主动隐藏（Iter-21 R2 设计）。**收敛方式**：563 单测已覆盖两态语义与 `sendMessage` 调用形状；API 可达性已验（对根会话目标正确返回 lineage 拒绝）。如需实测，须先构造父子拓扑（成本高、收益低），留待出现真实使用场景时再验。
2. **`interruptByParent` 的 accepted 语义 ≠ 实际中断**：官方契约只保证「cancel 信号已受理」，活任务子会话是否立即停下取决于其是否在步界观察到信号（实测子会话 7 秒后收尾且终局为 `completed`）。**影响面**：仅兜底通道（`sessionController.cancel` 主通道已绕开，见缺陷 #5），故不构成风险。

## 遗留与建议

1. `scripts/build-preset.js` 已废弃化（2026-09-13）：文件头标注 DEPRECATED + 运行即 `exit 1` 并提示现役构建链（sync-modules → build.js → test-host），从机制上杜绝误跑覆盖现役 mjs；文件保留作历史参考。
2. 测试工作区 `~/Projects/dsh_wf_ws/` 遗留 5 个实例目录 + 6 个归档（回归数据，用户决定本迭代不清理）。

