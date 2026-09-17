# Iter-34 报告 — 门禁真实执行（缺陷 #8 闭环）

- **状态**：🚧 编码与单测完成，v0.26.3 已发行部署（含 preset persona 同步），**待用户真机验收**
- **阶段**：阶段 4（现有功能修复）
- **版本**：host `v0.26.2 → v0.26.3`（阶段内第三格顺延；门禁执行语义变更）
- **测试**：588 单测全绿（+用例 34 门禁软强制/pendingGates 6 断言；2 处既有模拟修正为携带 gateResult 的正确门禁流程）
- **提交**：见 git log

## 1. 诊断结论（迭代前置静态诊断）

| 事实 | 证据 |
|---|---|
| 门禁执行链路已实证可用 | Iter-32 补验：verify-gate 模板实例中 never-pass checker 被真实派发独立 subagent |
| 解析层完好 | verify-gate.yaml quality-gate 三字段逐一正确提取 |
| 现役 + 归档实例**零** gate 配置 | 两工作区 instances/ + archive/ 全量 state.json 扫描零命中 |
| **结论** | #8 根因 = 用户当时实例定义中无（或丢失了）quality-gate 配置（最可能渠道：编辑器无 gate 字段，Iter-36），执行链本身无缺陷；但暴露结构性风险——门禁执行仅依赖编排 Agent「记得走」，无兜底 |

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 | 影响 |
|---|---|---|---|
| 1 | 强制层级 | **引擎软强制**：「gateChecker 一旦设置必须强制执行；工作流未定义门禁技能则不检查」 | updateTask 守卫：有 gate 无 gateResult 标 DONE → 拒绝 + 指引文案 |
| 2 | 验收效果（用户定义） | ① 有 gateChecker 的任务必须独立 subagent 执行门禁并产生检查结果 ② 检查不通过 → 任务重执行，**检查结果作为输入驱动修正** ③ retry 耗尽仍不通过 → 任务 FAILED；每次 retry 的检查结果=上轮门禁输出 | gateNote 机制 + persona 反馈链 |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `code/plugins/workflow-host/engine.js` | ① updateTask 门禁软强制：有 gate 且无 gateResult 标 DONE → throw 结构化指引（正确路径三步 + FAIL 按 onFailure 处置）；gateResult=FAIL 标 DONE → throw 指引（retry 回 RUNNING 附 gateNote / block→FAILED / skip→SKIPPED）② updateTask 支持 `gateNote` 字段留存快照 ③ snapshot 新增 **`pendingGates`** 摘要（有 gate 未出结果、非终态任务清单）④ taskSnapshot 补 gateNote |
| `code/plugins/workflow-host-preset/tools-preset.js` | workflow_status：schema 增加 `gateNote` 参数；**per-task gateResult 接通**（此前工具层未把 gateResult 传入单任务 patch，任务级门禁结果恒空——本次顺带修正的关键缺口） |
| `code/agent-presets/workflow-orchestrator/system-prompt.md` | §5 质量门禁重写：pendingGates 先看、DONE 前置=gateResult、gateNote 必填、FAIL 重试派发必须附失败理由与修正要求、retry 耗尽→FAILED |
| `code/packages/workflow-host/package.json` | v0.25.2 → **v0.26.3** |
| `code/scripts/test-host.js` | 新增用例 34（6 断言）；修正 2 处既有模拟（gated 任务 DONE 携带 gateResult，符合新门禁语义） |

## 4. 实施与验证过程（差分）

| 步骤 | 改动 | 验证 | 结果 |
|---|---|---|---|
| 1 | L2 引擎软强制 | 首跑暴露 2 处既有测试模拟未带 gateResult（被新守卫正确拦截）→ 修正模拟为正确门禁流程 | ✅ 守卫按设计生效 |
| 2 | L1 pendingGates | 用例 34 场景 2/4 | ✅ 列出/清空 |
| 3 | per-task gateResult 接通 | 场景 3/4（PASS 同批放行、FAIL 拒绝） | ✅ |
| 4 | L3 persona 强化 | 文案随 preset 重部署（与源 diff 一致） | ✅ |
| 5 | 全量单测 | `test-host.js` | **588 全绿** |

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 588 全绿 | 用例 34 六断言：无门禁放行 / 无 gateResult 拒+指引 / pendingGates / FAIL 拒+处置指引 / SKIPPED+gateNote 留存 / PASS 同批放行 |
| 产物级 | ✅ | bundle + 发行内容断言（v0.26.3） |
| preset 同步 | ✅ | 部署副本与源 diff 一致 |
| 真机（用户 GUI） | ⏳ 待验收 | 见 §7 三条效果验收 |

## 6. 问题与修复

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 方案期判断「expandInstanceDefinition 跨段可见」，本轮同型函数 `validateInstanceEntry` 被预判规避；首跑实际暴露的是 2 处既有测试模拟未带 gateResult 被新守卫拦截 | 守卫按设计生效 | 测试模拟修正为正确门禁流程（附带强化了 2 条断言） |
| 2 | 工具层 per-task gateResult 从未接通（历史缺口，本次顺带修复） | statusTool 此前只把 gateResult 写全局、未传入单任务 patch | updateTask patch 接通 gateResult/gateNote |

## 7. 真机验收清单（用户 GUI，重启 dsh + preset 已重部署后）

| # | 效果（用户定义） | 操作 | 通过标准 |
|---|---|---|---|
| 1 | 有 gateChecker 必须独立 subagent 执行门禁并产生检查结果 | 跑 verify-gate 模板 | 三任务门禁各有独立子会话、产出检查结论；gate-pass→DONE(PASS)、gate-skip→SKIPPED、gate-block→FAILED |
| 2 | 检查不通过 → 重执行任务，检查结果作为输入驱动修正 | 观察 gate-skip（retry 变体可临时改 verify-gate 的 gate-skip 为 retry）或构造 retry 场景 | 重派发的任务子会话 prompt 中可见上轮 gateNote 失败理由与修正要求 |
| 3 | retry 耗尽仍不通过 → 任务 FAILED | maxRetries 用尽后继续 FAIL | 任务置 FAILED，工作流按 block 上报门禁理由 |
| 附加 | 软强制护栏 | （可选）让 Agent 故意直接标 gated 任务 DONE | 引擎拒绝且错误文案含正确路径指引；Agent 按指引收敛 |

## 8. 遗留与后续

| 遗留 | 去向 |
|---|---|
| 编辑器 quality-gate 字段缺失（#8 最可能根因） | Iter-36 表单补全（含 U2） |
| gate-block 变体导致工作流 FAILED 后的续跑体验 | 用户验证反馈后评估 |

## 9. 参考

- 设计：`iter-34-design.md`；诊断：§1（静态诊断 + Iter-32 verify-gate 证据）
