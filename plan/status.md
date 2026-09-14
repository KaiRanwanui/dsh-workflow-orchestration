# 项目状态（单一权威）

> **本文件是 workflow-agent「当前状态」的唯一权威**，回答「项目走到哪了、基线是什么、下一步做什么」。
> **维护频率：每阶段一次**（阶段启动/收尾时更新）。迭代级状态写在各自迭代报告里，**不回写本文件、不回写阶段 README**。
> 历史过程记录见 `phases/progress-record.md`（已冻结）。

**最后更新**：2026-09-14（阶段 2 收尾后；同日完成**文档归档整理**——按阶段重组 `plan/`，
根目录 PoC 残留移入 `PoC/legacy-root/`，重写入口文档与文档地图，取消逐迭代打钩式状态维护）

---

## 1. 阶段总览

| 阶段 | 时间 | DSH 基线 | 交付版本 | 测试基线 | 状态 |
|---|---|---|---|---|---|
| **阶段 0 · PoC 验证** | 2026-08 中旬前 | 0.1.2-alpha 系列 | 原型（未发行） | 无 | ✅ 已归档 |
| **阶段 1 · 核心功能开发**（Iter-1 ~ Iter-30 + Iter-SUBA） | 2026-08-26 ~ 09-05 | **0.1.1-rc.2** | host v0.20.1 / client v0.9.0 | 563 单测全绿 | ✅ 已完成并归档 |
| **阶段 2 · DSH 0.1.5-rc.2 迁移** | 2026-09-13（单日完成） | **0.1.5-rc.2** | host **v0.21.0** / client **v0.9.1** | 563 单测全绿 + GUI 回归通过 | ✅ 已完成并归档 |
| **阶段 3 · 构建链合并重构**（规划中） | 待启动 | 0.1.5-rc.2 | — | — | ⏳ 方案已论证（见下） |

阶段详情与迭代索引：`phases/README.md`。

---

## 2. 当前系统形态（已部署并运行）

| 项 | 现状 |
|---|---|
| DSH | **0.1.5-rc.2**（主包 + 10 个关键卫星包同版本） |
| 服务 | 用户级 systemd `dsh.service`，Web 3080（loopback + token 认证） |
| 部署形态 | web profile（`~/.dsh/profiles/web/`）：`link:` 依赖两个包 + `dsh.profile.bundles` 注册；preset 部署在 `~/.dsh/.agent-presets/workflow-orchestrator/` |
| 内建资产 | 插件启动时物化到 `~/.dsh/workflow-agent/`（4 模板 + 7 技能 + samples/docs） |
| 运行时插件来源 | **npm 包** `packages/workflow-host/lib/index.js`（CJS）；preset 目录中的 `workflow-host.mjs` 当前**未挂载**（见阶段 3） |
| GUI | orchestrator 会话的 `conversation.view` 面板（DAG/四键/编辑/管理）正常 |

版本锁定明细（含卫星包清单）见 `phases/phase-2-dsh-migration/iterations/iter-migration-015rc2-verification-report.md`「版本锁定」节。

---

## 3. 下一步：阶段 3 — 构建链合并重构

**问题**（阶段 2 收尾时发现，已打桩验证可行）：
1. `workflow-host.mjs` 是「12 源模块同步副本 + 2 段手编区」的混合体，靠 `sync-modules.js` 人工同步维持（历史多次因漏同步翻车）；
2. 单测入口依赖 mjs 而非真实交付物 `lib/index.js`；
3. 现役 `lib/index.js` 存在**导出面被篡改**缺陷：源模块尾部的条件导出块未剥离，`apply()` 执行后 `module.exports` 被最后一个 section 覆盖（`name/inject/apply` 丢失）。

**方案**（可行性已用原型验证，见阶段 3 设计文档）：
- 抽取 2 段手编区为真实源文件 → 单一生成器直接从源模块产出 CJS 交付物 → mjs 降级为生成物或取消；
- 单测改为对准真实产物；消除同步纪律。

**待办**：出正式迭代设计（交付件/顺序/验证标准/回退点）→ 用户确认 → 开发。
`development-plan.md`（阶段 1 详案）已归档，新阶段计划按 `plan/development/iteration-plan-template.md` 撰写。

---

## 4. 已知限制（明确不做，留档）

| 限制 | 说明 | 记录 |
|---|---|---|
| delivery 两态 / probe-inject 完整冒烟未做真实拓扑实测 | 实际使用形态为根会话，无「orchestrator 作为子代理」拓扑；以单测覆盖 + API 可达性验证关闭 | 阶段 2 验证报告「已知限制」#1 |
| `interruptByParent` 的 accepted ≠ 实际中断 | 仅影响兜底通道；面板 Stop 主通道走 `sessionController.cancel` 原生级联 | 同上 #2 |
| 门禁 subagent 分支（PASS→COMPLETED）真实链路未在 0.1.5 环境复跑 | 引擎既有能力，阶段 3 或后续迭代顺带覆盖 | 阶段 2 迁移计划 Phase 3 勾选备注 |
| `build-preset.js` 已废弃（运行即 exit 1） | 防止误跑覆盖现役 mjs；建议阶段 3 一并退役 | `code/scripts/build-preset.js` 头部 |
| `interruptByParent` / legacy 脚本（`build-host.js`、`.ps1`、`dist/`）待退役 | 阶段 3 评估 | 阶段 3 设计文档 |

---

## 5. 文档地图（从本文件出发）

```
plan/status.md              ← 你在这里（当前状态唯一权威）
plan/README.md              ← 文档地图与阅读路径
plan/phases/README.md       ← 阶段总览 + 索引
plan/phases/phase-N-*/      ← 各阶段总结 + iterations/（冻结的迭代产物）
plan/design/                ← 现行设计（数据模型、生命周期、通信机制…）
plan/architecture/          ← 架构决策记录（ADR）
plan/requirements/          ← 需求基线
plan/development/           ← 团队约定 + 迭代计划/报告模板
plan/build/                 ← 构建、部署、环境文档
```
