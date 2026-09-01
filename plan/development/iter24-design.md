# Iter-24 设计定稿：预定义目录与安装布局

- **设计确认**：2026-09-02 用户批准（含两个决策点拍板）
- **上游输入**：`../requirements/工作流数据管理需求.md`（R1-R4 地基）、`../design/definition-pipeline-discussion.md`（现状实证）、`iteration-replan-draft.md` §Iter-24
- **状态**：设计已批准，待开工（实施顺序：步骤 0 探针 → 收编技能 → 实现 → 验证）

## 目标

全局预定义目录落地 + 内建资产物化 + 两级路径解析 + 模板下拉切源——**任何空白工作区开箱即用 default-demo**。

## 已拍板决策

| 决策点 | 结论 |
|---|---|
| 预定义目录位置 | **`~/.dsh/workflow-agent/`**（用户确认） |
| 工作区 templates/ 迁移影响 | **接受**：不再进下拉，已有文件手工移入预定义目录（用户确认） |
| 内建模板去向 | 物化到预定义目录；升级同名直接覆盖（A2） |
| 路径解析 | 相对引用 workspace 根优先 → 预定义根兜底；绝对路径直通；双 miss 保持现行报错 |
| 模板下拉源 | 扫预定义目录为主，**内嵌常量兜底合并**（物化失败不至无模板） |

## 交付范围

1. 预定义目录四子目录：`templates/`、`skills/`、`samples/`、`docs/`（后两个本轮只建骨架+README）。
2. 物化机制：插件 apply 时确保目录并写入内建资产——模板 2 个（default-demo.yaml / serial-demo.yaml）+ 技能 5 个（deep-analysis / spec-writer / data-prep / integrator / integrator-checker，从 workflow_test_ws/skills/ 收编入仓库，收编时补 frontmatter `name`）。同名覆盖，幂等；失败不阻断插件启动（记日志+下拉兜底）。
3. 解析链改造：processor / gate.checker / items-from / inputs 的相对引用两级查找，替换现有"定义文件目录逐级上探"（resolveRel）。
4. `/wf/templates` 源切换+合并去重。

## 实施顺序

1. **步骤 0 探针**：Host fs 服务对 `~/.dsh/` 的写能力验证（本项目首个工作区外写入；被拒则按备选 a) DSH fs 配置扩范围 / b) 退插件包目录 / c) 再议，结论回报用户后定）。
2. 收编 5 个技能入仓库源码（builtin-skills 常量，sync-modules 新 section → build 链）。
3. 实现：物化 + 解析链 + 模板源（host 0.13.0，部署三处照常）。
4. 验证。

## 验证标准

- **单测**：解析链四情形（workspace 优先 / 预定义兜底 / 绝对直通 / 双 miss）；物化幂等（重复 apply 不炸、覆盖生效）；模板合并去重。
- **端到端**：① 空白工作区：建编排会话 → 下拉选 default-demo → 创建 → 启动 → COMPLETED（技能全部解析到预定义目录）；② workflow_test_ws 回归（workspace 同名 skills 优先）；③ DSH 重启后物化幂等。
- **部署**：lib 验证（node --check + 产物内容抽查）、预设 mjs 副本同步、systemctl 重启。

## 范围外

samples/docs 内容建设 / 多文件技能物化 / `${workspace}` 等目录变量（Iter-25）/ 语义校验（Iter-27）/ 技能版本展示（Iter-28）。
