# Iter-41 设计 — 节点详情与文件预览

- **阶段**：阶段 4（现有功能修复/补全）
- **日期**：2026-09-19
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.26.28` → 发行时阶段内第三格顺延
- **状态**：**待用户确认后编码**
- **来源**：队列 Iter-41；plan.md 已拍板项（详情卡不含时间戳；文件围栏与 /wf/skill 一致）

---

## 1. 踏勘结论（代码级，2026-09-19）

| 项 | 现状 |
|---|---|
| 节点选中 | `selectedId` 仅做节点高亮（isSel 描边），**无任何详情呈现** |
| 数据可得性 | status 快照 tasks 字段齐备：id/name/type/status/dependsOn/retries/inputs(绝对路径[])/outputs([])/processor/skillDir/gateChecker/gateResult/gateNote/gateOnFailure/_loopGroup/_loopItem/_concurrentGroup —— **零服务端改动即可支撑详情卡** |
| 文件预览通道 | `/wf/skill?path=` 已接受任意路径 `fs.resolve + readText` 直读返回——**复用即可，无需新增 /wf/file-preview 路由**（plan 原拟新路由可省） |
| 可复用组件 | Iter-35 技能只读弹层（skillView modal：固定遮罩+路径头+pre 正文）；textarea 只读形态已落地 |

## 2. 交付件

| # | 交付件 | 说明 |
|---|---|---|
| 1 | 节点详情卡 | 点击 DAG 节点选中后，DAG 下方展开详情卡（再点取消选中收起；编辑器展开时详情卡让位隐藏）。任务节点三分区：**基础**（id/名称/类型/状态/retries/dependsOn）· **数据流**（inputs/outputs 逐行绝对路径，可点击→文件预览）· **处理器与门禁**（processor + 「查看技能」入口、gateChecker + gateResult 色点 + gateNote 摘要） |
| 2 | 组节点详情卡 | 选中循环/并发组节点 → 成员清单（序号/名称/迭代项/状态）+ 聚合状态条（复用组节点统计口径） |
| 3 | 文件预览弹层 | 点击 inputs/outputs 路径 → 只读弹层展示文件全文（复用 skillView modal 形态与 /wf/skill 通道；标题显示文件绝对路径） |

## 3. 技术要点

- **数据源**：`stateData.tasks.find(t => t.id === selectedId)`（快照字段直读，服务端零改动）；组节点按 `_loopGroupName`/`_concurrentGroup` 匹配成员任务。
- **预览通道**：`GET /wf/skill?path=<绝对路径>`（已有守卫与错误通道 `{text, error}`）；弹层复用 skillView 结构，新增 `fileView` state（与 skillView 同款交互）。
- **详情卡显隐规则**：`selectedId` 变化即更新内容；`editorOpen=true` 时详情卡隐藏（编辑器优先）；再次点击已选中节点 = 取消选中收起。
- **不做**（范围控制）：不含时间戳（已拍板）；不加 64KB/二进制围栏（/wf/skill 现状即任意直读，收口另立迭代）；不提供文件编辑。

## 4. 决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 详情卡形态 | a) DAG 下方展开卡（随选中即时更新，与编辑器互斥） b) 弹层（复用 modal） | **a**（不遮挡 DAG，阅读/预览连贯） |
| 2 | 文件预览通道 | a) 复用 /wf/skill（零新路由） b) 新增 /wf/file-preview + 围栏（64KB/二进制检测） | **a**（能力已存在；围栏收口另立迭代） |
| 3 | 组节点成员行交互 | a) 仅展示清单与状态 b) 点击成员行 → 该成员任务详情卡 | **b**（成员详情复用同一任务卡组件，成本低价值高） |

## 5. 验证标准（完成线）

- [ ] 单测全绿（无回归）
- [ ] 产物级：bundle + verify-client-bundle + 部署产物核验
- [ ] 真机：①点击任务节点 → 详情卡三分区正确呈现 ②inputs/outputs 路径点击 → 预览弹层展示文件全文 ③processor「查看技能」→ 技能弹层 ④点击组节点 → 成员清单+聚合状态；点成员行 → 成员详情 ⑤编辑器展开时详情卡让位 ⑥再点节点收起详情卡

## 6. 工作量估计

**约 1 人天**（任务详情卡 0.35 + 组节点卡与成员行 0.2 + 文件预览弹层 0.2 + 联动/互斥 0.15 + 回归 0.1）。
