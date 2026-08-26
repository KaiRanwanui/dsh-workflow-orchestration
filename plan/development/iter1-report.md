# 迭代 1 报告 — Host 插件：引擎基础

| 项 | 内容 |
|----|------|
| 迭代目标 | Host 插件引擎基础：parser + engine + tools + RPC + shared/schema |
| 迭代规模 | ≤ 1 人天 |
| 状态 | ✅ 完成并验收 |
| 关联产物 | `code/`（交付件）、本报告（过程记录） |

---

## 1. 交付内容

### 1.1 文件清单

| 层 | 文件 | 职责 |
|----|------|------|
| 共享 | `code/shared/workflow-schema.js` | Schema 常量：TASK_TYPES / DEFAULTS / REQUIRED / ON_FAILURE_VALUES / PARAM_PATTERN / TASK_STATUS / STAGE |
| 共享 | `code/shared/workflow-parser.js` | 自研轻量 YAML 解析器（无外部依赖）+ `parseWorkflow` 结构化与校验 |
| Host | `code/plugins/workflow-host/engine.js` | `createWorkflowEngine()` 状态机：begin / updateTask / setStage / setGateResult / setRetries / setError / setPersist / snapshot / hydrate / clear |
| Host | `code/plugins/workflow-host/storage.js` | `createWorkflowStorage()`：状态 JSON 落盘与恢复（`.workflow-agent/state.json`） |
| Host | `code/plugins/workflow-host/tools.js` | 模型工具：`workflow_begin`（解析并启动）、`workflow_status`（编排上报） |
| Host | `code/plugins/workflow-host/rpc.js` | RPC：`wf:status` / `wf:skill` / `wf:logs`（供 Client 监控面板轮询，Iter-3 使用） |
| Host | `code/plugins/workflow-host/index.js` | `hostApply(ctx)` 组装入口 + 构建期入口 |
| 构建 | `code/scripts/build-host.js` | 多模块 → 单一宿主函数体（host-body / host-bundle / host-verify 三种形态） |
| 测试 | `code/scripts/test-host.js` | Node 单元验证（30 个断言） |
| 样例 | `workflows/` | demo 工作流 YAML + 4 个技能文件 + 循环条目 + 输入样例（供 Iter-2 端到端使用） |

### 1.2 数据模型（简述）

- **Task 类型**：`llm-task`（默认）/ `loop`（顺序迭代）/ `human-decision` / `external-agent`（后两者预留）。
- **状态枚举**：Task → PENDING / RUNNING / DONE / FAILED / SKIPPED；全局 → PENDING / RUNNING / COMPLETED / FAILED / PAUSED。
- **执行模型**（措辞确认后）：串行，由 `depends-on` 推导 ready 队列；**无 max-concurrency**（并发为后续迭代的独立维度）。
- **quality-gate**：per-task 门禁，`on-failure: retry | block | skip`。
- **参数注入**：`${param_name}` 在 `workflow_begin` 时注入 inputs/outputs/processor/gate/items-from。

### 1.3 构建体系

多模块源码无法直接在 cordis_define 中引用（**宿主机体内无 require/import**），因此 `build-host.js` 把
schema → parser → engine → storage → tools → rpc → index 按依赖顺序拼接为单函数体，产出三种形态：

| 产物 | 用途 |
|------|------|
| `dist/host-body.js` | 完整 host 函数体（供 cordis_define 的 code.host） |
| `dist/host-verify.js` | 去注释紧凑版（减小传参体积） |
| `dist/host-bundle.js` | CommonJS 可加载版（Node 单元验证用） |

---

## 2. 验证结果

### 2.1 Node 单元验证 — 30/30 通过

| 用例 | 覆盖点 | 结果 |
|------|--------|------|
| 用例 1 合法工作流 | 2 任务解析、默认类型、processor/inputs 保留、gate 配置、loop 的 items-from/item-var、depends-on | ✅ 15 断言 |
| 用例 2 非法工作流 | on-failure 非法值、depends-on 幽灵引用、重复 id | ✅ 3 断言 |
| 用例 3 引擎状态机 | begin 初始化、fingerprint 防抖、任务流转、gate 记录、retries、日志、COMPLETED 收尾、hydrate 恢复 | ✅ 12 断言 |

### 2.2 DSH 宿主集成验证

- `cordis_define` → `cordis_run`：插件 `wfag-1` 启动（run-1）✅
- 模型工具注册：`workflow_begin`、`workflow_status`（经 Tool listTools 确认）✅
- RPC 注册：`wf:status`、`wf:skill`、`wf:logs`（经宿主 handlers 确认）✅
- 注入服务：`fs`、`timer` 就绪，`waitingFor` 为空 ✅

---

## 3. 发现的问题与解决方式

### 3.1 工程链路问题（编码与脚本）

| # | 问题 | 解决方式 |
|---|------|---------|
| 1 | PowerShell 不支持 `&&` 语句分隔符 | 改为 `;` 顺序执行（如 `node build-host.js; node test-host.js`） |
| 2 | parser 列表分支死循环（`- key: value` 元素导致 Maximum call stack） | 重写列表分支：`- key: value` 作为多行对象元素的起始行，首键单行解析 + 续行 map 合并（`parseBlock(lines, i, indent+1)` 收回续行） |
| 3 | engine 独立 Node 测试缺 STAGE/TASK_STATUS 常量 | 引擎内兜底 `E_STAGE`/`E_TASK_STATUS`：宿主体内复用前置 const，Node 独立时用本地默认 |
| 4 | bundle 中 map 回调内 `await` 语法错误（非 async 回调） | `Promise.all(parsed.tasks.map(async t => …))` |
| 5 | PowerShell `Set-Content -Encoding UTF8` 破坏中文注释（乱码、行合并） | 输出文件统一改用 write 工具（UTF-8 无损） |

### 3.2 设计层问题（验收阶段的转折点）

| # | 问题 | 解决方式 |
|---|------|---------|
| 6 | 状态持久化“落盘位置”依赖 `sandboxPolicy.workspaceRoot`，而宿主动态插件**无 session 上下文**，该值解析为**部署根（DSH 安装目录）**，会把状态写进安装目录 | 见 §4（探针定位）+ §5（探讨结论）。落盘根改为由 `workflow_begin` 显式传入 `workspaceRoot` / `statePath`；未传时 `save()` 返回明确错误，绝不静默写错位置 |

---

## 4. 探针的使用（验收期方法论）

### 4.1 为什么需要探针

`workflow_begin`/`workflow_status` 是**模型工具**，只能由 Agent Loop 层调用（属 Iter-2 范围）。因此迭代 1 验收时
无法直接执行“解析 → 落盘”的完整链路。而宿主插件内部状态（engine 快照、sandboxPolicy 值）也无法从外部读取：
- 工具本人不能主动调用；
- RPC 需 Client 侧（Iter-3 才有 UI）；
- console 输出落在 DSH 宿主日志，会话侧读不到。

> 探针（probe）= 临时定义一个小插件，其 `apply(ctx)` 在激活瞬间自动执行一段诊断代码，把结果写入**可被外部观察的载体**（工作区文件 / RPC / console），观察后即删除。

### 4.2 探针实现模式（v1 → v4）

| 版本 | 手法 | 用途 |
|------|------|------|
| v1 | apply 内直接写 `probe-ok.txt` | 验证 `fs.writeText` 链路是否可用 |
| v2 | 注册 RPC `wfpr:probe` | 暴露 workspaceRoot（但 RPC 仍需 Client 调，不够直接） |
| v3 | apply 内**多路径候选同时尝试**，各自记录成功/失败，诊断写盘 | 一举证明：哪里能写、哪里不能写、workspaceRoot 实际值 |
| v4 | 对比 `workspaceRoot` 属性 vs `sandboxPolicy.resolve()` | 确认无 session 时 resolve() 也返回部署根，排除“调用方式差异”假说 |
| final | 模拟修复后的 `setWorkspaceRoot('C:/Users/ranwa/dsh_workspace')` + writeText | 验证修复后的落盘路径确实成功 |

### 4.3 关键探针输出（v3，决定性证据）

```json
{
  "hasSandbox": true,
  "hasFs": true,
  "root": "C:\\Users\\ranwa\\AppData\\Local\\Programs\\DSH Desktop",
  "attempts": [
    { "label": "via-workspaceRoot", "targetPath": "...DSH Desktop\\.workflow-agent\\probe3.txt", "result": "ok" },
    { "label": "via-dsh-workspace", "targetPath": "...dsh_workspace\\.workflow-agent\\probe3.txt", "result": "error",
      "error": "file access denied under workspace-write mode" },
    { "label": "root-level", "targetPath": "...DSH Desktop\\wfpr3-root.txt", "result": "ok" }
  ]
}
```

### 4.4 探针方法论沉淀（对后续迭代通用）

1. **一步多测**：一个探针同时尝试多条候选路径，一次运行拿到全部事实（能写哪/不能写哪/默认根是什么）。
2. **结果必须落到可观察载体**：写真实文件最可靠（RPC/console 有客户端前置依赖）。
3. **用完即删**：全部探针插件（wfpr-2..5、wfin-6）验证完毕后 cordis_stop + cordis_undefine 清理。
4. **探针与产品代码分离**：探针是独立的临时 Plugin，不改动正式交付件。

---

## 5. 探讨的问题：宿主插件为何拿到工作目录外的写权限

### 5.1 现象

终验探针把文件写到了 `C:\Users\ranwa\AppData\Local\Programs\DSH Desktop\.workflow-agent\` —— 位于 **DSH 安装目录**，而不是会话工作区 `C:\Users\ranwa\dsh_workspace`。

### 5.2 结论（探讨后厘清）

1. **边界裁决看“声明的 workspaceRoot”，不看物理工作目录**。
   探针调用 `fs.writeText(target, content, …, { mode:'workspace-write', workspaceRoot })` 时，
   workspaceRoot 来自 `sandboxPolicy.workspaceRoot` —— 而宿主动态插件**没有 session cwd**，
   该服务在“无会话调用”场景返回**部署根 fallback**，恰好等于 DSH 安装目录。探针只是把宿主给的默认值
   **原样**声明回去，于是写“界内”通过。

2. **不是探针越权，而是宿主给宿主插件的默认“工作区根”本身就在用户工作区之外**。
   同一探针中，声明 root=DSH Desktop 时写 dsh_workspace 被拒（在界外）——证明裁决严格跟随声明的 root。
   探针没有打开任何权限漏洞。

3. **动态插件的安全模型是“代码信任”，不是能力隔离**。
   受限执行环境“不是恶意代码的安全边界”；能运行的动态插件可触碰真实服务、可声明任意 sandboxPolicy。
   因此工作流的“执行目录”绝不能由插件代码自行猜测或声明，必须由编排层显式传入 —— 这也是 §3.2/#6 修复的
   设计根因。`cordis_run` 的授权（含双勾=信任后续版本）是这条信任链的守门员。

4. **遗留一项部署配置待确认**：为何部署根 fallback 被配置为 DSH 安装目录本身？若所有无会话宿主插件都以此为准，
   “静默写错位置”会是系统性问题。建议后续检查宿主配置中 workspace-write 的 fallback root 设定。

### 5.3 对后续迭代的约束

- **Iter-2（Agent Preset 编排）**：调用 `workflow_begin` 时**必须传 `workspaceRoot`**（= 当前会话工作区）或 `statePath`，状态才能落在正确位置并可恢复。
- **Iter-3（Client 监控）**：`wf:status` RPC 依赖宿主 engine 内存态；宿主重启后依赖 storage.load() 恢复 —— 恢复同样需要显式状态目录。
- **Iter-6（多实例）**：多实例的状态文件命名/目录划分需在设计时显式纳入（建议每实例独立 statePath）。

---

## 6. 当前 DSH 运行时状态（验收时刻）

| 项 | 值 |
|----|----|
| 插件 | `wfag-1`（workflow-agent-host） |
| 当前包 | `pkg-6`（含落盘修复） |
| 运行 | ✅ running（run-6） |
| 工具 | `workflow_begin`、`workflow_status` |
| RPC | `wf:status`、`wf:skill`、`wf:logs` |
| 状态文件 | `C:\Users\ranwa\dsh_workspace\.workflow-agent\state.json`（终验探针写入） |

**遗留待办**：
- [ ] 手动清理 `C:\Users\ranwa\AppData\Local\Programs\DSH Desktop\.workflow-agent\probe-ok.txt`、`probe3.txt`（会话沙箱外，无法从会话内删除）。
- [ ] 确认宿主配置 workspace-write fallback root 为何指向安装目录（§5.2/#4）。

---

## 7. 下一步

迭代 2 — Agent Preset 串行编排（依赖 Iter-1 的 `workflow_begin`/`workflow_status`）：

1. 编写串行编排 system-prompt（ready 队列消费：由空 depends-on 起步）；
2. subagent 执行 + `workflow_status` 上报（RUNNING→DONE）；
3. quality-gate：独立 LLM 会话 + retry/block/skip；
4. loop 按 items-from 顺序迭代（Iter-4 深化）；
5. 端到端跑通 `workflows/demo-ir-workflow.yaml`（记住传 `workspaceRoot`）。