# Iter-34 设计 — 门禁真实执行（缺陷 #8 闭环）

- **阶段**：阶段 4（现有功能修复）
- **日期**：2026-09-17
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.26.2` → **v0.27.0**（门禁执行语义变更，minor）
- **状态**：**待用户确认后编码**（§A6）

---

## 1. 诊断结论（2026-09-17 静态诊断 + Iter-32 补验证据）

| 事实 | 证据 |
|---|---|
| 门禁**执行链路已实证可用** | Iter-32 补验：verify-gate 模板跑实例，never-pass checker 被真实派发到独立 subagent（用户亲眼确认） |
| 解析层完好 | verify-gate.yaml 的 quality-gate（checker/onFailure/maxRetries）parse 提取逐一正确（本日探针） |
| **现役 + 归档实例中不存在任何含 gate 配置的实例状态** | 两工作区 instances/ 与 archive/ 全量扫描 state.json，零命中 gate 字段 |
| 结论 | **#8「gateChecker 未执行」的最可能根因 = 用户当时实例的定义中没有（或丢失了）quality-gate 配置**，而非执行链缺陷；原始实例已不可考。同时暴露结构性风险：门禁执行依赖编排 Agent「记得走」，无任何机制兜底 |

## 2. 目标与方案（三层保障，防止「Agent 忘了走门禁」再次静默发生）

| 层 | 内容 | 改动位置 |
|---|---|---|
| **L1 可见性** | `workflow_begin` / `workflow_status` 返回增加 **`pendingGates`** 摘要：列出「配置了 gate 且尚无 gateResult」的任务（id / checker / onFailure / maxRetries），Agent 与用户都能直接看到待执行门禁 | `tools-preset.js`（begin/status 返回构造） |
| **L2 引擎软强制** | `updateTask` 对「有 gate 且 gateResult 为空」的任务**拒绝直接置 DONE**，返回结构化错误：「该任务配置了门禁（checker=…），须先派发 checker 子会话执行，并以 workflow_status(task, taskStatus: DONE, gateResult: PASS) 上报；门禁失败按 onFailure 处置（retry 携带失败理由 / block / skip）」——把「忘了走门禁」从静默错误变成硬错误 | `engine.js`（updateTask 守卫） |
| **L3 persona 强化** | §5 质量门禁补两句：①「任务标 DONE 前置条件=门禁已出结果（引擎会拒绝无 gateResult 的 DONE）」②「FAIL 重试派发时，必须在子会话 prompt 中携带上轮 gate 失败理由」 | `system-prompt.md` |

**FAIL→retry 反馈语义补全**（既有 schema：gate.maxRetries/onFailure）：重试计数已达上限仍 FAIL → 按 onFailure 收敛（block→FAILED 上报 / skip→SKIPPED）；重试派发携带失败理由。

## 3. 执行顺序与差分验证

| 步骤 | 改动 | 验证 | 通过标准 |
|---|---|---|---|
| 1 | L2 引擎软强制 + 单测（用例 34：无 gate 直接过 / 有 gate 无 gateResult 拒+错误文案 / gateResult=PASS 过 / gateResult=FAIL+skip → SKIPPED） | `test-host.js` | 四态断言全绿 |
| 2 | L1 pendingGates 摘要 | 单测（begin 后有 gate 任务列入；gateResult 出现后移出） | 断言全绿 |
| 3 | L3 persona 强化 | 文案评审（用户） + 真机 | persona 部署后 verify-gate 全链路复跑 |
| 4 | 真机验收（用户 GUI）：跑 verify-gate → 观察故意漏报 DONE 时引擎拒绝 + pendingGates 可见 + 三变体处置正确 | 用户 | §5 完成线 |
| 5 | v0.27.0 发行重装 + 报告归档 | 内容断言 | — |

## 4. 验证标准（完成线）

- [ ] 单测全绿（578→~586：用例 34 四态 + pendingGates 两断言）
- [ ] 真机（用户）：①正常链路 gate-pass→DONE(PASS)、gate-skip→SKIPPED、gate-block→FAILED ②故意直接标 DONE → 引擎拒绝且错误文案指引正确 ③FAIL 重试携带失败理由
- [ ] 文档：报告归档；status.md 刷新

## 5. 决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 门禁强制层级 | a) **引擎软强制**（无 gateResult 拒绝 DONE，错误文案指引正确路径） b) 仅 pendingGates 提示 + persona 强化（不拒绝） | **a**（唯一能杜绝静默跳过的层级；错误文案即指引，不会卡死——Agent 按 persona 必然知道怎么走） |
| 2 | 旧实例兼容 | a) 软强制对所有含 gate 实例生效 b) 仅新创建实例生效 | **a**（含 gate 的旧实例同样应正确走门禁） |

## 6. 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| 软强制导致 Agent 反复被拒不收敛 | 错误文案即完整操作指引；persona §5 同步强化；verify-gate 真机先行验证收敛性 | 降级为 L1+L3（仅提示） |
| pendingGates 每轮返回增大 payload | 仅列未出结果任务，量级小 | — |

## 7. 工作量估计

**约 1 人天**：L2 引擎守卫 + 用例 0.5 · L1 摘要 0.25 · L3 persona 0.1 · 真机验收与报告 0.25。
