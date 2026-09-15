# 阶段 3 — 构建链合并重构 + 发行工具

- **时间**：2026-09-14（方案拍板）~ 2026-09-15（3a+3b+3c 完成；执行中途按用户要求暂停过一轮做准备工作）
- **DSH 基线**：`0.1.5-rc.2`（不变）
- **交付**：`@workflow-agent/workflow-host` **v0.22.0** · `@workflow-agent/client-ui-monitor` **v0.9.2**
- **测试基线**：**569 单测全绿**（563 + 6 条产物级回归）+ 产物级验证 + 真机冒烟 + GUI 验收
- **状态**：✅ 已完成并冻结（3d persona 文件化移出，见「后续」）

## 阶段目标

消除「一份逻辑两份代码」的构建链（12 源模块同步副本 + 2 段只能手编的 mjs 区域），让单测对准真实交付物；修复交付物导出面缺陷；退役历史代码；补齐发行工具（npm 打包 + 安装器）。

## 交付能力清单（阶段结果）

| 能力域 | 交付内容 |
|---|---|
| **单一生成器** | `packages/workflow-host/build.js` 按 `scripts/module-manifest.js`（14 项有序清单）从源模块产出 `lib/index.js`（CJS 交付物）；`--format=esm` 按需产 `dist/workflow-host.mjs`（本地测试输出，不入库不随包）+ `--check` 新鲜度 |
| **源模块化** | 2 段手编区成为真实源文件：`apply-prologue.js`（探针 + 注册表 + A1 tap）、`webserver-routes.js`（`/wf/*` 路由）；同步纪律消失 |
| **交付物健康** | CJS 产物剥离 12 处条件导出块（修复 apply 后 `module.exports` 被覆盖缺陷）；导出面 = `{name, inject, apply, registerWebRoutes, loadStateFromFile}`（单测可直调路由） |
| **测试对准** | 单测加载真实交付物（6 处 mjs import 全部替换）+ 产物新鲜度自动重建 + 用例 31 产物级回归（导出面/工具数/路由往返/dist 存在） |
| **停止级联 v4** | 面板 Stop 修复「空闲主会话下子会话不停」：cancel（原生级联）+ 全量枚举 + **`drainContinuableChildren` 硬释放** + 逐子 interrupt 兜底 + 实例 `logs/stop-trace.log` 留痕 |
| **发行工具** | `build-release.js`（双产物 + Client 验证 + preset 暂存 + `npm pack` + 内容断言 + 版本矩阵）；`install.js`（`dsh plugin add` + preset 三件套同步，`--dry-run`/`--preset-only`/幂等）；preset 随 host 包分发 |

## 迭代索引

| 迭代 | 主题 | 报告 |
|---|---|---|
| 3a | 构建链合并：抽取 2 段手编区为源文件、单一生成器双产物、单测对准真实产物 | `iterations/iter-build-chain-report.md` §1–§5 |
| 3b | legacy 集中归档 `code/legacy/`（含 README：清单与退役原因） | 同上 §3（S8 行） |
| — | 缺陷 #7：面板 Stop「空闲主会话」不停后台子会话（v3 互斥级联设计缺陷 → v4 叠加式修复） | 同上 §5 |
| 3c | 发行工具：`build-release.js` + `install.js` + 包结构/preset 分发 | 同上 §9 |

## 关键机制（阶段 3 后的构建链）

```
源模块（14 项，scripts/module-manifest.js 有序表）
   └── packages/workflow-host/build.js（单一生成器）
         ├── packages/workflow-host/lib/index.js        # CJS 交付物（运行时加载；剥离条件导出块）
         └── packages/workflow-host/dist/workflow-host.mjs  # ESM 形态（**按需测试输出，不入库不随包**；2026-09-15 收尾修订）
测试 ── require(lib/index.js)（产物新鲜度自动重建）
部署 ── profile link:（构建即生效；Host 重启 / Client 刷新页面）
发行 ── scripts/build-release.js → release/*.tgz；scripts/install.js → 一键安装
```

## 设计决议（用户拍板，详见 `plan.md` §6）

1. section 作用域 = **模块作用域**（12 个 section 顶层均纯定义，已核实）
2. mjs → **退役**；ESM 形态降级为「`--format=esm` 按需的本地测试输出」（`dist/`，不入库、不随发行包）——2026-09-15 收尾修订；`agent-presets/` 旧手编 mjs 删除
3. 3c 发行工具 **纳入本阶段**
4. 3d persona 文件化 → **独立迭代**，先探针验证（4 项前置探针见 `plan/status.md` 阶段 4 候选）
5. legacy 处置 = **代码保留、集中 `code/legacy/`**
6. 版本号 = host 0.22.0 / client 0.9.2

## 阶段教训（已沉淀）

1. **单测必须对准真实交付物**——否则测的是死代码/中间产物（`expandLoopTasks` legacy 副本、mjs 路由测试均为实例）；
2. **生成产物不入库、不手编**——入库的手编中间物会制造「源/产物两说」与误跑风险（build-preset.js 事件）；
3. **停止类操作必须覆盖所有会话状态**——「主会话活跃/空闲」两种时序行为不同，验收要分别覆盖（缺陷 #7）。

## 后续（阶段 4 候选与开放项）

| 项 | 说明 |
|---|---|
| persona 文件化（先 4 项探针） | `plan/status.md` 阶段 4 候选表 |
| 门禁 subagent 分支真实链路复跑 | 后续功能迭代顺带 |
| npm publish 到 registry | 需账号/registry 决策；当前发行 = 本地 tgz + `install.js` |
| client `build.js` ESM 警告 | 可改名 `build.mjs` 消除 reparse 警告（微清理） |
| 节点详情面板 / 交互增强 / 主题适配（原 Iter-31 backlog） | 功能迭代队列 |
