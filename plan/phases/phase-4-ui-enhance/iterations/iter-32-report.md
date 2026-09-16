# Iter-32 报告 — 验证测试资产与补验（verify-* 测试模板 + 校验样例）

- **状态**：🚧 资产交付与部署完成，**待补验执行**（用户 GUI 逐模板跑实例；结论回填后关闭）
- **阶段**：阶段 4（现有功能修复）
- **版本**：host `v0.24.0 → v0.25.0`（单包）
- **测试**：573 单测全绿（+6 条 verify-* 资产本体断言）+ 语义校验探针全过 + 发行内容断言通过
- **提交**：见 git log

## 1. 目标与范围

为验证清单遗留的补验项提供**预置测试工作流模板**（物化后进 GUI 模板下拉，可反复复用），
并以此执行补验；顺带覆盖其余「无法构造数据」项（文本创建/校验硬拦/警告类/空提取）。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 | 影响 |
|---|---|---|---|
| 1 | 补验独立成迭代 + 测试定义进预置目录（用户，09-16） | 独立 Iter-32；模板进 `builtin-assets/templates/` | 物化后 GUI 直接可选，验证可重复 |

**实施中的关键发现**：验证清单 C 组「分支条件 SKIPPED」**无法验证的真正原因是分支条件（precondition）尚未实现**——schema v1 中标注「后续迭代」，parser/engine 无 condition 字段；SKIPPED 现有真实路径仅两条：门禁 `on-failure: skip` 与循环节点 `break`。分支条件属新增能力 → 归入阶段 5 候选；本迭代模板改为覆盖已实现的 SKIPPED 路径。

## 3. 交付件（资产清单）

| # | 资产 | 覆盖验证项 |
|---|---|---|
| 1 | `templates/verify-gate/` | 门禁三变体：PASS→DONE(retry) / FAIL→SKIPPED(skip) / FAIL→阻断(block)；**Iter-34 门禁诊断直接复用** |
| 2 | `templates/verify-dir-vars/` | 四目录变量两阶段注入（${workspace}/${skills} 阶段1；${wf_dir}/${skill_dir} 阶段2） |
| 3 | `templates/verify-skill-shadow/` | 工作区 skills/ 同名覆盖预定义技能（两级链顶替） |
| 4 | `templates/verify-empty-items/` + `inputs/empty-list.txt` | items 空提取 → (0) 占位形态；下游任务放行 |
| 5 | `skills/never-pass/SKILL.md`（新探针技能，第 8 个预定义技能） | 门禁恒败探针，保证 FAIL 路径确定性 |
| 6 | `samples/validation-probe.sample.yaml` | 校验硬拦+警告同屏（E-DEP-CYCLE + E-PROCESSOR-MISSING + W-ITEMS-INPUT-DUP，探针实测码一致） |
| 7 | `samples/skill-shadow/data-prep/SKILL.md` | 影子副本（SHADOW-COPY 标记判定覆盖生效） |
| 8 | `code/scripts/test-host.js` | +6 条 c21 资产本体断言 |

## 4. 实施与验证过程（差分）

| 步骤 | 改动 | 验证 | 结果 |
|---|---|---|---|
| 1 | 4 模板 + 探针技能 + 2 样例编写 | 语义校验探针（parse + validateWorkflow，正确 fs 适配）：4 模板 E:0；样例报错码与预期逐一吻合 | ✅（首轮探针 E-SKILL-MISSING 为探针自身 fs 适配问题，修正后排除） |
| 2 | c21 +6 条资产本体断言 | `test-host.js` | 573 全绿 |
| 3 | 版本 v0.25.0 + `build-release.js` | 内容断言 7 项必含 + 版本矩阵 | ✅ |
| 4 | profile 清单指到 0.25.0 tgz + `pnpm install` | 部署核验：版本/4 verify 模板/never-pass/两样例全在位 | ✅ |

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 573 全绿 | c21 新增 6 断言全过 |
| 语义校验探针 | ✅ | 模板 E:0；探针样例 E-DEP-CYCLE, E-PROCESSOR-MISSING + W-ITEMS-INPUT-DUP |
| 发行与部署 | ✅ | v0.25.0 tgz 重装，资产在位核验通过 |
| **补验执行（GUI）** | ⏳ 待执行 | 清单见下方 §7；跑完回填结论后关闭本迭代 |

## 6. 问题与修复

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | 「分支条件 SKIPPED」无法构造数据 | 分支条件（precondition）**未实现**（schema 标注后续迭代），非操作问题 | 模板改覆盖已实现的 SKIPPED 路径（gate-skip / loop break）；分支条件列阶段 5 候选 |
| 2 | **空提取下游不放行（缺陷 #10，本迭代模板暴露的真引擎缺陷）**：empty-loop/empty 已 DONE，downstream（dependsOn: empty-loop）不入 runnable | 静态展开（begin 期 items 可解析）用迭代替换组任务、组锚点不存在 → 下游组 id 依赖悬空；`getRunnableTasks` 依赖判定为纯 id 匹配、无组解析。延迟展开路径有占位锚点不受影响——现有模板无「下游依赖循环组」用例，故首次由 verify-empty-items 暴露 | 引擎修复：`isDepSatisfied` 补组语义（依赖 id 无对应任务时，按组内全部迭代 DONE/SKIPPED 判定，FAILED 不放行）；用例 32 四场景（空提取/未全终态/FAILED/并发组）锁死；host v0.25.2 |

## 7. 补验执行清单（用户 GUI，重启 dsh 后）

| # | 操作 | 观察点 / 通过标准 | 对应清单项 |
|---|---|---|---|
| 1 | 模板下拉选 `verify-gate` 创建并启动 | 三个门禁任务各有独立 subagent 会话；gate-pass→DONE(G)、gate-skip→SKIPPED、gate-block→工作流 FAILED 含门禁理由；DAG 状态条 G 值正确 | 门禁链路（缺陷 #8 复跑前置） |
| 2 | 选 `verify-dir-vars` 创建并启动 | dir-vars-report 中四个 marker 路径均可达（无字面 ${xxx} 残留） | 目录变量全量 |
| 3 | 按 verify-skill-shadow 头注释复制影子副本 → 跑模板 | shadow-probe 输出首行含 SHADOW-COPY；删除副本后重跑恢复预定义版 | 技能工作区覆盖 |
| 4 | 选 `verify-empty-items` 创建并启动 | 空提取循环呈占位 (0)；downstream 正常 DONE | items 空提取 |
| 5 | `samples/validation-probe.sample.yaml` 全文粘贴到创建弹窗文本创建 | 硬拦：E-DEP-CYCLE / E-PROCESSOR-MISSING 结构化清单；W-ITEMS-INPUT-DUP 警告同屏 | 文本创建 / 校验硬拦 / 警告类 |
| 6 | GUI 删除一个绑定实例的会话 | 实例解绑回池（或先停后解绑），/wf/list 可见 | 会话删除解绑 |

### 7.1 补验结果回填（2026-09-16，用户执行）

| # | 结果 | 说明 |
|---|---|---|
| 1 verify-gate | ✅ 链路通 | never-pass 探针被真实派发（用户观察到并询问）= 门禁 checker 独立会话执行的直接证据；三变体处置表现待用户确认细节（gate-pass PASS / gate-skip SKIPPED / gate-block 阻断） |
| 2 verify-dir-vars | ✅ 已跑 | 用户未报异常 |
| 3 verify-skill-shadow | ⏸ 未完成 | 工作区无同名技能——**需手动复制影子副本**（samples/skill-shadow/data-prep/SKILL.md → `<工作区>/skills/data-prep/SKILL.md`）后再跑；覆盖判定=比对放副本前后产出首行 SHADOW-COPY 标记 |
| 4 verify-empty-items | ✅ 已跑（观察=设计行为） | 空列表仍派发 1 个占位迭代（「（items 为空）」）并产出文件——**这正是阶段 1 Q1-b 拍板的设计**（「正常派发，skill 识别空 items」），本报告 §7-4 原预期「零派发」写错；「是否改为零提取不派发」作为设计决策点提交用户（见 §8） |
| 5 校验样例粘贴 | ⏳ 待执行 | |
| 6 删除绑定会话 | ✅ 回收正确 + **连带发现严重缺陷 #9** | 删除会话 → 该实例解绑回池正确；但发现管理列表中其他实例显示「未绑定」→ 根因=`isSessionLive` 用 `sessions.get`（驻留语义），重启/关会话后「存在但未打开」会话的实例被孤儿回收批量误解绑（实证 dsh_wf_ws 14 实例 13 个 sessionId 被清）→ **归 Iter-33 修复**（plan.md 分诊 #9） |

**UI 呈现问题（用户裁定归后续 UI 迭代）**：U1 门禁角点执行后消失 → Iter-39；U2 模板下拉只显说明 → Iter-36。

## 8. 遗留与后续

| 遗留 | 去向 |
|---|---|
| 分支条件（precondition）实现 | 阶段 5 候选（新能力） |
| 孤儿回收误判（补验发现 #9，严重） | Iter-33 |
| 空提取派发（Q1-b）维持，item-processor 空 items 文案已对齐引擎占位值（v0.25.1，用户拍板「只改技能文案」） | 已落实 |
| 缺陷 #3~#8 | Iter-33 ~ 38（plan.md 队列） |
| 根 README「4 模板 + 7 技能」计数过时 | 阶段 4 收尾统一修订（现 8 模板 + 8 技能） |

## 9. 参考

- 设计：`plan/phases/phase-4-ui-enhance/plan.md`（v6 §4 Iter-32 详案）
- 验证输入：`verification-checklist.md`（C 组无法验证项 + 问题清单）
