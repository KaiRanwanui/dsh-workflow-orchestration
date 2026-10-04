# Iter-MIG1 · 代码适配报告（阶段 6 · DSH 0.2.0-rc.2 迁移）

> **状态**：编码 + 构建链验证完成，待真机验收（Iter-MIG2 环境重建后回归）。
> **依据**：[dsh-0.2.0-rc-upgrade-impact-and-migration-plan.md](dsh-0.2.0-rc-upgrade-impact-and-migration-plan.md)（Iter-MIG0 影响评估）
> **交付**：host **v0.28.0** · engines `>=0.2.0-rc.2` · **603 单测全绿** · 发行链 tgz 内容断言通过

---

## 1. 断裂项适配清单（全部完成）

### B1 🔴 listChildren 返回结构重构（3 处消费点）

| 消费点 | 适配 |
|---|---|
| `apply-prologue.js` `listRunningChildren` | 过滤改「有 id 即纳入；`kind` 字段存在时才校验 `kind==='child'`」——0.1.5 `SubagentListEntry` 与 0.2.0 `SubagentCatalogEntry`（`{id,createdAt,mode,label}`，无 kind/activity）双形状通吃；判活主源不变（`sessions.get` resident，agents 兜底） |
| `tools-preset.js` workflow_stop 级联（**MIG0 清单外，单测 c16 暴露补齐**） | 同规则改写 |
| `webserver-routes.js` 面板 Stop childIds 枚举 | 同规则改写 |

> **教训留档**：影响评估报告 §3 的消费点清单漏了 tools-preset 内的第三处（tool 侧直接调 subagents 服务，不走 apply-prologue 装配）——被既有用例 c16（workflow_stop 级联）当场拦住。**迁移类迭代的验收必须含全量既有测试，清单核对不能替代测试。**

- 单测 mock（test-host.js）同步改 0.2.0 catalog 形状（`{id,createdAt,mode:'continuable',label}`）。
- 回归：c16 级联打断 / stoppedChildren 语义 / c33 孤儿判定对照全过。

### B2 🔴 preset 交付形态迁移（目录扫描 → 随包声明制）

- **新增** `code/packages/workflow-host/presets/workflow-orchestrator.patch.yml`：`@deepseek-ai/dsh-agent-preset` 声明行（形态对齐官方 web-app `standard.patch.yml`），plugins = 原 agent.cordis.yml 现役行原样迁移；进 `dsh.bundle.patch` 链（`package.json dsh.bundle.patch: [cordis.patch.yml, presets/workflow-orchestrator.patch.yml]`）。
- **persona 随包**：`@workflow-agent/workflow-host/persona` 子路径导出（`lib/persona-file.mjs` + `lib/system-prompt.md`，build.js 复制并纳入新鲜度判定）——**persona 单一源约定保留**（改 md 不需构建，3g 机制延续），官方 `dsh-persona` 仅收内联文本故不采用。
- **退役标记**：`agent-presets/workflow-orchestrator/{preset.yml,agent.cordis.yml}` 头部注明退役与权威指向（留档不删）。
- **打包/安装链改造（用户拍板：安装只从打包产物执行）**：
  - `build-release.js`：③ preset 目录暂存步骤删除 → 内容断言改为 patch 声明 + persona 资产 + patch 链 7 项必含；⑤ engines 断言改对齐 0.2.0；输出安装指引改 `install.js --tgz release/`。
  - `install.js`：重写为**仅接受 `--tgz <dir>`**（源码目录直挂/link: 语义退役），新增 tarball 完整性预检（patch 链 + persona 资产必须在包内）。
  - `--preset-only` 模式删除（preset 随包，无独立部署步骤）。

### B3 🟡 版本预检 + 硬编码清零（用户硬要求）

- `dsh.engines` 收窄 `>=0.2.0-rc.1` → **`>=0.2.0-rc.2`**；版本 0.27.1 → **0.28.0**。
- `/home/zhaokai` 硬编码 6 处 → **0**：
  - `src/client.js`（相对 cwd 兜底）：改以当前工作区首项为基解析，无基则原样透传；
  - `scripts/simulate-exec.js`：状态文件落 `process.cwd()/.workflow-agent/`；
  - `scripts/render-smoke.mjs`：fixture 工作区取 `process.cwd()`（`WF_SMOKE_WS` 可覆盖）。
- 防回归：本报告为证，后续迭代提交前 `grep -rn "/home/" code/` 应为 0。

### B4 🔴 DSH fs 服务沙箱化（MIG2 真机实证新发现，2026-10-03）

- **现象**：物化静默全败（`~/.dsh-dev/workflow-agent/` 不创建、无任何残留）。探针 profile（wf-probe，3081 独立实例）捕获启动日志定性：30 个文件全部 `file access denied under workspace-write mode`。
- **根因**：0.2.0 新增 `fs-sandbox` 层——DSH fs 服务默认 **workspace-write 策略**，会话工作区之外的写入一律拒绝；物化目标（插件自有 home 目录）从架构上不可能再经 fs 服务写。
- **修复**：物化改 **node:fs 直写**（Host 进程自有装配，与 dsh 写 `~/.dsh-dev/profiles` 同一信任层级）；`materializeBuiltinAssets` 增加 `options.root` 注入点（单测临时目录）；调用点不再以 fs 服务存在为前置；c18 单测组重写为真实文件语义（临时目录）。
- **真机实证**：探针实例 `[workflow-agent] materialize ok root=.../.dsh-dev/workflow-agent written=30`，docs/samples/skills/templates 四层落盘。
- **波及面警示（已入长期记忆）**：项目内今后一切"写 home"路径禁走 DSH fs 服务；B1–B4 之外新增此条为 0.2.0 迁移第 4 项断裂。

## 2. 顺手修缮（迁移中实证）

- **render-smoke 挂起修复（Mac/Node 26）**：client 轮询裸 `setInterval` 吊住事件循环，断言全过后进程不退（旧 WSL/Node 静默兼容）。PASS 后显式 `process.exit(0)`。对照实验确认与本次适配无关（HEAD 版同样挂起）。
- `install.js` / `build-release.js` 头注释与用法提示全面对齐 0.2.0 形态。

## 3. 验证记录

| 项 | 结果 |
|---|---|
| `node build.js`（CJS + persona 资产复制） | ✓ lib/index.js 343,071 B + persona-file.mjs + system-prompt.md |
| `build-client.mjs` + `verify-client-bundle.js` | ✓ bundle 求值/inject/apply 冒烟全过 |
| `test-host.js` | ✓ **603 通过 0 失败**（基线 602 不减） |
| `render-smoke.mjs` | ✓ RENDER SMOKE PASS，exit 0 |
| `build-release.js` 全链 | ✓ tgz 产出 + 7 项内容断言 + engines 0.2.0-rc.2 矩阵一致 |
| 硬编码扫描 `grep -rn "/home/"` | ✓ 0 处 |

### 3.1 追加轮（MIG2 真机发现 B4 后，2026-10-03）

- **版本演进**：0.28.0（编码轮，B1–B3）→ **0.28.1**（B4 修复轮：物化 node:fs 直写 + options.root 注入 + c18 真实文件语义重写 + install.js 悬空引用修正）。纪律依据：同号重打不可追溯。
- **追加验证**：603 全绿（c18 重写后）；探针实例（wf-probe profile，3081）`materialize ok written=30` 真机实证；正式 profile 已落 0.28.1。
- **流程缺陷修正（install.js ⓪）**：历史安装把 `file:<tgz 绝对路径>` 写进 profile dependencies，release/ 重建后悬空 → pnpm 任何操作先撞 ENOENT、后续 add 全挂。install.js 现检测悬空 file: 引用即改写指向本次 tgz（dry-run 可预览）。

## 4. 已知限制 / 待真机（顺延 Iter-MIG2/MIG3）

- preset 声明行在 0.2.0 真机的实际注册与选择器呈现（`agent-preset-registry` 收集 preset 行的顺序与 `dsh.bundle.patch` 跨包次序）**未实证**——MIG2 挂载时首验；
- live profile HMR 下「改插件即时生效」与 Host 改动生效方式待勘察；
- 门禁分支（PASS→COMPLETED）真实链路、Iter-46-2 复验、sys-design 端到端 → Iter-MIG3 回归清单。
