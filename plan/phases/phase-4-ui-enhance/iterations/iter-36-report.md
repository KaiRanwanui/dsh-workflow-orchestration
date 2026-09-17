# Iter-36 报告 — 编辑器表单补全（字段矩阵 + U2 + 配色 + 校验增强）

- **状态**：🚧 编码与单测完成，v0.26.9 已发行部署，**待用户真机验收**
- **阶段**：阶段 4（现有功能修复/补全）
- **版本**：host `v0.26.8 → v0.26.9`（阶段内第三格顺延；单包）
- **测试**：595 单测全绿（+W 警告两态 2 断言、edit36 新字段 round-trip/deny 4 断言）+ 产物级验证通过
- **提交**：见 git log

## 1. 目标与范围

编辑器表单（Iter-28）字段覆盖补全至 schema 可执行期全字段 + U2 + 下拉配色 + 校验增强（W-GATE-RETRY-MISMATCH）。**不做什么**：任务 type 变更（走源码态）、params 编辑（Iter-37）、precondition（未实现）、YAML 着色。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | depends-on 编辑形态 | 逗号分隔单行（同 outputs 风格）；自引用/空串由服务端拒绝/清除 |
| 2 | max-retries W 警告 | 本迭代加（W-GATE-RETRY-MISMATCH）——4423b98e 验证混淆的预防 |
| 3 | 任务 type | 只读（换类型走源码态） |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `code/shared/workflow-edit.js` | applyInstancePatch 白名单扩展：`dependsOn`（数组，自引用拒绝，[]/null 清除）、`timeout`（>=1 整数或 null 删除）、`gateOnFailure`（枚举 retry/block/skip，'' 清除，写 gate 壳 on-failure）、组字段 `itemsFrom/itemVar/itemsFormat`（仅 loop/concurrent，非组任务 → E-EDIT-TYPE；items-format 枚举校验）、`onError`（仅 loop，枚举 break/continue）——全部 definition 权限门控沿用 |
| `code/shared/workflow-validate.js` | 新增 **W-GATE-RETRY-MISMATCH**：gateRaw 存在且 max-retries>0 且 on-failure≠retry → W 级警告 |
| `code/plugins/workflow-host/webserver-routes.js` | GET /wf/instance-yaml 任务映射补：dependsOn/timeout/itemVar/itemsFormat/onError + 运行态只读字段（runGateResult/runGateNote/runLoopItem/runLoopGroupName，state 对齐） |
| `code/packages/workflow-host/src/client.js` | ①任务表单分区：基础区（processor/depends-on/timeout/inputs/outputs/gateChecker+on-failure+retries）+ 组字段分区（仅 loop/concurrent：items-from/item-var/items-format/on-error/组并发）②运行态只读行 ③mkEnumSelect 助手 + 全部 select option 显式配色（对齐 Iter-30 修法）④U2：创建弹窗模板下拉 label=「[模板] 名称 — 说明」 |
| `builtin-assets/templates/verify-gate/verify-gate.yaml` | gate-skip 变体清除无效 max-retries（skip 模式下无意义，W 警告会提示） |

## 4. 实施与验证过程（差分）

| 步骤 | 改动 | 验证 | 结果 |
|---|---|---|---|
| 1 | W 警告（validate 层） | 单测两态：skip+maxRetries2 → W 命中；retry+maxRetries2 → 无 W | ✅ |
| 2 | GET 映射 + patch 白名单扩展 | edit36 四断言（保存 200/GET 回读/自引用拒绝/E-EDIT-TYPE） | ✅ 首跑即绿 |
| 3 | 表单分区渲染 + 配色 + U2 | 构建 + verify-client-bundle | ✅ |
| 4 | 全量单测 | `test-host.js` | **595 全绿** |

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 595 全绿 | W 两态 + edit36 四断言 + 全部既有断言无回归 |
| 产物级 | ✅ | bundle 求值三断言 + 发行内容断言（v0.26.9） |
| 真机（用户 GUI） | ⏳ 待验收 | §7 五组 |

## 7. 真机验收清单（用户 GUI，刷新页面即可——仅 Client/校验层，Host 路由无变化）

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | loop 任务表单 | 组字段分区显示：items-from/item-var/items-format 下拉/on-error 下拉（仅 loop）/组并发；编辑保存后重进回显一致 |
| 2 | llm-task 表单 | 无组字段分区；depends-on（逗号分隔）/timeout 可编辑；保存后重进回显 |
| 3 | gateChecker 非空任务 | on-failure 下拉（retry/block/skip）出现；选择与 max-retries(retries) 组合保存生效 |
| 4 | 配置 skip/block + max-retries>0 → 保存 | W-GATE-RETRY-MISMATCH 警告同屏（不阻断） |
| 5 | 全部下拉展开 | 未选中项文字可见（配色修复） |
| 6 | 创建弹窗模板下拉 | label 显示「[模板] 名称 — 说明」 |
| 7 | 只读行 | 有运行态的任务显示 状态/门禁结果/结论摘要/迭代条目 |

## 8. 遗留与后续

| 遗留 | 去向 |
|---|---|
| params 编辑 | Iter-37 |
| U1 门禁角点 | Iter-39 |
| precondition（schema 未实现） | 阶段 5 候选 |

## 9. 参考

- 设计：`iter-36-design.md`（字段矩阵 §2）
- 来源：改进项「完整可执行期编辑属性」+ 分诊 #5/#6/U2 + 4423b98e 混淆预防（W 警告）

## 10. 补记：技能查看路径解析修正（v0.26.10，2026-09-17）

用户复验反馈：processor/gateChecker「查看」仍失败——传入的是工作区 skills 相对路径，而 never-pass 等技能实际在预定义物化目录（~/.dsh/workflow-agent/skills/）。修正：openSkillView 优先用 /wf/skills 列表项自带的绝对路径 path（两级链已裁决：工作区顶替→生效工作区副本；预定义→物化目录），列表未命中再回退 workspaceRoot 拼接（覆盖历史实例「当前值不在列表」场景）。

另答用户问：loop/concurrent 任务配置 quality-gate = **每个迭代独立执行门禁**（schema 明确；tools-preset 逐迭代复制 gate「同一 checker，独立执行」）——每个迭代完成后先走自己的 checker 子会话、PASS 才算该迭代 DONE；组级聚合仅做「全部迭代终态」判定放行下游。FAIL 处置（retry/skip/block）为迭代粒度。
