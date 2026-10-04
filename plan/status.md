# 项目状态（单一权威）

> **本文件是 workflow-agent「当前状态」的唯一权威**，回答「项目走到哪了、基线是什么、下一步做什么」。
> **维护频率：每阶段一次**（阶段启动/收尾时更新）。迭代级状态写在各自迭代报告里，**不回写本文件、不回写阶段 README**。
> 历史过程记录见 `phases/progress-record.md`（已冻结）。

**最后更新**：2026-10-04（**阶段 6 关闭**——Iter-MIG0~7 全部完成验收，host **v0.29.5** / 608 单测绿 / 终验全面功能验收通过（含阶段 1~4 全回归）+ 复验反馈轮 3 项修复。**阶段 5 总结归档**（已进行部分验收关闭，余量汇入阶段 7）；**阶段 7 立项**：设计作业流续期与质量清偿，汇聚 O-1~O-12 + 迭代池 2 项，版本 0.30.x 起）

---

## 1. 阶段总览

| 阶段 | 时间 | DSH 基线 | 交付版本 | 测试基线 | 状态 |
|---|---|---|---|---|---|
| **阶段 0 · PoC 验证** | 2026-08 中旬前 | 0.1.2-alpha 系列 | 原型（未发行） | 无 | ✅ 已归档 |
| **阶段 1 · 核心功能开发**（Iter-1 ~ Iter-30 + Iter-SUBA） | 2026-08-26 ~ 09-05 | **0.1.1-rc.2** | host v0.20.1 / client v0.9.0 | 563 单测全绿 | ✅ 已完成并归档 |
| **阶段 2 · DSH 0.1.5-rc.2 迁移** | 2026-09-13（单日完成） | **0.1.5-rc.2** | host **v0.21.0** / client **v0.9.1** | 563 单测全绿 + GUI 回归通过 | ✅ 已完成并归档 |
| **阶段 3 · 构建链合并重构 + 发行工具 + 单包化** | 2026-09-14 ~ 09-15 | 0.1.5-rc.2 | **host v0.23.0 单包**（Host 插件 + 面板 bundle + preset 随包；client-ui-monitor 退役） | 567 单测全绿 + 真机冒烟 + GUI 验收 + **实物验收**（清除→tgz 重装→基本功能） | ✅ 已完成并归档 |
| **阶段 4 · 现有功能修复**（Iter-31 ~ 43） | 2026-09-16 ~ 09-20 | 0.1.5-rc.2（不变） | **host v0.26.50**（单包形态延续） | 602 单测全绿 | ✅ 已完成（13 个迭代全部验收关闭） |
| **阶段 5 · 设计作业流专项** | 2026-09-20 ~ 10-04 | 0.1.5-rc.2 → 0.2.0-rc.2 | host v0.27.1 | — | ✅ **总结归档**（Iter-44/45/46/46-2 验收关闭；sys-design 资产在 0.2.0 实证跑通；余量与遗留 → 阶段 7） |
| **阶段 6 · DSH 0.2.0-rc.2 迁移**（Mac 环境重建 + 版本迁移） | 2026-10-03 ~ 10-04 | 0.1.5-rc.2 → **0.2.0-rc.2** | **host v0.29.5**（0.28.x B1–B6 + 0.29.x MIG5~7 及验收修复） | **608 单测全绿** + 真机回归 + 终验全面功能验收 | ✅ **已完成并关闭**（Iter-MIG0~7；断裂 B1–B6 + 验收修复全闭环；见 `phases/phase-6-dsh-020-migration/`） |
| **阶段 7 · 设计作业流续期与质量清偿** | 待启动 | 0.2.0-rc.2 | host **0.30.x**（待首发） | — | 📋 **立项规划中**（汇聚阶段 5/6 遗留：O-1~O-12 + 迭代池 2 项；方案见 `phases/phase-7-dwf-continuation/README.md`，待用户确认排期） |

阶段详情与迭代索引：`phases/README.md`。

---

## 2. 当前系统形态（macOS / DSH 0.2.0-rc.2，已部署运行）

| 项 | 现状 |
|---|---|
| DSH | **0.2.0-rc.2**（dsh-cli 管理，`~/.local/share/dsh-cli/`，289 卫星包同版本；`DSH_HOME=~/.dsh-dev`） |
| 服务 | 终端手动 `dsh web`，Web 3080（loopback 围栏 + fs workspace-write 沙箱） |
| 部署形态 | web profile（`~/.dsh-dev/profiles/web/`）：`dsh plugin add` 自动注册 bundles；依赖指向 `file:release/*.tgz`（打包产物安装制） |
| preset | **随包声明**：`presets/workflow-orchestrator.patch.yml` 进 bundle patch 链（GUI 选择器可见，order 100） |
| 内建资产 | 启动时物化到 `~/.dsh-dev/workflow-agent/`（30 文件：docs/samples/skills/templates；node:fs 直写，B4） |
| 运行时插件 | `@workflow-agent/workflow-host` v0.28.7（Host CJS + 面板 + preset 单包）；插件私有写入走 `shared/fs-host.js` 直写 |
| GUI | orchestrator 会话 `conversation.view` 面板（DAG/四键/编辑/管理）正常；页签门控哨兵复活（B6） |

版本锁定明细见 `phases/phase-6-dsh-020-migration/iterations/iter-migration-020rc2-closeout-report.md` §2。

---

## 3. 当前与下一步：阶段 7 立项（📋 规划确认中）

> 阶段 6 已关闭（Iter-MIG0~7，v0.29.5，608 单测绿）；阶段 5 已总结归档。两者遗留全部汇入阶段 7。
> 立项方案：[`phases/phase-7-dwf-continuation/README.md`](phases/phase-7-dwf-continuation/README.md)（定位 / 遗留汇聚总表 / 迭代分组草案 G1~G5 / 版本 0.30.x）。

| 分组 | 内容 | 定位 |
|---|---|---|
| **G1 逐活动资产磨炼**（Iter-47~57） | 11 个设计活动逐个做实 skill + 门禁定义（现仅 init 真实）：每迭代=真实执行→门禁→验收，**同步产出该活动 templates 与 knowledge**（原资产组并入，用户拍板）；O-7 门禁语义边跑边修、序列尾集中收口；Iter-57 含全链贯通复跑；**随时可插入/调序**（硬约定） | **主线** |
| G2 UI 缺陷清偿 | O-4/O-5/O-6/O-11（+O-1 视觉） | 执行到时展开 |
| G3 校验与能力增强 | O-9/O-10/O-12（+O-8 讨论项） | 执行到时展开 |
| G4 安全与专项 | P-1 /wf/skill 围栏、P-2 权限矩阵 | 视 G1 暴露插入 |

**当前迭代**：Iter-47（req-clarify 活动做实 + 该活动模板/知识资源）——首个 G1 迭代，待启动方案。

### 阶段 6 归档索引（MIG0~7 全量）

| 文档 | 内容 |
|---|---|
| [`plan.md`](phases/phase-6-dsh-020-migration/plan.md) | 立项方案 + 决策 D1–D4 + 断裂初勘 + 收尾轮规划 §8 |
| [`iterations/dsh-0.2.0-rc-upgrade-impact-and-migration-plan.md`](phases/phase-6-dsh-020-migration/iterations/dsh-0.2.0-rc-upgrade-impact-and-migration-plan.md) | MIG0 影响评估（断裂映射 B1–B3 + 兼容确认 + prompt 证伪） |
| [`iterations/iter-migration-020rc2-report.md`](phases/phase-6-dsh-020-migration/iterations/iter-migration-020rc2-report.md) | MIG1 代码适配（B1–B3 + B4 追加轮） |
| [`iterations/iter-migration-020rc2-env-report.md`](phases/phase-6-dsh-020-migration/iterations/iter-migration-020rc2-env-report.md) | MIG2 环境重建（B4/B5 + install 流程双缺陷） |
| [`iterations/iter-migration-020rc2-regression-report.md`](phases/phase-6-dsh-020-migration/iterations/iter-migration-020rc2-regression-report.md) | MIG3 行为回归（B6 + 11 项回归矩阵） |
| [`iterations/iter-migration-020rc2-closeout-report.md`](phases/phase-6-dsh-020-migration/iterations/iter-migration-020rc2-closeout-report.md) | MIG4 收尾（版本锁定矩阵 + 断裂总账 B1–B6 + 移交项）——**收官结论已按用户修订作废，以 MIG5~7 关闭为准** |

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
