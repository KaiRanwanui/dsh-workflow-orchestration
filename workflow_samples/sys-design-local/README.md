# sys-design 资产说明（发布模型 v2，Iter-46 起）

阶段 5 主体作业流的资产母本。**目录二分**（用户拍板 2026-09-22）：

```
workflow_samples/
  sys-design/          ← 预置镜像（唯一发布源，结构与 ~/.dsh 预置目录 1:1 一致）
    sys-design.yaml    # 作业流定义 v0.4
    skills/            # 12 任务技能 sys-* + 12 门禁技能 gate-*
    templates/         # 输出文档模板（Iter-47/48 填充后随镜像发布）
  sys-design-local/    ← 本地独立目录（不进预置）
    sample-prd/PRD.md  # 示例 PRD（PRD=外部输入件，不随工作流发布、不声明为 inputs（创建期 preset 校验仅锚定模板子目录）；真实 PRD 放运行工作空间 prd/）
    materialize.sh     # 发布/物化脚本（幂等）
    README.md          # 本文件
```

**发布规则**：发布到预置 = 把 `sys-design/` 整目录 1:1 复制到 `~/.dsh/workflow-agent/templates/sys-design/`（materialize.sh 已实现）；**所有要发布到预置的文件必须先落在本镜像目录**，本地开发用件放 `sys-design-local/`。

## 任务链（12 任务纯串行，定义 v0.4）

design-init 设计准备（环境初始化六步，门禁 **block**）→ req-clarify → uc-analy → func-impact → dfx-analy → sr-def → req-review → func-design → dfx-design → ar-def → design-review → design-baseline（其余 11 任务门禁 retry+1）

## 环境初始化（design-init v0.3）创建的工作空间结构

以工作空间根为项目根（git 仓根）：`prd/`（外部输入件）、`req_spec/`、`design_spec/`、`reports/`、`knowledge-base/{product-kb/{business,design,architect}, version-kb, personal-kb, dfx-kb}`（本版本知识占位、索引未建）；`.gitignore` 排除 `.workflow-agent/`。

## 使用

```bash
bash workflow_samples/sys-design-local/materialize.sh
# 首次会播种样例 PRD 到 design-trial/prd/PRD.md（可替换为真实 PRD）
# 然后在 design-trial 工作空间的编排会话面板：创建 → 选 sys-design → Start
```

技能落 `design-trial/skills/`（两级链工作空间优先）；定义入预置模板目录（创建时模板子目录 1:1 复制进实例）。
