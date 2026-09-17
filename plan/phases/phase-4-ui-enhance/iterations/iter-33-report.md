# Iter-33 报告 — 实例完整性与采纳关口

- **状态**：🚧 编码与单测完成，v0.26.0 已发行部署，**待用户真机验收**（四项）
- **阶段**：阶段 4（现有功能修复）
- **版本**：host `v0.25.2 → v0.26.0`（单包）
- **测试**：581 单测全绿（+用例 33 孤儿判定对照 3 断言；c32/c21 等既有断言无回归）+ 产物级验证通过
- **提交**：见 git log

## 1. 目标与范围

修复验证期发现的三个实例生命周期缺陷 + 落实采纳关口拍板（D4）：#9 孤儿回收误判（严重）、#11 面板 reset 展开缺上下文、#3 CREATED 实例明示与清理出口、采纳关口校验。**范围外**：#8 门禁（Iter-34）、编辑器项（Iter-35+）。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 | 影响 |
|---|---|---|---|
| 1 | 采纳校验时机 | 仅 adopt 点击时全量校验；池内轻量标注 | 轮询无语义校验开销 |
| 2 | CREATED 但定义完整的实例 | 允许采纳（判定基准是可用性而非 phase） | 采纳关口按完整性判定 |
| 3 | reset 的 inputs 语义 | **恢复模板初始态**（有 defDir 时清空并从模板恢复；inline 实例仅清 output/logs） | pendingCleanup 契约扩展 |
| 4 | 批量回收保守闸 | **取消**（用户：事后诸葛亮）；改对照测试确保判定正确 | 用例 33 两集合 mock |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `code/plugins/workflow-host/apply-prologue.js` | 新增 `sessionExists(sid)`（驻留快路径 + `sessionQuery.listSessions()` 成员资格；不可用/异常保守返回 true）注入注册表；#9 探针注释 |
| `code/plugins/workflow-host/instance-store.js` | `scanOrphans`/`recoverOrphan` 孤儿判定改 `sessionExists`（缺省 true=保守不回收）；`archiveInstance` 门禁追加 CREATED |
| `code/plugins/workflow-host/webserver-routes.js` | ① reset 路由展开换完整上下文（wfDir/defDir/workspaceRoot + finalizeDataflow + inputs 物化；简化版 helper 删除）② pendingCleanup 契约扩展：清 inputs + 有模板来源时 `cp -R` 恢复初始 inputs ③ adopt 动作前置可用性校验（400 + 结构化 errors）④ 池内 CREATED 轻量标注「已创建未启动（采纳时校验完整性）」 |
| `code/packages/workflow-host/src/client.js` | 绑定实例 phase=CREATED 时 DAG 区显示状态卡（已创建未启动 + Start/归档引导），替代永久 "Waiting for workflow..." |
| `code/scripts/test-host.js` | 新增用例 33（孤儿判定对照：存在未驻留→不回收 / 已删除→回收 / 回收解绑）；三处 mock 补 `sessionExists`（与 live 集合对齐保持旧语义） |

## 4. 探针结论（详见 `iterations/iter-33-probe.md`）

`sessions.get/list` 均为 live（驻留）语义，无法回答「存在但未驻留」；**`sessionQuery.listSessions()`**（web profile 经 session-query-sqlite 挂载，官方 api-session-controller 同款消费）覆盖持久化会话 → 存在性判定采用之，降级路径保守不回收。

## 5. 实施与验证过程（差分）

| 步骤 | 改动 | 验证 | 结果 |
|---|---|---|---|
| 0 | 探针 sessions 存在性 API | 实包 types + 官方消费者交叉验证 | ✅ sessionQuery.listSessions |
| 1 | #11 reset 展开修复 | 首跑暴露跨段可见性误判（嵌套函数不可见）→ 改段级原语等价实现 | ✅ S4 reset 两断言恢复全绿 |
| 2 | #9 孤儿回收修复 | 用例 33 三断言 + 既有孤儿用例 mock 对齐 | ✅ |
| 3 | 采纳关口校验 | 复用段级原语等价实现（同 #11 教训，预先规避同类可见性问题） | ✅ 全绿 |
| 4 | CREATED 明示 + archive 放开 | 构建 + verify-client-bundle | ✅ |
| 5 | 全量单测 | `test-host.js` | **581 全绿** |

## 6. 问题与修复

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 首跑 S4/R2 用例失败：`expandInstanceDefinition is not defined` | 该函数嵌套于 tools-preset 子作用域（2 缩进），跨段不可见——与 `expandDefinition`（0 缩进段级）不同；方案期「跨段可见有先例」的判断对嵌套函数不成立 | reset/adopt 两处均改为**段级原语等价实现**（所需符号 expandDefinition/finalizeDataflow/materializeInputsIntoInstance/E_presetTemplateDirOf/detectPredefinedRootSafe/E_parseWorkflow/E_validateWorkflow/E_formatValidationItem 均经缩进核实为段级） |

## 7. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 581 全绿 | 用例 33：存在未驻留→不回收（#9 回归）/ 已删除→回收 / 回收解绑 |
| 产物级 | ✅ | bundle 求值三断言 + 发行内容断言（v0.26.0） |
| 真机 ①绑定保持 | ⏳ 待验收 | 重启 dsh 后：其他会话绑定实例**不再**被解绑（管理列表不再批量「未绑定」） |
| 真机 ②面板 Reset | ⏳ 待验收 | verify-empty-items 实例 Reset 成功、停留 PENDING；inputs 恢复模板初始态（无历史物化残留） |
| 真机 ③采纳关口 | ⏳ 待验收 | 构造不完整实例（如删实例 inputs 文件）→ 采纳被拒 + 结构化原因 |
| 真机 ④CREATED 明示 | ⏳ 待验收 | CREATED 实例面板显示状态卡（非永久 Waiting）；可归档清理 |

## 8. 遗留与后续

| 遗留 | 去向 |
|---|---|
| 被误解绑实例的修复（历史 13 个 sessionId=null 的实例需重新采用或归档） | 用户操作（Iter-33 后不再复发） |
| #8 门禁诊断（Iter-34，复用 verify-gate） | 下一迭代 |
| U1/U2 UI 缺陷 | Iter-39 / Iter-36 |

## 9. 参考

- 设计：`iter-33-design.md`；探针：`iterations/iter-33-probe.md`
- 来源：验证缺陷 #3/#9/#11 + 用户 D4 拍板
