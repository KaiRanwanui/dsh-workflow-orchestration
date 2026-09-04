# Iter-28 报告 — 实例编辑前台

- **状态**：✅ 完成关闭（2026-09-04，用户 GUI 验收通过；两轮验收修正含 persona 单源化复验通过后收尾）
- **版本**：host v0.19.0 / client v0.7.0
- **提交**：`bc54fdf`（主体+验收修正+单源化）+ 收尾文档提交（本报告随收尾提交入库），已推 origin/master
- **配套**：`architecture-decisions.md` §8（rc2 persona 内联系统限制与单源化决策）

## 设计决议（用户多轮选项拍板）

- **布局**：DAG 下方可折叠面板（默认收起，「✎ 编辑」展开）
- **技能下拉源**：预定义 + 工作区合并，同名工作区顶替（`predefinedShadowed` 标注）
- **保存流程**：校验错误**阻止落盘** + 结构化错误列表展示（`workflowBeginErrors` 格式化行 + editErrors `[code] 任务"x" field: message` 双列表）
- **编辑范围权限矩阵**（用户原话拍板）：`name` 只读；`params` 编辑器内只读（创建对话框键值行可编辑）；`maxConcurrency` 实例级可改；`concurrency`/`retries` 任务级可改；`processor`/`gateChecker`/`inputs`/`outputs` 仅实例创建时可改（CREATED 后 definition 维度全锁）
- **创建对话框 params**：key-value 行编辑器（非 JSON 文本框）；空键跳过、值 JSON.parse 回退字符串、重复键报错

## 交付

### Host（v0.19.0）

- `code/shared/workflow-edit.js`（新增，第 11 个同步 section，仅依赖同域 parseYaml）：
  - `serializeWorkflowYaml(raw)`：稳定键序 name/version/description/params/max-concurrency/tasks（未知键原位保持）；自研标量序列化对 looks-numeric/boolean/special 字符串加引号（已知损失：引用不保真，`"1.0"` 往返数字化，用户接受）
  - `instanceEditPermissions(stage)`：CREATED=定义可编辑；RUNNING=`readonlyAll`；runtime（max-concurrency/retries）=非 RUNNING
  - `applyInstancePatch(raw, patch, perms)`：字段白名单+拒绝码（`E-EDIT-RAW` 非法值/`E-EDIT-DENIED` 权限/`E-EDIT-VALUE`/`E-EDIT-NOTASK`）；`gateChecker:''` 删 checker 保 gate shell；无 gate 任务设 checker/retries 自动建 `on-failure:block` shell；`concurrency:null` 删
  - `simplifyParams`（默认值展平）/ `parseSkillFrontmatter`（name+version）
- mjs 直编区：
  - `GET /wf/skills`：预定义+工作区两级扫描合并，同名工作区顶替并标注；无 SKILL.md 目录跳过
  - `GET /wf/instance-yaml`：stage 判定（state.json 存在=引擎快照，否则 CREATED）+ editable 权限 + 任务 raw 字段（processor/gateChecker/retries/inputs/outputs/concurrency/itemsFrom）+ 状态聚合（同 id 直取，`_loopGroup`/`_concurrentGroup` 取组内最劣态）
  - `POST /wf/validate-instance`（dryRun）与 `POST /wf/instance-yaml`（保存）共用 `editInstancePipeline`：stripInstanceHeader → parseYaml → applyInstancePatch → 注释头保留重接 → serializeWorkflowYaml → parseWorkflow → **validateWorkflow 实例语境**（Iter-27b 引擎复用）→ 错误 400 `{errors, workflowBeginErrors, hint}` 零写入；dryRun 200；save 落盘+`registry.patchMeta`（validation 快照）
  - `GET /wf/templates` 补 `params` 字段（创建对话框预填）

### Client（v0.7.0）

- `getKeyValueComponent()`：键值行编辑器（行删除 ×、readOnly 隐藏编辑、+ 添加）
- 创建对话框：`paramsEntries` 键值行态取代 JSON 文本框；模板切换预填默认值；成功后对话框内**呈现视图**（✓ + recoveredConflict 蓝框 + warnings 黄列表；无警告自动关闭）
- `getEditorComponent()`（EditorPanel）：双栏布局；左侧任务列表（状态色点+类型标签 llm-task/loop/concurrent/human-decision/external-agent）；右侧表单（技能下拉=版本+来源后缀+⚠ 当前值兜底项；inputs Kv 多值逗号；outputs 行编辑；gateChecker「（无门禁）」空项；retries/concurrency）；顶部实例级（name 只读 / maxConcurrency / params 只读 Kv）；页脚「仅校验」+「保存（校验通过才落盘）」
- hooks 纪律：`editorOpen` 与 `formOpen` 同置条件 return 之前的 hooks 区；模块级组件缓存防重挂载

## 验收修正（两轮，均为 GUI 实测反馈）

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | inputs「+ 添加」无效 | onChange 即时过滤空 key 行→新行消失 | draft 改存 entries 中间态（空 key=合法编辑态），对象转换推迟 buildPatch；删除行自然生效 |
| 2 | RUNNING 时编辑按钮仍可点 | 按钮可见性与 stage 无关 | `stateData.stage==='RUNNING'` 灰禁（opacity+title） |
| 3 | 运行中打开编辑器表单仍可编辑 | 编辑器数据不随 stage 刷新（打开时 CREATED 权限快照一直有效） | EditorPanel 接收外部 stage（2s 轮询权威值），不一致即重拉→权限即时转禁用 |
| 4 | params 未传给任务 subagent | 两层：①host `workflow_status` 快照无 params（engine state 从不存用户实参，值仅在 meta.params）②persona 派发模板无 params 指示 | ①快照附 `meta.params`（非空才挂）②persona 派发段加 `params = <JSON 原样>` 行 |
| 4b | 修后仍未见 params | **persona 实际生效的是 agent.cordis.yml 内联 text**（dsh-persona row config.text），system-prompt.md 只是源文档——首修只改了 md | 同步内联 text；进而拍板单源化根治（见下） |

另记：`/wf/status`（HTTP 轮询，`loadStateFromFile` 直读）无 params 属预期——与 `workflow_status` 工具是两条通道。

## 架构限制与 persona 单源化（A 方案，用户拍板）

- **系统限制（rc2 无法解耦）**：`@deepseek-ai/dsh-persona@0.1.1-rc.2` Config 仅 `text: string`（无 file/path 引用）——persona 必须内联 composition，与 md 源文档双写。完整决策与 **DSH 升级检查项**记档 `architecture-decisions.md` §8。
- **单源链路**：`system-prompt.md` 唯一手编源 → `code/scripts/sync-persona.js` 构建期注入 yml persona row `text: |` literal block（生成物勿手编）。脚本特性：`{{` 模板插值符拦截（dsh-persona 会当 prompt 变量展开）、幂等、`--check` 供部署链/CI、兼容旧 `>-` 折叠形态 bootstrap。
- **前置合并**：单源化前修复 md 的 3 处 v1 串行残留（职责段/就绪推导/单发 subagent→runnable 驱动+并行启动+并发规则），节号 1-8 顺延修复重号；md 现含全部语义（Session 启停止血/控制指令统一表/错误码表/清理契约）。
- **验证**：js-yaml 解析 `config.text` 与 md **逐字节相等**（含尾换行归一）；`--check` 通过。
- **部署链变化**：改 persona = 改 md → `node code/scripts/sync-persona.js` → cp `agent.cordis.yml`+`system-prompt.md` 至 preset 目录 → 重启 dsh.service。

## 验证结论

- **单测**：485 → 529 全绿。runCase25 新增 44 项：序列化往返幂等（键序递归 norm+重序列化比对）/权限矩阵/patch 白名单·拒绝·非法值/simplifyParams/parseSkillFrontmatter//wf/skills 合并（DSH_HOME 隔离夹具，工作区顶替+frontmatter）//wf/templates params/创建→GET→保存链（注释头保留+数值持久化+重读一致）/dryRun 零写入/E-SKILL-MISSING 门控 400+磁盘不变/手动构造 STOPPED+RUNNING 实例（绕过创建缓存）/400·404 参数
- **部署**：sync 11 section → host bump 0.19.0/client 0.7.0 → build×2 → verify-client-bundle OK → cp（mjs+system-prompt.md+agent.cordis.yml，diff 一致）→ 用户重启 dsh.service（多轮，journalctl materialize ok）
- **GUI 验收（用户执行）**：编辑器全功能（技能下拉/inputs 增删/outputs/重试/并发）✓ 创建对话框 params 键值行+warnings 面板 ✓ RUNNING 编辑按钮灰禁+表单全锁 ✓ params 进任务 subagent 首条消息（单源化后）✓

## 边界与遗留

| 项 | 归属 | 说明 |
|---|---|---|
| 序列化引用不保真（`"1.0"`→1） | 已接受损失 | 自研 serializer 对 numeric 形态字符串加引号已尽力；用户拍板接受 |
| `/wf/status` 不含 params | 设计如此 | HTTP 轮询通道直读 state.json，不过工具层；面板无需 params |
| persona 单源依赖 sync-persona.js | rc2 系统限制 | DSH 升级后按 architecture-decisions §8 检查项复查，支持 file 引用即删脚本 |
| 编辑器展开期间实例被外部 reset | 未处理 | stage 不变（READY）权限不变；下次迭代如遇再评估 |
| Iter-29 实例管理子页签+归档/下载/删除 | **下一迭代** | 独立可提前；fs 无删除 API 沿用 pendingCleanup 模式 |
| Iter-30 DAG 美化 | 排队 | 节点详情面板数据依赖 Iter-25 已就绪 |
