# sys-design · 系统分析与设计作业流资产

阶段 5 主体作业流的资产母本（git 版本化）。**不在本目录运行实例**——运行现场是独立工作空间 `~/Projects/design-trial/`。

## 目录

```
sys-design.yaml    作业流定义（12 任务串行，见下）
input/PRD.md       作业输入样例（产品需求定义；实战时替换为真实 PRD）
skills/            12 份占位 SKILL.md（sys-<task-id>，Iter-45 起充实内容）
templates/         输出文档模板（Iter-47/48 填充）
knowledge/         设计作业知识资源（Iter-50/51 填充）
materialize.sh     物化脚本（幂等）
```

## 任务链（12 任务纯串行）

design-init 设计准备 → req-clarify 需求澄清 → uc-analy 用例分析 → func-impact 功能影响分析 → dfx-analy DFX 分析 → sr-def SR 定义 → **req-review 需求评审** → func-design 功能设计 → dfx-design DFX 设计 → ar-def AR 定义 → **design-review 设计评审** → design-baseline 设计基线

- 输入：`input/PRD.md`（design-init 的 inputs，随模板静态复制进实例目录；不用 params）。
- 衔接：`output/00~11-<id>.md` 逐级传递，全部任务 inputs 同时列 PRD（全局需求源）。
- 门禁锚点：req-review / design-review（Iter-45 引入门禁时优先落此两处）。
- design-init = Iter-46 环境准备锚点（滚动充实）。

## 使用

```bash
bash workflow_samples/sys-design/materialize.sh
# 然后在 design-trial 工作空间的编排会话面板：创建 → 选 sys-design → Start
```

物化落位：
1. 定义+PRD → `~/.dsh/workflow-agent/templates/sys-design/`（模板下拉可见，创建时 1:1 复制进实例目录）；
2. 技能 → `design-trial/skills/sys-*/SKILL.md`（processor `skills/<id>/SKILL.md` 两级链工作空间优先命中）。
