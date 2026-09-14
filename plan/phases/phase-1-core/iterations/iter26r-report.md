# Iter-26R 关闭报告：运行时 items 展开

**状态**：✅ 已关闭（2026-09-03 GUI 验收通过）
**版本**：host v0.16.0（client 未动 v0.6.1）；单测 349 → **387**（+38，零回归）
**设计**：`iter26r-design.md`（D1-D5 用户拍板）

## 交付明细（设计拍板 5 项）

1. **延迟展开判定（D1 混合方案）**：
   - 自动检测：items 文件不存在 + 上游任务 outputs 包含该路径 → 延迟
   - 显式声明：`deferred: true` → 强制延迟（覆盖自动检测）
   - `deferred: false` → 强制报错（items 不存在即错误）

2. **组占位节点（D2 占位=组完成哨兵）**：
   - 占位 id=组 id（下游 `depends-on:[组id]` 天然工作）
   - `_pendingItems` 携带展开元数据（itemsFrom/itemVar/processor/inputs/outputs/gate/onError/taskType）
   - `_expanded=false` 初始标记

3. **运行期展开（D4 getRunnableTasks 内前置检查）**：
   - `engine.expandDeferredGroups(expandFn)`：遍历 PENDING 占位 → 前驱全 DONE/SKIPPED → 调用 expandFn 展开 → 插入迭代 → 占位标 `_expanded=true`
   - `tools-preset.makeExpandFn(entry)`：构造展开回调（读 items 文件 → extractItems → expandLoop/ConcurrentTasks → finalizeDataflow 绝对化）
   - `workflow_status` 工具：每次返回快照前调用 `expandDeferredGroups`（`bind()` 补 `entry` 返回）

4. **组完成语义（D3 用户拍板：全部迭代终态→组完成）**：
   - `engine.updateTask`：每次迭代状态变更后调用 `checkGroupCompletion`
   - 检测同组（`_loopGroup`/`_concurrentGroup`）所有迭代是否终态（DONE/SKIPPED/FAILED）
   - 全部终态 → 占位节点 DONE → 下游 `depends-on:[组id]` 放行

5. **DAG 晚现渲染（D5 占位组框预留+填充）**：
   - Client 检测占位组框（单元素 + `_pendingItems` + `!_expanded`）→ 渲染虚线琥珀色组框（"⏳ 等待 items..."）
   - 展开后组框原地填充迭代节点（Client 下次轮询自然更新）

## GUI 验收修复（3 缺陷）

| # | 缺陷 | 根因 | 修复 |
|---|------|------|------|
| 1 | **未展开** | `bind()` 返回值没有 `entry` 字段 → `if (b.entry)` 恒 false → **展开从未触发** | `bind` 补 `entry` 返回；`workflow_status` 每次调用前置展开 |
| 2 | **itemsFrom 路径错** | 延迟组 items-from 经两级链解析落到 workspaceRoot，而上游 output 以实例目录为基准（finalizeDataflow）→ 基准错位 | 占位保留**相对形态** + `itemsDeferred` 标记 → `finalizeDataflow` 以实例目录绝对化 → **与上游 output 落点天然一致**；展开迭代 outputs 同款绝对化 |
| 3 | **占位泄漏进 runnable** | 占位是 PENDING 任务，依赖就绪后被 `getRunnableTasks` 放行 → 编排侧拿到 processor=null 假任务 | `getRunnableTasks` 跳过所有 `_pendingItems` 任务（占位永不派发） |

## 设计问题回答（用户确认）

- **相对路径**：✅ 模板定义写相对路径（如 `output/modules.txt`），延迟组在展开期以**实例目录**为基准刷新为绝对路径——与上游任务 output 完全同基准（Iter-25 D1 决议语义）
- **绝对路径**：✅ 用户显式写绝对路径（含 `${wf_dir}` 展开后的）→ **直通保留**，不标 deferred、不做基准改写

## 内建模板与技能

- **模板 `runtime-items-demo`**：collect→loop 延迟展开演示
  - collect（收集模块清单）→ 写 `output/modules.txt`（3 个模块：login/order/payment）
  - analyze（逐模块分析，loop）→ items-from: `output/modules.txt`，depends-on: `[collect]`
- **技能 `list-collector`**：写固定清单到 output/modules.txt

## 验证

- **单测**：387 通过 0 失败（349 基线 + 38 个 26R 测试）
  - 延迟判定矩阵（自动检测/显式声明/报错）
  - 占位节点结构（id/元数据/_pendingItems）
  - 引擎展开（前驱就绪→展开/前驱未就绪→不展开）
  - 组完成检测（全部终态→占位 DONE）
  - 下游放行（depends-on:[组id] 占位 DONE 后放行）
  - hydrate 兼容（旧 state.json 无新字段→null/false）
  - **路径语义矩阵**：相对→占位保留相对+deferred 标记 / finalize 后=实例目录绝对路径 / 与上游 output 落点一致 / 绝对→直通
  - **runnable 排除**：前驱就绪前后占位均不进 runnable
  - **工具级端到端**（GUI 主链路复现）：create→start（占位+itemsFrom 已绝对化+runnable=[collect]）→ 模拟 collect 写文件 → `workflow_status` 标 DONE → **自动展开 3 迭代**（outputs 含 `${mod}` 注入+实例目录绝对化）→ runnable=[首迭代] → 迭代全部 DONE → **占位 DONE**

- **GUI 验收**（runtime-items-demo-300fe547）：
  - Stage: COMPLETED ✓
  - Tasks: 5 个（collect + analyze 占位 + 3 迭代）全部 DONE ✓
  - 占位展开: analyze._expanded=True ✓
  - 输出文件: modules.txt + analyze/{login,order,payment}.md 全部生成 ✓

## 后续

**Iter-27 语义校验**（含缺 processor 升错误级）/ **Iter-28 实例编辑前台** / **Iter-29 实例管理子页签+归档下载删除** / **Iter-30 DAG 美化**。
