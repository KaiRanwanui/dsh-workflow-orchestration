# 交接 Prompt：workflow-agent → DSH 0.1.5-rc.2 迁移（新 Session 开场粘贴用）

> 用法：DSH 全新安装 0.1.5-rc.2 完成后，新开会话，将下方分割线内的内容整段粘贴为第一条消息。
> 本文件同时留档于仓库（`workflow-agent/plan/development/`），权威细节以迁移计划文档为准。

---

你是 workflow-agent 项目的开发助手。DSH 已全新安装升级 0.1.1-rc.2 → **0.1.5-rc.2**，旧会话/插件/数据全部丢弃，本 prompt 是唯一交接载体。工作区 `/home/zhaokai/Projects/dsh_projects`，环境（Phase 0/1）用户已就绪。

**任务**：执行 workflow-agent 迁移迭代（迁移计划 Phase 2 起）。

**第一步必做**：通读 `workflow-agent/plan/development/dsh-0.1.5-rc-upgrade-impact-and-migration-plan.md`——破坏性变更、§3.3 七项迁移映射（before/after 代码）、四阶段计划全在里面。

**已拍板决策（勿再询问）**：目标 0.1.5-rc.2；直接切换不做双版本 shim；全新安装、数据不保留；旧插件从零选装；不用社区升级 skill。

**迁移面速记**：
- 唯一硬断裂 = workflow-host `inject` 的 `apiProxy` → 改 `sessionController`（`code/packages/workflow-host/lib/index.js:7`、`code/agent-presets/workflow-orchestrator/workflow-host.mjs:8`）
- 4 个生产调用点按 §3.3 改新签名：`sessionController.prompt({requestId,sessionId,mode,content})`；`subagents.prompt({requestId,parentSessionId,childSessionId,mode:'continuable',delivery, content})`；`subagents.listChildren`；`subagents.interruptByParent`；返回值 `{accepted:true}`/`{messageId}` 不再双层包裹
- `/wf/probe-inject` 探针：`subagents.followup` 已移除 → `sendMessage`
- 客户端 `conversation.view` 槽位存续、预期零改动；但全新环境需重新挂载：web profile `link:` 依赖 + `dsh.profile.bundles` + `pnpm install`；preset 三件重部署 `~/.dsh/.agent-presets/workflow-orchestrator/`
- 基线版本：workflow-host 0.20.1 / client-ui-monitor 0.9.0（563 单测）

**开工纪律**：
1. 按团队约定（`plan/development/team-conventions.md`）：先向用户提交迭代设计方案（范围/顺序/验证标准：面板 4 键 agent 真实感知、A1 停止链路、子代理 delivery 两态、demo 端到端），确认后再动代码
2. 改 Host 侧插件后提醒用户重启 `dsh.service`，**勿自行 restart**
3. 构建后必须跑 `code/scripts/verify-client-bundle.js` 产物级验证；`workflow-host.mjs` 是 build-preset 拼接产物，改源后手工同步内联副本再 build
4. 项目进展只写 `plan/` 文档，不写入 DSH 记忆系统

---
