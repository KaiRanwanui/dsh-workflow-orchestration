# Iter-10 报告：实例目录与存储（多实例后台）

> 对应 `progress-record.md` §12（Iter-10 交付）
> 迭代计划：`plan/development/development-plan.md`（Iter-10）
> 技术方案：`plan/design/multi-instance-session-design.md`
> 前置：`plan/development/iter9-report.md`（DSH Session 探针）

---

## 1. 交付概要

| 项 | 值 |
|----|-----|
| 目标 | 实例目录结构 + storage 按实例读写 state + workflow-host 实例注册表（engine 零改造） |
| 状态 | ✅ 完成并部署验证（web profile，workflow-host v0.4.0） |
| 单测 | 79 通过，0 失败（原 65 + 新增用例 8 共 14 断言） |
| 提交 | 见 git log（本文档同批提交） |

---

## 2. 目录约束确认（迭代前置检查）

**结论：实例目录建在 session cwd 下没有问题，且这正是正确做法。**

| 检查点 | 结论 | 依据 |
|--------|------|------|
| 沙箱写权限 | ✅ session cwd 即该会话的 workspace-write 边界 | dsh-sandbox-policy 源码：`resolve()` 返回 `workspaceRoot: session?.header.cwd ?? fallback`，注释 "A session cwd is its workspace-write boundary" |
| 现有路径解析 | ✅ workflow-host 已从 `exec.agent.session.header.cwd` 取落盘根（`sessionCwd()`），与 Iter-9 约束一致 | workflow-host.mjs tools 层 |
| 嵌套目录创建 | ✅ `<cwd>/.workflow-agent/instances/<id>/` 深层写入/读回可用 | Iter-9 探针 P7 |
| 路由读跨目录 | ✅ webServer 路由在 Host 进程上下文只读文件，不受会话沙箱写限 | Iter-10 路由验证 |
| 约束条件 | session cwd 必须绝对路径（Iter-9 探针 guard 已证）；sandboxPolicy fallback（HOME/部署根）不可依赖 | Iter-9 报告发现 6 |

---

## 3. 实例目录布局（本次落地）

```
<session.cwd>/.workflow-agent/instances/<instanceId>/
├── instance.yaml   # 实例定义快照（源 YAML + 参数注释头；源定义文件只读）
├── state.json      # engine snapshot（storage.setInstanceDir 落点）
├── metadata.json   # { instanceId, workflowName, sessionId, sessionCwd, sourcePath, params, createdAt }
├── output/         # 每实例产物（.gitkeep 占位）
└── logs/           # 每实例日志（.gitkeep 占位）
```

- 实例 id = `slug(workflowName)-uuid8`（8 位十六进制，时间尾+随机）
- metadata.json 是 instanceId↔sessionId 主映射（sessionId 跨重启稳定，是惰性恢复的匹配键）

---

## 4. 修改清单

| 文件 | 改动 |
|------|------|
| `code/plugins/workflow-host/instance-store.js` | **新增**：实例注册表（`beginInstance` 建目录+引擎条目 / `forSession` 会话绑定 / `hydrateLatest` 惰性恢复：sessionId 精确匹配优先、createdAt 最新兜底）+ 纯逻辑（slugifyName/makeUuid8/路径计算/composeMetadata），module.exports 供 Node 单测 |
| `code/plugins/workflow-host/storage.js` | 新增 `setInstanceDir(dir)`：state.json 落 `<dir>/state.json`，优先级高于旧布局；writePolicy 根随之调整 |
| `code/plugins/workflow-host-preset/tools-preset.js` | `registerWorkflowToolsPreset(ctx, engine, storage, registry)`：① `workflow_begin` 成功路径（解析+展开无错后）自动创建实例并切换绑定，快照附 `instanceId` ② `workflow_status` 按会话取活跃实例（重启后惰性恢复）③ 每次调用独立绑定 engine/storage（多会话并行安全，无闭包串扰）④ 显式 `statePath/workspaceRoot` 参数或无会话上下文回退旧单实例布局（兼容）⑤ 补齐 Iter-8 时只在 mjs 内联副本里存在的 concurrent 展开分支（源文件漂移修复） |
| `workflow-host.mjs`（内联同步） | apply() 组装 registry + 单实例兼容绑定；storage/instance-store/tools-preset 三段与源模块逐字同步（脚本化 section 替换）；webserver-routes 见下 |
| `workflow-host.mjs` webserver-routes | `loadStateFromFile(fs, root, instanceId)`：instances/<id> 精确 → createdAt 最新实例 → 旧布局回退；`/wf/status` 支持 `?instanceId=`；`/wf/config` 认可实例目录布局 |
| `code/scripts/test-host.js` | 用例 8（14 断言）：mock fs + 真实 engine/storage 驱动注册表全流程 |
| `code/packages/workflow-host/package.json` | 0.3.0 → **0.4.0** |

**Client（client-ui-monitor）：零改动** —— `workspaceRoot` 参数语义不变（= 会话 cwd），路由端自适应新旧布局。

---

## 5. 验证结果

### 5.1 Node 单元测试（79/79）

用例 8 覆盖：id 形态（`demo-<uuid8>`）· 目录锚点 session cwd · metadata 映射（instanceId↔sessionId↔sessionCwd）· instance.yaml 快照（源文本+params）· output/logs 就绪 · state.json 落实例目录 · 双实例目录隔离 + 独立 state.json · forSession 按会话各归各实例 · 新注册表（模拟 DSH 重启）按 sessionId 精确恢复且任务状态保留。

### 5.2 部署与路由验证（web profile 3080）

- 部署：`node build.js`（lib/index.js，59293 chars）→ link 直指仓库 → 重启 dsh.service（10:41:49 > lib 构建 10:19:06，内存约定的时间戳比对法确认加载新构建）
- 启动日志无 error/fail

| 检验项 | 结果 |
|--------|------|
| `/wf/config`（实例布局 cwd） | ✅ `valid: true` |
| `/wf/status` 无 instanceId（fixture 双实例） | ✅ 返回 createdAt 最新的实例 B + `instanceId` 字段 |
| `/wf/status&instanceId=demo-test-a` | ✅ 精确返回实例 A |
| `/wf/status`（旧布局 cwd，Iter-8 demo 数据） | ✅ 回退读取 concurrent-demo 状态，无回归 |

---

## 6. 关键决策与踩坑

| 决策/坑 | 说明 |
|---------|------|
| engine 零改造 | 注册表按实例新建 engine + storage（`Map<instanceId, entry>`），engine 状态机无任何改动（计划约束达成） |
| 多会话并行安全 | 工具 execute 每次调用重新解析绑定（局部变量），杜绝闭包级 engine/storage 跨会话串扰 |
| 实例创建时机 | begin 的解析/展开全部成功后才建实例目录——失败的 begin 不留残缺实例；hydrateLatest 会跳过无 `workflow` 字段的残缺 state.json（双保险） |
| 旧布局兼容 | 显式 `statePath/workspaceRoot` 参数走旧布局；路由对无 instances 目录的 cwd 回退读 `<root>/.workflow-agent/state.json`（demo 数据仍可看） |
| 内联副本漂移 | 发现 tools-preset.js 源文件缺 Iter-8 的 concurrent 展开 begin 分支（当时只改了 mjs）——本次重写源文件并脚本化同步，漂移修复 |
| 重复声明 | `normalizeDir` 在 storage.js 与 instance-store.js 各写了一份，同属 mjs 作用域导致 SyntaxError——从 storage.js 移除（脚本化同步避免了手抄漏改，但同名 helper 需注意作用域合并） |

---

## 7. 当前部署状态

```yaml
profile: web (systemd dsh.service, 10:41:49 重启)
packages:
  - @workflow-agent/workflow-host v0.4.0（实例注册表 + 实例存储 + 路由实例布局）
  - @workflow-agent/client-ui-monitor v0.1.0（未改动）
能力:
  - workflow_begin 自动实例化：<cwd>/.workflow-agent/instances/<id>/
  - workflow_status 会话绑定 + 重启惰性恢复
  - /wf/status 支持 instanceId 精确读取与最新实例选择
待下一步（Iter-11）: workflow_create/start/stop/reset/list 操控工具
```

---

## 8. 参考文件

| 文件 | 说明 |
|------|------|
| `plan/design/multi-instance-session-design.md` | 多实例技术方案 |
| `plan/development/iter9-report.md` | Iter-9 探针（目录约束与生命周期依据） |
| `plan/development/development-plan.md` | Iter-10 计划 → Iter-11 |
