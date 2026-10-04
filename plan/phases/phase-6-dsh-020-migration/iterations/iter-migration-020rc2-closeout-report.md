# Iter-MIG4 · 收尾报告（阶段 6 · DSH 0.2.0-rc.2 迁移）

> **状态**：✅ 完成——**阶段 6 全部任务（Iter-MIG0~4）验收关闭，恢复阶段 5**
> **最终基线**：DSH **0.2.0-rc.2** / host **v0.28.7** / macOS（`~/.dsh-dev`）/ **603 单测全绿**

---

## 1. 本迭代工作

1. **诊断探针降噪**（v0.28.7）：移除 `[wf-gate]` 高频探针（inject/订阅成功/生命周期行），保留异常路径日志（applyGate 早退 bail、trySubscribe 失败）——后续排障仍可用。
2. **文档刷新**：README（项目状态/版本/快速开始 Mac 化 + install.js --tgz 流程）、GUIDE（校订头 + §3.5 环境表全面改 Mac 实况 + 0.2.0 关键语义摘要）、status.md 阶段表与任务表。
3. **backlog 移交**：O-2 空 Workflow 页签（B6 已知代价）记入阶段 5 待优化池。

## 2. 版本锁定矩阵（阶段 6 收官基线）

| 项 | 版本/值 | 备注 |
|---|---|---|
| DSH 主包 | **0.2.0-rc.2** | dsh-cli 安装，`DSH_HOME=~/.dsh-dev` |
| 关键卫星包 | 同版本 0.2.0-rc.2 | session-controller / subagent / agent-preset(-registry) / fs(-local/-sandbox) / web-app / tools 等（dsh-cli 单版本管理，无混版本风险） |
| @workflow-agent/workflow-host | **v0.28.7** | 单包：Host + 面板 bundle + preset 随包声明 |
| `dsh.engines` | `>=0.2.0-rc.2` | B3 收窄，0.2.0 插件版本预检可正确拦截 |
| profile | `~/.dsh-dev/profiles/web` | bundles 自动注册；file: tgz 依赖（install.js ⓪/⓪.5 守护） |
| 单测基线 | **603 通过 0 失败** | 基线 602 不减（c18 重写为真实文件语义） |
| 物化资产 | 30 文件四层 | `~/.dsh-dev/workflow-agent/` |
| 源码对照 | `~/Projects/dsh_projects/deepseek-harness/` | 双 tag（0.1.5-rc.2 / 0.2.0-rc.2），后续升级调研复用 |

## 3. 阶段 6 断裂项总账（B1–B6）

| 编号 | 断裂 | 修复轮 |
|---|---|---|
| B1 | listChildren 返回结构重构（SubagentCatalogEntry，无 kind）→ 停止级联静默失效 | MIG1（3 处消费点；MIG3 真机 children=3/6 实证） |
| B2 | preset 目录扫描退役 → agent-preset-registry 声明制 | MIG1（随包 patch + build/install 链改造；MIG2 GUI 实证） |
| B3 | 插件版本预检新增强制 | MIG1（engines 收窄）+ 硬编码清零 |
| B4 | fs 服务 workspace-write 沙箱 → 物化拒写 | MIG2 发现 / MIG2 修复（node:fs 直写） |
| B5 | Host 作用域实例写入同遭沙箱拒（工作区内也拒） | MIG2 发现 / MIG2 修复（fs-host 适配层 22 处） |
| B6 | sessions 快照删 current + 订阅不推送 → 页签门控死锁 | MIG3 发现 / MIG3 修复（哨兵复活 + 组件不自注销） |
| — | prompt(request, signal) 签名变化传闻 | **MIG0 证伪**（两版一致） |

## 4. 已知限制 / 移交项

- **O-2**（backlog）：非编排会话下空 Workflow 页签（B6 已知代价）；
- **Host 侧 HMR**：0.2.0 client-hmr 覆盖 client bundle；Host（node 侧）改动仍需重启 web——live profile 是否覆盖 Host 插件热重载未实证，后续迭代顺带观察；
- install.js ⓪/⓪.5 已实证，但「pnpm 对悬空 file: 依赖静默保留旧实体」的行为值得在 pnpm 升级时复查；
- `~/.dsh-dev/logs/startup-*.log`（诊断日志目录）机制可在排障时利用。

## 5. 恢复阶段 5

阶段 5（设计作业流专项）自 Iter-47 恢复：Iter-44/45/46 已关闭成果保留；Iter-46-2 复验已在 MIG3 完成（欠账清零）；sys-design 作业流资产（`workflow_samples/sys-design/`）具备在 0.2.0 重跑条件——建议恢复后第一件事以该作业流做一轮真实磨炼（迁移后首次非 demo 负载）。
