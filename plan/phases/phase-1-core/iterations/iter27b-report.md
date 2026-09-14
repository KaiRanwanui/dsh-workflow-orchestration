# Iter-27b 报告 — 语义校验（错误级清单 + 关口硬拦 + workflow_validate）

- **状态**：✅ 完成关闭（2026-09-04，用户 GUI 验收通过；验收修正"只转告+停止"复验通过后收尾）
- **版本**：host v0.18.0 / client 不动（v0.6.1）
- **提交**：`585c5b1`（主体）+ 收尾文档提交（本报告随收尾提交入库），已推 origin/main
- **配套**：`iter27-design.md`（拆分版 §5 错误码表 / §7 边界；主体实施方案以"用户操作流程叙述"版过审——技术清单版曾被用户退回看不懂）

## 设计决议（用户拍板，详见设计稿）

- **拍板①=B**：create/begin 语义**硬拦截**（校验先于 createBind，拒绝零副作用，不建实例目录）；start/resume **实时闸门**（重读 instance.yaml，防"创建后退化"）；reset **回传不拦**
- **拍板②**：items **双语境**（preset 定义语境=模板子目录锚点+禁字面绝对路径；实例语境=实例目录 1:1 副本优先→绝对直通）
- **码表**：8 错误码（`E-DEP-CYCLE`/`E-PROCESSOR-MISSING`/`E-SKILL-MISSING`/`E-GATE-CHECKER-MISSING`/`E-INPUT-MISSING`/`E-ITEMS-MISSING`/`E-ABS-IN-DEF`/`E-ITEMS-PARSE`）+ 2 警告（`W-REF-MISMATCH` 拼接疑义 / `W-ITEMS-INPUT-DUP` 重复声明，27a 后补丁拍板）
- **raw/expanded 双轨**：`E-ABS-IN-DEF` 查 raw 字面（params 注入出绝对=合法用户入口，四点④）；存在性查 ${} 展开后值——两条拍板互不冲突的关键
- **验收修正（GUI 验收后用户提出，安全红线）**：被拦后 LLM 只许**转告清单+停止**，**严禁自行搜索/替换技能或输入文件**（同名≠正确，防引用错误甚至恶意文件注入）——首次复验发现 LLM 被拦后自行拿工作区同名旧技能顶替继续执行

## 交付

- `code/shared/workflow-validate.js`（新增，第 10 个同步 section）：`validateWorkflow` 纯函数引擎；`expandRef` 轻量 ${} 注入（与 injectParams 非迭代分支同语义，单测一致性断言）；`detectDepCycles` DFS 三色+同环去重（环路径可读 `a>b>a`）；fs 缺失降级纯静态不误报
- `workflow-paths.js`：+`deferDisposition`（单一事实源自 tools-preset 前移；raw/expanded 双形态兼容）
- `workflow-parser.js`：gate checker / 缺 processor 两处 warning 下线（升错误级归 validate；warnings 数组恒空保形状兼容）
- `tools-preset.js`：create/begin 硬拦 + start/resume 实时闸门 + reset 回传 + status 附 metadata 快照（legacy 实例 hydrate=ok 兼容）+ 新工具 `workflow_validate`（只读两形态：instanceId=实例语境实时校验；workflowPath/Text=定义语境，preset 自动锚定）+ 拒绝响应统一 `hint`
- mjs 直编区：`/wf/create` 同款关口（400 结构化 `errors`+`hint`；200 补 `validation` 摘要）；BUILTIN_TEMPLATES 未动
- persona（system-prompt.md + agent.cordis.yml）：码表/关口契约/**hint 安全红线**/validate 用法/Iter-25 两条护栏标注 legacy 兜底
- 基础设施：sync-modules 登记 workflow-validate（9→10 section）；测试同步改 `wv`/`wvE_` 前缀规避 mjs 内联作用域重声明

## 查找次序（用户确认，明确记档）

- **技能（processor / gate.checker）相对路径两级链**：工作区根（会话 cwd）→ 预定义目录（`$DSH_HOME/workflow-agent`）→ 双 miss 拦截；绝对路径直通（仅用户指定）
- **静态文件（inputs / items-from）**：实例语境=实例目录 1:1 副本 → defDir（仅 preset 来源）→ 两级链；普通定义语境=两级链；preset 定义语境=仅 defDir 锚点（不走两级链）
- **同名替代**（工作区优先可顶替预定义版）= 用户拍板**当前可接受**（灵活性）；"路径固化"（metadata 锁定创建时解析路径+启动一致性校验）留作可选加固，未排期

## 验证结论

- **单测**：421 → 485 全绿。用例 24 新增 59 项：引擎静态 12（缺 processor 三形态/gate/环三情形/fs 降级）+ fs 探针语境 22（技能四情形/inputs 六情形/items 六情形/preset 锚点+禁绝对+params 注入/实例链/互斥警告/单源/注入一致性）+ 工具关口 14（create 拦×2+零副作用/通过+快照落盘/start 退化拦+恢复放行/resume 闸门/reset 回传/status 摘要/begin 整体拒+不建实例）+ workflow_validate 工具 5（定义/preset 锚定/实例/实例退化/parseErrors）。既有用例 9/10/13/14/16/17/20/21/22/23 夹具补技能文件或断言迁移 27b 语义（case 10：400 硬拦+hint+validation）
- **修复 2 个 mjs 内联冲突**：`normalizeSlashes` 函数重声明、`E_` 别名重声明（模块级作用域）——validate 内部助手加 `wv`/`wvE_` 前缀
- **部署**：sync 10 section → package.json 0.18.0 → build.js（lib 求值级加载通过）→ 三份 cp 至 `~/.dsh/.agent-presets/workflow-orchestrator/`（diff 一致）→ 用户重启 dsh.service 两次（主体+验收修正各一次；journalctl materialize ok）
- **GUI 验收（用户执行）**：①缺 processor create 被拦见清单 ✓ ②修复后成功 ✓ ③删技能 start 被拦 ✓（首次复验发现 LLM 自行找同名技能顶替 → 验收修正后二次复验：工作区+预定义双删后正确停止，不再自行搜索 ✓）④延迟组/完好定义零误报 ✓

## 边界与遗留

| 项 | 归属 | 说明 |
|---|---|---|
| gate checker 文件缺失（路径存在性）未校验 | 局限声明 | 不在已拍板 10 码表内，保持运行时语义（执行期 checker null 护栏兜底） |
| `E-ABS-IN-DEF` 仅覆盖 inputs/items-from | 局限声明 | processor/gateChecker 技能保留绝对直通（当前语义） |
| 同名替代（工作区优先顶替预定义） | 用户拍板可接受 | 路径固化留作可选加固，未排期 |
| warnings 面板展示 | **Iter-28** | W 级清单前台展示（数据通道已通：响应 warnings + metadata.validation） |
| 编辑保存触发校验 | **Iter-28** | iter28 小节已写明"保存时触发 Iter-27 校验并展示结果" |
| 物化/复制仅文本文件 | 局限声明 | fs 服务 readText/writeText 无 copy/delete（Iter-26 先例延续） |
