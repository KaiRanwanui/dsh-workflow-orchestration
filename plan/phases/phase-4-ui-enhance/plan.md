# 阶段 4 方案 — 现有功能问题修复（定稿 v6）

- **阶段**：阶段 4（**定位：现有功能问题的修复与补全，不增加新工作流能力**）
- **日期**：2026-09-16（v6：补验项独立成迭代——新增 **Iter-32 验证测试资产与补验**，测试工作流模板进预置目录，原 32–40 顺延为 33–41；v5：UI 组拆定 4 个；v4：31/32 拆 6 个聚焦迭代）
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.23.0`（单包双端）
- **决策记录（用户拍板）**：
  - **定位与排序（09-16）**：仅修现有功能；「真正的 skill 使用、output→input 串联、变量引用」→ 阶段 5。迭代按**后台能力 → 前台能力 → UI 交互性**排序。
  - **行为决策（09-16）**：reset 后停 PENDING 等手动 Start；stopHint 移除；采纳关口校验（不完整实例不允许正常采纳）；Iter-31 版本 v0.24.0、目录定名 `phase-4-ui-enhance`。
  - **拆分决策（09-16 审核）**：原 31/32 各混 4~5 个主题 → 拆 6 个聚焦迭代；UI 组拆 4 个（页签门控 / 脉冲+跟随 / 详情+预览 / 主题适配各自独立）。
  - **补验独立决策（09-16 审核）**：补验项自 Iter-31 移出**独立成迭代**，并**补充测试用的工作流定义到预置目录**（`builtin-assets/templates/`，物化后进 GUI 模板下拉 predefined 链），方便验证测试与后续迭代复用（如门禁诊断）。
  - **空提取决策（09-16 补验后）**：维持 Q1-b（空提取派发「（items 为空）」占位迭代），**只改技能文案**——item-processor 空 items 条款对齐引擎实际占位值，明确「不展开条目分析直接写空结论」（host v0.25.1）。
- **验证输入**：`verification-checklist.md`（用户完成，2026-09-16）——39 通过 / 3 未通过 / 7 无法构造 / 2 部分。

---

## 0. 阶段边界

| 在范围内（修复/补全现有功能） | 移出（阶段 5 候选） |
|---|---|
| 8 项验证缺陷全修复；编辑器补全（全文编辑/参数编辑/items-from/完整属性）；gate 按既有 schema 语义跑通（含 FAIL 反馈重试）；页签门控；DAG 观察增强（脉冲/跟随/详情/预览）；**验证测试资产（预置测试模板）**；主题适配 | 真正的 skill 使用范式；output→input / item-form 自动串联；技能中变量引用；其他新增工作流能力 |

## 1. 迭代队列（11 个聚焦迭代，后台 → 前台 → UI 交互）

| 迭代 | 类别 | 聚焦主题 | 内容 | 估计 |
|---|---|---|---|---|
| **Iter-31** | 后台 | 面板控制指令语义 | reset 后停 PENDING（注入文案改纯通知）+ stopHint 提示条移除 | 0.25 天 |
| **Iter-32** | 资产/验证 | 验证测试资产与补验 | 预置测试工作流模板（分支/目录变量/技能覆盖/门禁/空提取）+ 校验错误样例 + 执行补验 | 0.5~0.75 天 |
| **Iter-33** | 后台 | 实例完整性与采纳关口 | 采纳时可用性校验（不完整实例拒绝+原因）+ 已绑定 CREATED 实例面板明示 + archive 门禁放开 CREATED + **孤儿回收误判修复**（补验实证：`isSessionLive` 用 `sessions.get` 驻留语义，重启/关会话后「存在但未打开」会话的实例被批量误解绑——dsh_wf_ws 实证 14 实例 13 个 sessionId 被清；修复方向=`sessions.list()` 成员资格判定，先探针 list 形态）+ **面板 reset 展开缺上下文修复**（缺陷 #11：reset 路由用简化版 `expandInstanceDef`，缺 wfDir/defDir/workspaceRoot，凡引用模板静态文件或 ${wf_dir} 的实例面板 reset 必失败——实证 verify-empty-items reset 报 `~/.dsh/workflow-agent/inputs/empty-list.txt` not found；修复=L955 换用完整版 `expandInstanceDefinition`，跨段可见性有 expandDefinition 先例） | 1.5 天 |
| **Iter-34** | 后台 | 门禁真实执行 | 诊断先行（**复用 Iter-32 verify-gate 模板**；数据链完整，疑 Agent 遵循度）→ 修复至 checker 独立 subagent 执行、PASS/FAIL 按 onFailure/maxRetries 处置 | 1 天 |
| **Iter-35** | 前台 | 定义全文编辑 | 编辑器 YAML 源码模式（双栏表单 ↔ 源码两态切换；保存走既有语义校验关口） | 1 天 |
| **Iter-36** | 前台 | 编辑器表单补全 | items-from 字段 + 完整属性呈现（不可编辑项只读）+ 下拉配色修复 + 创建弹窗模板下拉展示「名称+说明」（补验 U2） | 1 天 |
| **Iter-37** | 前台 | 全局参数编辑 | 编辑器 params 区 + 后端 meta patch 通道（仅 STOPPED/PENDING 开放） | 0.5 天 |
| **Iter-38** | UI | 页签动态门控 | 探针 `ctx.sessions` 快照 → 按当前会话 preset 动态注册/注销 conversation.view slot | 0.5 天 |
| **Iter-39** | UI | RUNNING 运行视觉 | RUNNING 脉冲（呼吸动画）+ 自动跟随（视口外才滚、每指纹一次）+ 门禁角点执行后消失修复（补验 U1） | 0.75 天 |
| **Iter-40** | UI | 节点详情与文件预览 | 节点详情面板 + 文件内容预览（**方案待 Iter-35 全文编辑效果评估后确定**） | 1 天 |
| **Iter-41** | UI | 主题适配 | 173 处 style → 13 CSS token（含 39/40 新增 UI） | 待定 |

> 版本：Iter-31 = v0.24.0（已拍板）；后续迭代版本随实施定（新能力 minor、纯修复 patch）。
> 顺序满足约束：全文编辑（35）先于参数编辑（37）与 UI 配色（41）。
> Iter-34（gate 诊断结论影响设计）与 Iter-40（挂 35 效果评估）启动前出细化方案确认（§A6）。
> 阶段合计约 **7 人天**（不含主题适配）。

## 2. 开单分诊（根因代码定位 2026-09-16）

| # | 问题 | 根因（定位） | 归属 |
|---|---|---|---|
| 1 | reset 之后自动执行 | `webserver-routes.js` `injectSessionCmd` reset 注入文案「…按全新工作流继续执行」指示 Agent 自动 begin（begin 即 RUNNING） | 31 |
| 2 | stopHint 提示条存疑 | Iter-23(A3) 遗产；Stop v4 后两通道等效（用户两时序验证通过） | 31 |
| 3 | 实例 44d0d90b 卡死（永久 Waiting / "instance not started (CREATED)"） | CREATED=有目录无 state.json：面板 `hasData=false` 永久 Waiting；resume 报错；archive 门禁不含 CREATED 无清理口 | 33 |
| 4 | 非 orchestrator 会话显示 Workflow 页签 | slot label 恒 `'Workflow'`；DSH `viewTabs()` 遍历**全局注册表**（label 空仅回退 id），tab 快照不随会话切换重算 → 须动态注册/注销 | 38 |
| 5 | 编辑器下拉未选中项字色=背景色 | Iter-30 只修创建弹窗 `<option>` 配色；编辑器 `getEditorComponent` 未处理 | 36 |
| 6 | items-from 未开放配置 | 编辑器任务表单无该字段 | 36 |
| 7 | 创建后全局 params 无法修改 | params 存 `metadata.json`（`meta.params`）；编辑器无 params 区，保存走 `instance-yaml` POST 不触 meta | 37 |
| 8 | gateChecker 未执行 | 数据链完整（快照 `tasks[].gate` 齐备 + persona §5 流程完备）→ 疑 Agent 遵循度或定义写法，诊断先行 | 34 |
| 9 | 孤儿回收误判：重启/关会话后存活会话的实例被批量误解绑（补验新发现，2026-09-16） | `isSessionLive`=`!!sessions.get(sid)` 是**驻留**语义（未打开≠删除）；`scanOrphans` 每轮 /wf/list 触发 → 误回收 stop+sessionId 置 null（实证 dsh_wf_ws 14 实例 13 个被清） | 33 |
| 10 | 静态循环组下游不放行：空提取/正常循环迭代全终态后，dependsOn 组 id 的下游永不就绪（verify-empty-items 补验发现，2026-09-16） | 静态展开用迭代替换组任务、组锚点消失 → 组 id 依赖悬空；`getRunnableTasks` 纯 id 匹配无组解析 | ✅ **Iter-32 内已修**（`isDepSatisfied` 补组语义 + 用例 32 四场景，host v0.25.2） |
| 11 | 面板 reset 失败：`cannot read "~/.dsh/workflow-agent/inputs/empty-list.txt": not found`（verify-empty-items reset 发现，2026-09-16） | reset 路由用简化版 `expandInstanceDef`（缺 wfDir/defDir/workspaceRoot + finalizeDataflow + inputs 物化），静态引用解析退化到预定义根；编排侧 reset 工具用完整版不受影响——面板/工具不对称 | 33 |
| U1 | 门禁角点：任务执行后右上角门禁小圆点消失（补验 UI 发现） | DagCanvas 门禁角标渲染条件待查（疑似仅创建态渲染） | 39 |
| U2 | 创建弹窗模板下拉只显示工作流说明，应显示名称+说明（补验 UI 发现） | 下拉 label 构造待查 | 36 |

**补验项**（→ **Iter-32 独立迭代**，配预置测试模板）：分支 SKIPPED / 目录变量全量 / 技能工作区覆盖 / 会话删除解绑；顺带覆盖：文本创建 / 校验硬拦 / 警告类 / items 空提取（校验清单其余无法构造项）。

## 3. Iter-31 详案 — 面板控制指令语义（下一步启动项）

### 3.1 交付件

| # | 交付件 | 说明 |
|---|---|---|
| 1 | reset 语义修正 | `webserver-routes.js` `injectSessionCmd` reset 文案改纯通知：「实例已重置至 PENDING，此前对话的阶段与任务状态已作废，以 workflow_status / workflow_list 返回为准；等待用户启动指令」 |
| 2 | stopHint 移除 | 删 `/wf/list` stopHint 计算（`webserver-routes.js`）+ 面板提示条（`src/client.js` stopHintBar 及 wfStopHint 状态） |
| 3 | 迭代报告 | `iterations/iter-31-report.md` |

### 3.2 执行顺序与差分验证

| 步骤 | 改动 | 验证 | 通过标准 |
|---|---|---|---|
| 1 | reset 文案 | `build.js` 重建 → 重启 dsh → 真机 reset | 重置后停留 PENDING，Agent 不自动 begin；面板 Start 可正常启动 |
| 2 | stopHint 移除 | 重建 → 真机跑实例观察 | 原触发场景（主会话空闲+子会话在跑）不再出现提示条；停止两通道复验仍全停 |
| 3 | 单测全量 + 报告 | `test-host.js` | 全绿；报告归档 |

### 3.3 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| reset 后 Agent 对「等待指令」不响应（用户点 Start 时 Agent 未接续） | Start 注入链路不变（仍发「请启动实例」）；文案保留「以 workflow_status 返回为准」锚点 | 恢复原文案 |
| stopHint 计算被单测断言依赖 | 先跑全量单测确认无引用再删 | 恢复代码 |

## 4. Iter-32 详案 — 验证测试资产与补验

### 4.1 交付件

| # | 交付件 | 说明 |
|---|---|---|
| 1 | 预置测试模板（`builtin-assets/templates/` 新增子目录；物化到 `~/.dsh/workflow-agent/templates/` 后自动进 GUI 模板下拉 predefined 链） | ① `verify-branch-skip`：分支条件不满足 → SKIPPED 链路 ② `verify-dir-vars`：任务引用全部目录变量（`${workspace}/${wf_dir}/${skills}/${skill_dir}`）③ `verify-skill-shadow`：引用同名技能（配工作区 `skills/` 覆盖验证，附覆盖用技能文件样例）④ `verify-gate`：带 quality-gate 任务（**Iter-34 门禁诊断直接复用**）⑤ `verify-empty-items`：items 文件空提取 → (0) 占位形态 |
| 2 | 校验错误样例（`builtin-assets/samples/`） | 含 E-\* 硬拦与 W-\* 警告的 YAML 样例，作「文本创建 / 校验硬拦 / 警告类」三项 GUI 补验的复制源 |
| 3 | 补验执行记录 | 4 项补验 + 4 项顺带覆盖，逐项结论入迭代报告（通过 / 新问题开单） |
| 4 | 迭代报告 | `iterations/iter-32-report.md` |

### 4.2 执行顺序与差分验证

| 步骤 | 改动 | 验证 | 通过标准 |
|---|---|---|---|
| 1 | 模板与样例文件编写 → `build.js`（资产随包） | 物化目录出现新模板；GUI 模板下拉可见可选 | `~/.dsh/workflow-agent/templates/verify-*` 就位 |
| 2 | 逐模板跑实例补验（一模板一验证一记录） | 每模板创建+执行 | 分支 SKIPPED / 目录变量全量 / 技能覆盖 / 空提取各出结论 |
| 3 | 校验样例复制粘贴补验 | 文本创建 + 校验硬拦 + 警告类 | 硬拦清单结构化展示；警告不硬拦 |
| 4 | 会话删除解绑（操作场景，模板无关） | GUI 删除绑定会话 | 实例解绑/先停后解绑符合设计 |
| 5 | 单测全量（资产文件对准真实文件本体断言，对齐 c21 模式）+ 报告 | `test-host.js` | 全绿；报告归档 |

### 4.3 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| 模板引用技能不在场导致执行失败 | verify-\* 模板 processor 优先用既有 7 技能或无外部依赖的最小任务 | 调整模板 |
| 物化幂等覆盖语义覆盖用户对测试模板的改动 | `verify-` 前缀明示「测试资产会被包内规范内容覆盖」（物化语义已拍板） | — |

### 4.4 工作量

**0.5~0.75 人天**：模板/样例编写 0.25 · 补验执行 0.25~0.5 · 报告 0.1。

## 5. 后续迭代要点（启动前按需出细化方案）

- **Iter-33**：`/wf/adopt` 前置可用性检查（复用 `validateInstanceEntry` 语义校验 + 关键文件在场 + phase 判定）→ 不完整 `adoptable=false` + 结构化原因；`/wf/list` 池内标注；面板 CREATED 明示；archive 放开 CREATED。风险：校验过严挡合法实例（如静态文件自愈场景）→ 自愈路径纳入校验前尝试，回退为警告+强制采纳。
- **Iter-34**：用 **Iter-32 verify-gate 模板**跑带门禁工作流，记录快照 gate 字段与会话轨迹 → 按结论修复（候选：begin 返回加「待执行门禁」显式提示 / persona 强化 / 引擎级强制）；FAIL→retry 反馈按既有 schema（gate.maxRetries/onFailure）语义补全。
- **Iter-35**：编辑器加源码模式（表单态保留，两态切换；源码态保存走 `instance-yaml` POST + 语义校验关口，校验错误结构化展示沿用创建弹窗样式）。
- **Iter-36**：items-from 表单字段（四格式提示）+ 表单覆盖 schema 全字段（不可编辑项只读呈现）+ option 显式配色（对齐 Iter-30 创建弹窗修法）。
- **Iter-37**：编辑器 params 区 + `/wf/instance-params` PATCH 通道（`registry.patchMeta`；仅 STOPPED/PENDING 开放，对齐权限矩阵）。
- **Iter-38**：探针 bundle 内 `ctx.sessions.list` 快照可读 `byId[].projectionValues.agentPreset`（官方 `dsh-client-ui-conversation` 直用 `ctx.sessions` 先例）→ 订阅会话变化动态注册/注销 slot；探针不过则降级常驻页签+空态文案报决策。
- **Iter-39**：RUNNING 脉冲（`<style>` 注入 keyframes，`wfdag-` 前缀防串扰，色值沿用 `C` 色板，状态迁移即停）+ 自动跟随（RUNNING 节点视口外才 `scrollIntoView` 平滑滚入，每指纹一次；极简无开关已拍板）。
- **Iter-40**：节点详情面板（任务节点：基础/数据流/处理器与门禁分区；组节点：成员清单+聚合状态）+ 文件预览（`/wf/file-preview` 路由；已拍板：详情卡不含时间戳、围栏与 `/wf/skill` 一致——任意绝对路径+loopback+64KB+二进制检测）；**实施方案在 Iter-35 全文编辑落地后评估确定**。
- **Iter-41**：`src/client.js` 173 处 style → 13 token；含 Iter-39/40 新增 UI 一并 token 化。

## 6. 阶段 5 候选（预告，不在本阶段）

真正的 skill 使用范式 · output→input / item-form 自动串联 · 技能中目录/输入输出/item 变量引用。
