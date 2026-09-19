# Iter-40 报告 — RUNNING 运行视觉（呼吸脉冲 + 自动跟随 + U1 门禁角点修复）

- **状态**：🚧 编码与单测完成，v0.26.27 已发行部署，**待用户真机验收**
- **阶段**：阶段 4（现有功能修复/补全）
- **版本**：host `v0.26.27`（阶段内第三格顺延；单包；纯 Client 改动）
- **测试**：602 单测全绿（无回归）+ bundle 求值验证
- **提交**：见 git log（5e4c4d0）

## 1. 交付件（方案=iter-40-design.md，推荐项全部采纳）

| # | 交付件 | 实现 |
|---|---|---|
| 1 | RUNNING 呼吸脉冲 | svgKids 注入 `@keyframes wfdag-pulse`（opacity 1→0.35→1）；RUNNING 任务节点状态点(dot)+状态条(bar) 绑定 `animation: wfdag-pulse 1.6s ease-in-out infinite`；状态迁移后条件不命中即停 |
| 2 | DAG 自动跟随 | 滚动容器 ref（DagCanvas 自持）；useEffect 每指纹一次：首个 RUNNING 节点视口外（偏离中心 >24px）→ `scrollTo({left, behavior:'smooth'})` 滚入居中；不抢用户手动滚动（仅指纹变化判定一次） |
| 3 | U1 门禁角点修复 | 条件 `n.task.gate`（client 数据模型中不存在 → 角点从未渲染）→ `n.task.gateChecker`（快照稳定字段）；色值 `gateResult`：未出=灰 / PASS=绿 / FAIL=红；执行前后恒在 |

## 2. 实施与验证

| 步骤 | 验证 | 结果 |
|---|---|---|
| DagCanvas 三处改造 | node --check + 构建 + bundle 求值 | ✅ |
| 全量单测 | test-host | ✅ 602 全绿 |
| 发行部署 | 内容断言 + 部署产物 grep（脉冲 2/角点 1/跟随 3） | ✅ v0.26.27 |
| 真机 | ⏳ §5 | |

## 5. 真机验收清单（用户 GUI：重启后台 + 强刷浏览器）

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | 启动工作流，观察 RUNNING 任务节点 | 状态点+状态条呼吸脉冲；DONE/FAILED 迁移后即停 |
| 2 | RUNNING 期间横向滚动使 RUNNING 节点出视口 | 指纹变化（任务状态推进）时自动平滑滚入居中；用户手动滚动不被抢 |
| 3 | 配置门禁的任务 | 右上角点全程显示：未出结果=灰 → PASS=绿 / FAIL=红，执行后不消失 |
| 4 | 并发/循环组任务 | 组内 RUNNING 迭代行状态正常；组节点聚合状态正确 |

## 6. 教训

- python str.replace 锚点未命中静默跳过（keyframes 注入首次未落地）——**批量编辑后逐项 grep 断言**（再次验证既有规则）。
- verify-client-bundle 是发行链的有效语法门（本轮两次拦截坏构建）。

## 7. 参考

- 设计：`iter-40-design.md`（U1 根因实证 + 已拍板细节沿用 plan.md 补充设计）
