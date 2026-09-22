# Iter-44 报告 — 设计作业流基本框架（12 任务串行链资产 + 双落位物化）

- **状态**：✅ 完成关闭（2026-09-22，用户 GUI 验收通过——12 任务跑通、衔接正确）
- **阶段**：阶段 5（设计作业流专项）
- **版本**：无插件发行（本迭代不动 `code/`，host 基线维持 `v0.26.52`）
- **测试**：602 单测全绿（基线确认）+ 渲染冒烟 PASS + 定义解析/校验实测
- **提交**：待入（资产与文档）

## 1. 目标与范围

建立系统分析与设计作业流的基本框架：12 任务与文件衔接，可在面板创建实例并完整跑通；skill 为占位版，**不要求实质性内容输出**。

范围边界：只做资产（workflow_samples/sys-design/）+ 物化脚本 + 迭代文档；不写实质 skill 内容、不配门禁、不做模板与知识资源、不改插件代码、不发行版本。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 | 影响 |
|---|---|---|---|
| 1 | 任务链定稿 | 12 任务串行：design-init 设计准备 → req-clarify 需求澄清 → uc-analy 用例分析 → func-impact 功能影响分析 → dfx-analy DFX分析 → sr-def SR定义 → req-review 需求评审 → func-design 功能设计 → dfx-design DFX设计 → ar-def AR定义 → design-review 设计评审 → design-baseline 设计基线 | 原 8 任务方案扩为 12；评审节点入链作门禁锚点 |
| 2 | 作业输入 | `input/PRD.md`（产品需求定义）作为 **design-init 的 inputs 声明**；**不使用 params** | 免去创建时填参；PRD 随模板子目录 1:1 复制进实例 |
| 3 | PRD 全局可见 | 全部任务 inputs 同时列 PRD + 直接上游产物 | 数据流卡片可见全局需求源；skill 可统一引用 |
| 4 | 门禁 | 本迭代**不配门禁**；Iter-45 引入，锚点=req-review / design-review | 框架期变量最少 |
| 5 | 资产落位 | 母本=仓库 `workflow_samples/sys-design/`（原 trial/ 更名）；运行现场=独立工作空间 `~/Projects/design-trial/` | 运行产物不进插件仓库 |
| 6 | 技能落位 | 技能物化到**运行工作空间** `design-trial/skills/`（两级链第一优先），定义入预定义模板目录 | 改 skill 不触碰 `~/.dsh` 全局区；沿用 serial-demo 成熟形态 |
| 7 | design-init 定位 | 环境准备锚点，Iter-46 滚动充实的挂载点 | 框架期产出「环境就绪声明」占位 |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `workflow_samples/sys-design/sys-design.yaml` | 新增：12 任务定义（串行依赖 + inputs/outputs 衔接） |
| `workflow_samples/sys-design/input/PRD.md` | 新增：示例产品需求（智能备忘录「快记」极简版） |
| `workflow_samples/sys-design/skills/sys-*/SKILL.md` | 新增：12 份占位技能（frontmatter + 最小指令 + 占位小节） |
| `workflow_samples/sys-design/templates/`、`knowledge/` | 新增：空目录占位（Iter-47/48、50/51 填充） |
| `workflow_samples/sys-design/materialize.sh` | 新增：双落位物化脚本（幂等） |
| `workflow_samples/sys-design/README.md` | 新增：资产说明 + 使用步骤 |
| `plan/phases/phase-5-design-workflow/*` | 阶段目录（README/iteration-plan/findings/trial-workflows） |

## 4. 实施与验证过程

1. **机制核实**（先于制作）：确认面板模板下拉只扫预定义目录 `${DSH_HOME:-~/.dsh}/workflow-agent/templates/<名>/<名>.yaml`（Iter-24 起工作区 templates/ 不列入）；创建时模板子目录 1:1 复制（Iter-27a）；processor 相对路径两级链=工作空间 → 预定义根。
2. **定义解析实测**：用真实 `shared/workflow-parser.js` 解析 → name=sys-design、12 任务、id 序正确、依赖串行、`processorRaw` 全部命中 `workflow_samples/sys-design/` 下的 skill 文件（missing=none）。
3. **校验器语境核实**：`workflow_validate`（definition 语境，锚定当前会话工作空间 dsh_projects）报 E-SKILL-MISSING/E-INPUT-MISSING——**符合预期**（本会话非运行现场）；读 `shared/workflow-validate.js` 确认实例语境解析为「实例目录 → defDir → 两级链兜底」、技能恒两级链，故创建后（PRD 随模板复制进实例目录、技能在 design-trial 工作空间）两类引用均可命中。
4. **物化执行**：`bash workflow_samples/sys-design/materialize.sh` → 模板落 `~/.dsh/workflow-agent/templates/sys-design/{sys-design.yaml,input/PRD.md}`；技能落 `~/Projects/design-trial/skills/sys-*`（12 个，frontmatter 起始标记经 `nl` 复核正确）。
5. **质量防线**：`render-smoke.mjs` → `RENDER SMOKE PASS`（三条语义断言通过；脚本打印后未自行退出，用 timeout 收尾，结论有效）；`test-host.js` → **602 通过 / 0 失败**。

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 602 通过 0 失败 | `/tmp/test-host.log`（job bash-1，exit 0） |
| 渲染冒烟 | ✅ PASS | `RENDER SMOKE PASS`（深主体语义断言/门控/文本量 219） |
| 定义解析 | ✅ 12 任务、串行依赖、技能无缺失 | `shared/workflow-parser.js` 实测输出 |
| 物化落位 | ✅ 模板 2 项 + 技能 12 个 | `ls` 复核 + skill 首 5 行 `nl` 复核 |
| GUI 跑通（12 任务） | ⏳ 待用户验收 | 待办：design-trial 会话创建实例 → Start |

## 6. 问题与修复（若有）

| # | 现象 | 根因 | 修复 | 证据 |
|---|---|---|---|---|
| 1 | 质量防线两脚本串联执行 300s 超时无输出 | `render-smoke.mjs` 打印 PASS 后进程不自行退出（疑似残留句柄），串联时吞掉后续输出 | 拆分为独立执行 + timeout + 日志落盘 | 拆分后 smoke PASS、单测 602 绿 |
| 2 | `workflow_validate` 定义语境报 24 条 E-SKILL/E-INPUT | 定义语境锚定**当前会话工作空间**，而资产在仓库、技能在 design-trial | 非缺陷；以实例语境解析代码核实（实例目录 → defDir → 两级链） | `shared/workflow-validate.js` §probeStaticPath/skillRefExists |

## 7. 遗留与后续

| 遗留 | 去向 |
|---|---|
| 实质技能内容（12 活动方法论） | Iter-45 |
| 门禁（req-review / design-review 锚点） | Iter-45 起 |
| 输出模板（templates/） | Iter-47/48 |
| 知识资源（knowledge/） | Iter-50/51 |
| 环境准备充实（design-init） | Iter-46 滚动 |
| PRD 替换为真实产品需求 | 实战跑通时（Iter-55/56） |
| `render-smoke.mjs` 打印后不退出（疑似句柄） | 观察项，若影响 CI 串联则开缺陷单 |

## 8. 参考

- 设计：`plan/phases/phase-5-design-workflow/iteration-plan.md`（修订三）+ 本报告 §2 决议表
- 资产：`workflow_samples/sys-design/`（README 含使用步骤）
- 相关：阶段 4 封版 `plan/status.md`；迭代池遗留（/wf/skill 围栏、权限矩阵对齐）
