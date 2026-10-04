# 阶段 6 — DSH 0.2.0-rc.2 迁移（Mac 环境重建 + 版本迁移）

- **时间**：2026-10-03 ~ 10-04（Iter-MIG0~7：主体 0~4 + 收尾轮 5~7）
- **DSH 基线**：`0.1.5-rc.2` → **`0.2.0-rc.2`**（macOS；`~/.dsh-dev`）
- **交付**：`@workflow-agent/workflow-host` **v0.29.5**（单包形态延续；preset 随包声明制）
- **测试基线**：**608 单测全绿** + 真机回归 11 项 + 终验全面功能验收（A/B/C 三区块，阶段 1~4 全回归）
- **状态**：✅ **已完成并关闭**（用户验收 2026-10-04；阶段 5 归档总结，余量汇入阶段 7）

## 断裂项总账（B1–B6）

| 编号 | 断裂 | 修复 |
|---|---|---|
| B1 🔴 | `listChildren` 返回重构（SubagentCatalogEntry，无 kind）→ 停止级联静默失效 | 3 处消费点双形状兼容（MIG1） |
| B2 🔴 | preset 目录扫描退役 → agent-preset-registry 声明制 | 随包 patch 行 + build/install 链改造（MIG1，GUI 实证 MIG2） |
| B3 🟡 | 0.2.0 插件版本预检 | engines 收窄 `>=0.2.0-rc.2` + 硬编码清零（MIG1） |
| B4 🔴 | fs 服务 workspace-write 沙箱 → 物化拒写 | node:fs 直写（MIG2） |
| B5 🔴 | Host 作用域实例写入同遭沙箱拒 | `shared/fs-host.js` 适配层 22 处消费点（MIG2） |
| B6 🔴 | sessions 快照删 `current` + 订阅不推送 → 页签门控死锁 | 哨兵复活 + 组件不自注销（MIG3） |

## 归档索引

| 文档 | 内容 |
|---|---|
| [plan.md](plan.md) | 立项方案（两战线差异 / 初勘 F1–F9 / 决策 D1–D4） |
| [iterations/dsh-0.2.0-rc-upgrade-impact-and-migration-plan.md](iterations/dsh-0.2.0-rc-upgrade-impact-and-migration-plan.md) | MIG0：影响评估（断裂映射 + 兼容确认 + prompt 证伪） |
| [iterations/iter-migration-020rc2-report.md](iterations/iter-migration-020rc2-report.md) | MIG1：代码适配（B1–B3 + B4 追加轮） |
| [iterations/iter-migration-020rc2-env-report.md](iterations/iter-migration-020rc2-env-report.md) | MIG2：环境重建（B4/B5 + install 双缺陷） |
| [iterations/iter-migration-020rc2-regression-report.md](iterations/iter-migration-020rc2-regression-report.md) | MIG3：行为回归（B6 + 11 项矩阵） |
| [iterations/iter-migration-020rc2-closeout-report.md](iterations/iter-migration-020rc2-closeout-report.md) | MIG4：收尾（版本锁定矩阵 + 总账 + 移交项） |

## 收尾轮（Iter-MIG5~7，2026-10-04 用户拍板追加后完成）

| 迭代 | 交付 |
|---|---|
| MIG5 页签门控 | 事件驱动终版（retainedBy.mainView 主视图解析 + list.subscribe 事件链 + 组件即时注销；哨兵 5s 兜底）；[技术报告](../../design/client-tab-gating-design.md) |
| MIG6 热生效实证 | Host 无 HMR 须重启 / client 强刷即生效；GUIDE §5 逐行标注 |
| MIG7 终验 | sys-design 真实负载 ✓ + 干净重装 ✓ + 悬空复验 ✓ + 全面验收清单（含阶段 1~4 全回归）+ 立即修复（workflowPath 两级链 / checker 校验 / 预览 fallback / 断链智能提示） |

## 遗留 / 移交（全部 → 阶段 7）

- 阶段 6 验收问题 **O-3~O-12**（含复验关闭项 O-3）；
- O-2 已解决（MIG5）；Host HMR 范围已知（须重启）；pnpm 悬空行为已固化防护（⓪/⓪.5）。
