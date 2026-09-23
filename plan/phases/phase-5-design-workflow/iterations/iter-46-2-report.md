# Iter-46-2 报告 — Reset 注入投错会话修复（v0.27.1）

- **状态**：⚠️ 编码、自验、部署完成——**待用户重启 DSH + GUI 复验**（Stop→Reset 序列 + PRD 负例）
- **阶段**：阶段 5（设计作业流专项）
- **版本**：host **v0.27.1**（阶段 5 首次发行；版本号规则 0.<阶段号>.<构建号>，见 team-conventions.md）
- **测试**：603 单测全绿（602+新增权威绑定断言）+ 渲染冒烟 PASS + verify-deploy PASS
- **提交**：bc105da（代码）；部署 = tar 直解至 `~/.dsh/profiles/web/node_modules/@workflow-agent/workflow-host`（强删旧目录，禁 pnpm）

## 1. 目标与范围

修复 findings F-1：面板 Reset 引擎侧成功、但「已重置+清理契约」注入主会话静默失败（指令被投进 Mnemon idle checkpoint review 子 subagent，清理无人执行）。三处修复：注入目标权威绑定、reset 清理引擎直执行、面板消费注入结果。

范围边界：编排侧工具 `workflow_reset` 的 pendingCleanup 契约**保留**（会话内自执行可靠，F-1 是面板路由链路特有）；stop 的 steer 模式、Iter-31「reset 停留 PENDING」语义不变。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 | 影响 |
|---|---|---|---|
| 1 | 迭代归属 | 单开 Iter-46-2（不并入 46） | 迭代计划修订四留痕 |
| 2 | 注入目标 | `entry.meta.sessionId`（创建/采纳时权威绑定）优先，客户端上送值仅兜底 | 子代理/子会话不可能再抢收控制指令 |
| 3 | 清理执行者 | 路由内 `node:fs.rmSync/mkdirSync/cpSync` 引擎直清 output/logs/inputs（模板含 inputs/ 时恢复）；**pendingCleanup 会话契约退役**（编排侧工具保留） | 消除「注入失败→无人清理」整条脆弱链 |
| 4 | 失败兜底 | 引擎清理异常（不应发生）→ 保留 legacy `pendingCleanup` 载荷 + `resetNote` 标注 ENGINE CLEANUP FAILED | 面板 alert 展示手动命令 |
| 5 | 面板反馈 | 四键统一消费注入结果：`messageInjected=false` → alert（error/reason + 手动清理命令如有） | 杜绝静默失败 |
| 6 | 版本号规则 | 0.<阶段号>.<构建号>（阶段 5=0.27.x 从 1 起） | 写入 team-conventions.md（c964024） |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `code/plugins/workflow-host/webserver-routes.js` | injectSessionCmd 增 `boundSessionId` 参数（meta 权威）；stop/resume/reset 调用点传绑定；start 内联块同规；reset 清理块引擎直执行 + legacy 兜底；reset 通知文案去清理契约；snap 增 `messageInjectionReason` 透出 |
| `code/packages/workflow-host/src/client.js` | 四键成功路径消费注入结果（alert 提示）；reset confirm 文案更新（产物目录由引擎清空） |
| `code/packages/workflow-host/package.json` | version 0.26.52 → **0.27.1** |
| `code/scripts/test-host.js` | S4 用例：注入目标断言（客户端冒名 sess-imposter → 实际落 sess-a）、文案断言去清理契约；c21 注释同步（工具侧契约保留） |

## 4. 实施与验证过程

1. 三处代码修复（见 §3）。
2. 版本 0.27.1 + 测试更新 → build.js 重建 lib/index.js（342,785B）。
3. test-host：**603 通过 0 失败**（新增 S4 权威绑定断言生效）。
4. render-smoke PASS；build-release.js → `workflow-agent-workflow-host-0.27.1.tgz`（内容断言 7 项 + 版本矩阵通过）。
5. 部署：强删旧包目录 → tar 直解（`package.json` 0.27.1、lib 内 Iter-46-2 标记 grep 命中）→ verify-deploy **PASS**。
6. **重启 DSH 由用户执行**（重启会终止本会话进程）。

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 603 通过 0 失败 | `/tmp/test-host-462.log` |
| 渲染冒烟 | ✅ PASS | `/tmp/render-smoke-462.log` |
| 发行构建 | ✅ 0.27.1 内容断言+版本矩阵通过 | build-release 输出 |
| 部署核验 | ✅ DEPLOY VERIFY PASS | verify-deploy.mjs（脉冲/跟随/归一/两级链/清零 7 类标记） |
| GUI 复验（Stop→Reset / Mnemon 子代理在场 / PRD 负例） | ⏳ 待用户重启后执行 | 见 §7 验收指引 |

## 6. 问题与修复（若有）

（编码过程无返工；F-1 本身即本迭代修复对象，见 findings.md）

## 7. 验收指引（重启 DSH + 强刷后）

1. **主路径**：实例跑若干任务 → Stop → Reset：主会话收到「已重置至 PENDING」纯告知（无清理契约字样）；`output/logs/inputs` 由引擎直接清空（archive 有备份）；面板无「消息未送达」提示；
2. **权威绑定**：在存在 Mnemon checkpoint-review 子代理的会话重复 Reset——指令只到达绑定会话（子代理不再收到）；
3. **负例（Iter-46 遗留）**：`prd/PRD.md` 改名后新实例 Start → design-init 判不就绪 → gate FAIL → **block 阻断**；
4. Reset 后 Start 全链重跑正常。

## 8. 参考

- F-1 台账：`findings.md`（根因链 + 修复记录）
- 迭代计划修订四；版本号规则：`plan/development/team-conventions.md`「版本号规则」
- 关联：Iter-44（物化机制）/ Iter-45（全任务门禁）/ Iter-46（环境准备）报告
