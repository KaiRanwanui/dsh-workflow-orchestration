# 阶段 6 · DSH 0.2.0-rc.2 迁移（Mac 环境重建 + 版本迁移）— 立项方案稿

> **状态**：立项已确认（D1–D4 拍板 + B2/B3 补充拍板 2026-10-03）。Iter-MIG0 ✅（断裂项 B1–B3）、Iter-MIG1 ✅（编码完成，603 测试绿，待真机验收）；下一步 Iter-MIG2 环境重建。
> **性质**：插入阶段 —— 阶段 5（设计作业流专项）暂停期间执行，迁移验收后恢复阶段 5。
> **起草**：2026-10-03（Mac 新环境首轮勘察 + 0.2.0-rc.2 实包抽查）

---

## 0. 背景与触发条件

- 原开发设备（Win + WSL2）故障，环境迁移至 macOS；Mac 上已装 DSH **0.2.0-rc.2**（dsh-cli 管理，`~/.local/share/dsh-cli/`，289 个 `@deepseek-ai/*` 卫星包同版本）。
- 项目当前基线：DSH **0.1.5-rc.2** / host **v0.27.1**（602 单测基线，阶段 5 Iter-46-2 部署后未复验）。
- 阶段 5（sys-design 作业流专项，Iter-44~57 计划）被打断：Iter-44/45/46 已关闭，**Iter-46-2（Reset 注入修复）编码部署完成但复验未做** —— 复验顺延至迁移完成后在新环境执行。

## 1. 本次迁移与阶段 2 的差异（两条战线）

| 维度 | 阶段 2（0.1.1→0.1.5） | 本阶段（0.1.5→0.2.0） |
|---|---|---|
| 版本跨度 | 小版本 rc 序列 | **0.1.x → 0.2.x 大版本**，断裂面预计 ≥ 阶段 2 的 B1–B8 |
| 运行环境 | 同机（WSL2）原地升级 | **跨设备 + 跨 OS**：WSL2/Linux → macOS |
| 环境重建 | 旧环境丢弃重装即可 | Mac 为**净环境**：无 web profile、无 preset 部署、无物化资产、无 dsh.service 等价物（systemd 不存在） |
| 源码 diff 条件 | 实包在手 | **已有现成克隆**：`~/Projects/dsh_projects/deepseek-harness/`（HEAD=0.2.0-rc.2，`dsh-v0.1.5-rc.2`/`dsh-v0.2.0-rc.2` 双 tag 已拉取，可直接 diff；无需重新克隆） |
| 数据迁移 | 全部丢弃（用户决策） | **不抢救**（用户拍板 2026-10-03：有备份，需要时按需复制；`.workflow-agent/instances` 等运行态放弃，孤儿回收机制兜底） |

## 2. 初步勘察结论（已实证，2026-10-03）

对 `~/.local/share/dsh-cli/node_modules/@deepseek-ai/` 0.2.0-rc.2 实包抽查：

| # | 触点 | 0.1.5-rc.2（我方基线） | 0.2.0-rc.2 实包初勘 | 影响初判 |
|---|---|---|---|---|
| F1 | `sessionController.prompt` | `prompt(request, signal)`，signal 必填（首行 `throwIfAborted()`） | **`prompt(request)` 单对象签名**；内容校验先行，signal 处理方式移位（进 request 或删除，待 Phase 0 核实类型） | ⚠️ 疑似断裂 |
| F2 | `subagents.listChildren` | `listChildren(parentSessionId)` | `listChildren(parentSessionId, signal)`（signal 可选） | ✅ 兼容 |
| F3 | `subagents.interruptByParent` | `(child, parent, mode)` | 仍存在（Remote 装饰器实现） | 待核语义 |
| F4 | `sessionController.cancel` | `cancel({sessionId})` | `cancel(request)` 形式仍在（commands.cancel 转发） | 待核字段 |
| F5 | `sessions.get` / agents store | resident 语义判活 | 待核（阶段 2 教训：以实包为准） | 待核 |
| F6 | persona 配置 | `config.prefix` 必填 | dsh-agent-preset 0.2.0-rc.2 中 prefix 相关实现待核 | 待核 |
| F7 | Client 投影 | `byId[id].projectionValues.agentPreset` | dsh-web-app 实包待核 | 待核 |
| F8 | cordis.patch.yml / bundle 注册 | insert 单行双端（0.1.5 实证约束） | 待核 | 待核 |
| F9 | 硬编码路径 | — | 全仓仅 6 处 `/home/zhaokai`（simulate-exec.js / render-smoke.mjs / client.js 开发兜底 1 处），`workflow_samples/` 无 | 低危，Phase 2 顺手清理 |

> F1 证明「以实包实现为准」的教训依然成立：0.2.0 的 prompt 签名再次变化。**Phase 0 必须逐项重验全部耦合点，不信任任何文档推断。**

## 3. 耦合面清单（Phase 0 核对范围，收敛于少数文件）

- `code/plugins/workflow-host/apply-prologue.js` —— 服务探针（sessions/agents/subagents/sessionController）、A1 `session/event` tap、路由与工具注册入口（**核心**）
- `code/plugins/workflow-host/webserver-routes.js` —— 面板 Stop 的 `sessionController.cancel` 权威直停
- `code/plugins/workflow-host-preset/tools-preset.js` —— `workflow_*` 十个工具注册方式
- `code/packages/workflow-host/src/client.js` —— projectionValues 投影读取、conversation.view 槽位
- `code/packages/workflow-host/cordis.patch.yml` + `package.json`（`dsh.engines`、`dsh.bundle`、`dsh.client` 字段）
- `code/agent-presets/workflow-orchestrator/` —— preset schema（persona prefix、composition）
- `code/packages/workflow-host/build.js` / `build-client.mjs` / `code/scripts/test-host.js` —— 构建链在 macOS/Node≥22 下的可运行性

## 4. 阶段任务（5 个，沿用阶段 2 方法模板；迭代号 Iter-MIG0~4）

### 任务 1 · Phase 0 影响评估与迁移计划细化（Iter-MIG0）

1. 源码 diff 通道：直接使用现成克隆 `~/Projects/dsh_projects/deepseek-harness/`（`git diff dsh-v0.1.5-rc.2 dsh-v0.2.0-rc.2 -- packages/<域>/<包>`）。注意：`~/.local/share/dsh-cli/` 为残留工具代码（用户拍板：不需要关注）；运行实包核对以实际安装位置为准，Phase 0 勘察确认；
2. 对 §3 耦合面逐项核对 0.2.0-rc.2 源码/实包，产出**断裂点映射表（before/after，仿阶段 2 §3.3 七项映射）**；
3. 核对范围至少覆盖：sessionController（prompt/cancel/事件流）、subagents（listChildren/interruptByParent/prompt+delivery）、sessions/agents 判活语义、`session/event` payload、webServer 路由注册 API、preset schema、client 投影、cordis.patch.yml 格式、dsh profile/服务管理（macOS 无 systemd 的等价机制）；
4. 产出：`iterations/dsh-0.2.0-rc-upgrade-impact-and-migration-plan.md`（B 级断裂项编号 B1…Bn + 映射 + 四阶段执行勾选表）。

### 任务 2 · Phase 1 代码适配（Iter-MIG1）

- 按断裂点映射逐项落地（预计集中在 apply-prologue.js / webserver-routes.js / client.js / preset）；
- **[B2 拍板补充]** preset 随包 + **必须改造 build 与打包工具**：向环境安装一律从打包产物（构建出的包）执行安装，不得从源码目录直挂——`build.js` / `build-release.js` / `install.js` 同步改造并验证「tgz 构建 → 从产物安装」全链路；
- **[B3 拍板补充，硬要求]** 用户目录**严禁硬编码**：§2-F9 的 6 处 `/home/zhaokai` 全部 `os.homedir()` 化或删除（含开发兜底），并加一条全仓扫描防回归；
- `dsh.engines` 收窄为 `>=0.2.0-rc.2`（D1 细化：0.2.0 新增插件版本预检，收窄后可被预检正确拦截）；
- 版本号：host **v0.28.0**（迁移 minor 段，仿阶段 2 0.20.1→0.21.0）；
- 验证：`node build.js` + `test-host.js`（602 基线全绿；若单测依赖 0.1.5 API mock，随适配同步修订，listChildren fixture 改 0.2.0 `SubagentCatalogEntry` 形状）。

### 任务 3 · Phase 2 环境重建 + 挂载（Iter-MIG2，可与任务 2 部分并行）

Mac 净环境从零搭建（沿用 README 快速开始，按 0.2.0 实况修订）。**目录约定（用户拍板）：开发用 dsh home 是 `~/.dsh-dev/`；`~/.dsh/` 属于 dsh-desktop，与开发环境无关，禁止混用**：

1. web profile 重建（位于 `~/.dsh-dev/profiles/`）：从打包产物安装——`dsh plugin --profile web add <构建出的包>`；
2. preset 部署：随 B2 改为 bundle patch 声明行，随包安装自动生效，不再有独立目录部署步骤；
3. 内建资产物化验证（`~/.dsh-dev/workflow-agent/`：4 模板 + 7 技能 + samples/docs，启动时自动）；
4. 服务管理适配：优先启用 0.2.0 live profile HMR（插件改动热生效），验证「改 Host → 即时生效」后退役重启流程文档；
5. 阶段 5 运行现场：按需从用户备份复制产物文档（D2 已拍板：不主动抢救，运行态实例放弃）。

### 任务 4 · Phase 3 行为回归 + 缺陷修复轮（Iter-MIG3，预计多轮）

复用阶段 2 回归清单 + 阶段 5 已跑通资产，全部在新环境真机执行：

- 面板四键「agent 真实感知」（Start/Stop/Resume/Reset）；
- A1 停止链路（UI 停止 → session/event tap → 权威停止；面板 Stop → cancel 原生级联）；
- demo 工作流端到端 ×2；
- 孤儿回收 / 重启后 hasState 磁盘水合；
- **门禁 subagent 分支（PASS→COMPLETED）真实链路**（阶段 2 遗留未复跑项，本次顺带关闭）；
- **Iter-46-2 Reset 注入修复复验**（阶段 5 欠账，合并到此轮）；
- sys-design 作业流（阶段 5 资产）至少跑通 1 个完整实例 —— 兼作迁移验收与阶段 5 恢复的双重验证。
- 发现缺陷即开单修复（预期 0.1.5→0.2.0 跨度会带来 ≥ 阶段 2 的 6 项量级）。

### 任务 5 · Phase 4 收尾（Iter-MIG4）

- 版本锁定矩阵落档（主包 + 关键卫星包，仿阶段 2 验证报告「版本锁定」节）；
- README / GUIDE / status.md 刷新（§3.5 环境路径全面改 Mac 实况，dsh-cli 目录、profile 布局、服务管理）；
- 已知限制归档；阶段 6 关闭，**恢复阶段 5**（Iter-47 起，或先做 sys-design 跑通延续）。

## 5. 风险表

| 风险 | 等级 | 缓解 |
|---|---|---|
| 0.2.0 大版本断裂面超出初勘（F1 已证实签名再变） | 高 | Phase 0 逐项实包核对 + 源码 diff 双通道；不赶工期 |
| macOS 服务管理差异（无 systemd/dsh.service） | 中 | Phase 2 勘察 dsh-cli 管理命令；GUIDE「重启生效」条目随验随改 |
| 单测 mock 绑定 0.1.5 API 形状 | 中 | 适配时同步修订 mock；602 基线不允许净减少 |
| 旧设备数据不可取（design-trial 现场 / 实例） | 中 | D2 决策：不可取则接受重建，sys-design 资产在仓库内可重放 |
| 跨 OS 路径/大小写/文件锁差异 | 低 | 全仓仅 6 处硬编码；实例目录路径均相对 home |

## 6. 决策项（已全部拍板，2026-10-03）

| # | 决策 | 结论 |
|---|---|---|
| D1 | `dsh.engines` 是否收紧为 `>=0.2.0-rc.1`（放弃 0.1.5 兼容） | ✅ 收紧（旧设备已报废，无双版本并行需求；用户未持异议，按建议执行） |
| D2 | 阶段 5 运行现场与实例数据是否从旧设备抢救迁移 | ✅ 不抢救（用户有备份，需要时按需复制；运行态实例放弃） |
| D3 | 阶段命名：立为「阶段 6」，阶段 5 暂停标记 | ✅ 按本方案（目录 `phase-6-dsh-020-migration/`） |
| D4 | deepseek-harness 源码克隆 | ✅ 不重新克隆：现成克隆在 `~/Projects/dsh_projects/deepseek-harness/`（双 tag 齐）；`~/.local/share/dsh-cli/` 为残留工具代码，不需要关注 |

## 7. 验收标准（阶段 6 关闭判据，2026-10-03 用户修订：MIG3 后不算完成，移交项专项解决）

1. 602+ 单测全绿（允许增加，不允许减少）；
2. §4 任务 4 回归清单全项通过（含门禁分支、Iter-46-2 复验）；**✅ MIG3 已达成**
3. sys-design 作业流在新环境完整跑通 ≥1 实例；**⏳ 未达成（初版收官时以 demo 顶替，用户裁定不行——归 Iter-MIG7）**
4. 版本锁定矩阵 + 文档刷新落档；**✅ MIG4 已达成**
5. **移交项清零（新增，Iter-MIG5~7，用户拍板「不带病恢复阶段 5」）**：
   - O-2 空 Workflow 页签消除（Iter-MIG5）；
   - Host 改动生效方式实证 + 开发流程定型（Iter-MIG6）；
   - sys-design 真实负载验收 + install 悬空场景专项复验（Iter-MIG7）。

## 8. 收尾轮规划（Iter-MIG5~7，2026-10-03 用户拍板追加；**✅ 全部完成并验收 2026-10-04**，交付详见各迭代报告）

### Iter-MIG5 · 页签门控完善（消 O-2 空页签，**事件驱动为硬要求**）

- **现状**：B6 终版 = entry 恒挂载 + 哨兵复活 + 组件 null 门控；非编排会话下页签 label 静态显示「Workflow」（空页签）。
- **用户要求（2026-10-03 拍板）**：页签隐藏/显示必须走 DSH 原生机制**优雅解决，首选事件订阅**；轮询哨兵只允许作过渡态，不得为终态。
- **技术路径**（按优先级探针取证，遵守「以实包为准」）：
  1. **事件订阅**：找到 0.2.0 客户端「当前会话切换」的正确订阅源（宿主 `ConversationMainPanel` 的 sessionId 来源 / `useSession` 单会话 store / sessions store 的正确订阅姿势——旧 `svc.list.subscribe` 实证不推送，需查正确成员或事件）；
  2. label 动态化 + 宿主重求值语义（空 label 是否隐藏页签）；
  3. 0.2.0 `ConversationViewRegistry` 条件视图/可见性 API。
- **验收**：非编排会话页签消失、切回编排会话即时恢复（事件驱动，无轮询）、无闪烁；603 基线不减；哨兵退役或降级为兜底（带日志可观测）。

### Iter-MIG6 · Host 热生效机制实证与开发流程定型

- **内容**：
  1. Host（node 侧）改动生效方式实测：live profile 是否覆盖 Host 插件热重载；若无，定型「终端重启 dsh web」流程；
  2. client bundle 改动生效链验证（官方 client-hmr 的 watcher 前置条件：`pnpm run dev:web`？）；
  3. GUIDE「改哪里 → 生效方式」对照表逐行实证标注（现在是经验推断）。
- **验收**：GUIDE §5 表格每行有真机实证结论；开发循环（改→验）耗时明确。

### Iter-MIG7 · 真实负载验收 + 干净重装 + 全面功能验收（阶段 6 终验）

- **内容**：
  1. `workflow_samples/sys-design/` 作业流完整跑通 ≥1 实例（多任务 + 门禁 + 真实技能链，非 demo 负载；§7 判据 3 补课）；
  2. install.js ⓪/⓪.5 悬空场景**专项复验**（构造悬空 dep → 自动修正 → 实体同步断言；pnpm 行为记录归档）；
  3. **迁移终验（用户拍板 2026-10-03）**：收尾轮全部迭代完成后——**重新打包 → 从产物干净重装**（卸载旧包 → 清物化目录 → tgz 安装 → 重启 → 物化/路由/preset 自检），并向用户提供**可操作的全面验收清单**（GUI 分步操作 + 每步预期结果，覆盖：preset 会话创建 / 实例创建·编辑·删除 / 四键控制 / DAG 呈现 / 门禁 / 实例管理（归档/下载）/ 多实例切换 / 页签门控）；
  4. 可选：delivery/probe-inject 真实拓扑实测（阶段 2 遗留，视 sys-design 运行形态顺带）。
- **验收**：用户按清单逐项验收通过 → §7 判据 1~5 全绿 → **阶段 6 关闭 → 恢复阶段 5（Iter-47 起）**。
