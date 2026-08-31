# Iter-22 报告 — S1 状态同步语义 + S3 孤儿采用池 + S4 重置语义 + reset 修复

**日期**：2026-09-01
**状态**：✅ **代码完成 + 手测闭环**（host v0.11.16 / client v0.5.12；179 单测通过；手测 33/35 通过 + 2 项转入 Iter-SUBA 设计；prompt 止血已部署）
**前置**：Iter-21（前后台状态一致 v4 闭环 + Resume 提前，host v0.11.14 / client v0.5.10，161 单测，git 88d6ba0）
**设计定稿**：git ab58bee（S1/S3/S4/reset 修复四件套 + 验证标准）
**输入**：手工验证 `plan/development/iter22-verification-report.md`（用户执行，A4/D2/D5/E1/E3/G5 自动预填 + 人工 29 项）

---

## 背景

Iter-21 后遗留四件事：S1（idle→stop 误停防护 + 移除 running→resume 自动恢复）、S3（孤儿自动回收进采用池）、S4（reset 注入"已重置"消息 + 全新运行语义 + 自然语言控制短语）、reset 修复（hydrate-only 实例 reset 抛"reset 需要已 begin 的定义"）。按"探针先行"惯例先跑 S1 最小探针确认信号语义，再按序实现。

## S1 最小探针结论（动态插件 probe-1，用后已 undefine）

| 会话状态 | status | inbox.hasPending | agents.get() |
|---|---|---|---|
| ask_user_question 阻塞等待（374 样本/60s） | `running` | false | 存在 |
| 主会话正常空闲 | `idle` | false | 存在 |
| 用户中断 subagent | — | — | **undefined**（从注册表移除） |
| 排队输入瞬间 | running→idle | **true** | 存在 |

结论：`hasPending` 是"排队用户输入"信号；提问等待本身不产生 idle；手工停语义（idle→stop）与排队 race 守卫可并存。

## 交付

| # | 项 | 方案 |
|---|----|------|
| S1 | idle→stop 排队守卫 + 移除自动 resume | `syncInstanceState` idle→stop 增加 `!isAgentPending(sid)` 守卫（读 `agents.get(sid).inbox.hasPending`）；**删除** running→resume 自动恢复分支——恢复只能由用户显式"继续"类消息触发 `workflow_resume`（system-prompt §2 同步改写） |
| S3 | 孤儿自动回收 + 采用池标注 | `/wf/list` 轮询即触发 `scanOrphans`→`recoverOrphan`（逐个 try/catch，`recoveredOrphans` 上报）；池内实例按运行态标注 `poolNote`（未启动 / 已停止·含进度 / 已结束）+ `adoptable`；RUNNING 拒绝采用语义不变 |
| S4 | reset 注入 + 全新运行语义 + 自然语言控制 | `/wf/reset` 注入"已重置…按全新工作流继续执行"（queue）；system-prompt 新增**全新运行语义**（勿对比对话历史旧 stage/task、不回溯旧进度）与**统一控制指令表**（面板注入与人工输入同权：请启动/停止/继续/重置 → 对应工具 + 一行确认）；client reset 请求带 `sessionId/parentSessionId` |
| reset 修复 | `resetWithDefinition` | engine 新增 `resetWithDefinition(parsed)`；`workflow_reset` 先 `expandInstanceDefinition(instance.yaml)` 再重置——摆脱内存 `state.def`（hydrate 后必缺失的根因） |

## 过程问题与修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 部署后前台全部插件加载失败（"loaded without registering"） | S4 改 client.js 时 poolNote 行多包一层括号少补一个 `)`；`node --check src` 中间态假阴性，产物 lib 未验证即部署 | 补括号；新增 `code/scripts/verify-client-bundle.js` **求值级验证**（执行 bundle→断言 `__ModuleLoader__.load` 注册→factory 导出），今后改 client.js 必跑；恢复被排障移除的 profile bundles 条目 |
| D4：RUNNING 孤儿回收后在采用池被标"未启动" | `recoverOrphan` 的 `engine.stop()` 未落盘，state.json 残留 RUNNING；标注逻辑把 RUNNING 归入"未启动" | recoverOrphan 改为**以磁盘 state.json 为准**（顺带修掉缓存陈旧缺口）stop+save；`listInstances` 对池内 RUNNING 残留自愈（磁盘状态水合新引擎→stop→落盘→同步内存条目）；标注逻辑 RUNNING 单列"异常残留" |
| D1：采用池实例 ID 只显示后 6 位 | Iter-20 遗留 `slice(-6)` | 改 `slice(-8)` 对齐 uuid8 |

## 手测结论（iter22-verification-report.md）

- **通过**：A（部署修复 4/4）、C（S1 显式恢复 4/4）、D1/D3、E2/E5、F（自然语言控制 5/5）、G 回归（4/4 + 单测）；B2/B3。
- **未通过/转入设计**：B1（4 条现象）与 B4 同源——**真正的误停源是"agent 回合结束 = idle = 停 wf"**，S1 守卫防的排队 race 并非高频场景。三个具体暴露面：①自然文本提问结束回合→停 ②后台 subagent 等待结束回合→停（且唤醒后继续推进造成"任务推进 vs wf=STOPPED"失配）③ASK 跳过后结束回合→停。
- **处置（用户拍板）**：本迭代只落 system-prompt 止血（编排期提问必须用 `ask_user_question`；任何唤醒后推进前先 `workflow_status` 确认 stage，STOPPED 时禁止推进并等待显式"继续"）；**会话树聚合守卫 + stopReason 定向恢复**整体转入 Iter-SUBA（设计方案已写入 development-plan.md §Iter-SUBA）。

## 转入 Iter-SUBA 的设计（已定稿方向）

- 聚合守卫：idle→stop 条件推广为 `!isAgentPending(sid) && !hasRunningChildren(sid)`。
- stopReason：`user-stop` 不自动恢复（S1 语义保留）；`session-idle` 主会话新回合 running → 自动 resume（精准恢复，消除失配）。
- 探针前提：确认 agents registry child 条目字段（parentSessionId）与枚举方式。

## 验证

- 单测：**179/179**（Iter-21 收官 161 → +18：S1 守卫语义 5、S3 路由/回收 4、S4 注入 2、resetWithDefinition/PartA2 2、D4 落盘+自愈 3、其余回归微调）。
- 手测：33/35 通过（2 项 E4/FAILED 场景未构造、B 组 3 条转 SUBA 设计）；F 组自然语言控制全通过；C 组确认 S1"手工停权威"语义无回归。
- 部署一致性：服务端 bundle 与本地 lib md5 一致；`/wf/list` 实测返回 `adoptable/poolNote/recoveredOrphans` 新字段。

## 提交

- `feat(iter-22): S1 状态同步语义 + S3 孤儿采用池 + S4 重置语义 + reset 修复`（含探针结论、部署事故修复、D1/D4 手测修复、SUBA 设计转出；具体 hash 见 `git log --grep=iter-22`）
