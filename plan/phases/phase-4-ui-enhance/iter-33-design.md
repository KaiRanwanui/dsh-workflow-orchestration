# Iter-33 设计 — 实例完整性与采纳关口

- **阶段**：阶段 4（现有功能修复）
- **日期**：2026-09-16
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.25.2` → **v0.26.0**（新增校验能力 + 行为修复，minor）
- **来源**：验证缺陷 #3（44d0d90b 卡死）、#9（孤儿回收误判，严重）、#11（面板 reset 展开缺上下文）+ 用户 D4 拍板（采纳关口）
- **状态**：**待用户确认后编码**（§A6）

---

## 1. 背景与目标

三个已定位的实例生命周期缺陷，主题统一为「实例完整性」：

| # | 问题 | 根因（已代码定位） |
|---|---|---|
| #9（严重） | 重启/关会话后，存活会话绑定的实例被**批量误解绑**（dsh_wf_ws 实证 14 实例 13 个 sessionId 被清） | `isSessionLive = !!sessions.get(sid)`——`sessions.get` 是**驻留**语义（未打开 ≠ 删除）；`scanOrphans` 每轮 `/wf/list` 触发误回收 |
| #11 | 面板 reset 报 `cannot read "~/.dsh/workflow-agent/inputs/empty-list.txt"` | reset 路由用简化版 `expandInstanceDef`（缺 wfDir/defDir/workspaceRoot + finalizeDataflow + inputs 物化），静态引用退化到预定义根 |
| #3 | CREATED 实例面板永久 "Waiting for workflow..."、无逃生口 | 面板 `hasData=false` 恒 Waiting；archive 门禁不含 CREATED |

**做完后达成什么**：重启/关会话不再丢绑定；面板 Reset 对任何合法实例都成功；不完整实例无法被采纳（有明确原因）；CREATED 实例有明确状态展示与清理出口。

**不做什么**：实例删除能力（保持仅归档路线）；#8 门禁（Iter-34）；其余编辑器项（Iter-35+）。

## 2. 交付件

| # | 交付件 | 路径 | 说明 |
|---|---|---|---|
| 1 | 探针报告：sessions 服务「存在性」API | `iterations/iter-33-probe.md` | 确认 Host 侧判定「会话存在（持久化）vs 已删除」的可用 API 与返回形态 |
| 2 | 孤儿回收误判修复（#9） | `apply-prologue.js`（isSessionLive）+ `instance-store.js`（scanOrphans/recoverOrphan 守卫） | 见 §3.1 |
| 3 | 采纳关口校验（D4） | `webserver-routes.js`（adopt 动作）+ `src/client.js`（失败原因展示） | 见 §3.2 |
| 4 | 面板 reset 展开修复（#11） | `webserver-routes.js` L955 | 简化版 `expandInstanceDef` → 完整版 `expandInstanceDefinition`；删除简化版 helper |
| 5 | CREATED 明示 + archive 放开 | `instance-store.js`（archiveInstance 门禁）+ `src/client.js`（面板状态区） | 见 §3.4 |
| 6 | 迭代报告 | `iterations/iter-33-report.md` | |

## 3. 技术方案

### 3.1 #9 孤儿回收误判

- **步骤 0 探针**：确认 `sessions` 服务（Host 侧，`ctx.get('sessions')`）判定「会话存在」的 API——候选 `sessions.list()`（ADR §6 记载 create/list/get/fork 面）成员资格；备选 session 持久化头探测。
- **修复**：`isSessionLive` 拆分两义——
  - `sessionExists(sid)`（新）= 会话在持久化库中存在（list 成员资格）→ **孤儿判定用它**：不存在才是真孤儿；
  - 驻留语义（`sessions.get`）仅保留给真正需要「当前激活」的场景（现有 listRunningChildren 兜底等，不动）。
- **测试（对照式，用户拍板：不加保守闸，确保判定正确）**：mock 将「会话存在」与「会话驻留」拆为**两个独立集合**（`existingSessions` / `residentSessions`）——此前的测试缺口正是 mock 把二者混为一谈（删除≈get 无返回），从未模拟「存在但未驻留」形态。对照用例：
  - 会话**存在但未驻留**（重启/关会话形态）→ 实例**必须保持绑定**（#9 回归锁死）；
  - 会话**不存在**（已删除）→ 实例**必须回收**（既有语义回归）；
  - 驻留且 RUNNING → 启停同步行为不回归（既有用例覆盖）。

### 3.2 采纳关口校验（D4）

- **时机（推荐）**：仅在 **adopt 点击时**执行全量校验（复用 tools-preset `validateInstanceEntry` 等价逻辑：instance.yaml parse + validateWorkflow instance 语境 + 静态文件在场，**含模板 defDir 自愈尝试**）；`/wf/list` 池内仅做轻量标注（phase → poolNote 已有，追加 CREATED 标注「已创建未启动」），**不做每轮轮询全量校验**（轮询 2s 一次，语义校验含 fs 探测，开销不可接受）。
- **判定语义**（按 D4 原话「缺失文件导致采纳后无法使用的实例不允许正常采纳」）：
  - parse/语义校验失败（E-* 硬拦）→ **拒绝**，400 + 结构化 errors；
  - 静态文件缺失且自愈（defDir 补拷）后仍缺 → **拒绝**，列出缺失清单；
  - 校验通过（含 CREATED/PENDING/STOPPED/COMPLETED）→ 允许；RUNNING 沿用现行拒绝。
- **前端**：adopt 弹窗对失败的池内实例置灰 + 原因 tooltip（依据 /wf/list 轻量标注）；adopt 请求失败时 alert 展示结构化原因。

### 3.3 面板 reset 修复（#11）

- L955 `expandInstanceDef(entry)` → `expandInstanceDefinition(entry)`（tools-preset 完整版，跨段可见有 `expandDefinition` 先例）；删除简化版 helper（唯一使用点即 L955）。
- **测试**：mock 实例（instance.yaml 含 `items-from: inputs/empty-list.txt` + 实例目录副本在场）→ reset 展开后 items 命中实例副本、任务含迭代占位（不再 not found）。

### 3.4 CREATED 明示 + archive 放开

- **archive 门禁**：`archiveInstance` stage 判定追加 CREATED（有目录+definition 即可备份；无 state.json 跳过 stop 分支）。
- **面板**：绑定实例 phase=CREATED 时，DAG 区域显示明确状态卡——「实例已创建未启动（CREATED）：定义完整可点击 Start / 定义异常见错误」+「归档清理」入口（替代永久 Waiting）；沿用现有 canCreate 分支扩展，不新增布局。

### 3.5 reset 语义明确化：恢复到「模板全新建立」状态（#11 延伸，用户 09-16 提问驱动）

**现状保留清单**：instance.yaml（重展开）与 metadata 保留；output/logs 清空（先归档备份）；**inputs/ 原样保留**——含模板初始副本，但也含**运行期物化残留**（上游产物被复制进 inputs 的历史副本）。与「从模板全新建立」基准的唯一偏差即 inputs 残留。

**修复方案（#11 的完整版展开恰好带来解法）**：完整版展开带 defDir（模板子目录）锚点 → `pendingCleanup` 清理契约从「清 output/logs」扩展为：

```
rm -rf output logs inputs && mkdir -p output logs
cp -r <defDir>/inputs/. inputs/   # 有 defDir（预置模板来源）时恢复模板初始 inputs
```

- 有 defDir → inputs 恢复为模板初始态（**reset 语义 = 从模板全新建立**）；
- 无 defDir（inline/手工实例）→ 退化为仅清 output/logs（inputs 不动，保持现状语义）；
- 归档备份先于清理，数据安全不变。

### 3.6 明确不做

- 不新增实例「删除」能力（保持仅归档路线）；不动编排侧 reset 工具（已用完整版展开，行为正确）。

## 4. 执行顺序与差分验证

| 步骤 | 改动 | 验证 | 通过标准 |
|---|---|---|---|
| 0 | 探针：sessions 存在性 API（读 DSH 实包 types + 单测 mock 验证） | `iterations/iter-33-probe.md` | API 与形态结论明确；不可用则启用备选并报决策 |
| 1 | #11 reset 展开修复 + pendingCleanup 扩展（inputs 恢复） | 单测（items-from 实例副本命中；defDir 恢复语义） + 真机重放 verify-empty-items 的 Reset | reset 成功、停留 PENDING；inputs 为模板初始态（无历史物化残留） |
| 2 | #9 孤儿回收修复 | 单测对照三态（存在未驻留→保持绑定 / 不存在→回收 / 驻留 RUNNING 同步不回归） + 真机：重启 dsh 后其他会话绑定实例**不再被解绑** | 误回收归零；真孤儿仍正确回收 |
| 3 | 采纳关口校验 | 单测（CREATED 完整/CREATED 缺文件/校验失败/正常四态）+ 真机采纳弹窗 | 不完整拒绝+结构化原因；完整实例正常 |
| 4 | CREATED 明示 + archive 放开 | 真机（复现 44d0d90b 场景） | 面板明示状态；可归档清理 |
| 5 | 全量单测 + v0.26.0 发行重装 + 报告 | `test-host.js` | §5 完成线 |

## 5. 验证标准（完成线）

- [ ] 单测全绿（预计 578 → ~590：#9 三态、adopt 四态、reset 展开命中、archive CREATED）
- [ ] 产物级：build + verify-client-bundle（涉及 client）+ build-release 内容断言
- [ ] 真机（用户 GUI）：①重启 dsh 后存活会话实例绑定保持 ②面板 Reset verify-empty-items 成功 ③不完整实例采纳被拒且有原因 ④44d0d90b 同类实例可明示+归档清理
- [ ] 文档：探针/报告归档；status.md 刷新

## 6. 待用户拍板的决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 采纳校验时机 | a) 仅 adopt 点击时全量校验，池内轻量标注 b) 池内列表每轮预校验 | **a**（轮询开销） |
| 2 | CREATED 但定义完整的实例 | a) 允许采纳（采纳后可 Start） b) 一律拒绝 | **a**（判定基准是可用性而非 phase） |
| 3 | reset 的 inputs 语义 | a) 恢复模板初始态（有 defDir 时；§3.5 方案） b) 保持现状（inputs 原样不动） | **a**（用户 09-16 提问的语义指向「从模板全新建立」） |

> 已裁定（2026-09-16）：批量回收保守闸**取消**（用户：事后诸葛亮）——以「存在 vs 驻留」对照测试确保孤儿判定正确。

## 7. 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| sessions 存在性 API 形态与预期不符 | 探针先行；备选 session 持久化头探测 | 备选方案报决策 |
| 修复 #9 后真死会话实例滞留池外（漏回收） | list 成员资格是「存在性」的精确判定，漏回收仅可能发生在 API 异常（降级路径返回 true 不回收，与误回收相比代价更小）；孤儿仍可手动归档 | — |
| 完整版展开引入 reset 行为差异（finalizeDataflow/物化副作用） | 与编排侧 reset 工具同源（该路径已长期验证）；单测锁实例副本命中 | 恢复简化版 helper |
| pendingCleanup 扩展的 bash 契约对旧会话/异常路径未执行 → inputs 残留 | 与现状一致（output/logs 清空本就依赖该契约）；归档备份兜底 | 契约回退为仅清 output/logs |
| validate 在 adopt 语境的性能（大定义） | 仅点击时执行一次 | — |

## 8. 工作量估计

**约 1.5 人天**：探针 0.25 + #11 0.25 + #9 0.5 + 采纳校验 0.5（含前端展示）+ CREATED 明示/archive 0.25 + 报告 0.25。
