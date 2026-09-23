# Iter-46 报告 — 环境准备初充（design-init 环境初始化六步 v0.3）

- **状态**：⚠️ 编码与自验完成，待用户 GUI 验收（design-trial 新建实例跑环境初始化 + block 门禁）
- **阶段**：阶段 5（设计作业流专项）
- **版本**：无插件发行（不动 `code/`，host 基线维持 `v0.26.52`）；资产 `sys-design.yaml` v0.2 → **v0.3**
- **测试**：602 单测全绿 + 渲染冒烟 PASS + 定义/门禁/镜像结构断言
- **提交**：见 git log（资产+报告一并提交）

## 1. 目标与范围

按用户定稿的**环境初始化六步**充实 design-init：项目目录结构（工作空间为项目根）、工具齐备性检查与安装、知识准备（本版本占位）、输入件检查、git 建仓并初始化提交、输出环境准备报告（记录环境约束供后续任务确认）；门禁按六项到位性检查。PRD 改为工作空间外部输入件（不随工作流发布）；发布模型改为**预置镜像 1:1 + 本地独立目录**。

范围边界：知识下载/复制/索引构建占位；交付件仍落实例 `output/`（迁 `req_spec/`/`design_spec/`/`reports/` 留 Iter-47/48）；不动其余 22 份技能与插件代码。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 | 影响 |
|---|---|---|---|
| 1 | 六步过程 | 目录检查/创建 → 工具检查安装（git/python）→ 知识准备（占位）→ 输入件检查 → git 建仓+首提交 → 环境准备报告 | design-init v0.3 主干 |
| 2 | 项目根 | **工作空间根 = 项目根 = git 仓根**（非实例内） | 12 目录树落在 design-trial/ 下 |
| 3 | 目录结构 | `prd/`、`req_spec/`、`design_spec/`、`reports/`、`knowledge-base/{product-kb/{business,design,architect}, version-kb, personal-kb, dfx-kb}` 共 12 目录；拼写修正为 `knowledge-base`（用户授权直接改） | design-init 建树 + gate 点名检查 |
| 4 | PRD 外部化 | `input/PRD.md`（随模板复制）→ **`prd/PRD.md`**（工作空间根）；模板不再内置 input/；样例 PRD 存 sys-design-local/，materialize 播种（不覆盖） | yaml 12 处 inputs 改路径 |
| 5 | 门禁语义 | design-init 门禁 `on-failure: retry` → **`block`**（环境不就绪重试无意义，阻断等人工） | block 变体首次实战 |
| 6 | 技能元数据 | 准备过程与门禁检查均写成标准 SKILL.md，frontmatter 含 name/version/**description** | 两份 v0.3 技能已带 description |
| 7 | 技能自检取消 | 工作流技能不需环境自检——构建发布机制保证，运行即视为 OK | 原方案第 2 项检查删除 |
| 8 | 发布模型 | `workflow_samples/sys-design/` = 预置镜像（唯一发布源，1:1 发布）；`workflow_samples/sys-design-local/` = 本地独立目录（样例 PRD/materialize.sh/README） | 目录重组；materialize.sh 重写 |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `workflow_samples/sys-design/sys-design.yaml` | v0.3：PRD 路径 12 处 → `prd/PRD.md`；design-init 门禁 block；版本/描述/头注释 |
| `workflow_samples/sys-design/skills/sys-design-init/SKILL.md` | 重写 v0.3：环境初始化六步 + 7 小节环境报告结构；frontmatter 加 description |
| `workflow_samples/sys-design/skills/gate-design-init/SKILL.md` | 重写 v0.3：7 条检查项对齐（含整体判定：任一未决结论 → FAIL） |
| `workflow_samples/sys-design/` | 删除 `input/`、`knowledge/` 占位；模板内置 PRD 移出 |
| `workflow_samples/sys-design-local/` | 新增：`sample-prd/PRD.md`（原 input/PRD.md）、`materialize.sh`（镜像发布模型重写）、`README.md`（发布规则） |
| 预置目录 | 1:1 重建（yaml + skills/ + templates/，无 input/） |

## 4. 实施与验证过程

1. 目录重组（git mv 保历史）→ 镜像/本地二分。
2. 两份技能 v0.3 重写（活动项/检查项逐字对齐：12 目录点名、7 小节、block 语义）。
3. yaml v0.3（python 脚本改：13 处 PRD 引用含头注释、版本、design-init gate）。
4. 断言脚本（真实 parser）：version 0.3、12 处 `prd/PRD.md`、design-init block 无 retries、其余 11 任务 retry+1、24 技能文件存在、v0.3 技能含 description、镜像无 input/materialize.sh/README/knowledge 残留——全部 PASS（首跑断言脚本自身正则 bug 误报 description，grep 复核排除）。
5. 物化（镜像发布）：预置目录整目录替换；design-trial 技能 24 个；PRD 播种 `design-trial/prd/PRD.md`；镜像内核验无 input/。
6. 质量防线：test-host **602 通过 0 失败**；render-smoke PASS。

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 602 通过 0 失败 | `/tmp/test-host-46.log`（job bash-3） |
| 渲染冒烟 | ✅ PASS | `/tmp/render-smoke-46.log` |
| v0.3 配置断言 | ✅ 全 PASS | parser 断言脚本（见 §4.4） |
| 镜像结构 | ✅ 仅 yaml/skills/templates | 预置目录 ls |
| GUI 环境初始化 + block 门禁 | ⏳ 待用户验收 | 见 §7 验收指引 |

## 6. 问题与修复（若有）

| # | 现象 | 根因 | 修复 | 证据 |
|---|---|---|---|---|
| 1 | 断言脚本报两份技能缺 description | 脚本正则缺多行标志（^ 只匹配首行） | grep 复核 frontmatter 确认存在；脚本 bug 非资产 bug | head -5 输出 |

## 7. 遗留与后续

| 遗留 | 去向 |
|---|---|
| 知识下载/复制/索引构建（knowlege-base→knowledge-base 已修正拼写） | Iter-50/51 或按需 |
| 交付件落位迁 `req_spec/`/`design_spec/`、关键报告迁 `reports/` | Iter-47/48 格式化时一并调整 |
| 工具安装的实际执行路径（子会话命令能力） | 本次验收观察：design-init 报告的 `## 工具检查` 会如实记录探测方式 |
| **验收指引**：① 新建实例 → Start：design-init 产物 7 小节、design-trial 出现 12 目录树与 git 首提交、门禁 PASS 放行；② 负例（可选）：Start 前把 `design-trial/prd/PRD.md` 改名 → 不就绪 → 门禁 FAIL → 工作流 **block**（下游 PENDING） |

## 8. 参考

- 设计：本报告 §2 决议表（用户六步过程 + 门禁六项为原始输入）
- 资产：`workflow_samples/sys-design/`（镜像）+ `workflow_samples/sys-design-local/`（本地）
- 相关：Iter-44（框架/物化机制）、Iter-45（全任务门禁）报告
