# Iter-22 手工验证报告 v1 — S1 状态同步语义 + S3 孤儿采用池 + S4 重置语义 + reset 修复

> 用途：部署 Iter-22（host v0.11.15 / client v0.5.11）后，由人工逐条执行并填写**验证结果**与**问题**。
> 填写约定：验证结果填 `PASS` / `FAIL` / `N/A`；问题列填简要现象或留空。预填 `PASS（自动）` 的条目已有自动化证据，人工可复核或直接确认。
> 交付范围：S1（idle→stop 排队输入守卫 + 移除 running→resume 自动恢复）、S3（/wf/list 自动回收孤儿进采用池 + 状态标注）、S4（reset 注入"已重置"消息 + 全新运行语义 + 自然语言控制短语）、reset 修复（resetWithDefinition，摆脱内存 state.def）。
> 关联：设计 `plan/development/development-plan.md` §Iter-22；探针证据见本文件 §H；部署事故与修复见 §A。

## 0. 部署前置（先完成）

- [-] `systemctl --user restart dsh.service`（加载 host v0.11.15；刷新浏览器只重载 Client）
- [-] 浏览器硬刷新（Ctrl+Shift+R，载入 client v0.5.11 bundle）
- [-] **确认无 "Failed to load plugins" 报错**（本轮曾发生 client bundle 语法故障，见 §A；已修复）
- [-] 开**新的 workflow-orchestrator 会话**（system-prompt 变更需新会话才生效；旧会话不热更新）
- [-] 用默认模板 `default-demo` 创建→Start（免改免参），作为执行载体
- [-] 确认 `/wf/list` 正常 + 返回 `sessionState`（并含新字段 `recoveredOrphans`）

---

## A. 部署修复确认（本轮 client bundle 故障 + 恢复）

> 背景：S4 改 client.js 时 poolNote 行少一个右括号，产物 lib 未验证即部署 → 前台全部插件加载失败（"loaded without registering"）。已修复并恢复被移除的加载项。

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| A1 | 面板加载 | 硬刷新浏览器，打开 workflow-orchestrator 会话 | 无插件加载报错；DAG 面板正常渲染 | PASS（自动） | 服务端 bundle 与本地 lib md5 一致（1325ac7f…）+ 求值验证通过；待人工刷新最终确认 |
| A2 | 求值级验证 | `node code/scripts/verify-client-bundle.js` | bundle 求值 + `__ModuleLoader__.load` 注册 + factory 导出 apply/inject 全通过 | PASS（自动） | 新增验证脚本，今后改 client.js 必跑 |
| A3 | 加载项恢复 | 检查 web profile `package.json` | `@workflow-agent/client-ui-monitor` 在 dependencies（link:）与 dsh.profile.bundles（workflow-host 之后）两项均在 | PASS（自动） | |
| A4 | Host 新代码生效 | `curl /wf/list?workspaceRoot=…` | 返回含 `adoptable`/`poolNote` 字段（S3 标注生效） | PASS（自动） | 实测返回 `"adoptable":true,"poolNote":"未启动"` |

---

## B. S1 — 提问等待不被误停（idle→stop 排队输入守卫）

> 探针实测（§H）：ask_user_question 阻塞等待期间 agent status 保持 `running`（不产生 idle），本组 B1 预期由该语义保证；B3 守卫覆盖"排队输入瞬间"。

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| B1 | 提问等待不误停 | workflow RUNNING 中，让编排 agent 向你提问（如让它 ask）；**等待 60s 后再回答** | 等待期间与回答后，DAG 保持 RUNNING 不被误停 | 未通过 | 现象：1）直接等待我回答而不是用Ask工具，工作流会进入stop状态；使用ASK工具，工作流会保存RUNNING等待。2）主Session启动subAgent并等待subagent返回时，状态wf变为stopped；之后subagent返回，会发现wf状态为stopped，问我是否继续。3）主Session启动subAgent并等待subagent返回时，状态wf变为stopped；之后subagent返回，主Session继续执行，状态还是STOPPED未变。4）ASK提问跳过，主Session会停止等待，此时wf状态为Stop |
| B2 | 权限等待不误停 | workflow RUNNING 中触发一次需批准的操作（如 agent 请求 bash 批准），搁置 30s 再批准 | 同上，wf 保持 RUNNING | 通过 | |
| B3 | 手工停会话仍生效（守卫不破坏原语义） | workflow RUNNING 中**点 Stop 停止编排会话**（或等 agent 回合自然结束后停） | wf 同步 → STOPPED（保 DONE），dag 停 | 通过 | |
| B4 | 子会话中断不影响 | workflow RUNNING 中中断一个 task subagent（子会话点停止） | wf 状态不变（子会话从 agents 注册表消失 → sync 判 undefined 不触发） | ？ | 现象：subagent停止后，主Session会检查到subagent状态异常，提示是否继续执行，wf实例的状态为STOPPED。之后resume，会新建一个刚刚停止的subagent任务 |

---

## C. S1 — 移除自动 resume（显式 workflow_resume）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| C1 | 非继续消息不恢复 | wf STOPPED 后，人工输入"为什么停了？"等**非控制类**消息 | agent 正常回答；wf **保持 STOPPED**，不被拉回 RUNNING | 通过 | |
| C2 | 继续消息显式恢复 | wf STOPPED 后，人工输入"继续执行工作流" | agent 调 `workflow_resume` → RUNNING，续跑保 DONE | 通过 | |
| C3 | 面板 Resume 仍等效 | STOPPED 实例点面板「▶ Resume」 | 注入"请继续…"消息 → agent 调 `workflow_resume` → RUNNING | 通过 | |
| C4 | session 重开不自动恢复 | wf STOPPED 后，停掉编排会话再重新发消息唤醒会话 | wf 仍 STOPPED；需显式"继续"指令才恢复 | 通过 | |

---

## D. S3 — 孤儿自动回收进采用池 + 状态标注

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| D1 | 死会话孤儿自动进池 | 制造孤儿（绑定的会话已死：如停掉旧编排会话后归档/放弃），另开 UNBOUND 新会话点「采用」 | 采用池**自动**列出该孤儿（无需手工 recover），`recoveredOrphans` 上报 | 通过 | 问题：列表中的wf实例ID只显示了后6位，而不是8位 |
| D2 | 未启动孤儿标注 | 池中含 CREATED 孤儿 | 标注"未启动" | PASS（自动） | /wf/list 实测 `poolNote:"未启动"` |
| D3 | 已停止孤儿标注 + 续跑 | 池中含 STOPPED·含进度孤儿 | 标注"已停止·含进度，可采用后 resume 续跑"；采用后可 Resume 续跑 | 通过 | |
| D4 | RUNNING 孤儿拒绝 | 池中含 RUNNING 实例（先手工 recover 解绑制造） | 不被标注可采用；`/wf/adopt` 拒绝（"运行中，先 stop 再采用"） | 问题：RUNNIng的会话被我归档删除，再次采用的使用，可采用实例标注的是“未启动”，这个状态对不对？ |
| D5 | 回收幂等 | 连续轮询 /wf/list | 二次轮询 `recoveredOrphans` 为空，不重复回收 | PASS（自动） | |

---

## E. S4 + reset 修复 — 重置语义与消息注入

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| E1 | reset 注入"已重置" | STOPPED/COMPLETED 实例点「↻ Reset」 | 会话收到注入消息"工作流实例 … 已重置…按全新工作流继续执行"；agent 只回一行确认，不复述旧状态 | PASS（自动：注入文案含"已重置"+"全新工作流"、mode=queue；人工确认会话表现） | |
| E2 | 全新运行不复述 | E1 后继续让 agent 推进 | agent 以 workflow_status 为准编排，不回溯/对比对话中旧 stage/task | 通过 | |
| E3 | hydrate-only reset | 重启 dsh.service 后（或对历史会话实例）直接「↻ Reset」 | reset 成功 → 全新 PENDING（不再抛"reset 需要已 begin 的定义"） | PASS（自动） | 单测 Part A2 覆盖 COMPLETED hydrate-only 场景 |
| E4 | 各状态 reset 全通 | 分别对 STOPPED / COMPLETED / FAILED 实例 Reset | 三种状态均成功重置；备份 `_reset_<state>` 写入；重跑正常 | 未测试 | 未构造出FAILED场景 |
| E5 | 重跑状态一致 | E4 后 Start 重跑 | DAG 全新 PENDING→正常执行，DONE 从零累计，无旧状态残留 | 通过 | |

---

## F. S4 — 自然语言控制短语（人工输入与面板注入等效）

> 在编排会话**直接输入**以下短语，预期与面板按钮注入等效：立即调对应工具 + 只回一行确认。

| 编号 | 输入 | 预期动作 | 验证结果 | 问题 |
|------|------|---------|---------|------|
| F1 | "请启动工作流" | `workflow_start` + 一行确认 | 通过 | |
| F2 | "请停止工作流" | `workflow_stop` + 一行确认 | 通过 | |
| F3 | "请继续工作流" | `workflow_resume` + 一行确认（仅 STOPPED 有效） | 通过 | |
| F4 | "请重置工作流" | `workflow_reset` + 一行确认（仅 STOPPED/COMPLETED/FAILED 有效） | 通过 | |
| F5 | 非控制消息不受影响 | "为什么停了？"等 | 正常回答，不触发任何控制工具 | 通过 |

---

## G. 回归（确认 Iter-21 主要行为未破坏）

| 编号 | 场景 | 操作 | 预期 | 验证结果 | 问题 |
|------|------|------|------|---------|------|
| G1 | Start/Stop/Resume 全链 | default-demo 创建→Start→执行中 Stop→Resume | 全链正常；STOPPED 时 RUNNING 任务回 PENDING，resume 不死锁 | 通过 | |
| G2 | 控制中间态 | 连点 Start/Stop/Resume | Starting/Stopping/Resuming 中间态防重复点击 | 通过 | |
| G3 | DAG 稳定 | 执行期持续观察 | 无闪烁/重建；按钮状态不丢 | 通过 | |
| G4 | BROKEN/会话切换 | 删 metadata 再恢复；同工作区切会话 | BROKEN 告警正常；切换状态即时正确 | 通过 | |
| G5 | 单测回归 | `node code/scripts/test-host.js` | 176/176 通过（Iter-21 收官 161 + 净增 15） | PASS（自动） | |

---

## H. S1 最小探针实测结论（自动证据，2026-09 动态插件 probe-1，用后已 undefine）

| 会话状态 | status | inbox.hasPending | agents.get() | 对 syncInstanceState 影响 |
|---|---|---|---|---|
| 提问等待（ask_user_question 阻塞 60s，374 样本全程） | `running` | false | 存在 | 不触发 idle→stop（无 idle）——B1 的机制保证 |
| 主会话正常空闲（对照会话） | `idle` | false | 存在 | 触发 idle→stop（"手工停"语义保留，B3） |
| 用户停止（子会话 interrupt） | — | — | **undefined** | 现行"无法判定不触发"已覆盖（B4） |
| 排队输入瞬间（用户消息已排队未认领） | running→idle | **true** | 存在 | S1 守卫跳过 stop（B3 场景的防护边） |

> 结论：`hasPending` 是"排队用户输入"信号（官方 apiProxy 同款读法）；提问等待本身不产生 idle。守卫按设计落地，防排队瞬间的误停 race。

---

## I. 处置记录（手测后闭环，2026-09-01）

| 编号 | 手测结果 | 根因 | 处置 |
|------|---------|------|------|
| B1（4 条现象） | 未通过 | 同源根因：**误停真源是"agent 回合结束 = idle = 停 wf"**（文本提问/后台 subagent 等待/ASK 跳过均以结束回合收尾），S1 守卫防的排队 race 并非高频场景 | 用户拍板：idle→stop 语义**保留**；本迭代落 system-prompt 止血（①编排期提问必用 ask 工具 ②唤醒后推进前查 stage，STOPPED 禁止推进）；**会话树聚合守卫 + stopReason 定向恢复**设计定稿转 Iter-SUBA（development-plan §Iter-SUBA） |
| B4 | ？（行为存疑） | 中断 subagent → 主 agent 结束回合 → idle → 停（同 B1）；resume 后 PENDING 任务重派新 subagent | **符合设计**（Iter-21 stop 重置 RUNNING→PENDING 防死锁的预期恢复路径），随 B1 转 SUBA 后体验将改善 |
| D1 | 通过（有瑕疵） | Iter-20 遗留 `slice(-6)` | ✅ 已修：`slice(-8)`（client v0.5.12） |
| D4 | 问题：RUNNING 孤儿回收后标"未启动" | `recoverOrphan` 的 stop 未落盘（state.json 残留 RUNNING）+ 标注把 RUNNING 归"未启动" | ✅ 已修：recoverOrphan 以磁盘 state.json 为准 stop+save；listInstances 池内 RUNNING 残留自愈；RUNNING 单列异常标注（host v0.11.16）；**历史污染实例下次 /wf/list 轮询自愈** |
| E4 | 未测试 | 未构造 FAILED 场景 | 单测已覆盖 reset 全状态守卫；人工构造留待 Iter-23 归档场景顺带验证 |

**修复版本**：host v0.11.16 / client v0.5.12（179/179 单测）；system-prompt 止血已部署（新会话生效）。

---



**总体结论**：☑ 存在需修复问题——D1/D4 已修复待复测；B1/B4 设计转出 Iter-SUBA（本迭代 prompt 止血）。详见 §I 处置记录。

**问题清单**（编号 + 现象 + 复现步骤）：

## 其他问题

（留白，供人工填写本版新发现的问题）
