# 迁移迭代报告 — DSH 0.1.1-rc.2 → 0.1.5-rc.2（迁移计划 Phase 2）

- **状态**：✅ Phase 2 全部完成并关闭（2026-09-13，含重启后激活验证）；⏳ Phase 3 行为回归另行提交设计确认
- **版本**：host v0.21.0 / client v0.9.1
- **测试**：563 单测全绿（桩已随新服务形状同步）；`verify-client-bundle.js` 产物级验证通过（inject=["slots"]）
- **备份**：开工前全量备份 `~/Projects/dsh_projects/workflow-agent-backup-pre-0.1.5-migration-full-20260913-202833.tar.gz`（含 .git，排除 node_modules）

## 设计方案（用户确认版，2026-09-13）

范围 A→E：A Host 迁移（§3.3 ①–⑦，按 4 个维度差分推进）→ B 单测桩同步 → C 构建链+版本号（host 0.21.0 / client 0.9.1）→ D 全新环境重挂载 → E 文档回填。Phase 3 行为回归（面板 4 键真实感知 / A1 停止链路 / delivery 两态 / demo 端到端）不在本迭代，另报设计。

## A. Host 代码迁移（§3.3 逐项）

| # | 迁移项 | 落点 | 结果 |
|---|---|---|---|
| ① | inject：`apiProxy`→`sessionController` | `workflow-host.mjs:8`（直编）；npm 包侧由 build.js 从 mjs 提取 | ✅ |
| ②③ | 4 个 prompt 调用点：`requestId` 拍平、子代理 `delivery`（stop→steer/其余→queue）、返回直接量 `{accepted:true}`/`{messageId}` | mjs `injectSessionCmd` + start 分支 | ✅ |
| ④ | 子代理列表探针：`subagents.listChildren(parent)`，activity 本地用 `agents.get(id)?.status==='running'` 重算（等价旧行为） | mjs apply 前言 `listRunningChildren` | ✅ |
| ⑤ | 中断：`subagents.interruptByParent(child, parent, 'continuable')` | mjs apply 前言 `interruptChild` + `tools-preset.js` stop 级联 | ✅ |
| ⑥ | `/wf/probe-inject`：`subagents.followup`→`subagents.sendMessage(parent, target, content, {signal})` | mjs 路由 | ✅ |
| ⑦ | 返回结构消费方核对：`snap.promptResult` 仅进 /wf JSON 直出（诊断用），无客户端消费方；守卫字段 `snap.apiProxyUnavailable`→`snap.sessionControllerUnavailable`（无外部消费方，已全库 grep 确认） | mjs | ✅ |

注：子代理 prompt 路径新增软守卫（`subagents` 不可用→`{messageInjected:false, reason:'subagents unavailable'}`）。

## B. 单测桩同步（`scripts/test-host.js`）

- S4 桩：`apiProxy.sessions.prompt` → `sessionController.prompt`（拍平参数 + `{accepted:true}`），断言同步去 payload 包裹。
- c16 桩：`apiProxy.subagents.{list,interrupt}` → `subagents.{listChildren,interruptByParent}` 新形状 + `agents.get` 判活 mock（stop 级联重算依赖）。
- c17 用 deps 注入（listRunningChildren 等），与新实现解耦，无需改。
- 结果：**563/563 全绿**。

## C. 构建链

- 纪律执行：改 `tools-preset.js`/`instance-store.js` → `sync-modules.js tools-preset instance-store` → mjs 直编 section 手工改 → `packages/workflow-host/build.js`。
- **发现并修复隐患**：`build.js` 输出模板**硬编码**旧 inject 行，导致首次重建产物 lib/index.js:7 仍是 apiProxy（单测不覆盖 npm 包产物，纯靠人工核对抓出）。已改为从 `workflow-host.mjs` 原始文本正则提取 inject（剥离 export 前执行），消除模板/源漂移。
- 版本：host package.json → 0.21.0（engines `>=0.1.5-rc.1`）；client → 0.9.1。
- client 代码零改动；`verify-client-bundle.js` 通过。
- **坑记录**：`scripts/build-preset.js` 是过时生成器（模板 `inject:['fs','timer']`），运行会覆盖现役 mjs——本次未运行，后续可考虑删除或标注废弃。

## D. 全新环境重挂载（2026-09-13 完成）

- web profile：`dsh plugin --profile web add ./workflow-host ./client-ui-monitor`（官方通道）→ dependencies 两条 `link:` + bundles 追加两包 + pnpm 安装，`~/.dsh/profiles/web/package.json` 对账正确。
- preset 部署：`preset.yml / agent.cordis.yml / system-prompt.md / workflow-host.mjs / workflow-rpc.mjs` 五文件（含 mjs，超出"三件"口径保险起见全量）→ `~/.dsh/.agent-presets/workflow-orchestrator/`；部署副本已验证（inject 新值、无 apiProxy 调用残留）。
- 沙箱注记：`~/.dsh` 写入需 danger-full-access（workspace-write 拒绝），两次提权均获批。

## 待办（移交）

1. ~~用户重启 `dsh.service` → journalctl 验证~~ ✅ 已完成（2026-09-13 20:41 重启：journal 无 waiting/error、`[workflow-agent] materialize ok`、`/wf/list` HTTP 200 合法 JSON、`conversation.view` 槽位在 live Slots 树确认存续）
2. **Phase 3 迁移补充修复（2026-09-13，回归环境准备期发现）**：`dsh-persona` 0.1.5 Config schema 变更 `text` → 必填 `prefix`（+可选 suffix/complete/includeRuntimeContext），preset 切换报 `$.prefix missing required value`。修复：`sync-persona.js` 生成物键名 text:→prefix:（保留旧形态一次性转换识别），system-prompt.md 头注与 agent.cordis.yml 重新生成并重部署；**其余 preset 行（agent-instructions/tool-subagent/tool-fs-search/tool-todo）已逐一对照 0.1.5 实包 Config schema 核对通过**。
3. Phase 3 行为回归（环境已备：模板/技能 materialize ✅、回归工作区 `wf-regression-015/` ✅、/wf 路由活性探针 ✅）：面板 4 键 agent 真实感知、A1 停止链路（sessionController.cancel）、子代理 delivery 两态、孤儿回收、demo 端到端、probe-inject 冒烟。
4. git 提交 + push（待 Phase 3 通过后一并）。
