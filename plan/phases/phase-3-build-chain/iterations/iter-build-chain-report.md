# 阶段 3 迭代报告（3a + 3b）— 构建链合并重构

- **状态**：✅ 3a + 3b 完成关闭（2026-09-15，用户 GUI 验收通过）；⏳ 3c 发行工具待细案确认
- **阶段**：阶段 3（构建链合并重构）
- **版本**：host **v0.22.0** / client **v0.9.2**（client `dsh.engines` 对齐 `>=0.1.5-rc.1`）
- **测试**：**569 单测全绿**（563 + 6 条产物级回归）；真机冒烟通过（`/wf/list` 200、materialize ok、资产完整、面板 DAG 正常）
- **方案**：[`../plan.md`](../plan.md)（6 决策点已全部拍板）

## 1. 目标与范围

消除「一份逻辑两份代码」的构建链：单一生成器从源模块直接产出交付物（CJS `lib/index.js` + ESM `dist/workflow-host.mjs` 双产物入库），单测对准真实交付物；mjs 手编中间物退役；legacy 代码集中归档。

## 2. 设计决议（用户拍板）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | section 作用域 | **模块作用域**（12 个 section 顶层均纯定义，已核实；异常时生成器 flag 回退嵌套） |
| 2 | mjs / dist | 生成器**双产物**：CJS `lib/index.js` + ESM `dist/workflow-host.mjs`（**入库**）；`--format=cjs\|esm\|both` 开关；`agent-presets/` 旧手编 mjs 删除 |
| 3 | 3c 发行工具 | **本阶段必须提供**（S1–S8 之后，细案另行确认） |
| 4 | 3d persona 文件化 | **移出本阶段**，独立迭代先探针验证（4 项前置探针已登记 `plan/status.md` 阶段 4 候选） |
| 5 | legacy 处置 | **代码保留**，集中 `code/legacy/`（`git mv` 保历史）；文档不再描述为现役 |
| 6 | 版本号 | host 0.22.0 / client 0.9.2 |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `code/plugins/workflow-host/apply-prologue.js` | **新增**：apply 前言源模块（探针 + 注册表装配 + A1 tap，从 mjs L11–114 逐字抽取） |
| `code/plugins/workflow-host/webserver-routes.js` | **新增**：`/wf/*` 路由源模块（从 mjs L5107–6425 逐字抽取 + 停止级联 v4 修订，见 §5） |
| `code/scripts/module-manifest.js` | **新增**：构建清单（name/inject + 14 项有序源模块表） |
| `code/packages/workflow-host/build.js` | **重构**：单一生成器（双产物、剥离条件导出块、`--format` 开关、`--check` 新鲜度、`build()/needsBuild()` 可编程调用） |
| `code/scripts/test-host.js` | 单测对准真实产物（6 处 `import(mjs)` → `require(lib)`）；`expandLoopTasks` 改指现役实现；产物新鲜度自动重建；新增用例 31（产物级回归） |
| `code/agent-presets/.../workflow-host.mjs` | **删除**（6430 行手编中间物退役；ESM 形态由 `dist/` 承接） |
| `code/legacy/**` + `code/legacy/README.md` | legacy 集中归档（build-host.js / sync-modules.js / *.ps1 / workflow-host 的 index.js·rpc.js·tools.js·dist/ / workflow-client/ / workflow-rpc/ / ui/ / probes/ / workflow-rpc.mjs） |
| `code/packages/*/package.json` | 版本 0.22.0 / 0.9.2；client `dsh.engines.dsh` → `>=0.1.5-rc.1` |
| 部署副本 | `~/.dsh/.agent-presets/workflow-orchestrator/` 移除两个未挂载 mjs（preset = 3 文件） |
| 文档 | `GUIDE.md`、`code/README.md`、`code/scripts/README.md`、`code/plugins/README.md`、`code/legacy/README.md`、`.gitignore`（legacy 路径）、`plan/status.md` 全部对齐 |

## 4. 实施与验证（差分步骤）

| 步骤 | 内容 | 验证 |
|---|---|---|
| S1 | 抽取 apply-prologue.js | 逐字 diff ✅；`node --check` ✅ |
| S2 | 抽取 webserver-routes.js | 逐字 diff ✅；语法 ✅ |
| S3 | manifest + 生成器双产物 | `lib` 导出面/`dist` ESM 具名导出 ✅；条件导出块 0 残留 ✅；`module.exports` 唯一 ✅；模块作用域冒烟（10 工具注册 + `/wf/list` 200）✅ |
| S4 | test-host 对准真实产物 + 现役实现 | 563 → 569 全绿（见 §5 缺陷 #7 说明） |
| S5 | 新增产物级回归用例（用例 31） | 导出面 / 工具数=10 / 路由往返 / dist 存在 ✅ |
| S6 | 真机冒烟（用户重启） | `/wf/list` 200；journal `materialize ok`、0 异常；资产 4 模板 + 7 技能完整；**GUI：DAG 渲染正常** |
| S7 | 删除旧 mjs + 版本号 + 部署副本同步 | `agent-presets` preset 目录 = 3 文件；版本 0.22.0 / 0.9.2 |
| S8 | legacy 集中 `code/legacy/` + README | 现役 `code/` 顶层仅 `agent-presets / legacy / packages / plugins / scripts / shared` |

## 5. 缺陷发现与修复

### 缺陷 #7：面板 Stop 在「主会话空闲」时不停止后台子会话（严重）

- **现象**：实例启动、子会话后台执行（主会话派发回合已结束）→ 点面板 Stop → 引擎即停（user-stop 落盘），但 deep-analysis 子会话**继续执行至自然完成**（子会话终局 `completed` 而非 aborted）。
- **根因**：v3 停止级联为**互斥**设计——`sessionController.cancel` 成功即跳过子会话级联。而主会话空闲时 `cancel` 是**空转成功**（无活回合可中止、也不级联后台子会话）→ 子会话无人处理。
- **为何此前未暴露**：9-13 的验收测试点击时机恰好命中「主会话回合活跃」→ cancel 中止活回合触发原生级联，碰巧覆盖。本阶段重构后首次按「派发完成后点击」的时序测试，缺陷显形。
- **与本迭代的关系**：**非重构引入**——停止级联代码逐字保真迁移（S1/S2 diff 证据）；该缺陷自 v3 设计（阶段 2 收尾）即存在，本阶段首次以「派发后空闲」时序测出。
- **修复（级联 v4，叠加式）**：
  1. `engine.stop()` + 落盘 + `stopReason=user-stop`（不变）
  2. `sessionController.cancel({sessionId})`——中止主会话活回合（原生级联）
  3. 枚举全部子会话（durable 全量，不判活）
  4. **`drainContinuableChildren(parentAgent, childIds)`**——硬释放 resident continuable 激活（不依赖判活；absent 目标 no-op）
  5. drain 不可用 → 逐子 `interruptByParent`（父会话离线亦可寻址）
  6. 注入通知（降级为事后告知）
- **验证**：用户 GUI 复测两次（`cancelled=true drained=true children=2/5`），子会话立即终止 ✅；停止后子会话返回不再唤醒主会话（user-stop 语义保持）✅

### 附带发现：`expandLoopTasks` 单测曾命中 legacy 副本

`test-host.js` 从 `plugins/workflow-host/tools.js`（39 行旧实现）导入 `expandLoopTasks`，而现役实现在 `tools-preset.js`（82 行，含 Iter-30 修复）——**循环展开用例一直在验证死代码**。已在 S4 修正为现役实现（用例全绿，未发现行为差异，定性为「测试目标错误」而非现役 bug）。

## 6. 验证结果

| 验证项 | 结果 |
|---|---|
| 单测 | **569 全绿**（含用例 31 产物级回归） |
| 产物 | `lib/index.js` 条件导出块 = 0；`module.exports` 唯一；apply 后导出面完好 |
| 双产物 | CJS `lib/index.js` + ESM `dist/workflow-host.mjs` 同源产出，均入库 |
| 构建链 | 单命令生成；`--check`/`--format` 开关；测试自动重建陈旧产物 |
| 真机 | `/wf/list` 200、materialize ok（资产完整）、面板 DAG 正常、面板 Stop 立即终止主/子会话（用户验收） |
| 减重 | 删除 6430 行手编 mjs + legacy 集中归档；`code/` 现役/历史界限清晰（`legacy/README.md`） |

## 7. 遗留与后续

| 项 | 去向 |
|---|---|
| **3c 发行工具**（npm 打包 + 安装器 + preset 分发 + client `build.js` ESM 警告清理） | 本阶段收尾前，细案待确认 |
| 3d persona 文件化（先 4 项探针） | 阶段 4 候选（`plan/status.md`） |
| 门禁 subagent 分支真实链路复跑 | 后续迭代顺带 |
| `dsh_wf_ws` 测试实例清理 | 用户自理 |

## 8. 参考

- 方案：`../plan.md` · 阶段 2 报告：`../../phase-2-dsh-migration/iterations/iter-migration-015rc2-report.md`
- 关联缺陷：阶段 2 验证报告缺陷 #5（面板 Stop 架构修订）→ 本报告缺陷 #7（空闲主会话场景 + 硬释放）
