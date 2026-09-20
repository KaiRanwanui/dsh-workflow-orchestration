# Iter-37 报告 — 全局参数编辑（params）

- **状态**：✅ 完成关闭（2026-09-18 验收；阶段收尾一致性检查补记——编辑器 params 区 + meta patch 通道；params 后续由 Iter-38 单轨化承接（patch.params 承载，旧路由退役），发行 v0.26.13~19），v0.26.13 已发行部署，**待用户真机验收**
- **阶段**：阶段 4（现有功能修复/补全）
- **版本**：host `v0.26.9 → v0.26.13`（阶段内第三格顺延；单包）
- **测试**：595 单测全绿（+params 路由 4 断言：CREATED 保存落盘/GET 回读/空键 400/非对象 400）+ 产物级验证通过
- **提交**：见 git log

## 1. 目标与范围

改进项（创建实例后全局 params 无法修改）：编辑器 params 区可增删改，独立保存通道落 `meta.params`；阶段门控 CREATED/PENDING/STOPPED（用户拍板含 CREATED）；RUNNING/COMPLETED/FAILED 拒绝。**不做什么**：定义内 params 声明（defaults）编辑（源码态可改）；RUNNING 阶段开放；模板默认值回写。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 可编辑阶段 | CREATED/PENDING/STOPPED（含 CREATED——未 begin 无执行态耦合） |
| 2 | 保存交互 | 独立「保存参数」按钮（与定义保存通道分离，互不覆盖） |

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `code/plugins/workflow-host/webserver-routes.js` | 新增 **POST /wf/instance-params**：阶段门控 → params 形态校验（对象、键非空）→ `registry.patchMeta({ params })` → 返回 `{ok, params, hint: 对下一次 begin/reset 生效}` |
| `code/packages/workflow-host/src/client.js` | params KvEditor 改可编辑（`paramsDraftEntries` 缓冲，null=无改动回落）；`paramsEditable` 门控（CREATED/PENDING/STOPPED）；独立「保存参数」按钮 + doSaveParams（JSON.parse 宽松解析值、重复键报错）；保存成功 → 提示「对下一次 begin/reset 生效」+ 重载回落 |
| `code/scripts/test-host.js` | +params 路由 4 断言（CREATED 保存 200/GET 反映/空键 400/非对象 400） |

## 4. 实施与验证过程（差分）

| 步骤 | 改动 | 验证 | 结果 |
|---|---|---|---|
| 1 | 路由 | p37 四断言 | ✅ 首跑即绿 |
| 2 | 编辑器 params 区 | 构建 + bundle 验证 | ✅ |
| 3 | 全量单测 | `test-host.js` | **595 全绿** |

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 595 全绿 | p37 四断言 |
| 产物级 | ✅ | bundle 求值三断言 + 发行内容断言（v0.26.13） |
| 真机（用户 GUI） | ✅ 用户验收通过 | params 编辑保存生效；新增 params 经编排 Agent 写入 subagent 派发提示词（用户确认） |

## 7. 真机验收清单（用户 GUI，重启 dsh 后）

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | STOPPED 实例编辑器 → params 增删改 → 「保存参数」 | 提示「参数已保存」；workflow_status 快照 params 反映；重进回显一致 |
| 2 | begin/reset 后执行 | 目录变量/${param} 注入使用新值 |
| 3 | RUNNING 实例 params 区 | 只读 + 保存按钮禁用（title 提示当前阶段不允许） |
| 4 | 非法输入（空键/非对象） | 400 报错不落盘 |

## 8. 遗留与后续

| 遗留 | 去向 |
|---|---|
| 定义内 params 声明与 meta.params 实参的差异标注（「非声明参数」提示） | 候选，Iter-38+ 评估 |
| **params 双轨统一**（instance.yaml 声明 vs metadata.params 实参；用户 09-17 指令插入队列） | **Iter-38：params 影响分析与单轨化**（先出影响分析方案） |
| U1 门禁角点 | Iter-39 |

## 9. 参考

- 设计：`iter-37-design.md`
- 版本 Incident：本迭代首次发行时误编 0.26.10（该号已被技能查看修复占用）——根因=sed 基线过期静默空转 + 预设版本号违反规则；已纠正为 0.26.13 并记入教训（版本号以发行时顺延为准，禁止预设）

## 10. 补记：验收反馈修复（v0.26.14，2026-09-17）

用户验收三现象（实例 verify-gate-4423b98e，FAILED 阶段）：①maxConcurrency 修改无效重进旧值 ②保存按钮灰色 ③新增 params 未进 subagent 提示词。

| 根因 | 修复 |
|---|---|
| ①② params KvEditor 在 FAILED 阶段被我设为只读（原门控仅 CREATED/PENDING/STOPPED）+ 用户编辑的是 maxConcurrency（定义字段，走页脚定义保存）却点了 params 区的独立灰按钮——**两个保存按钮并存的 UI 语义混乱（设计缺陷）** | ①params 阶段门控放宽为仅拒 RUNNING（FAILED/COMPLETED 下改参数→Reset 重跑正是主流程）②**统一保存**：移除 params 独立按钮，页脚「保存」双通道（定义 patch + params 有改动时同批提交）③maxConcurrency 走页脚保存即落盘 |
| ③ 新增 params 未进 subagent 提示词 | workflow_begin 返回快照未挂 params（仅 statusTool 挂）→ beginTool 补挂 meta.params（对齐 statusTool）；persona §4 派发已要求附 params 上下文（L90-92 既有） |

版本 v0.26.14；588→599（含 params 路由与 edit36/edit37 断言累计）。

## 11. 补记：params 单轨化落地（v0.26.16~18，2026-09-17，与 Iter-38 分析合并实施）

用户拍板：全局 params 作为工作流定义一部分保留在模板/instance.yaml；**不设 default、仅当前值**；meta.params 删除退役。实施（iter-38-analysis.md 方案合并落地）：

| 改动 | 说明 |
|---|---|
| params 节扁平化 | parser 兼容旧对象形态（取 default），新形态=扁平当前值；serialize 往返保真 |
| 单一事实源 | instance.yaml params 节：${param} 注入、workflow_status/begin 快照 params、编辑器 params 区、源码态全部同源 |
| 保存通道统一 | params 随 /wf/instance-yaml patch.params 提交（applyInstancePatch 顶层分支，非 RUNNING 可改）；/wf/instance-params 路由退役删除 |
| 创建实参落 yaml | /wf/create 与 workflow_create：args.params 经 mergeParamsIntoYamlText 落 instance.yaml params 节；**meta.params 不再写入**（createBind/beginInstance params={}） |
| 头注释保留修复 | mergeParamsIntoYamlText 保留文件头注释块（实例溯源不被 parseYaml 往返丢弃） |
| 教训 | merge 编辑曾引用未赋值 parsed（runCase14 中断）；webserver/tools-preset 双路径都要改（GUI 走 /wf/create 路由）；pnpm install 对同版本 file: tgz 不刷新内容——**发版后必须强删包目录+--force 重装并 grep 部署产物核验** |
