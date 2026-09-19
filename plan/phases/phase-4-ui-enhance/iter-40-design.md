# Iter-40 设计 — RUNNING 运行视觉（呼吸脉冲 + DAG 自动跟随 + U1 门禁角点修复）

- **阶段**：阶段 4（现有功能修复/补全）
- **日期**：2026-09-19
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.26.26` → 发行时阶段内第三格顺延
- **状态**：**待用户确认后编码**
- **来源**：队列 Iter-40 + U1 补验（iter-32 验收发现，多次顺延）+ plan.md 补充设计中已拍板细节

---

## 1. 踏勘结论（代码级，2026-09-19）

| 项 | 现状 |
|---|---|
| DAG 渲染 | `DagCanvas`（React.memo）：SVG，任务节点 = rect(bg)+状态条(bar)+状态点(dot)；布局坐标 `p.x/p.w` 可得 |
| 状态色 | `C.RUNNING` 等色板常量；fingerprint 去重已有（L803/812） |
| 滚动容器 | DagCanvas 外层 `overflowX: auto` div（L1407），父层渲染——**无 ref** |
| **U1 根因（实证）** | 门禁角点条件 `n.task.gate`（L1306）——但 client **从未构造 `.gate` 字段**（快照字段是 `gateChecker/gateResult/gateNote`）→ 角点从未渲染过；数据源稳定可用，修复即接对字段 |
| 已拍板（plan.md 补充设计） | `<style>` 注入 keyframes、`wfdag-` 前缀防串扰、色值沿用 C 色板、状态迁移即停；自动跟随=视口外才滚、每指纹一次、极简无开关 |

## 2. 交付件

| # | 交付件 | 说明 |
|---|---|---|
| 1 | RUNNING 呼吸脉冲 | `<style>` 注入 `@keyframes wfdag-pulse`（opacity 呼吸，不改几何尺寸防 SVG 抖动）；`status==='RUNNING'` 的节点状态点(dot)+状态条(bar) 加 `animation: wfdag-pulse 1.6s ease-in-out infinite`；状态迁移后条件不再命中即停 |
| 2 | DAG 自动跟随 | 滚动容器加 ref 传入 DagCanvas；`useEffect` 依赖 fingerprint：存在 RUNNING 节点且其 x 在可视区外（`x < scrollLeft || x+w > scrollLeft + clientWidth`）→ `scrollLeft = nodeX - clientWidth/2`（平滑：容器 `scroll-behavior: smooth`）；**每指纹一次**（ref 记录已跟随指纹）；多 RUNNING 取第一个 |
| 3 | U1 门禁角点修复 | 角点条件 `n.task.gate`（永不存在的字段）→ `n.task.gateChecker`；色值：`gateResult` PASS=绿 / FAIL=红 / 未出=灰（快照字段全程稳定，执行前后角点恒在） |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `src/client.js` | DagCanvas：keyframes `<style>` 注入（一次）、RUNNING 节点动画绑定、自动跟随 useEffect（fingerprint 依赖 + 每指纹一次 ref）、角点条件/色值修复；父层滚动 div 加 ref prop |
| 服务端 | **零改动**（快照字段已齐备） |

## 4. 决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 脉冲元素范围 | a) 状态点+状态条同步呼吸（弱动效，不动几何） b) 仅状态点 | **a**（RUNNING 一眼可辨，幅度低不扰） |
| 2 | 多 RUNNING 跟随目标 | a) 第一个 RUNNING（DAG 顺序） b) 最近状态变更的 RUNNING | **a**（顺序执行语义下=当前推进节点；并发组=组内首个，可接受） |
| 3 | 跟随方式 | a) scrollLeft 直接设置 + 容器 `scroll-behavior: smooth` b) 节点元素 scrollIntoView | **a**（SVG 子元素 scrollIntoView 兼容性风险，容器滚动可控） |

## 5. 验证标准（完成线）

- [ ] 单测全绿（无回归；纯 Client 改动，无新服务端断言）
- [ ] 产物级：bundle + verify-client-bundle + 部署产物核验
- [ ] 真机：①RUNNING 任务节点呼吸脉冲，DONE/FAILED 后即停 ②RUNNING 节点在视口外时自动滚入居中，同指纹不重复滚动 ③配置门禁的任务全程显示右上角点：未出结果=灰、PASS=绿、FAIL=红，执行后不消失 ④用户手动横向滚动不被抢滚动条（仅指纹变化时跟随一次）

## 6. 工作量估计

**约 0.75 人天**（脉冲 0.2 + 跟随 0.25 + U1 0.15 + 真机回归 0.15）。
