# Iter-31 报告 — 面板控制指令语义（reset 停 PENDING + stopHint 移除）

- **状态**：✅ 完成关闭（2026-09-16，用户真机验收通过：reset 停 PENDING 且 Agent 不自动 begin、提示条不再出现）
- **阶段**：阶段 4（现有功能修复；首个迭代）
- **版本**：host `v0.23.0 → v0.24.0`（单包；client 随包无独立版本）
- **测试**：567 单测全绿（1 用例断言随语义修订重写）+ 产物级验证通过
- **提交**：`94d9074`（代码 + 报告）+ `c84f857`（v0.24.0 发行重装 + 部署结论）

## 1. 目标与范围

修复验证开单缺陷 #1/#2：

1. **reset 之后自动执行**——根因：`/wf/reset` 注入编排会话的通知文案含「按全新工作流继续执行」，直接指示 Agent 自动 begin（begin 即 RUNNING）。修复目标：reset 后停留 PENDING，等待用户点 Start。
2. **stopHint 提示条存疑**——根因：Iter-23(A3) 遗产；Stop v4 后会话 UI 停止与面板 Stop 等效（用户验证清单 D.4 两时序通过），提示失去存在前提。修复目标：提示条与 `/wf/list` stopHint 计算整体移除。

**范围外**：补验 4 项（→ Iter-32 独立迭代）；其余 6 缺陷（→ Iter-33+）。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 | 影响 |
|---|---|---|---|
| 1 | reset 后行为（D2） | 停留 PENDING 等用户手动 Start | 注入文案改纯通知，删除续跑指示 |
| 2 | stopHint（D3） | 移除 | Host 计算 + 面板提示条整体删除 |

**实施中发现的关键约束**：reset 注入的 `extraText` 携带 **pendingCleanup 清理契约**（fs 无删除 API，output/logs 清空靠会话执行 bash）——通知不能是"零指令"，须保留清理命令但明确「仅清理、不含启动指令」。原文案「清空后再推进」一并修正。

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `code/plugins/workflow-host/webserver-routes.js` | ① `injectSessionCmd` reset 文案改纯通知（「已重置至 PENDING…请勿自行 begin 或启动工作流…等待用户发出启动指令」）② reset 调用处清理契约措辞「清空后再推进」→「仅清理，不含启动指令」③ 删除 `/wf/list` stopHint 计算块（14 行）与响应字段 |
| `code/packages/workflow-host/src/client.js` | 删除 `wfStopHint` 状态/赋值/重置、`stopHintBar` 定义与两处渲染（-14 行，留注释说明移除原因） |
| `code/plugins/workflow-host/instance-store.js` | 导出注释修正：`isAgentRunning`/`listRunningChildren` 不再标注"stopHint 判定用"（**方法保留**——池自愈/孤儿回收内部仍在用，遵守工作代码保护） |
| `code/plugins/workflow-host/apply-prologue.js` | A1 tap 注释同步：Case I 无提示为预期行为（原由 A3 提示条覆盖） |
| `code/scripts/test-host.js` | 用例 15 S4 断言随 D2 语义重写（见 §6） |
| `code/packages/workflow-host/package.json` | 版本 v0.23.0 → **v0.24.0** |
| `plan/status.md` | 阶段表补阶段 4 行；§3 刷新为阶段 4 进行中 |

## 4. 实施与验证过程（差分）

| 步骤 | 改动 | 验证 | 结果 |
|---|---|---|---|
| 1 | reset 文案（webserver-routes） | grep 确认旧文案 0 处、新文案 1 处 | ✅ |
| 2 | stopHint 移除（routes + client） | grep 全源码 0 处功能引用（仅注释留痕）；instance-store 内部方法确认仍有真实使用方（L873/912/928）后保留 | ✅ |
| 3 | 构建 | `build.js`（CJS 309951B）+ `build-client.mjs`（104973B）+ `verify-client-bundle.js` | ✅ 求值级三断言通过 |
| 4 | 单测 | `test-host.js` | 首跑 566/567 → S4 断言重写 → **567 全绿** |

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 567 全绿 | S4 新断言：文案含「已重置至 PENDING」+「等待用户发出启动指令」、不含旧续跑指示、含清理契约、queue 模式 |
| 产物级 | ✅ | bundle 求值 + `__ModuleLoader__.load` 注册 + factory 导出 apply/inject |
| 真机 reset（步骤 1） | ✅ 用户验收通过 | 重置后停留 PENDING，Agent 不自动 begin；面板 Start 正常启动 |
| 真机 stopHint（步骤 2） | ✅ 用户验收通过 | 原触发场景不再出现提示条；停止两通道复验仍全停 |

## 6. 问题与修复

| # | 现象 | 根因 | 修复 | 证据 |
|---|---|---|---|---|
| 1 | 首跑单测 566/567，S4「注入文案含全新运行语义」失败 | 用例断言的是**被本迭代有意移除的旧语义**（「按全新工作流继续执行」）——正是缺陷 #1 的根因文案 | 断言重写为新语义四要点（含 PENDING/等待指令/无续跑指示/清理契约） | §4 步骤 4 |
| 2 | 真机首验 reset 仍自动执行、提示条仍在（用户反馈收到旧文案） | **部署形态自阶段 3 实物验收起为 tgz 真实副本**（profile `package.json` 钉 `file:...0.23.0.tgz`），非早期 `link:`——仓库重建不生效，必须走发行重装 | `build-release.js` 产 v0.24.0 tgz → 修 profile 清单指向新 tgz → `pnpm install`（PNPM_HOME 对齐 `~/.npm-global/pnpm`）→ 部署核验：v0.24.0、功能文本仅新文案（旧文案仅存于注释引用）、stopHint 0、client bundle 已更新 | 本节上方部署核验记录 |

**部署形态结论（后续迭代通用）**：Host 改动交付链 = `build.js` + `build-client.mjs` + 单测 → `build-release.js` → 重装（pnpm 需 `PNPM_HOME=~/.npm-global/pnpm`；profile 清单 `file:` 版本号随 tgz 升版）→ 用户重启 `dsh.service`。GUIDE §4.4「构建即生效」描述的是阶段 3 前的 link: 形态，已不适用（阶段 4 收尾时统一修订 GUIDE）。

## 7. 遗留与后续

| 遗留 | 去向 |
|---|---|
| 补验 4 项（分支 SKIPPED/目录变量/技能覆盖/会话删除解绑） | Iter-32（预置 verify-* 测试模板后执行） |
| 缺陷 #3~#8 | Iter-33 ~ 38（见 plan.md 迭代队列） |
| GUIDE §4.4/§5「构建即生效」表述过时 | 阶段 4 收尾统一修订 |

## 8. 参考

- 设计：`plan/phases/phase-4-ui-enhance/plan.md`（v6 §3 Iter-31 详案）
- 验证输入：`plan/phases/phase-4-ui-enhance/verification-checklist.md`（问题清单 #1/#2）
