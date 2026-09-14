# 阶段 3 迭代方案 — 构建链合并重构

- **阶段**：阶段 3（构建链合并重构）
- **日期**：2026-09-14
- **DSH 基线**：`0.1.5-rc.2`（不变）
- **项目版本**：host `v0.21.0` / client `v0.9.1` → 目标 **host v0.22.0 / client v0.9.2**
- **状态**：✅ 方案已确认（2026-09-14，决策见 §6）→ ⏸ **暂停执行：等待用户准备工作完成**

---

## 1. 背景与目标

### 问题（均为实证，非推测）

| # | 问题 | 证据 |
|---|---|---|
| **P1** | **构建链是「一份逻辑两份代码」**：12 个源模块靠 `sync-modules.js` 复制进 `workflow-host.mjs` 的内联 section；另有 2 段代码**只存在于 mjs**（apply 前言、webserver-routes），只能手编。运维靠"记得跑脚本"的纪律 | `code/scripts/sync-modules.js:4` 的纪律注释；Iter-8/Iter-24 漏同步事故；mjs 6430 行 / 328KB 入库 |
| **P2** | **单测脱离真实交付物与真实实现**：① 6 处 `await import(mjs)` 测的是构建中间产物；② `expandLoopTasks` 从 **legacy 副本** `plugins/workflow-host/tools.js`（39 行旧实现）导入，而**现役实现**在 `tools-preset.js`（82 行，含 Iter-30 修复：`normalizeItemEntries`、哨兵名后缀剥离）——**循环展开的测试在验证死代码** | `scripts/test-host.js:10`、`:1229-1258`、`:2205-2222`；两份实现逐字 diff 不同 |
| **P3** | **交付物有真实缺陷**：12 个源模块尾部的 `if (typeof module !== 'undefined') { module.exports = {...} }` 未剥离，进入 CJS 产物后 `apply()` 执行时**逐个覆盖 `module.exports`**，最终 `name/inject/apply` 全部丢失 | 复现脚本 `scratch/corruption-check.js`：apply 后 `require(lib)` 的键变为 `registerWorkflowToolsPreset,…`（18 个），`apply === undefined`。线上未爆是因为 loader 在 require 时已捕获引用；但 HMR 重载（profile `patchReload: live`）、二次挂载、外部工具检查导出面都会看到损坏 surface |

### 目标（可验收）

1. **单一生成器**：从源模块（含新抽取的 2 段）直接产出交付物 `packages/workflow-host/lib/index.js`；**mjs 不再作为中间产物存在**。
2. **单测对准真实产物与真实实现**：路由测试打交付物；`expandLoopTasks` 用例指向现役实现。
3. **P3 缺陷修复**：产物内不再有条件导出块；新增回归用例锁死。
4. **仓库减重**：删除 mjs（6430 行）与 legacy 构建件。
5. **零行为变更**：除 P3 修复外，运行时语义与现状一致（真机冒烟验证）。

### 不做什么

- 不改任何工作流语义（引擎/状态机/路由/面板行为不变）；
- 不做 npm 发行打包与安装器（→ 3c，需另行确认是否纳入本阶段）；
- 不改 persona 注入机制（→ 3d，同上）；
- 不顺带修 P2 暴露的"两份实现差异"中的潜在 bug（只做定性记录，修复另立迭代）。

---

## 2. 交付件

| # | 交付件 | 路径 | 类型 |
|---|---|---|---|
| 1 | apply 前言源文件（探针 + A1 tap + 注册表装配） | `code/plugins/workflow-host/apply-prologue.js` | 新增（从 mjs 抽出，逐字保真） |
| 2 | webserver-routes 源文件（全部 `/wf/*` 路由） | `code/plugins/workflow-host/webserver-routes.js` | 新增（同上） |
| 3 | 模块清单（有序 section 表 + 插件元数据） | `code/scripts/module-manifest.js` | 新增 |
| 4 | 单一生成器（源模块 → **CJS 交付物 + ESM 生成物**；剥离条件导出块；开关 `--format=cjs\|esm\|both`，默认 both） | `code/packages/workflow-host/build.js` | 重构 |
| 5 | 单测改造（mjs → 产物；legacy → 现役实现；构建新鲜度保障） | `code/scripts/test-host.js` | 改造 |
| 6 | 产物级回归用例（导出面完好 / 路由往返 / 工具注册数 / 构建新鲜度） | `code/scripts/test-host.js` 新增用例节 | 新增 |
| 7 | mjs 删除 + 部署/文档同步 | 删除 `code/agent-presets/.../workflow-host.mjs`；更新 `GUIDE.md` §4-5、`code/README.md`、`plan/status.md`、`plan/build/*` | 清理/文档 |
| 8 | legacy 退役（3b） | 见 §4 Step 8 清单 | 清理 |
| 9 | 迭代报告 | `plan/phases/phase-3-build-chain/iterations/`（收尾归档） | 文档 |

---

## 3. 技术选型

| 决策 | 方案 A（推荐） | 方案 B | 理由 |
|---|---|---|---|
| **生成器归属** | 改造 `packages/workflow-host/build.js` 为唯一生成器（可被 `require`，`require.main` 时自跑） | 新建 `scripts/build-all.js` 串起 sync+build | A 让"构建"只有一个入口，且 test-host 可直接 `require` 它做新鲜度保障；B 多一层胶水 |
| **section 作用域** | **模块作用域**（与 ESM 原形一致，顶层常量只初始化一次） | 保持现役"全部嵌进 `apply()`"结构 | 已核实 12 个 section 顶层均为**纯定义**（函数/常量），无副作用；差异仅在初始化时机。若真机冒烟异常，生成器加 flag 回退嵌套（一行开关） |
| **mjs 处置** | ~~删除~~ **（已拍板）生成器同时产出 CJS 交付物 + ESM 生成物，ESM 入 `packages/workflow-host/dist/workflow-host.mjs` 并入库**；`agent-presets/` 下的旧 mjs 删除 | — | 保留 ESM 形态（应急/preset 本地插件路径不丢），但由生成器统一产出，不再是手编中间物 |
| **sync-modules.js** | 退役并移入 `code/legacy/`（职责并入生成器） | 保留原地 | 合并后无内联副本可同步 |
| **版本号** | host **0.22.0**（结构变更）/ client **0.9.2**（仅 `dsh.engines` 对齐 `>=0.1.5-rc.1`） | 不改版本 | 交付物接口（导出面）修复属可感知变更，升 minor 合理 |

---

## 4. 执行顺序与差分验证

> 原则：**一次只改一个维度**（约定 §A2）；每步有最小可观测验证；每步一个 git 提交（可回退）。

| 步骤 | 改动 | 验证手段 | 通过标准 |
|---|---|---|---|
| **S1** | 抽取 `apply-prologue.js`（mjs L11–114 逐字搬入） | 与 mjs 原文 `diff` | 逐字一致（除文件头注释） |
| **S2** | 抽取 `webserver-routes.js`（mjs L5107–6425 逐字搬入） | 同上 | 逐字一致 |
| **S3** | 建 `module-manifest.js`（14 项有序表 + `name`/`inject`）；改造 `build.js`：默认产出 ① `packages/workflow-host/lib/index.js`（CJS，剥离条件导出块，模块作用域，导出 `registerWebRoutes`/`loadStateFromFile` 供测试）② `packages/workflow-host/dist/workflow-host.mjs`（ESM 生成物，入库）；开关 `--format=cjs\|esm\|both`（默认 both） | 生成后与现役 `lib/index.js` 做结构化 diff；`node -e "require(lib)"` 校验导出；ESM 产物 `import` 校验 | 差异仅限：①剥离的 12 个条件导出块 ②作用域位置 ③导出面新增 2 个测试通道；无其他差异 |
| **S4** | `test-host.js`：6 处 `import(mjs)` → `require('../packages/workflow-host/lib/index.js')`；`expandLoopTasks` 改从 `tools-preset.js` 导入；启动时按 mtime 校验产物新鲜度（陈旧则调 `build()`） | 跑全量单测 | 全绿（若 expandLoopTasks 用例因实现差异失败 → 逐条定性：更新断言 or 记录现役 bug，**不在本迭代改实现**） |
| **S5** | 新增产物级回归用例：① `apply()` 后导出面完好（P3 锁死）② `/wf/create`+`/wf/list` 往返 ③ 工具注册数 = 10 ④ 产物新鲜度 | 跑新增用例 | 全绿 |
| **S6** | **真机冒烟**：部署 → 用户重启 `dsh.service` | `/wf/list` HTTP 200；工具 10 件套；面板 DAG 渲染；Start→Stop 一轮（agent 真实感知） | 全部通过 |
| **S7** | 删除 `agent-presets/.../workflow-host.mjs`（旧手编中间物）；更新部署清单（preset 目录不再需要 mjs；如需 preset 本地插件形态用 `dist/workflow-host.mjs`）、`GUIDE.md`、`code/README.md`、`plan/status.md` | grep 全库确认无旧 mjs 引用；部署点核对 | 无残留引用；preset 目录 3 文件（preset.yml / agent.cordis.yml / system-prompt.md） |
| **S8（3b）** | legacy **集中归档**（不删除）：`scripts/{build-host.js,sync-modules.js,*.ps1}`、`plugins/workflow-host/{dist/,index.js,rpc.js,tools.js}`、`plugins/workflow-client/`、`plugins/workflow-rpc/`、`ui/`、`probes/` → `code/legacy/`（`git mv`）；新增 `code/legacy/README.md` 说明来历与"非现役"；更新文档引用 | `grep` 确认现役链路无引用；移后跑单测；`code/` 顶层只剩现役目录 | 单测全绿；`code/` 现役/历史界限清晰 |

> **3c（发行工具）/ 3d（persona 文件化）** 为可选子迭代，见 §6 决策点 3/4；若纳入，排在本方案 S1–S8 之后独立执行（各自出小方案）。

---

## 5. 验证标准（完成线）

- [ ] **单测**：`node code/scripts/test-host.js` 全绿；循环展开用例指向现役实现；新增产物级用例通过
- [ ] **产物**：`lib/index.js` 中 `typeof module !== 'undefined'` 出现次数 = 0；`apply()` 后 `name/inject/apply` 完好
- [ ] **真机**：重启后 `/wf/list` 200、10 工具注册、面板 DAG + 四键一轮通过（用户验收）
- [ ] **构建链**：`node code/packages/workflow-host/build.js` 一条命令从源产出交付物；无 sync 步骤；陈旧产物自动重建
- [ ] **双产物**：`lib/index.js`（CJS）与 `dist/workflow-host.mjs`（ESM，入库）同源产出；`--format` 三态开关可用
- [ ] **减重**：`agent-presets/` 旧 mjs（6430 行手编中间物）删除；legacy 件集中到 `code/legacy/`（保留可用）
- [ ] **发行（3c）**：`npm pack` 产物内容断言通过；安装脚本 `--dry-run` + 全新 profile E2E 通过；`client.dsh.engines` 对齐 `>=0.1.5-rc.1`
- [ ] **文档**：`GUIDE.md` §4-5 与 `code/README.md` 的构建链描述更新；`plan/status.md` 阶段 3 状态回填；迭代报告归档到 `plan/phases/phase-3-build-chain/iterations/`

---

## 6. 决策记录（2026-09-14 用户拍板，全部闭合）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | section 作用域 | ✅ **模块作用域**（异常时生成器 flag 一行回退嵌套） |
| 2 | mjs / dist 处置 | ✅ **保留 dist 生成物、开关可选**；ESM 生成物入库；`agent-presets/` 旧 mjs 删除 |
| 3 | 3c 发行工具 | ✅ **本阶段必须提供**（S1–S8 之后执行，届时出 3c 细案） |
| 4 | 3d persona 文件化 | ✅ **独立迭代**：先写探针验证（4 项）后实施；记入 `plan/status.md` 阶段 4 候选 |
| 5 | legacy 处置 | ✅ **代码保留并集中到 `code/legacy/`**；文档同步更新 |
| 6 | 版本号 | ✅ host 0.22.0 / client 0.9.2 |

---

## 7. 风险与回退

| 风险 | 影响 | 缓解 | 回退点 |
|---|---|---|---|
| 抽取两段手编区时遗漏/错位 | 运行时行为变化 | 逐字 diff（S1/S2）+ 全量单测 + 真机冒烟（S6） | 每步独立提交；mjs 删除前可 `git revert` |
| 模块作用域初始化时机变化 | 首挂载异常 | 已核实无副作用；生成器 flag 可回退嵌套 | S3 提交 |
| 测试改造暴露 `expandLoopTasks` 两份实现差异 | 用例失败/需重新定性 | 逐条定性（现役更正确 → 更新断言；现役有 bug → 记录另立修复），**本迭代不改实现** | S4 提交 |
| 产物新鲜度机制误判（mtime） | 测试用旧产物 | 以"清单内任一源 mtime > 产物 mtime"为判据；单测首用例打印构建时间 | S4 提交 |
| 真机冒烟窗口需重启服务 | 需用户配合 1~2 次 | 合并到 S6 一次重启完成（避免多次） | — |

---

## 8. 工作量估计

| 子迭代 | 内容 | 估计 |
|---|---|---|
| **3a** | S1–S7（构建链合并 + 测试对准 + 真机冒烟） | 0.5 – 0.8 人天 |
| **3b** | S8（legacy 退役） | 0.2 人天 |
| **3c** | 发行工具（本阶段必须提供，S1–S8 之后执行） | 0.5 – 1 人天 |
| **3d** | persona 文件化 → **移出本阶段**（独立迭代，先探针验证；见 `plan/status.md` 阶段 4 候选） | — |
| | **本阶段合计（3a + 3b + 3c）** | **1.2 – 2.0 人天** |

关键路径：S1 → S2 → S3 → S4 → S6（真机冒烟，含用户重启）。

---

## 附：本方案的实证依据（可复现）

| 结论 | 复现方式 |
|---|---|
| 直接生成 CJS 可行 | 原型 `scratch/direct-build-proto.js`（12 源模块 + 2 段按行区间取）→ 生成 6388 行 CJS；导出齐全；10 工具注册；`/wf/list`、`/wf/create`、`/wf/validate-instance` 往返 200 |
| ESM `import` 可拿 CJS 具名导出（测试改造可行） | 同上，`import(lib)` 得到 `registerWebRoutes` 等 |
| P3 导出面缺陷 | `scratch/corruption-check.js`：apply 后 `require(lib).apply === undefined` |
| 两份 `expandLoopTasks` 实现不同 | 逐字 diff：39 行（legacy，无 `vars` 参数）vs 82 行（现役，含 Iter-30 修复） |
| 12 个条件导出块进入产物 | `grep -c "typeof module !== 'undefined'" packages/workflow-host/lib/index.js` → 12 |
