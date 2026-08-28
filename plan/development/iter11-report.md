# Iter-11 报告 — 实例操控工具（后台）

**日期**：2026-08-28
**版本**：@workflow-agent/workflow-host **v0.5.0**
**前置**：Iter-10（实例目录与存储，83611bb）
**提交**：见 git log

---

## 交付内容

### 1. instance-store.js 扩展（实例注册表新增 4 个能力）

| 能力 | 说明 |
|------|------|
| `listInstances(cwd)` | 扫描 `<cwd>/.workflow-agent/instances/*/`，聚合 metadata + state 摘要，`createdAt` 倒序。`phase: CREATED`（仅目录未启动）/ `READY`（有 state.json），附 stage 与任务计数（total/done/failed）、`active` 标记 |
| `loadEntry(cwd, instanceId, opts)` | 精确加载：目录/metadata 校验 → 内存命中复用，否则建 engine+storage（`setInstanceDir`），有 state.json 则 hydrate；`opts.active` 标记会话活跃 |
| `resolveEntry(exec, instanceId, opts)` | 操控工具统一入口：显式 `instanceId` → 本 cwd 精确解析；缺省 → 会话活跃实例（`forSession`） |
| `patchMeta(cwd, id, patch)` | 读改写 metadata.json 辅助字段（reset 记 `lastResetAt`），同步内存条目 |

另：`sessionCwdOf(exec)` 从 `forSession` 内联提取为独立 helper（操控工具共用）。

### 2. tools-preset.js：5 个实例操控工具

| 工具 | 语义 | 关键行为 |
|------|------|---------|
| `workflow_list` | 列本会话工作区全部实例 | 返回 `{cwd, instances[], activeInstanceId}` |
| `workflow_create` | 预建实例目录，不启动 | `workflowPath`/`workflowText`+`params` → 校验定义 → `beginInstance`（instance.yaml/metadata/output/logs）；返回 `{instanceId, dir, phase:"CREATED"}` |
| `workflow_start` | 启动已有实例 | 读实例 `instance.yaml` → 剥注释头 → 展开 → 引擎 PENDING → 落盘；返回快照+`runnable`（编排循环起点）；RUNNING 中拒绝；标记会话活跃 |
| `workflow_stop` | 停止推进 | `stage=STOPPED` 落盘；CREATED 实例报错"无需停止" |
| `workflow_reset` | 清状态重跑 | 重读 `instance.yaml` → 全新 PENDING → 覆盖 state.json → metadata 记 `lastResetAt`；返回新 runnable；产物文件保留（同名覆盖） |

**定位语义**：全部工具缺省操作**当前会话活跃实例**，显式 `instanceId` 时在本 cwd 内精确解析——与沙箱边界（session cwd）和"实例选择由 DSH session 列表承担"的设计（multi-instance-session-design.md §5.4）一致。

### 3. begin/start/reset 共用重构

新增 `expandDefinition(fs, {text, base}, params)`：解析 → params 注入 → processor/gate 相对路径解析（`base` 优先取 `metadata.sourcePath` 所在目录，保证从实例目录启动时技能路径仍相对原始定义解析）→ loop/concurrent 展开。`workflow_begin` 中 ~70 行内联逻辑收敛到此函数；解析错误经 `definitionError` 携带 `workflowBeginErrors` 数组，**begin 既有契约不变**。

### 4. 前置工具同步

- `stripInstanceHeader(text)`：剥 `beginInstance` 生成的 `#` 注释头（连续 `#` 行 + 一个空行），无头部时原样保留
- `E_parseWorkflow` 兜底：mjs 内联作用域用同名函数，Node 单测环境从 `shared/workflow-parser` require（与既有 `E_PARAM_PATTERN` 同款模式）

---

## 关键决策

| 决策 | 理由 |
|------|------|
| **操控工具只操作实例目录，不管理 DSH session 生命周期** | 设计文档 §5.4：实例运行状态记 state.json，实例选择/切换由 session 列表承担；"工具创建实例 session（prepare+enter+announce 持 detach）"延后到有真实需求（如面板一键创建）时再做 |
| **stop 语义 = stage 置 STOPPED** | 执行编排由 Agent loop 驱动，工具层无法"杀执行"；落盘 STOPPED 后由 system-prompt 约束编排 Agent 停止推进（已写入 persona 第 7 步） |
| **reset 采用覆盖语义** | DSH `fs` 服务无删除 API（abstract 方法到 editText 为止，无 unlink/remove）——state.json 覆盖重置 + metadata 记 `lastResetAt`；output/logs 旧产物保留，同名输出被覆盖。文件级清理（subprocess rm 方案）列为已知限制 |
| **start 的实例状态守卫查磁盘而非内存标记** | `beginInstance` 条目 `hasState:false` 在 start 落盘后会过期（单测实锤），`entryStateOnDisk()` 一律读磁盘 state.json 判定 |
| **begin 保留"快捷方式"地位** | create+start 是显式生命周期；begin（create+start 一步）兼容既有编排流程与 system-prompt 主路径 |

---

## 验证

### 单测（用例 9 新增，总 93/93 ✅）

内存 mock fs 全流程：`stripInstanceHeader`×2 → list 空 → create（CREATED + id 形态）→ list 可见 → start（PENDING + runnable 2，max-concurrency=2）→ 快照带 instanceId → state.json 落实例目录 → status 推进（会话绑定）→ stop（STOPPED 落盘）→ reset（全新 PENDING + lastResetAt）→ list READY 计数 → **模拟重启**（全新 registry+tools）reset 按 sessionId 精确恢复。

### 部署

- `sync-modules.js`（新增脚本，纪律化 section 同步）→ mjs 语法检查 → `build.js` v0.5.0 → **需重启 dsh.service 生效**

---

## 已知限制 / 后续

1. reset 不做文件级清理（fs 无删除 API）；如需彻底清产物，评估 subprocess 方案
2. `workflow_stop` 不中断正在跑的 subagent Task（仅状态标记）；彻底停止需 Agent 侧配合（persona 已约束）
3. DAG 面板仍轮询写死的项目根（Client workspaceRoot 发现是静态的）——**Iter-12 核心（useSessions+sessionId+cwd 跟随）**
4. `system-prompt.md`（可读参考版）执行模型主体仍是 v1 串行描述，与 yml 内 v2 persona 并发语义存在表述漂移，Iter-12 顺带统一

## 下一步

**Iter-12 前台实例管理界面**：实例列表 + 跟随 session 切换 DAG（`useSessions` + `sessionId` → `byId[sessionId].cwd`），验证方式：切 session → DAG 跟随。
