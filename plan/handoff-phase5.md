# Session 交接 — workflow-agent 阶段 5 启动

## 项目现状（2026-09-20）
- 项目：DSH 的 workflow-agent 插件（工作流编排+DAG 监控面板），仓库 `/home/zhaokai/Projects/dsh_projects/workflow-agent`，远程 `github.com/KaiRanwanui/dsh-workflow-orchestration`（本地 master ↔ origin/main，已同步）。
- **阶段 4 已完成封版**：Iter-31~43 全部验收关闭（31/31 清单条目 ✅），最终基线 **host v0.26.52**，602 单测绿。部署形态=单包 tgz（Host 插件+面板 bundle+preset），已通过 install.js 干净重装端到端验证。
- 权威文档：`plan/status.md`（当前状态唯一权威）→ `plan/phases/phase-4-ui-enhance/README.md`（阶段总结）→ `GUIDE.md`（工程导览）。

## 工作规则（必须遵守）
1. 每个迭代**先出设计方案报用户确认，确认后才编码**；方案不预设版本号（发行时阶段内第三格 +1，第二段恒 26）。
2. 迭代流程：方案 → 编码 → 报告归档 `iterations/` → 用户验收 → 关闭；仅阶段收尾时更新 status.md。

## 质量防线（提交/部署前必跑，任一失败禁止交付）
```
node code/packages/workflow-host/scripts/render-smoke.mjs    # 深渲染语义冒烟
node code/packages/workflow-host/scripts/verify-deploy.mjs   # 部署产物核验（部署后跑）
node code/scripts/test-host.js                               # 602 单测
```
部署方式：build-release.js → **tar 直解**到 `~/.dsh/profiles/web/node_modules/@workflow-agent/workflow-host`（**禁用 pnpm**——其对 file: tgz 的 store 缓存键不含内容）；manifest 用 python 从 repo package.json 版本派生。详细军规见 `plan/development/team-conventions.md`「防静默失败军规」。

## 待办输入（下一阶段候选）
1. **权限矩阵对齐专项**（用户发起）：结构编辑仅 CREATED 可改 vs 放宽到非 RUNNING——修改场景需与用户对齐后拍板。
2. /wf/skill 围栏收口（64KB/二进制检测）。
3. 阶段 4 验收遗留：见 `plan/phases/phase-4-ui-enhance/acceptance-checklist.md` 文末汇总。

## 启动动作
阅读上述文档后，向用户确认阶段 5 的目标与迭代队列，按工作规则第 1 条出首个迭代方案。
