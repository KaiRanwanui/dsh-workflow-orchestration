# Iter-36 设计 — 编辑器表单补全（字段矩阵 + U2 + 配色 + 校验增强）

- **阶段**：阶段 4（现有功能修复/补全）
- **日期**：2026-09-17
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.26.8` → 发行时阶段内第三格顺延（不预设）
- **状态**：**待用户确认后编码**（§A6）

---

## 1. 背景与目标

编辑器表单（Iter-28）字段覆盖不全：任务级仅 processor/inputs/outputs/gateChecker/retries/并发——**depends-on、timeout、quality-gate 的 on-failure/max-retries、loop/concurrent 组字段（items-from/item-var/items-format/组级并发/on-error）全部缺失**（改这些只能进源码态）；另有 U2（模板下拉只显说明）、下拉配色缺陷（未选中项字色=背景色）。本迭代按「可执行期编辑属性全量可编辑 + 全部属性呈现」补齐。

**做完后达成什么**：表单态覆盖 schema 全部可执行期字段（按任务类型分区渲染）；模板下拉显示「名称 + 说明」；所有下拉未选中项文字可见；配置矛盾（max-retries 配在非 retry 模式）在保存时出 W 级警告。

**不做什么**：任务 type 变更（类型转换复杂，换类型走源码态）；params 编辑（Iter-37）；precondition（schema 标注未实现）；YAML 着色。

## 2. 字段矩阵（本迭代的验收基准）

| 字段 | 现状 | Iter-36 后 |
|---|---|---|
| processor / gateChecker | 可编辑（下拉） | 保持 + option 显式配色 |
| inputs / outputs / retries(=max-retries) | 可编辑 | 保持 |
| max-concurrency（工作流级） | 可编辑 | 保持 |
| **depends-on** | ✗ 无 | **可编辑**（逗号分隔单行，同 outputs 风格；服务端校验引用存在性/环依赖由语义关口兜底） |
| **timeout** | ✗ 无 | **可编辑**（数字，秒） |
| **quality-gate.on-failure** | ✗ 无（仅 checker） | **可编辑**（下拉 retry/block/skip） |
| **loop/concurrent：items-from / item-var / items-format / 组级 max-concurrency / on-error** | ✗ 无 | **可编辑**（仅 type=loop/concurrent 任务显示该分区） |
| id / type | 表单未显式展示 | **只读呈现** |
| 运行态字段（status / gateResult / gateNote / _loopItem / 组名 / retries 已用计数） | ✗ | **只读呈现**（有值才显示，来自 state 对齐） |
| **U2 模板下拉** | 只显 description | 显示「名称 — 说明」 |
| **下拉 option 配色** | 编辑器下拉未修 | 全部 select option 显式配色（对齐 Iter-30 修法） |

## 3. 改动面

| # | 交付件 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET 任务映射扩展 | `webserver-routes.js` | /wf/instance-yaml tasks 补 dependsOn/timeout/itemVar/itemsFormat/onError/gateOnFailure（已有）/gateMaxRetries（已有 retries 语义区分：改名为 maxRetries 并保留 retries=已用计数）、prompt/agent/command（human/external 类型只读呈现） |
| 2 | patch 白名单扩展 | `code/shared/workflow-edit.js` | applyInstancePatch 支持上列可编辑字段（含类型/值校验：timeout 正整数、on-failure 枚举、items-from 非空、依赖引用存在性、definition 权限门控沿用） |
| 3 | 表单分区渲染 | `src/client.js` | 任务表单按 type 分区：llm-task（基础+依赖+超时+门禁）/ loop·concurrent（组字段分区）/ human·external（只读属性呈现）；全部 select option 显式配色 |
| 4 | 校验增强 | `code/shared/workflow-validate.js` | 新增 **W-GATE-RETRY-MISMATCH**：max-retries>0 且 on-failure≠retry → W 级警告（保存不阻断） |
| 5 | U2 模板下拉 | `src/client.js` | label = `[模板] 名称 — 说明` |
| 6 | 迭代报告 | `iterations/iter-36-report.md` | |

## 4. 执行顺序与差分验证

| 步骤 | 改动 | 验证 | 通过标准 |
|---|---|---|---|
| 1 | 校验增强 W-GATE-RETRY-MISMATCH | 单测（配对/错配两态） | 断言全绿 |
| 2 | GET 映射 + patch 白名单扩展 | 单测（新字段 round-trip：patch → GET 回读一致；禁改字段 deny） | 断言全绿 |
| 3 | 表单分区渲染 + option 配色 + U2 | 构建 + verify-client-bundle + 手动 | §2 矩阵逐项核对 |
| 4 | 全量单测 + 发行重装 | `test-host.js` | 完成线 |
| 5 | 真机验收（用户）+ 报告 | GUI | §5 |

## 5. 验证标准（完成线）

- [ ] 单测全绿（预计 588 → ~600：W 警告两态、新字段 round-trip、deny 守卫）
- [ ] 产物级：bundle + 发行内容断言
- [ ] 真机：①loop 任务表单可配 items-from/item-var/format/组并发/on-error ②quality-gate on-failure/max-retries 可编辑且错误配置出 W 警告 ③depends-on/timeout 编辑生效 ④只读区呈现运行态字段 ⑤模板下拉「名称—说明」⑥下拉未选中项文字可见
- [ ] 文档：报告归档；status.md 刷新

## 6. 决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | depends-on 编辑形态 | a) 逗号分隔单行（同 outputs 风格） b) 行编辑器（KvEditor 变体） | **a**（一致性与实现成本） |
| 2 | max-retries W 警告 | a) 本迭代加（W-GATE-RETRY-MISMATCH） b) 延后 Iter-37 | **a**（正是 4423b98e 验证混淆的预防） |
| 3 | 任务 type | a) 只读（换类型走源码态） b) 可改下拉 | **a**（类型转换涉及字段结构变化，风险大） |

## 7. 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| patch 白名单扩展破坏既有保存 | 既有字段断言不动，新增字段独立断言 | 白名单回退（新增字段改动集中） |
| loop 组字段编辑与运行态冲突（RUNNING 改 items-from） | 沿用权限矩阵：definition=false 时全部禁改（服务端 deny） | — |
| 新 W 警告对既有实例产生噪音 | 仅 max-retries>0 且 on-failure≠retry 才触发；存量误配本就该提示 | 警告降级为不实现 |

## 8. 工作量估计

**约 1~1.25 人天**：白名单/映射 0.4 + 表单分区 0.4 + W 警告 0.15 + U2/配色 0.15 + 验收报告 0.25。
