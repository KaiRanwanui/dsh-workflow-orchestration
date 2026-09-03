# Iter-26R 设计定稿 — 运行时 items 展开

- **时间**：2026-09-02（初稿 → **设计定稿**）
- **状态**：**设计定稿**（D1-D5 全部用户拍板，据此实施）
- **输入**：`development-plan.md` §3 Iter-26R 节 + `iter26-report.md`"设计适配与已知局限" + `iter26-design.md`（Q1-Q6 复用地基）
- **上游迭代**：Iter-26（提取器 `extractItems` / 注入语义 `itemCtx` / `${wf_dir}` 拼写）

---

## 1. 现状与差距（代码实证）

| # | 现状 | 差距 |
|---|------|------|
| 1 | `expandDefinition`（tools-preset.js:212-227）在启动/重置时刻读 items 文件 → `extractItems` → `expandLoop/ConcurrentTasks` 一次展开 N 迭代 | items 文件不存在 → `fs.readText` 直接抛异常，实例无法启动 |
| 2 | 展开后组 id（如 `analyze`）被迭代 id（如 `analyze/module-a`）取代，原始组 id 不再存在于任务数组 | 下游 `depends-on: [analyze]` 形成**潜伏缺口**——parser 校验在展开前通过（`analyze` 在 `seenIds`），但引擎 `getRunnableTasks` 中 `finished.has('analyze')` 恒 false → 下游任务永远 PENDING |
| 3 | Client DAG 按任务数组顺序扫描连续 `_loopGroup`/`_concurrentGroup` 构建组框（client.js:208-234） | 运行期动态插入的迭代无法出现在组框中（数组已定、布局已算） |
| 4 | engine.js `getRunnableTasks` 只查 `PENDING` + 前驱 `DONE/SKIPPED` | 无"组占位→依赖就绪→读 items→展开"机制 |

**核心矛盾**：Iter-26 拍板"items=启动时刻已存在文件"（Q5），把"同运行上游 output 作 items"拆至 26R。26R 需引入**运行期延迟展开**——架构级变更。

---

## 2. 决议待拍板（D1-D5）

### D1: 延迟展开判定方式

**问题**：`expandDefinition` 遇到 loop/concurrent 的 items 文件不存在时，如何区分"上游运行期产出（延迟展开）"vs"文件真的不存在（报错）"？

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A 自动检测** | items 文件不存在 → 检查是否有上游任务的 outputs 包含该路径 → 有则延迟，无则报错 | 零 YAML 改动；用户无感 | 路径匹配可能误判（上游输出 `output/report.md` vs items-from `output/report.md` 需精确匹配）；含 `${param}` 未解析的路径难静态判定 |
| **B 显式声明** | loop/concurrent 新增可选字段 `deferred: true`；声明后 items 文件不存在不报错，建占位 | 明确、无歧义；用户完全控制 | 多一个字段要学；忘标声明则报错 |
| **C 混合（推荐）** | 默认自动检测；显式 `deferred: true` 覆盖（强制延迟/强制报错） | 兼顾易用与精确 | 实现稍复杂 |

**推荐 C**：常见场景（上游 output → 下游 loop）自动检测即可；边缘场景（items 路径含运行时变量、跨实例引用等）用 `deferred: true` 显式控制。

### D2: 组占位节点生命周期

**问题**：延迟组在启动时刻产生什么节点？展开后占位节点何去何从？

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A 占位=组完成哨兵（推荐）** | 启动时产出 1 个占位任务（id=组id，`_pendingItems=true`）；依赖就绪→读 items→展开 N 迭代插入数组→占位状态改 `_expanded=true`（不再派发 subagent）；全部迭代 DONE/SKIPPED→占位自动 DONE→下游放行 | 下游 `depends-on:[组id]` 天然工作（占位 id 就是组 id）；生命周期简单（PENDING→EXPANDED→DONE 三态） | 需新增 EXPANDED 中间态（但仅内部标记，不影响 Client 状态色） |
| B 展开后移除+依赖重写 | 占位展开后从数组删除，下游 `depends-on:[组id]` 重写为所有迭代 id | 无"假节点" | 依赖重写复杂（需遍历所有下游修改）；展开前下游已在等待，重写时机微妙 |
| C 合成完成节点 | 展开后占位转为合成的"组完成"虚拟节点（不派发，仅占位+承载状态） | 语义清晰 | 与 A 实质相同但多一层概念 |

**推荐 A**：占位节点 id=组 id，天然解决"下游 `depends-on:[组id]` 缺口"。EXPANDED 态仅引擎内部标记（`_expanded=true`），Client 看到的是"组内迭代正在跑"。

### D3: 组完成语义

**问题**：何时判定"组完成"→占位节点 DONE→下游放行？

| 场景 | 判定 |
|------|------|
| loop 组（串行） | 最后一个迭代 DONE 或 onError=continue 时部分 FAILED 后全部终态 |
| concurrent 组 | 全部迭代 DONE/SKIPPED（FAILED 视 onError：break→剩余 SKIPPED 后完成；continue→全部终态后完成） |
| 空提取（占位迭代） | `组id/empty` DONE → 组完成 |
| 上游 FAILED | 占位节点依赖含 FAILED 前驱 → 占位保持 PENDING（不放行）；编排器可识别为阻断 |

**实现**：engine `updateTask` 每次迭代状态变更时，检查同组所有迭代是否终态 → 是则把占位节点置 DONE。复用 `processBreak` 模式（组内 FAILED 触发 break→后续 SKIPPED→全部终态→组完成）。

### D4: 展开触发点

**问题**：运行期何时检查"占位节点依赖就绪→该展开了"？

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A getRunnableTasks 内前置检查（推荐）** | `getRunnableTasks()` 开头：遍历 PENDING 占位节点（`_pendingItems=true`）→ 前驱全 DONE/SKIPPED → 读 items → 展开 → 插入任务数组 → 占位标 `_expanded` → 继续正常计算 runnable | 展开与调度在同一调用内，原子性保证；编排 agent 每次查 runnable 时自动触发 | getRunnableTasks 需接受 fs 参数（当前纯内存） |
| B 独立 expandPendingGroups 方法 | engine 新增 `expandPendingGroups(fs)` → 编排 agent 在每次 workflow_status 返回 runnable 前显式调用 | engine 保持纯内存（fs 在外层） | 编排 agent 须记得调；漏调则展开不及时 |
| C updateTask 内触发 | 每次 `updateTask` 把任务置 DONE 后，检查是否有占位节点因此就绪 → 立即展开 | 最早触发 | updateTask 需 fs；且可能触发连锁展开（组 A 完成→组 B 的 items 就绪→组 B 展开） |

**推荐 A**：最小改动面。`getRunnableTasks` 是编排 agent 获取可派发任务的唯一入口，在此处前置检查保证展开及时且不漏。

**fs 注入方案**：`createWorkflowEngine()` 不改签名。`getRunnableTasks` 改接受可选 `(fs, dirCtx)` 参数。当前所有调用点（snapshot 内 `getRunnableTasks()`）改为 `getRunnableTasks(deps.fs, deps.dirCtx)`。deps 由 instance-store 在 hydrate/create 时注入（已有 fs/dir 上下文）。Node 单测传 null 跳过展开检查。

### D5: DAG 晚现节点渲染

**问题**：运行期展开的迭代节点如何出现在 DAG 面板？

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A 占位组框预留+填充（推荐）** | 启动时占位节点渲染为"等待中"组框（虚线边框+沙漏图标+组名+"等待 items..."）；展开后组框内填充迭代节点（保持组框位置不变，高度按迭代数调整） | 视觉连续（组框始终可见）；位置稳定 | 组框高度变化仍需重布局（但位置不变，体感好） |
| B 全量重布局 | 展开后整张 DAG 重算坐标 | 实现最简单 | 视觉跳动（所有节点位移） |
| C 追加到末尾 | 新节点追加在 DAG 右侧/下方 | 不影响既有布局 | 逻辑位置不对（组应在占位位置而非末尾） |

**推荐 A**：占位组框从启动就可见（用户知道"这里会展开"），展开后原地填充。Client 已有的组框渲染逻辑（`loopGroups`/`concGroups`）复用，仅增加"空组框"态。

---

## 3. 推荐方案汇总（待拍板）

| # | 决策点 | 推荐 |
|---|--------|------|
| D1 | 延迟展开判定 | **C 混合**：自动检测（items 不存在+上游产出→延迟）+ 显式 `deferred: true` 覆盖 |
| D2 | 组占位生命周期 | **A 占位=组完成哨兵**：id=组id，PENDING→EXPANDED→DONE |
| D3 | 组完成语义 | 全部迭代终态（DONE/SKIPPED）→占位 DONE；FAILED 前驱→占位保持 PENDING（阻断） |
| D4 | 展开触发点 | **A getRunnableTasks 内前置检查**：fs/dirCtx 注入，展开与调度原子 |
| D5 | DAG 晚现渲染 | **A 占位组框预留+填充**：启动显示"等待 items..."虚线框，展开后原地填充 |

---

## 4. 交付范围（基于推荐方案）

### 4.1 Host 引擎改动

1. **`expandDefinition` 延迟判定**（D1）：
   - loop/concurrent 的 items 文件不存在时：
     - 检查是否有上游任务 outputs 包含该路径（精确字符串匹配展开后绝对路径）；
     - 或 `deferred: true` 显式声明；
     - 满足 → 产出 1 个占位任务（id=组id，`_pendingItems={ itemsFrom, itemsFormat, itemVar, processor, inputs, outputs, gate, onError, ... }`）；
     - 不满足 → 维持现状报错（"items 文件不存在"）；
   - 占位任务字段：`type='llm-task'`（占位不派发），`status=PENDING`，`dependsOn=原始前驱`，`_pendingItems={...}`（展开元数据），`_loopGroup/_concurrentGroup` 保留组元数据（DAG 组框渲染）；

2. **engine `getRunnableTasks(fs, dirCtx)` 前置展开**（D4）：
   - 遍历 `state.tasks` 中 `_pendingItems && !_expanded && status===PENDING` 的占位；
   - 检查 `dependsOn` 是否全部 DONE/SKIPPED；
   - 是 → 读 items 文件（`fs.readText`）→ `extractItems` → `expandLoop/ConcurrentTasks` → 插入 `state.tasks`（占位之后、下一任务之前）→ 占位标 `_expanded=true`；
   - 新迭代继承组元数据（`_loopGroup`/`_concurrentGroup` 等）；
   - 展开后继续正常计算 runnable（新迭代可能立即就绪）；

3. **engine `updateTask` 组完成检测**（D3）：
   - 每次任务状态变更时，检查同 `_loopGroup`/`_concurrentGroup` 的所有迭代是否终态；
   - 全部终态 → 找到对应占位节点（id=组id）→ 置 DONE；
   - 复用 `processBreak` 模式（loop break→后续 SKIPPED→终态检测→组完成）；

4. **engine `taskSnapshot` 补字段**：
   - `_pendingItems`（占位元数据，Client 渲染"等待 items..."用）；
   - `_expanded`（是否已展开）；

5. **engine `hydrate` 兼容**：
   - 恢复 `_pendingItems`/`_expanded`（旧 state.json 无此字段 → null/false，兼容）；
   - 展开后的迭代已在 state.tasks 中（持久化过），hydrate 直接恢复；

6. **parser 校验调整**：
   - `depends-on` 引用校验：组 id 在展开前存在于 `seenIds`，校验通过（现状）；
   - 展开后迭代 id 形如 `组id/item`，下游引用组 id 由占位节点承载（id=组id），引擎 `finished.has(组id)` 在占位 DONE 后为 true。

### 4.2 Client DAG 改动

7. **占位组框渲染**（D5）：
   - 检测 `_pendingItems && !_expanded` 的任务 → 渲染为"等待中"组框：
     - 虚线边框（`stroke-dasharray`）+ 琥珀色（`#f59e0b`）；
     - 组名 + "⏳ 等待 items..."；
     - 高度固定（单节点高度，不展开迭代列表）；
   - `_expanded=true` 后 → 正常组框渲染（迭代节点已存在于 tasks 数组，Client 下次轮询自然填充）；

8. **布局自适应**：
   - 组框高度从固定→展开后按迭代数计算（`gHLoop` → `2*padV + N*gH + (N-1)*gapV`）；
   - 后续节点 x 坐标不变（组框宽度固定），y 中心不变（高度增长向上下扩展）；
   - 整张 DAG 宽度不因展开变化（组框宽度已预留）。

### 4.3 工具/路由改动

9. **`workflow_status` 返回**：
   - 占位节点在 tasks 数组中（已有），Client 轮询自然获取；
   - runnable 计算在 Host 侧完成（含前置展开），返回的 runnable 列表已含新展开迭代；

10. **`workflow_begin`/`workflow_start` 工具描述**：
    - 补"延迟展开"语义：items 文件由上游任务产出时，loop/concurrent 在启动时显示为占位，上游完成后自动展开。

### 4.4 system-prompt 改动

11. **编排契约**：
    - "延迟展开组在启动时显示为占位节点（⏳），上游完成后 Host 自动展开——编排 agent 无需手动干预"；
    - "占位组下游任务（`depends-on: [组id]`）在组全部迭代完成后自动放行"。

### 4.5 不改动的部分

- Iter-26 提取器 `extractItems` / 注入语义 `itemCtx` / `${wf_dir}` 拼写 → **原样复用**；
- Client 组框渲染核心逻辑（`loopGroups`/`concGroups` 扫描）→ 仅增加"空组框"态；
- engine 状态机（PENDING/RUNNING/STOPPED/COMPLETED/FAILED）→ 不变；
- 任务状态枚举（PENDING/RUNNING/DONE/FAILED/SKIPPED）→ 不变（`_expanded` 是内部标记，非任务状态）。

---

## 5. 改动面

| 文件 | 改动 |
|------|------|
| `code/shared/workflow-schema.js` | 无新增常量（`_pendingItems`/`_expanded` 为运行时标记，非 schema 级） |
| `code/shared/workflow-parser.js` | `normalizeTask` 解析可选 `deferred: true` 字段（`out.deferred`）；depends-on 校验不变（组 id 在 seenIds） |
| `code/plugins/workflow-host/engine.js` | `getRunnableTasks(fs, dirCtx)` 前置展开；`updateTask` 组完成检测；`taskSnapshot`/`begin`/`hydrate` 补 `_pendingItems`/`_expanded`；新增 `expandDeferredGroup` 内部方法 |
| `code/plugins/workflow-host-preset/tools-preset.js` | `expandDefinition` 延迟判定（items 不存在+上游产出/`deferred:true` → 占位）；新增 `buildPlaceholderTask`/`isUpstreamProduced` 辅助函数 |
| `code/plugins/workflow-host/instance-store.js` | `expandInstanceDefinition` 传 fs/dirCtx 给 engine（`getRunnableTasks` 注入）；snapshot 路径传 fs |
| `code/packages/client-ui-monitor/src/client.js` | 占位组框渲染（虚线+琥珀色+"等待 items..."）；展开后组框高度自适应 |
| `code/agent-presets/workflow-orchestrator/system-prompt.md` | 延迟展开契约段落 |
| `code/agent-presets/workflow-orchestrator/workflow-host.mjs` | sync-modules 同步（engine/tools-preset/parser） |
| `code/scripts/test-host.js` | 用例 22（运行时 items 展开） |
| `code/packages/workflow-host/package.json` | 0.15.0 → **0.16.0** |
| `plan/development/development-plan.md` | §3 Iter-26R 补设计定稿引用 |

---

## 6. 验证标准

### 单测（349 基线全绿 + 用例 22，预计 +50 项左右）

1. **延迟判定矩阵**：
   - items 不存在 + 上游 outputs 匹配 → 占位（`_pendingItems` 非空）；
   - items 不存在 + 无上游产出 → 报错（现状行为）；
   - `deferred: true` + items 不存在 → 占位（无论上游）；
   - `deferred: true` + items 存在 → 正常展开（显式声明不阻止即时展开）；
   - items 存在 → 正常展开（现状行为，零回归）；

2. **占位节点结构**：
   - id=组id、type='llm-task'、status=PENDING、dependsOn=原始前驱；
   - `_pendingItems` 含 itemsFrom/itemsFormat/itemVar/processor/inputs/outputs/gate/onError；
   - `_loopGroup`/`_concurrentGroup` 保留（DAG 组框渲染）；
   - `_expanded=false`；

3. **展开触发**：
   - `getRunnableTasks(fs, dirCtx)` 前驱全 DONE → 读 items → 展开 N 迭代 → 占位 `_expanded=true` → 迭代在 runnable 中；
   - 前驱含 PENDING/RUNNING → 不展开（占位保持 PENDING）；
   - 前驱含 FAILED → 不展开（占位保持 PENDING，阻断）；
   - fs=null → 跳过展开检查（单测隔离，不报错）；

4. **组完成检测**：
   - loop 组全部迭代 DONE → 占位 DONE；
   - loop 组 onError=break + 迭代 FAILED → 后续 SKIPPED → 全部终态 → 占位 DONE；
   - concurrent 组全部 DONE → 占位 DONE；
   - 下游 `depends-on:[组id]` → 占位 DONE 后放行；

5. **端到端展开**：
   - 上游 collect → output/module-list.md → 下游 loop 占位 → collect DONE → 占位展开 → 迭代派发 → 全部 DONE → 下游 report 放行；
   - 空提取运行时 → 占位迭代（`组id/empty`）→ 组完成；

6. **hydrate 兼容**：
   - 旧 state.json（无 `_pendingItems`/`_expanded`）→ hydrate 后 null/false（兼容）；
   - 展开后的迭代已在 state.tasks → hydrate 恢复正确；
   - STOPPED → resume → 占位若已展开则迭代状态保留；

7. **回归**：
   - 既有用例 1-21 全绿（items 存在场景零改动）；
   - 用例 4（legacy 行文本 expandLoopTasks）不回归。

### 端到端（部署后 GUI，用户执行）

- **场景 A（运行时 items 端到端）**：定义 collect→loop 两任务，collect 写 `output/modules.md`，loop items-from=`output/modules.md`。启动 → 面板显示 collect（PENDING）+ loop 占位组框（"⏳ 等待 items..."）→ collect 完成 → 组框填充迭代节点 → 迭代逐个执行 → 全部完成 → COMPLETED；
- **场景 B（下游组依赖）**：collect→loop→report 三任务，report `depends-on:[loop]`。loop 全部迭代完成 → report 自动放行；
- **场景 C（items 不存在+无上游→报错）**：items-from 指向不存在文件且无上游产出 → create/start 报错"items 文件不存在"（现状行为）；
- **场景 D（Iter-26 回归）**：items 启动时刻已存在 → 零改动可跑（349 基线全绿）。

---

## 7. 边界与已知局限

- **路径匹配精度**：自动检测用字符串精确匹配上游 outputs 与 items-from。含 `${param}` 的路径在展开期已注入，匹配可靠；含 `${item}` 的路径在 items-from 无意义（items 是组级，非迭代级）；
- **展开不可逆**：一旦占位展开为 N 迭代，不可"收回"（stop 时迭代回 PENDING，resume 后不重新展开——迭代已在 state.tasks）；
- **DAG 布局跳动**：组框高度从固定→展开后按迭代数增长，后续节点 y 坐标不变（组框向上下扩展），但 SVG viewBox 可能需调整（Client 已有自适应逻辑）；
- **fs 注入**：`getRunnableTasks` 从纯内存变为需 fs。单测传 null 跳过；生产路径由 instance-store 注入。不破坏 engine 纯逻辑定位（fs 仅用于读 items 文件，不用于状态管理）；
- **不处理跨实例引用**：items-from 只能引用本实例上游 output 或启动时已存在文件；跨实例引用不在本迭代范围。

---

## 8. 部署纪律

全量 `sync-modules.js`（8 section）→ `packages/workflow-host/build.js`（v0.16.0，lib 求值级加载验证）→ persona/mjs 副本 cp 至 `~/.dsh/.agent-presets/workflow-orchestrator/`（diff 一致）→ **提醒用户重启 dsh.service（不自行 systemctl）**。

---

## 9. 待用户拍板

| # | 决策点 | 推荐 | 备注 |
|---|--------|------|------|
| D1 | 延迟展开判定 | C 混合 | 自动检测+显式 `deferred: true` |
| D2 | 组占位生命周期 | A 占位=组完成哨兵 | id=组id，PENDING→EXPANDED→DONE |
| D3 | 组完成语义 | 全部迭代终态→占位 DONE | FAILED 前驱→阻断 |
| D4 | 展开触发点 | A getRunnableTasks 内前置 | fs/dirCtx 注入 |
| D5 | DAG 晚现渲染 | A 占位组框预留+填充 | 虚线琥珀色→原地填充 |

**请拍板 D1-D5 后据此实施。**
