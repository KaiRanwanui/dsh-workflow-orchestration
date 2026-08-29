# 工作进展记录

| 日期 | 阶段 | 状态 |
|------|------|------|
| 今日 | 项目启动 + 需求对齐 + Schema 定稿 | ✅ 完成 |
| 今日 | **Iter-1 Host 插件 — 引擎基础** | ✅ 完成 |
| 今日 | **v1.1 Schema 增强 — 命名式 inputs** | ✅ 完成 |
| 今日 | **Iter-2 Agent Preset — 串行编排** | ✅ 完成 |
| 今日 | **Iter-3 Client 监控面板** | ✅ 完成 |
| 今日 | **Flicker 修复 — 模块级状态** | ✅ 完成 (`wff-9/pkg-14`) |

---

| 今日 | **Iter-4 循环 + 循环展开** | ✅ 完成 |

---

| 今日 | **架构调整 — Host 插件迁移至 desktop profile** | ✅ 完成 |

---

| 今日 | **Client RPC 链路方案定稿 — HTTP 轮询** | ✅ 完成（决策 + 参考文档） |

---

| 今日 | **Iter-5 Host/Client 架构调整 — Client RPC 链路修复** | ✅ 完成（webServer 路由 + fetch 轮询，DAG 验证通过） |

---

| 今日 | **WSL2 迁移 — 插件打包/安装/端到端验证** | ✅ 完成（web profile + link 依赖，修复迁移残留 + _loopIndex bug） |

---

| 今日 | **Iter-6 循环错误处理 + 日志清理** | ✅ 完成（onError=break/continue，50 单测通过） |

---

| 今日 | **Iter-7 并发执行引擎 + DAG 并发组可视化** | ✅ 完成（getRunnableTasks + max-concurrency，59 单测通过） |

| 今日 | **Iter-8 并发语义完善 + concurrent 节点 + DAG 增强** | ✅ 完成（组级/工作流级 max 最严格，65 单测通过） |

| 今日 | **Iter-9 多实例技术验证（DSH Session 探针）** | ✅ 完成（12 项探针全过，方案可行性确认，动态插件已清理） |

| 今日 | **Iter-10 实例目录与存储** | ✅ 完成（实例注册表 + 会话绑定 + 路由实例布局，79 单测通过，v0.4.0 已部署） |

| 今日 | **Iter-11 实例操控工具** | ✅ 完成（workflow_list/create/start/stop/reset + expandDefinition 共用重构，93 单测通过，v0.5.0 待重启部署） |

| 今日 | **Iter-12 前台实例界面** | ✅ 完成（DAG 跟随 session cwd + 实例切换条 + /wf/list，client v0.2.0；已部署验证） |

| 今日 | **Iter-13 面板创建按钮 + 模板库 v1** | ✅ 完成（POST /wf/create + 内置模板×2 + 表单 UI，104 单测通过，host v0.6.0 / client v0.3.0；已部署验证） |

| 今日 | **实例创建语义定稿 v2 + 迭代重排** | ✅ 文档落档（7 步产品流程映射、模板/实例严格区分、面板控制走注入通道；迭代按执行顺序重排：13 创建按钮+模板库v1 → 14 注入穿刺 → 15 面板控制 → 16 编辑器拆分推进；见 plan/design/instance-creation-semantics.md） |

| 今日 | **Iter-14 消息注入技术穿刺** | ✅ 完成（subagents.followup API 验证通过，CONDITIONAL GO；发现权限约束：目标 session 必须是 parent 的子 session） |

| 今日 | **Iter-15 面板控制 start/stop/reset** | ✅ 完成（Host 路由 /wf/start + /wf/stop + /wf/reset；Client 工具条按钮；**消息注入功能实现**：apiProxy.sessions.prompt 调用格式 rpcId+payload；host v0.7.0 / client v0.4.0） |

| 今日 | **Iter-16 运行状态机（Host）** | ✅ 完成（STAGE 补 STOPPED；engine 补 start/stop/resume/reset + setStage(STOPPED) 置 active=false；113 单测通过；host v0.8.0；已重启部署验证 UI 可见部分） |

| 今日 | **Iter-17 绑定模型 + 完整性（Host）** | ✅ 完成（工作区骨架物化 instances/+archive/；create-bind/adopt + 1:1 守卫；派生 UNBOUND/BOUND/DONE/BROKEN；整树完整性判定；125 单测通过；host v0.9.0；已重启部署验证：骨架物化 + sessionId=null + 无回归） |

| 今日 | **Iter-18 流程控制工具 + 路由 + 孤儿回收（Host）** | ✅ 代码完成（workflow_adopt/resume 新增；start/stop/reset 接线 Iter-16 状态机；reset 写 _reset_<state> 归档备份；孤儿惰性扫描识别+回收；BROKEN 拦截；system-prompt adopt→start 同步；137 单测通过；host v0.10.0 待重启部署） |

| 今日 | **Iter-19 WebUI↔workflow 配合调优（前后台联动）** | ✅ 代码完成（create 即绑定 /wf/create 绑 sessionId；执行期=RUNNING workflow_begin 补 start；编排 workflow_start 驱动已绑定实例；Client Start/Stop gating；**Session 启停同步** agent idle→stop、running→resume；143 单测通过；host v0.11.0 + client v0.5.0 待部署。手测发现阻塞后追加修复：/wf/create 与 create/begin 工具改走 createBind(1:1 守卫)+CONFLICT 自愈解绑，Client 创建按钮仅会话 UNBOUND 显示+仅未绑定实例可选+解绑弹窗告知；148 单测；host 0.11.1 + client 0.5.1） |

| 今日 | **Iter-20 前后台状态一致（Iter-19 收尾）** | 🔄 进行中（R1 /wf/list 补 sessionState+Client gating、R2 面板 Start 不置 RUNNING（状态归 workflow_start）、R4 Session 启停同步进 listInstances、R3 移除常驻切换条+空态/创建/采用弹窗；155 单测通过；host v0.11.2 + client v0.5.2 待部署。**剩余**：预设门控（仅编排会话显页签）+ BROKEN 展示） |

---

## 已完成工作

### 12. Iter-15: 面板控制 start/stop/reset（✅ 完成）

**迭代报告**：`plan/development/iter15-report.md`

**核心交付**：
- **Host 端**：POST /wf/start + /wf/stop + /wf/reset 路由（直接操作实例状态）
- **Client 端**：工具条按钮（Start/Stop/Reset）+ 状态联动显示
- **消息注入**：Start 按钮触发 session 执行工作流（apiProxy.sessions.prompt）

**关键技术发现**：
- DSH API 调用格式必须包含 `rpcId` 和 `payload` 字段
- 普通 session：`apiProxy.sessions.prompt({ rpcId, payload: { sessionId, mode: 'queue', content } })`
- subagent session：`apiProxy.subagents.prompt({ rpcId, payload: { parentSessionId, childSessionId, mode: 'continuable', content } })`
- `sessionPersistence.append` 只写日志不触发 agent loop
- DSH 源代码在 `@deepseek-harness-master`，API 调用方式不确定时优先查源码测试用例

**验证**：消息注入成功，session 执行工作流 ✅

**提交**：`62a463b` + `2b75f4d` + `2a4023a`

---

### 13. Iter-16: 运行状态机（Host）（✅ 代码完成）

**迭代报告**：`plan/development/iter16-report.md`

**核心交付**：
- **schema**：STAGE 枚举 `PAUSED` → `STOPPED`（workflow-schema.js + engine 兜底）
- **engine**：`setStage('STOPPED')` 置 `active=false`；新增运行状态机动作 `start`（仅 PENDING→RUNNING）/ `stop`（仅 RUNNING→STOPPED，保 DONE 进度）/ `resume`（仅 STOPPED→RUNNING，续跑保 DONE）/ `reset`（仅 STOPPED/COMPLETED/FAILED→全新 PENDING；begin 保留 def 供 reset）；非法转移抛错
- **单测**：用例 11 新增 9 断言（start/stop/resume/reset + STOPPED 不可 start + PENDING 不可 reset）

**验证**：单测 113/113（原 104 + 新增 9）；lib/index.js 构建通过（v0.8.0）；awaiting 部署验证（重启 dsh.service）

**范围**：纯 Host 状态机，未改路由/工具/前端（归 Iter-17/18/20）

---

### 14. Iter-17: 绑定模型 + 完整性（Host）（✅ 完成）

**迭代报告**：`plan/development/iter17-report.md`

**核心交付**：
- **工作区骨架物化**：`<workspace>/.workflow-agent/{instances,archive}`（首次挂接 workflow 会话，幂等，`ensureWorkspaceSkeleton`）
- **绑定语义（按用户确认）**：`create-bind`（新建实例写 `metadata.sessionId=S`）/ `adopt`（仅采用池中 `sessionId==null` 实例）；1:1 守卫（一会话一实例、一实例一会话、绑定后禁再绑）；仅删会话解绑；adopt 拒绝 RUNNING 实例
- **派生状态**：`UNBOUND/BOUND/DONE/BROKEN`（不侵入 DSH Session，实时从实例+整树派生；DONE 由 archive 声明，Iter-20 起成立）
- **整树完整性判定**：不设独立绑定指针；骨架缺场/实例目录损坏/1:1 冲突 → BROKEN

**验证**：单测 125/125（用例 12 新增 12 断言）；lib/index.js 构建通过（v0.9.0）；awaiting 部署验证

**设计确认（孤儿判定基准，源码佐证）**：归档≠死亡；孤儿=绑定会话离开 live store（`sessions.get(id)===undefined`）；孤儿回收挪 Iter-18（见 lifecycle-design §9.1）

**范围**：未改运行状态机（Iter-16）、控制工具/路由（Iter-18）、归档（Iter-20）、Client（Iter-21）

---

### 15. Iter-18: 流程控制工具 + 路由 + 孤儿回收（Host）（✅ 完成）

**迭代报告**：`plan/development/iter18-report.md`

**核心交付**：
- **工具接线到 Iter-16 状态机**：`workflow_adopt`（新）/`workflow_resume`（新）；`workflow_start`（须绑定+adopt 前置+engine.start）/`stop`（engine.stop）/`reset`（_reset_<state> 备份+engine.reset）；`workflow_list` 补派生状态 + orphans
- **路由**：`POST /wf/start|stop|reset|resume|adopt`；BROKEN 拦截 create/adopt/run；reset 走归档备份
- **孤儿识别+回收（惰性扫描）**：判定=`sessions.get()===undefined`（归档≠死亡）；回收=RUNNING 先 stop→解绑（sessionId→null）→保留 state.json 回 UNBOUND 池→可被新会话 adopt/resume
- **system-prompt/agent.cordis.yml**：adopt→start 两步同步

**验证**：单测 137/137（用例 13 新增 11 断言：控制全链路 + reset 备份 + status + 孤儿识别/回收）；lib/index.js 构建通过（v0.10.0）；awaiting 部署验证

**决策（用户拍板）**：孤儿触发=惰性扫描；start 须先 adopt；reset 备份在 Iter-18 写。孤儿判定基准经源码佐证（归档≠死亡，lifecycle-design §9.1）

**范围**：未改归档管理/UI（Iter-20）、Client（Iter-21/22）

---

### 6. Iter-5: Host/Client 架构调整 — Client RPC 链路修复（✅ 完成）

**决策**：`plan/architecture/architecture-decisions.md` §5；方案对比 `plan/design/client-host-communication.md`

**背景**：Client UI 迁移到 npm 包后 RPC 链路断裂（`host.call` 是动态插件闭包符号，npm 包无法使用）。
Iter-5 采用 **HTTP 轮询方案**：Host 注册 webServer 路由，Client 用 fetch 轮询。

**修改清单**：

| 文件 | 改动 |
|------|------|
| `code/agent-presets/.../workflow-host.mjs` | 新增 webserver-routes 模块：`registerWebRoutes()` 注册 `/wf/*` 前缀路由（status/skill/config）+ loopback 围栏 + `writeJson` + `loadStateFromFile` |
| `code/packages/workflow-host/build.js` | inject 改为 `['fs','tools','webServer']` |
| `code/packages/workflow-host/package.json` | 版本 0.2.0 → **0.3.0** |
| `code/packages/client-ui-monitor/src/client.js` | `host.call('wf:status')` → `fetch('/wf/status?...')`；`ctx.interval` → `window.setInterval`（npm 包 Client 无 timer 服务，官方 client 插件同用 setInterval） |
| `code/packages/client-ui-monitor/build.js` | 移除 `require("@deepseek-ai/dsh-client-runtime").host`；inject 改为 `['slots']` |
| `code/packages/client-ui-monitor/package.json` | 移除 `dsh-cordis-client-runner` peerDependency |
| `code/agent-presets/.../agent.cordis.yml` | `workflow-rpc.mjs` 行停用（注释掉，由 webServer 路由替代） |
| `code/scripts/build-and-install-all.ps1` | 说明更新（RPC 已停用） |
| `code/scripts/install-iter5.ps1` | 新建专用安装脚本 |

**验证结果**：

| 检验项 | 结果 |
|--------|------|
| workflow-host 路由单测（/wf/status 200、loopback 403、404、/wf/config、/wf/skill） | ✅ 全部通过 |
| 构建产物语法/格式 | ✅ |
| 安装到 desktop profile（0.3.0） | ✅ |
| Client bundle 进入 boot 图（新 rev ffb8536f9dd7） | ✅ |
| DAG 图显示（节点颜色绿/红/琥珀） | ✅ |
| 循环组折叠框 "↻ 逐模块评审 (8)" | ✅ |
| 状态条（demo-wf / COMPLETED / FAIL） | ✅ |

**踩坑记录**：

| 坑 | 现象 | 解决方案 |
|----|------|---------|
| DSH Desktop 外部 HTTP 403 | 所有外部请求返回 403 "forbidden" | 发现是 `x-dsh-desktop-renderer` token 访问控制（`dsh-src/desktop/lib/desktop-browser-access-*.js`），非插件问题；验证走 Electron 渲染进程内 |
| 部署目录文件被锁 | `~/.dsh/profiles/desktop/node_modules/` 文件无法覆盖 | DSH 加载插件时锁定文件，需完全退出 DSH 后安装（install-iter5.ps1） |
| preset 部署未同步 | `~/.dsh/.agent-presets/.../agent.cordis.yml` 中 workflow-rpc 仍启用 | 源码已注释，部署目录需 DSH 停止后同步 |

**架构认知（Iter-5 附带发现）**：

- DSH Desktop 内核 = 官方 dsh Host（web-app 组合），43120 是内部 webServer 端口
- webServer 有 `x-dsh-desktop-renderer` token 访问控制（Electron 渲染进程专属）
- HTTP 轮询方案在 DSH Desktop 渲染进程内可行（Client fetch 自动带头）
- 详见 `plan/development/client-rpc-research.md` §7

---

### 7. Iter-6: 循环错误处理 + 日志清理（✅ 完成）

**迭代报告**：`plan/development/iter6-report.md`

**核心交付**：
- `updateTask` 在任务 FAILED 时自动检查 `_onError`：`break` → 同组 PENDING 标记 SKIPPED；`continue` → 继续执行
- `hydrate` 恢复循环元数据（消除重启后 processBreak 失效的隐患）
- `getNextRunnableTask()`（跳过 SKIPPED，预留 Iter-7 并发引擎）
- `begin()` 清空历史日志（避免重新 begin 工作流时日志跨实例残留）
- DAG 布局（循环组折叠 + SKIPPED 琥珀色）在 Iter-4 已就绪，本轮仅做在线验证

**验证**：单测 50/50（新增用例 5 共 9 断言）；在线验证 order FAILED → payment 自动 SKIPPED（BREAK 日志正确）。

**提交**：`05f85aa`（核心）+ `00285ef`（测试 + 日志清理）

---

### 8. WSL2 迁移 — 插件打包/安装/端到端验证（✅ 完成）

**背景**：项目从 Windows dsh-desktop 迁移到 WSL2，迁移后未做打包/安装，需验证 Windows 既有成果被完整继承。

**环境差异**：
- WSL2 无 desktop profile（Windows Electron 形态），实际是 web(3080) + headless profile，用 pnpm 管理（nodeLinker: hoisted）
- 插件接入方式：link: 依赖 + `dsh.profile.bundles`（先例 `@yejiming/dsh-data-agent`）
- DSH 用用户级 systemd 管理（`systemctl --user restart dsh.service` 重启 Host）

**修复的迁移 bug**：
- 硬编码 Windows 路径 `C:/Users/ranwa/dsh_workspace` → `/home/zhaokai/Projects/dsh_projects`（提交 `659d87e`）
- `_loopIndex: undefined` 导致 workflow_begin 返回非 lossless JSON（提交 `fa9732f`）

**验证**：打包 + 安装 + compose + 端到端（workflow_begin → DAG 循环组折叠 → HTTP 轮询）全部通过。

---

### 9. Iter-7: 并发执行引擎 + DAG 并发组可视化（✅ 完成）

**迭代报告**：`plan/development/iter7-report.md`

**核心交付**：
- `getRunnableTasks()`：就绪 = 前驱全 DONE/SKIPPED，槽位 = maxConcurrency - 当前 RUNNING；snapshot 输出 `runnable` 列表
- 工作流级 `max-concurrency` 字段（默认 1=串行，>1 并发）
- system-prompt 执行模型 v1 串行 → v2 并发（以 `runnable` 为准）
- DAG 并发组可视化：dependsOn 相同的连续任务垂直并列 + 虚线线框 + 箭头指向后继

**验证**：单测 59/59（用例 6 共 9 断言）；在线验证 concurrent-demo 的 runnable 动态变化 + DAG 并发组显示。

**提交**：`c6b140f` + `ff3a334` + `1b2ece0` + `ec1f0f0`

---

### 10. Iter-8: 并发语义完善 + concurrent 节点 + DAG 增强（✅ 完成）

**迭代报告**：`plan/development/iter8-report.md`

**核心交付**：
- **并发语义**：`getRunnableTasks` 对 concurrent 迭代做组级并发控制（组内 RUNNING + 已列入 < 组级 max），与工作流级 max 取最严格者
- **concurrent 节点**：`type: concurrent`（同 loop 结构 + 自身 max-concurrency）；`expandConcurrentTasks` 展开 N 个 item 迭代，迭代**无依赖**（可并发）；engine 存 `_concurrentGroup`/`_concurrentMax` 元数据
- **DAG**：依赖同一前驱节点撤销线框改垂直排列；新增 start（绿实心圆点）/end（红空心圆圈）；concurrent 节点复用 LoopGroupNode（实线 + 进度 + 状态 + 可展开，标注"⚡ 并发"）

**验证**：单测 65/65（用例 7 共 6 断言）；在线验证 demo-concurrent 的组级并发动态 + DAG start/end + concurrent 实线节点。

**提交**：`898ce53` + `8ca2ac0` + `127ec86` + `af7ce10` + `916a2ea` + `d508a15`

**遗留**（用户确认延后修）：① 箭头 x 左右未连接图元边缘 ② 节点内长文字覆盖 ▶/▼ 图标 ③ 图元宽度偏窄——后续增加文字内容时统一调整。

---

### 11. Iter-13: 面板创建按钮 + 模板库 v1（✅ 完成）

**迭代报告**：`plan/development/iter13-report.md`

**核心交付**：
- **Host 端**：POST /wf/create（只 create 不 start）+ GET /wf/templates + 内置模板×2（serial-gate / concurrent-summary）
- **Client 端**："+"按钮 + 表单 overlay（模板选择/参数配置）+ 实例列表轮询 + 实例切换
- **修复**：ESM→CommonJS（DSH cordis 不支持 ESM 插件）、loadStateFromFile 处理 CREATED 状态、activeRoot 轮询逻辑

**验证**：单测 104/104（用例 10 共 11 断言）；部署验证通过（面板创建/列表/切换功能正常）。

**提交**：`2b6a874` + `c506820`

**部署修复记录**：
| 问题 | 原因 | 修复 |
|------|------|------|
| DSH 启动失败 `SyntaxError: Unexpected token 'export'` | workflow-host 包使用 ESM 格式 | 改回 CommonJS（`module.exports`） |
| client-ui-monitor 未加载 | 同上 ESM 问题 | 改回 CommonJS |
| 插件未在 bundle 中 | `dsh.profile.bundles` 未包含 workflow-host | 添加到 package.json |
| `/wf/list` 请求未发出 | `activeRoot` 是模块级变量，useEffect 不触发 | 改用模块级函数 `startListPolling()` 显式调用 |
| `/wf/status` 返回错误 | CREATED 状态无 state.json | `loadStateFromFile` 从 instance.yaml 构建默认状态 |
| 面板显示 "Waiting for workflow..." | `hasData` 依赖 `/wf/status` 返回 workflow 字段 | 同上，CREATED 状态返回 `{workflow, stage: 'CREATED', ...}` |

---

## 待办（下次启动）

### Iter-20~22: 流程控制剩余功能（按功能闭环组织）（计划中）

**迭代计划**：`plan/development/development-plan.md`（Iter-20~22）；技术方案 `plan/design/workflow-lifecycle-design.md`

**目标**：按"一个迭代 = 一个可端到端验证的功能"重组剩余工作——
- **20 前后台状态一致**（Iter-19 收尾）：R1(/wf/list 补 sessionState+Client gating)、R2(面板 Start 不置 RUNNING、状态归 workflow_start)、R4(Session 启停同步覆盖列表路径)、R3(实例列表并入创建界面)、绑定/采用/锁定、预设门控、BROKEN 展示；
- **21 实例生命周期闭环 + 归档**：Host 归档 + Client 状态机按钮 + 归档 UI，端到端绑定→start→stop→resume→reset→archive；
- **22 编排可视化编辑**（22.1~22.4）。

**前置条件**：Iter-19 完成 ✅（重组按功能闭环，用户确认）

---

### Iter-11: 实例操控工具（后台）（计划中）

**迭代计划**：`plan/development/development-plan.md`（Iter-11）

**技术方案**：`plan/design/multi-instance-session-design.md`（复用 DSH Session 多实例）

**目标**：`workflow_create` / `workflow_start` / `workflow_stop` / `workflow_reset` / `workflow_list`；system-prompt 实例管理与重置能力提示。

**已就绪基础**：实例注册表 + 实例目录布局 + metadata 映射 + 惰性恢复（Iter-10）；实例 session 受控生命周期用 `prepare+enter+announce` 持 detach（Iter-9 约束）。

---

### 12. Iter-10 — 实例目录与存储（✅ 完成）

**迭代报告**：`plan/development/iter10-report.md`

**核心交付**：
- 目录约束确认：session cwd 即沙箱 workspace-write 边界（dsh-sandbox-policy 源码），实例目录建在会话工作区内拥有完全读写权限
- 新增 `instance-store.js`：实例注册表（beginInstance / forSession / hydrateLatest）+ 目录布局（instance.yaml/state.json/metadata.json/output/logs）
- storage 实例目录模式（`setInstanceDir`）；tools 每次调用独立绑定（多会话并行安全）；`workflow_begin` 成功路径自动实例化（id=`workflowName-uuid8`）
- `/wf/status` 支持 `?instanceId=` 精确读取 + 最新实例选择 + 旧布局回退；**Client 零改动**
- 修复 tools-preset.js 源文件与 mjs 内联副本的 Iter-8 漂移（脚本化 section 同步）

**验证**：单测 79/79（用例 8 共 14 断言：实例目录/metadata 映射/双实例隔离/惰性恢复）；部署 web profile v0.4.0 后路由验证 4 项全过（config 识别/最新实例/instanceId 精确/旧布局无回归）。

---

### 11. Iter-9 — 多实例技术验证（✅ 完成）

**迭代报告**：`plan/development/iter9-report.md`（含探针原始数据 `iter9-probe-results.json`）

**核心交付**：
- Host-only 动态插件探针（probe-1，验证后已 undefine）执行 12 项探针，全部通过
- 验证 `sessions` 服务全链路：create（id 唯一 + cwd 绝对路径 guard）/ list/get 并行共存 / append 自定义事件类型 / `prepare+enter+announce+detach` 受控生命周期 / flush 持久化检查点
- 验证 cwd 定位链路：`session.header.cwd → <cwd>/.workflow-agent/instances/<id>/metadata.json` 写入读回一致
- 确认持久化布局 `~/.dsh/sessions/<cwd 键控目录>/<sessionId>/`

**关键发现**：
- ⚠️ 动态插件上下文 `sandboxPolicy.workspaceRoot` = HOME（非 agent 会话工作区）→ 实例存储路径必须从 session cwd 推导
- `create()` 创建的 session 无 detach 通道（无法插件侧移除）；受控生命周期必须走 `prepare+enter+announce`
- session 创建自动写 `permission/preset`、`sandbox/mode`、`approval/policy` 3 个 epoch 事件

**验证**：12/12 探针通过（创建/监听/定位/并行/生命周期/持久化），探针执行 ~125ms。

---

### 4. Iter-4 — 循环 + 循环展开（✅ 完成）

**设计决策**：循环展开在 `workflow_begin` 时由 tools 层完成，engine 收到的是展开后的平面任务列表。每个迭代有唯一 ID（`{loopId}/{item}`）、串行依赖链（iter-N 依赖 iter-N-1）、独立 quality-gate。

| 组件 | 改动 |
|------|------|
| `tools-preset.js` | 新增 `expandLoopTasks` 函数，读取 items-from 文件 → 展开 N 个迭代任务 |
| `tools.js` | 同步增加同逻辑 + 修复 `PARAM_PATTERN` Node 独立加载兜底 |
| `test-host.js` | 新增用例 4（9 断言：依赖链/ID/注入/engine 集成）|
| `engine.js` | 无改动（engine 接收展开后任务，已天然支持）|
| `workflow-host.mjs` | 重建（988 行），ESM 加载验证通过 |
| `host-body/bundle/verify` | 全部重建 |
| `system-prompt.md` | 更新：自动展开，"编排 Agent 无需特殊处理" |
| `agent.cordis.yml` | 同步更新 persona 文本 |
| `client-body.txt` | 新增循环组可视化：连续迭代显示背景框 + "↻" 标签 |

**Client 动态插件部署**：

| 版本 | 插件 | 状态 |
|------|------|------|
| v3 | `wfd-10/pkg-15` | ❌ 颜色不刷新 + 闪烁复发 |
| v4 | `wfd-11/pkg-16` | ❌ 文字刷新正常，图形全灰 |
| v5 | **`wfd-12/pkg-17`** | ✅ 颜色/文字均正常刷新，无闪烁 |

**v5 修复要点**：
- 指纹函数 `fp(st)` 检查 `st.state.tasks` 而非 `st.tasks`（Host 返回 `{ state: {...} }`）
- `mRoot`/`mLoaded` 提升到 `apply()` 级模块变量，根治 remount 闪烁
- 颜色 key 使用全名 `PENDING`/`RUNNING`/`DONE`，匹配 `t.status`

**验证结果**：
- Node 单元测试 41/41 通过（原 32 + 新增 9）
- expandLoopTasks 探针 18/18 通过
- ESM 插件加载验证通过
- 4-task 模拟执行：PENDING（灰）→ RUNNING（蓝）→ DONE（绿）✅
- 循环组背景框 "↻ 逐模块评审" 显示正确 ✅

### 1. Iter-3 — Client 监控面板（✅ 完成）

**架构决策**：

| 维度 | Iter-3 |
|------|--------|
| 插件形态 | 独立动态 Cordis 插件（Host + Client 半边），需 `harness.handle` / `host.call` RPC 通信 |
| 状态来源 | Host 通过 `fs` 读取 `.workflow-agent/state.json`，与预设引擎解耦 |
| 通信机制 | Client → Host：`host.call('wf:status')`，每 1500ms 轮询 |
| 挂载点 | `conversation.view` slot，id=workflow，order=25，与 Chat 并列 |
| 闪烁根治 | 模块级数据层：`ctx.effect` 级单例轮询 + `listeners` 发布订阅 + 指纹防抖 |
| 工作区发现 | 优先 `window.__wfWorkspaceList`，兜底 `wf:config` 验证 |

**交付插件**：

| 属性 | 值 |
|------|-----|
| pluginId | `wff-9` |
| pkg-13 | Host minimal + Client text-only |
| pkg-14 | Host + Client DAG SVG（当前运行） |
| 状态 | ✅ running |
| Host handlers | `wf:status` |

**功能特性**：标签页 "Workflow" | SVG DAG 节点+箭头 | 色（灰/蓝/绿/红/黄）| 状态条 | 指纹防抖 | 工作区自动发现

### 2. 闪烁修复（Iter-3 补丁）

**问题**：LLM thinking 时 `conversation.view` 组件 remount → `useState` 清零 → "Connecting..." 闪烁，DAG 变空白。

**根因**：`workspaceRoot` / `configLoaded` 在组件 `useState` 内，remount 后失效。

**修复**：提升到 `apply()` 级模块变量，组件直读 `latest` 快照。

**踩坑 5 个**（详见 `iter3-report.md` 第 4.4 节）：
| 坑 | 表现 | 解决方案 |
|----|------|---------|
| JSON 参数截断 | `catch`→`catc h`，括号丢失 | 压缩代码到 ~1600 chars |
| 反斜杠转义 | `/\\/g` 误匹配 `/` | 改用 `new RegExp()` |
| Slot 回调返回函数 | 有标签无内容 | 返回 `React.createElement(W)` |
| Host 返回格式 | `{state:data}` 多一层包装 | 直接返回数据 |
| 工作区发现删除 | Host `fs` 沙箱读取失败 | 恢复 `tryDiscover()` |

**验证**：DAG 图形正常显示 ✅ | 状态平滑变化 ✅ | 无闪烁 / 无 "Connecting..." ✅

---

### 迭代报告

| 文档 | 位置 |
|------|------|
| Iter-1 报告 | `plan/development/iter1-report.md` |
| Iter-2 报告 | `plan/development/iter2-report.md` |
| Iter-3 报告 | `plan/development/iter3-report.md` |
| Iter-5 报告 | `plan/development/iter5-report.md` |
| Iter-6 报告 | `plan/development/iter6-report.md` |
| Iter-7 报告 | `plan/development/iter7-report.md` |
| Iter-8 报告 | `plan/development/iter8-report.md` |
| Iter-9 报告 | `plan/development/iter9-report.md` |
| Iter-10 报告 | `plan/development/iter10-report.md` |
| Iter-11 报告 | `plan/development/iter11-report.md` |
| Iter-12 报告 | `plan/development/iter12-report.md` |
| Iter-13 报告 | `plan/development/iter13-report.md` |
| Iter-14 报告 | `plan/development/iter14-report.md` |
| Iter-15 报告 | `plan/development/iter15-report.md` |

---

## 团队约定

行为准则见 `plan/development/team-conventions.md`。