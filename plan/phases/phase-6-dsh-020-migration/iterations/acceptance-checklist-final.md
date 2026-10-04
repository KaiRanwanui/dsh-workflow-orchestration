# 阶段 6 终验 · 全面功能验收清单（Iter-MIG7 交付）

> **对象**：workflow-agent v0.29.1 @ DSH 0.2.0-rc.2（干净重装后）
> **用法**：逐项操作并勾选；任一项不符预期即停，记录现象反馈（将视情况组织后续迭代）。
> 运行现场：`/Users/zhaokai/Projects/dsh_projects/sysdesign-trial/`

---

## A. sys-design 真实负载（12 任务串行 + 全门禁）

- [x] **A1 PRD 就位**：`prd/PRD.md` 已放（当前为占位件「智能会议室预订系统」；可用备份真件替换）
- [x] **A2 建会话**：在 `sysdesign-trial` 目录新建会话，preset 选 **Workflow Orchestrator**（预期：preset 选择器可见该选项；会话建好后 Workflow 页签显示）
- [x] **A3 创建实例**：会话内指示 agent「读取 ./sys-design.yaml 创建工作流实例」（或面板创建弹窗 YAML 模式贴入）。预期：实例创建成功、面板 DAG 显示 12 节点串行链
- [ ] **A4 Start**：启动后预期：design-init 先行（环境初始化六步：目录/工具/知识库占位/输入件/git/环境报告——检查 `output/`、`knowledge-base/` 等被创建）；其门禁 **block** 语义（PRD 缺失会阻断——若验证该项可临时移走 PRD 试一次再放回） -> （**存在问题，见问题记录章节**）
- [x] **A5 串行推进**：任务逐个 RUNNING→DONE，每个任务完成后有独立门禁评审子会话（DAG 上门禁角点/状态可见）；`output/` 下 00~11 号文档逐个产出
- [ ] **A6 门禁 retry 语义**（观察项）：若某任务门禁 FAIL，预期重做一轮（gateNote 反馈），耗尽才 FAILED 停链；正常情况全 PASS 则记「全 PASS 链路」（*未构造出测试例，其他测试工作流替代验证*）
- [x] **A7 中途干预**（建议做一次）：第 3~5 个任务期间点 **Stop** → 预期全部子会话级联停止、DAG 状态 STOPPED；**Resume** → 预期从断点继续
- [x] **A8 完成**：12 任务全 DONE → 实例 **COMPLETED**；`output/` 有 00~11 全套产物

## B. 全面功能回归

### B1 页签门控（MIG5 成果）
- [x] 切到非编排会话（含 sys-design 派生的任务子会话）→ Workflow 页签**立即消失**
- [x] 切回编排会话 → 页签**立即恢复**，无闪烁、无空页签

### B2 实例管理
- [ ] **多实例**：另建一个 default-demo 实例（同会话或另一会话）→ 实例列表可见两个实例并可切换 （*无法验证，不存在会话切换工作流实例的功能，不是预期的功能；采纳未绑定会话的实例功能正常*）
- [x] **编辑**：实例编辑器打开（表单/YAML 双模式），改一个任务名保存生效
- [x] **归档**：归档已完成的实例 → *列表移入归档区*、可下载 zip
- [x] **删除**：删除测试实例 → 列表消失

### B3 四键控制（对 demo 实例）
- [x] **Start** / **Stop**（级联）/ **Resume** / **Reset**（回 PENDING 停住等手动 Start）

### B4 呈现
- [x] DAG 分层布局、状态着色（RUNNING 脉动/FAILED 红/SKIPPED 黄）
- [x] 执行日志面板滚动输出
- [x] 深浅主题下面板可读（若有换肤）

### B5 工具链（会话内）
- [x] agent 正确调用 `workflow_begin` / `workflow_status`（A3/A5 已覆盖，确认即可）

---

## C. 阶段 1~4 全功能回归（模板驱动 + 特性清单）

> 原理：阶段 4 Iter-32 专门制作的 verify-* 验证模板 + 预定义 demo 模板，正是全语义回归的自带资产。
> 8 模板技能均经两级链（工作空间→预定义根 `~/.dsh-dev/workflow-agent/skills/`）兜底，任意工作区可跑。
> 建议在 `sysdesign-trial` 或专用验证工作区逐个「创建 → Start → 跑完」，边跑边核对验证点。

### C1 模板驱动语义回归（8 个预定义模板）

| # | 模板 | 验证的语义点（阶段来源） | 预期 |
|---|---|---|---|
| C1.1 | serial-demo | 串行链 / 依赖放行 / output→下游 input 文件衔接（S1） | 2 任务顺序完成，实例 COMPLETED |
| C1.2 | default-demo | 并发组 max-concurrency=2 / 长任务 / 门禁（S1） | deep-analysis+write-spec 并行；门禁 PASS→COMPLETED |
| C1.3 | items-demo | items 四格式（markdown 列表/表格、JSON、YAML map）× loop+concurrent / 模板子目录 1:1 复制（items-from 自包含）/ `_loopItem` 传入迭代（S1+Iter-27a） | 各格式迭代逐个执行，`_loopItem` 值出现在子会话；创建时 inputs/items/ 复制进实例目录 |
| C1.4 | runtime-items-demo | 运行时 items 展开：上游产出清单文件 → 下游 loop 动态展开 / 占位组框「⏳ 等待 items...」（Iter-26R） | collect 完成后占位展开为 N 迭代并逐个执行 |
| C1.5 | verify-dir-vars | 目录变量四变量两阶段注入：`${workspace}/${skills}`（展开期）/ `${wf_dir}/${skill_dir}`（实例目录就绪后）（Iter-32） | 产出文档如实陈述四路径可达（任一未注入即异常） |
| C1.6 | verify-empty-items | 空提取→占位形态 (0)：lines 提取忽略空行注释 → 0 条 → 组盒渲染 (0) 不派发（Iter-32/Q1-b） | 循环任务保持占位 (0)，链完整不报错 |
| C1.7 | verify-gate | 门禁三变体：PASS→DONE(retry) / FAIL→SKIPPED(skip) / FAIL→阻断(block)；门禁独立 subagent 会话；gateResult 落快照（Iter-32/阶段 4 #8） | 三任务并发各按 on-failure 正确处置；状态条 G: 与角标可见 |
| C1.8 | verify-skill-shadow | 技能两级链同名工作区优先（遮蔽）（Iter-32） | 按 steps 复制 shadow 技能后，输出含 SHADOW-COPY 标记 |

### C2 后台控制语义（S1+S2+Iter-31/33）

- [x] 状态机全态：CREATED→PENDING→RUNNING→STOPPED/COMPLETED/FAILED 可见流转
- [x] 权威停止两通道等效：面板 Stop 与会话 UI 停止均级联子会话（stop-trace：cancelled+drained+children>0）
- [x] Reset 后停 PENDING 等手动 Start；无 stopHint 提示条（Iter-31 移除，不应复现）
- [x] 孤儿回收：重启 dsh web 后 `/wf/list` 的 `recoveredOrphans` 正确识别死会话实例
- [x] 采纳关口：`workflow_adopt` 对缺文件/不完整实例拒绝（可造一个残缺实例目录验证）
- [ ] 多实例会话绑定：一会话多实例切换；实例列表跨会话隔离 （*无法验证，不存在会话切换工作流实例的功能，不是预期的功能；实例跨工作目录隔离是OK的*）

### C3 语义校验器（Iter-27b 起 8 类 E-* + 2 类 W-*）

- [x] E-DEP-CYCLE：造循环依赖 → 创建被拦
- [x] E-SKILL-MISSING / E-PROCESSOR-MISSING：技能路径不存在 → 拦截并精确报任务/字段
- [x] E-INPUT-MISSING：声明不存在的输入 → 拦截
- [x] E-GATE-CHECKER-MISSING：quality-gate 缺 checker → 拦截
- [x] E-ITEMS-PARSE / E-ITEMS-MISSING / E-ABS-IN-DEF：items 文件损坏/缺失、定义内绝对路径 → 拦截
- [x] W-REF-MISMATCH / W-ITEMS-INPUT-DUP：引用不匹配、items 与 inputs 重复声明 → 警告放行并在 UI 呈现（含 W-GATE-RETRY-MISMATCH：retry 无 max-retries 警告，Iter-36）
- [x] 多错误合并呈现（Iter-35）：一次提交多个错误全部列出

### C4 前台编辑器与 UI 特性（阶段 4 主体交付）

- [x] 创建弹窗：模板下拉（名称+说明 U2）/ YAML 源码模式（Iter-35 两态切换）
- [x] 实例编辑器：表单模式字段矩阵（depends-on/timeout/on-failure/gate-on-failure 等）与 YAML 双向一致
- [x] 技能全文只读浏览（Iter-35）
- [x] 编辑权限矩阵（保存仅允许特定字段——Iter-39 前形态；已列入待专项对齐，此项按现状记录即可）
- [x] 全局参数 params 编辑（Iter-37 单轨化）
- [x] 页签动态门控（MIG5 重做版：即时显隐无闪烁）
- [x] RUNNING 运行视觉：门禁角点、状态条 G: 计数（Iter-38/40）
- [x] DAG：分层布局 / 状态着色 / 失败红 / 跳过黄 / 组盒折叠（循环组）
- [x] 执行日志面板
- [x] 实例管理：归档 / zip 下载 / 删除 / 归档区浏览（Iter-29）
- [x] 深浅主题下面板可读（Iter-41 主题适配）

### C5 资产与发行（阶段 3；部分已被 MIG7 干净重装覆盖）

- [x] 物化 30 文件四层（MIG7 自检已过）
- [x] tgz 内容断言 / engines 预检 / bundles 自动注册（MIG7 干净重装已过）
- [x] install 悬空自动修正 + 实体同步（MIG7 专项复验已过）
- [x] 模板子目录 1:1 复制（C1.3 创建 items-demo 时顺带验证 presetCopy 非空）

## 验收结果记录

| 区块 | 结果 | 备注 |
|---|---|---|
| A 真实负载 | 1不通过，1未验证 |  |
| B1 页签门控 |通过 |  |
| B2 实例管理 | 1未验证 |  |
| B3 四键 | 通过 |  |
| B4 呈现 | 通过 | |
| B5 工具链 | 通过 |  |
| C1 模板语义回归（×8） | 通过 | |
| C2 后台控制语义 | 1未验证 |  |
| C3 校验器 E-*/W-* | 通过 | |
| C4 编辑器与 UI | 通过 | |
| C5 资产与发行 | 通过 | 3 项已由 MIG7 自检覆盖 |

**全过 → 阶段 6 关闭，恢复阶段 5（Iter-47：sys-design 模板/知识库资产制作 + 真实磨炼）。**

## 问题或优化点记录

### 需立即解决的问题
1. 需排查代码中是否存在硬编码的路径，硬编码是否合理。当dsh的安装位置、工作流工作空间变化时，硬编码可能导致错误。
2. 工作流编辑中，对于quality-gate:checker属性值是否填写进行了检查，但没有对填写的技能的存在性进行检查。输入不存在的技能文件依然能通过检查。建议补充门禁技能两层目录检查机制，跟processor属性的技能存在性检查逻辑一致。

### 可在后续阶段解决的问题
1. 指定工作流定义文件创建工作流实例时，除绝对路径外，可增支持相对路径。
2. 如果指定相对路径，默认搜索的位置的确定逻辑存在问题，如支持相对路径定义，需按以下优先级进行文件搜索：当前工作空间>插件预置文件目录。当前相对路径搜索提示如下错误`cannot read workflowPath: ENOENT: no such file or directory, open '/Users/zhaokai/Projects/dsh_projects/normal_ws/sys-design.yaml'`，说明当前优先从默认工作空间查找了。不要在默认工作空间执行查找，容易造成非预期混乱。
3. Workflow-Orchestration会话切换后，workflow的DAG面板刷新存在时延，不能立即刷新成为当前Session的DAG，而是会显示上个Session的DAG，过1-2秒左右才刷新为当前Session的DAG。
4. 编辑工作流定义->源码：校验和保存按钮的配色在深色外观下无法看到文字内容，按钮填充和文字都是灰白色。需跟表单编辑界面的按钮配色一致。
5. 编辑工作流定义->表单：当gateChecker选择技能并保存之后，再选择“（无门禁）”，无效的on-failure，max-retries等无效属性不会立即从界面上隐藏。如果选择了技能门禁但不保存，再选择“无门禁”，on-failure属性会隐藏，但max-retries属性不会隐藏.
6. （A4）design-init在重入（第一次检查过程stop了，第二次再重新执行检查，第一次的output输出已存在）执行门禁时存在没有严格按门禁skill要求执行的问题，表现在：1）如果output文件存在，则读取已存在的output文件执行检查逻辑，而不是从新读取各个工作目录下的目标文件；我在门禁检查subagent执行中stop，并修改PRD.md文件名称，再次resume进入门禁检查subagent执行，但第二次门禁检查没有重新检查RPD.md文件是否存在。2）输出文件增加了“-0”后缀且在log目录下，但实际应该覆盖任务定义的output文件（已存在）。门禁检查prompt的逻辑可能让LLM误解，我摘录最后一部分如下：

    ``` markdown
    ## 检查对象

    ### 任务输入文件（inputs）
    本任务无输入文件（inputs 为空）。

    ### 任务输出文件（outputs）
    - /Users/zhaokai/Projects/dsh_projects/sysdesign-trial/.workflow-agent/instances/sys-design-969bc476/output/00-design-init.md

    ## 要求
    1. 先用 read 工具读取上述输出文件全文。
    2. 按技能中 7 项检查项逐一检查。
    3. 把完整检查结论（含每项的通过/未通过判定及理由）写入以下路径：
    /Users/zhaokai/Projects/dsh_projects/sysdesign-trial/.workflow-agent/instances/sys-design-969bc476/logs/gate-design-init-0.md
    4. 最后，在回复中只输出 PASS 或 FAIL（FAIL 时附理由摘要）。
    ```
7. 工作流定义文件中，inputs使用的是KV风格，而output只是单一的V。建议风格统一，inputs使用KV是否有独特的优势？
8. 编辑校验时，对于并发组、循环组，并未校验任务outputs文件名中的`${var}`占位符中的变量名`var`，是否跟items-var变量名称一致。
9. （C1.5）`${wf_dir}`,`${skill_dir}`等变量仅在工作流实例文件中进行了填充，并未传递到技能中。后续需支持这种预置变量在skill中使用，并在skill运行时填充到skill执行prompt中。（但需要考虑skill的兼容性）
10. （C1.6）创建verify-empty-items工作流后的提示：`⚠ 有 1 个任务的执行状态属上一轮定义 · Reset 后对齐`，是否有必要提醒？文字表达是否清晰？ Reset后没有了这个提醒，但从工作流实例的表单、源码来看，很难发现区别，让人难于理解它说明的情况是什么。





