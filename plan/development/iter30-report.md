# Iter-30 报告 — DAG 分层布局 + GUI 附加修复

- **状态**：✅ 完成关闭（2026-09-05，用户 GUI 验收通过）
- **版本**：host v0.20.1 / client v0.9.0
- **提交**：主体+收尾文档（本报告随收尾提交入库），已推 origin/master
- **测试**：563 单测全绿

## 设计决议（用户多轮拍板）

- **主任务拆分**：原 Iter-30「DAG 美化与交互」拆为两迭代——**Iter-30 = 分层布局算法**（纯视觉/交互），**Iter-31 = 节点详情面板 + 交互增强**（RUNNING 脉冲/自动跟随/图例条/文件内容预览/主题适配）
- **原型先行**：先做独立 HTML 原型（`PoC/dag-layered-prototype.html`）多轮打磨至用户满意，再移植进 client.js——保证算法与渲染解耦，移植可机械验证
- **算法移植纪律**：算法区（`lgRgba` ~ `lgRouteEdges`）从原型机械变换（仅重命名），保证逐字符一致；唯一偏离=客户端真实数据的组哨兵过滤（注释标注）
- **路由风格统一**：分支扇出=贝塞尔曲线（优雅），合并汇入=正交总线（干净）——不再曲线/直角混排
- **主题适配**：规划到 Iter-31（DSH 13 个 CSS 变量 token 已查证，当前 173 处 style 对象需替换）

## 分层布局算法

### 核心步骤
1. **最长路径分层**：每个节点 layer = max(前驱 layer) + 1；起点 layer=0
2. **重心排序**：每层按邻居重心值迭代排序（4 轮），最小化交叉
3. **坐标计算**：每层列宽固定（gW=132），层间距 gapX=64；组展开高度叠加
4. **边路由**：
   - 跨层边：沟道+走廊直角路由（clearBands 避开中间节点盒）
   - 相邻边：贝塞尔曲线（dx=max(34, gap*0.42)）
   - **合并点**：入度≥2 → 所有入边统一正交（避免曲线/直角混排扭缠）

### 关键修复（原型多轮反馈）
1. **展开列表挂在组盒下方**：SVG 内渲染（非 HTML），extraHeights 列流保证画布高度正确
2. **结束圆帽箭头**：circle cx 偏移 10px（箭头触环边而非圆心）
3. **边不穿越占位节点**：anchor 钳制在盒内安全区
4. **节点间距**：gapX 从 44 增至 64，曲线不再贴盒
5. **非交叉锚点分配**：目标侧入边按源 y 排序分配锚点；同源 y 平局按列深降序（相邻边取近中锚点）
6. **合并点哨兵过滤**：组哨兵（id===组id && _pendingItems）不计入子任务清单，展开后哨兵与迭代并存时排除哨兵（旧版同样有此 bug）
7. **同目标跨层边分带**：分配到不同走廊带（上源走上带、下源走下带），避免共带扭缠

### 等价性验证
- 移植后用原型同款 MOCK 数据复测：收起/展开两态均 **0 交叉 0 穿盒**
- 真实实例 state.json 验证三种形态：展开实例 3 行（无哨兵）✓、未展开占位框 ✓、空提取 (0) ✓

## 附加修复（用户验收反馈）

### 1. 创建弹窗：模板路径修复 + 校验错误结构化展示
- **根因**：弹窗把模板转成纯文本（workflowText）提交，host 丢失模板目录锚点 → 6 条 E-ITEMS-MISSING 误报；且静态文件 1:1 复制（presetCopy）也不会发生
- **修复**：选模板提交时附带模板源路径 `workflowPath`（host 本就支持）→ host 恢复 definition-preset 语境校验 + 触发静态文件复制
- **错误展示**：校验失败时弹窗内展示红色摘要行 + 可滚动等宽错误清单（每项 `[code] 任务 "id" 字段: 原因`）

### 2. 运行时 items 展开：哨兵任务渲染修复
- **根因**：引擎设计里组哨兵（占位任务）按设计永久保留作组锚点（展开后标 `_expanded=true`、永不派发），但客户端分组时把哨兵也推进了子任务清单 → 4 行（第一行是哨兵「逐模块分析（等待 items）」）
- **修复**：`lgBuildGraph` 中哨兵（`id === 组id && _pendingItems`）不计入子任务清单；未展开时回填为唯一成员（占位渲染依赖）

### 3. 延迟展开命名：剥离「（等待 items）」后缀
- **根因**：`expandLoopTasks` / `expandConcurrentTasks` 直接用哨兵名（带后缀）拼迭代名和 `_loopGroupName` → 迭代名「逐模块分析（等待 items） - login」
- **修复**：函数入口计算 `baseName = name.replace(/（等待 items）$/, '')`，8 个命名点统一使用
- **曲折**：最初直接改 mjs 内联区，sync-modules 用 section 源重写 mjs 时把修改冲掉——最终落到正确的 section 源 `tools-preset.js`（附注释说明必须走 sync 链）

### 4. 下拉列表配色修复
- **根因**：`<option>` 元素继承父级 `color: 'inherit'`，浏览器下拉列表用默认样式（浅色背景+深色文字），深色主题下不可见
- **修复**：给 `<option>` 显式设置 `color: '#1e293b', background: '#f8fafc'`

## 部署链实证

- **Host 修改**：编辑 section 源 `code/plugins/workflow-host-preset/tools-preset.js` → `sync-modules.js` 同步进 mjs → `build.js` 重建 lib/index.js → cp preset mjs 到 `~/.dsh/.agent-presets/workflow-orchestrator/` → 提醒用户重启 dsh.service
- **Client 修改**：编辑 `code/packages/client-ui-monitor/src/client.js` → `build.js` 重建 lib/client.js → verify-client-bundle 求值级验证 → 强刷浏览器
- **纪律更新**：改 host 内联代码必须改 section 源（非直接改 mjs），否则 sync-modules 会覆盖

## 文件变更

- `code/packages/client-ui-monitor/src/client.js`（+473/-365）：删除旧扁平横排 DagCanvas + LoopGroupNode，替换为分层布局算法区 + 新 DagCanvas 渲染层；创建弹窗模板路径 + 错误清单；哨兵过滤；下拉配色
- `code/packages/client-ui-monitor/package.json`：v0.8.0 → v0.9.0
- `code/plugins/workflow-host-preset/tools-preset.js`（+23）：expandLoopTasks / expandConcurrentTasks 入口加 baseName 剥离，8 处命名点统一
- `code/packages/workflow-host/package.json`：v0.20.0 → v0.20.1
- `code/agent-presets/workflow-orchestrator/workflow-host.mjs`：sync-modules 自动同步
- `code/packages/workflow-host/lib/index.js`：build.js 自动重建
- `code/packages/client-ui-monitor/lib/client.js`：build.js 自动重建
- `PoC/dag-layered-prototype.html`（新增）：分层布局原型（多轮反馈定稿）

## 遗留（规划到后续迭代）

- **Iter-31**：节点详情面板（DAG 下方内嵌卡片）+ 交互增强（RUNNING 脉冲/自动跟随/文件内容预览）+ 主题适配（DSH 13 个 CSS 变量 token，173 处 style 对象替换）
- **Iter-29 遗留**：少量展示/交互小问题（用户判定不阻塞，留待后续规划）
