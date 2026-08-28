# Iter-9 报告：多实例技术验证（DSH Session 探针）

> 对应 `progress-record.md` §11（Iter-9 交付）
> 迭代计划：`plan/development/development-plan.md`（Iter-9）
> 技术方案：`plan/design/multi-instance-session-design.md`
> 探针原始数据：`plan/development/iter9-probe-results.json`

---

## 1. 交付概要

| 项 | 值 |
|----|-----|
| 目标 | 探针验证"实例 = DSH Session"方案的全部技术前提 |
| 状态 | ✅ 12 项探针全部通过，方案可行性确认 |
| 载体 | 动态插件 `probe-1/pkg-1`（Host-only，验证后已 undefine 清理） |
| 执行耗时 | ~125 ms（01:07:15.396Z → 01:07:15.521Z） |
| 原始证据 | `iter9-probe-results.json`（探针逐项落盘） |

---

## 2. 探针设计

Host-only 动态插件，在 `apply()` 内顺序执行 12 项探针，每项完成即把累计结果落盘（防中途失败丢证据）：

| # | 探针 | 验证点 |
|---|------|--------|
| P1 | 服务可用性 | `ctx.get('sessions')` 存在 + 方法面枚举 |
| P2 | 事件监听 | `session/created`、`session/disposed`、`session/event` 三个监听器先于创建注册 |
| P3/P4 | 创建 | `create('wf9p-iter9-a/b', { meta: { cwd: <绝对路径> } })` 两个不同 cwd |
| P5 | 并行共存 | `list()` 同时可见、`get()` 各自可达 |
| P6 | 轨迹追加 | `session.append('wf-probe/step', {...})` 自定义事件类型 + `session/event` feed |
| P7 | cwd 定位实例目录 | `<cwd>/.workflow-agent/instances/<id>/metadata.json` 写入→读回比对 |
| P8 | id 唯一 guard | 重复 id create 预期抛错 |
| P9 | cwd guard | 相对路径 create 预期抛错 |
| P10 | 受控生命周期 | `prepare → enter → announce → detach` 全链路（含 created/disposed 事件） |
| P11 | 持久化检查点 | `flush(session)` 返回值 |

## 3. 验证结果（12/12 通过）

| 探针 | 结果 | 关键证据 |
|------|------|---------|
| P1 服务可用 | ✅ | 方法面：`create/prepare/enter/detachEntered/announce/flush/get/list/fork` |
| P3/P4 create A/B | ✅ | header `{version: 0, cwd: <绝对路径保留>}` |
| P5 并行共存 | ✅ | `list()` total=4（含 2 探针 session），hasA/hasB/getA/getB 全 true |
| P6 自定义事件 | ✅ | `'wf-probe/step'` seq 3→4 提交成功，`session/event` feed 收到 |
| P7 cwd→实例目录 | ✅ | A/B 两个 metadata.json 写入读回比对一致 |
| P8 id 唯一 | ✅ | 抛 `session "wf9p-iter9-a" already exists` |
| P9 cwd guard | ✅ | 抛 `session header cwd must be an absolute path` |
| P10 受控生命周期 | ✅ | prepare 不在 store → enter+announce 在 store（created 事件）→ detach 移除（disposed 事件触发） |
| P11 flush | ✅ | `flushed: true` |

## 4. 关键发现

1. **方案全链路成立**：创建/共存/cwd 定位/映射/重置所需的底层能力全部可用，无需改 DSH。
2. **自定义 session 事件类型可直接 append**：运行时不校验类型注册表，`'wf-probe/step'` 直接提交并进入 feed——workflow 层可用自有事件类型（如 `workflow/instance`）在 session log 里记实例轨迹。
3. **session 创建自动写 3 个 epoch 事件**：`permission/preset`、`sandbox/mode`、`approval/policy`（seq 0-2）——实例 session 天然携带策略头。
4. **`create()` 无 detach 通道**：便捷路径创建的 session 无法从插件侧移除（探针遗留 a/b 两个空 session，内存 store 常驻至重启）。**Iter-11 的 `workflow_create/stop/reset` 必须用 `prepare + enter + announce` 并持有 enter 返回的 detach disposer**，才能支撑受控清理。
5. **持久化布局确认**：`~/.dsh/sessions/<cwd 键控目录>/<sessionId>/session.jsonl.zstd`——存储后端按 `header.cwd` 键控目录；detach 后持久化文件保留（彻底清除需文件层清理）。
6. **⚠️ 环境陷阱：动态插件上下文 `sandboxPolicy.workspaceRoot` = HOME（`/home/zhaokai`），不是 agent 会话工作区**。探针首次落盘就写到了 `$HOME/workflow-agent/...`。**Iter-10 存储路径必须从 `exec.agent.session.header.cwd` 推导，禁止依赖 workspaceRoot**（npm 包 workflow-host 运行在 agent session 上下文，路径来源不同，实现时需注意区分）。
7. **id/cwd guard 与设计方案吻合**：id 唯一性 → `workflowName-uuid8` 天然防撞；cwd 必须绝对路径 → 实例目录锚点可靠。

## 5. 对后续迭代的输入修正

| 迭代 | 修正 |
|------|------|
| Iter-10 | 实例目录一律由 session cwd 推导；metadata.json 读写模式已被 P7 证实；可选用自定义 session 事件记轨迹 |
| Iter-11 | 操控工具用 `prepare+enter+announce` 生命周期（持 detach）；`workflow_stop/reset` 走 detach + 文件层清理 |
| Iter-12 | `useSessions + sessionId → byId[sessionId].cwd → 实例目录` 链路两侧（session cwd 侧、cwd 键控存储侧）均已验证 |

## 6. 清理记录

| 项 | 处理 |
|----|------|
| 探针插件 probe-1 | ✅ 已 stop + undefine（定义、版本、授权全部移除） |
| `$HOME/workflow-agent/`（误落盘） | ✅ 已删除 |
| `$HOME/.wf-probe-iter9/`（探针实例目录） | ✅ 已删除 |
| `~/.dsh/sessions/` 3 个探针 session 存储 | ✅ 已删除 |
| 内存 store 残留 `wf9p-iter9-a/b` | 空 session、无 agent 绑定，DSH 重启自然消失（插件侧无移除 API，见发现 4） |

## 7. 参考文件

| 文件 | 说明 |
|------|------|
| `plan/design/multi-instance-session-design.md` | 多实例技术方案（§6 待确认项本轮已闭环） |
| `plan/architecture/architecture-decisions.md` §6 | 架构决策（本轮补充验证结论） |
| `plan/development/development-plan.md` | Iter-9 计划 → Iter-10 范围修正 |
| `plan/development/iter9-probe-results.json` | 探针原始数据 |
