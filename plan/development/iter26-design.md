# Iter-26 设计定稿 — items 结构化提取

- **时间**：2026-09-02
- **状态**：**设计定稿**（Q1-Q6 及拆分/reset 全部用户拍板，据此实施）
- **输入**：`../requirements/工作流数据管理需求.md`（R17/R18/R20）+ `iter25-design.md`（两阶段注入流水线 D1-D4）+ `iter25-report.md`
- **上游迭代**：Iter-25（两阶段注入 expandDefinition + finalizeDataflow、inputs/outputs 绝对化地基）

## 1. 现状与差距（代码实证）

| # | 现状 | 差距 |
|---|------|------|
| 1 | `expandDefinition` 阶段1 读 items 文件 → **行文本拆分**（trim / 跳 `#` 注释 / 空文件报错）→ 字符串数组 | 仅支持行文本；markdown/JSON/YAML 无法用（R17） |
| 2 | `PARAM_PATTERN = /\$\{(\w+)\}/g` 单层变量；`expandLoop/ConcurrentTasks` 把 item 字符串塞进 `iterParams[itemVar]` | `${item.字段}` 点号不匹配、原样幸存；对象 item 无从谈起（R18） |
| 3 | items-from 相对路径走两级链（workspace 优先 → 预定义兜底） | `${wf_dir}` 在阶段1不可知 → 实例目录内文件无法引用（本迭代部分解，见 §2-6 边界） |
| 4 | **架构事实（拍板确认）**：loop/concurrent 迭代节点在**启动/重置时刻一次展开定死** | "同一次运行内上游 output 作 items"需**运行时延迟展开**，属架构级变更 → 拆分至 **Iter-26R**（排 Iter-27 前），本迭代交付其复用地基 |
| 5 | `workflow_reset` 现状**保留 output/logs**（同名覆盖） | 与用户语义"重置重来应删 output"不符 → 本迭代顺带修（备份后清空） |

## 2. 决议记录（2026-09-02 用户拍板）

| # | 决策点 | 结论 |
|---|--------|------|
| Q1 | markdown 提取优先级 | **表格 > 列表**；两者皆无 → 0 items（空转语义见 Q1-b） |
| Q1-b | 空提取（0 items）语义 | **引擎不做特殊处理：展开为 1 个占位迭代**，正常派发 subagent，`${itemVar}`/`${itemVar.字段}` 注入空串，**行为由技能自行处理**（如写空白输出）；组节点存在、依赖链完整。文件不存在/坏 JSON/顶层标量仍报错。现状"空文件报错"随之取消（无测试断言依赖，安全） |
| Q2 | `${item}` 默认链 | **ID={id,no,num,number,编号,序号}（英文不区分大小写）→ 名称={name,title,名称,标题} → 1-based 十进制序号**；命中字段的值须为标量，否则跳下一级 |
| Q3 | 顶层并列对象的键 | **键恒为 `id` 字段**：值为对象 → `{id:键, ...值}`（值内同名 id 以键覆盖）；值为标量 → `{id:键, name:String(值)}` |
| Q4 | 注入正则 | **扩展主 `PARAM_PATTERN` 单正则单遍扫描**（`/\$\{(\w+(?:\.\w+)?)\}/g`）；`injectParams` 加 itemCtx 可选形参，缺省行为逐字节不变 |
| Q5 | 迭代拆分 | **方案 S**：本迭代 items=**启动时刻已存在的文件**；**运行时 items 展开立为 Iter-26R**（组占位/组完成语义/下游组依赖/DAG 晚现节点），排 Iter-27 之前；begin 路径**不重排** |
| Q6 | 验收样例 | **物化 samples/ 三格式 items 样例 + `items-demo` 内建模板**（GUI 验收开箱即用） |
| 追加 | reset 语义 | **归档备份后清空 output/logs**（符合"重置重来"），本迭代顺带修 |

## 3. 交付范围

1. **items-format 显式声明**：loop/concurrent 新增可选字段 `items-format: lines|markdown|json|yaml`；非法值 → error（结构错误，create 拦截，同 on-failure 先例）；
2. **扩展名推断**：无声明时按 items-from 扩展名——`.md/.markdown`→markdown、`.json`→json、`.jsonl`→json（行式语义）、`.yaml/.yml`→yaml、**其余（含 .txt/无扩展名）→ lines**；显式声明恒优先；`items-format: lines` 为旧行文逃生门；
3. **提取器 `extractItems`**（纯函数，新共享模块）：
   - **lines**：现规则原样（trim / 跳 `#` / 空行过滤）；
   - **markdown**：GFM 管道表格（表头=字段名、每行=对象 item、单元格保持字符串、列数不齐宽容补齐/截断）+ 列表项（`-/*/+/1.` 前缀剥离、标量 item）；表格 > 列表；
   - **json**：`JSON.parse` 整体 → 数组（标量/对象元素）；失败 → 逐行 `JSON.parse`（JSON Lines，每行须为对象）；
   - **yaml**：复用项目 `parseYaml`（YAML 子集；内联 flow 嵌套不支持，items 文件建议 block 风格）→ 顶层数组=items、顶层并列 map=items（Q3 规则）；
4. **注入语义**（R18）：`${item}`（=`${itemVar}`）对象 item 走 Q2 默认链、标量 item 原样；`${item.字段}` 单层、仅标量值（对象/数组/缺失 → 占位保留，防 `[object Object]`）；优先级 **目录变量保留字（D2）→ item → params → 占位保留**；
5. **空提取 → 占位迭代**（Q1-b）：一切 0 提取来源（markdown 无表格无列表 / 空文件 / 空数组 / 空 map）→ 1 个占位迭代：id=`<组id>/empty`、name=`<任务名>（items 为空）`、`${itemVar}` 及字段注入空串、`_loopItem`/`_concurrentItem`='（items 为空）'（DAG 显示用）、依赖/组元数据正常；**引擎不写文件、不改依赖图**，空转行为由技能定义；
6. **items-from 基础扩展**：`${wf_dir}` 拼写支持——`expandDefinition` 增加可选目录上下文，**start/reset/expandInstanceDefinition 传入 `entry.dir`**（begin 不重排：`${wf_dir}` items 在 begin 一步式路径无合法场景）；提取器/注入机制为 Iter-26R 复用地基；
7. **reset 语义修正**：workflow_reset 归档备份后**清空 output/logs**（工具描述/`resetNote` 同步）；
8. **样例物化**（Q6）：`builtin-skills.js` 增 samples 三格式 items 样例（markdown 表格/列表、json 数组、yaml 并列 map）物化到预定义 `samples/items/`；mjs `BUILTIN_TEMPLATES` 增 `items-demo` 模板（prepare 写三格式 items 到 output → 各格式 loop/concurrent，复用 integrator 技能，技能指令含"items 为空写空白输出"示范）；
9. **system-prompt** 契约同步：items 格式/注入语义/空提取占位迭代语义/`${wf_dir}` items-from 边界（同一运行内上游 output→loop 属 Iter-26R）；client（v0.6.1）不动。

## 4. 技术选型

- **提取器落点**：新共享模块 `code/shared/items-extract.js`（纯函数、Node 可 require、零依赖），sync-modules 登记 section `items-extract`（mjs 一次性手工插入 section 标记）——沿用 Iter-25 "登记补全消除盲区"先例；
- **注入实现（Q4）**：`PARAM_PATTERN` → `/\$\{(\w+(?:\.\w+)?)\}/g`；`injectParams/injectArray/injectInputsMap` 增第 4 形参 `itemCtx={varName, data, empty}`（可选，缺省行为与现状逐字节一致）；替换器逻辑：点号键 → 仅迭代上下文且 base===itemVar 时取标量字段，否则占位保留；`${itemVar}` → itemCtx 存在时走默认链（Q2），否则落 params 原逻辑；`expandLoop/ConcurrentTasks` items 参数接受 `string|object`，不再把 item 塞 `iterParams`（改传 itemCtx，item 优先级高于 params 与现状等价）；
- **迭代 id/name/元数据**：对象 item 由默认链解析串派生（sanitize 规则不变），`_loopItem`/`_concurrentItem`=默认链串 → **Client DAG 零改动**；
- **`${wf_dir}` 传递**：`expandDefinition(fs, src, params, dirCtx)` 增 `dirCtx.wfDir`（并入 dirVars，D2 保留字优先）；`expandInstanceDefinition` 传 `entry.dir`；finalizeDataflow 阶段2 保持（幂等兜底）；
- **legacy `plugins/workflow-host/tools.js` 不动**（仅旧动态插件形态与单测用例 4 使用，生产行为=tools-preset.js 经 sync 至 mjs）。

## 5. 改动面

| 文件 | 改动 |
|------|------|
| `code/shared/workflow-schema.js` | `ITEMS_FORMAT_VALUES`；`PARAM_PATTERN` 扩展（Q4） |
| `code/shared/workflow-parser.js` | loop/concurrent `normalizeTask` 解析校验 `items-format`（`itemsFormat` 字段；非法值 error） |
| `code/shared/items-extract.js`（新） | `extractItems(text, {format, path, taskId})` + 扩展名推断 + 四格式提取器 + 空提取约定 |
| `code/plugins/workflow-host-preset/tools-preset.js` | inject* 加 itemCtx；`expandLoop/ConcurrentTasks` 对象 item + 默认链 + 占位迭代；`expandDefinition` 加 dirCtx；`expandInstanceDefinition` 传 entry.dir；workflow_reset 备份后清空 output/logs（描述/resetNote 同步）；begin 工具描述补 items-format |
| `code/scripts/sync-modules.js` | SOURCES 登记 `items-extract` |
| `code/agent-presets/workflow-orchestrator/workflow-host.mjs` | sync 同步（schema/parser/items-extract/tools-preset）+ 手工插入 items-extract section 标记；BUILTIN_TEMPLATES 增 items-demo（webserver-routes 段直接编辑） |
| `code/plugins/workflow-host/builtin-skills.js` | samples/items/ 三格式样例物化（BUILTIN_SAMPLES） |
| `code/agent-presets/workflow-orchestrator/system-prompt.md` | items 契约段落（格式/注入/空提取/26R 边界） |
| `code/scripts/test-host.js` | 用例 21（items 结构化提取）；`expandDefinition` 直调处补 dirCtx 用例 |
| `code/packages/workflow-host/package.json` | 0.14.0 → **0.15.0** |
| `plan/development/development-plan.md` | §2 队列插入 **Iter-26R 运行时 items 展开**（26→**26R**→27→…）+ §3 增 26R 详述小节 + §3 Iter-26 补设计定稿引用；依赖图更新 |

## 6. 验证标准

**单测**（286 基线全绿 + 用例 21，预计 +45 项左右）：

1. extractItems 矩阵：lines 兼容（`#` 注释/空行）；markdown 列表（有序/无序）、表格（列名=字段名、列数不齐）、表格+列表并存取表格；json 数组（标量/对象）、并列对象（Q3 两分支）、JSON Lines、坏 JSON 报错；yaml 数组、并列 map（对象值/标量值）；顶层标量报错；
2. 推断矩阵：`.md/.markdown/.json/.jsonl/.yaml/.yml/.txt/无扩展名` × 有/无显式声明（声明恒赢、`lines` 逃生门）；
3. 注入：`${item}` 默认链三级（id 命中/缺 id 落 name/全缺落 1-based 序号）；`${item.字段}` 标量命中/缺失保留/非标量保留；自定义 item-var（`${mod.slug}`）；保留字优先（D2）不回归；非迭代上下文点号占位保留（params 查找不受点号干扰）；
4. 空提取：markdown 无表格无列表 / 空文件 / 空数组 → 占位迭代（id=`/empty`、name 含"items 为空"、`${itemVar}`=空串、依赖链完整、concurrent 组元数据正常）；
5. 展开端到端：对象 item 展开 N 迭代（id/name/_loopItem=默认链串、outputs 含 `${item.slug}` 正确展开为逐 item 路径）；`${wf_dir}` items 经 `expandInstanceDefinition`（entry.dir）解析成功；items-demo 模板 parse 零错误；
6. reset：归档备份存在且 output/logs 已清空（新增断言）；既有 stop→reset→start 链路不回归（用例 20）；
7. 兼容回归：既有用例 4（legacy 行文本 expandLoopTasks）与用例 20 全绿 = 旧行文本定义零改动。

**端到端（部署后 GUI，用户执行）**：三格式 × loop+concurrent 共 6 实例跑通（经 items-demo 模板）；对象 item 路径注入（`output/${item.slug}.md`）正确展开；空 items 文件实例：占位迭代正常派发、技能写空白输出、工作流 COMPLETED；旧行文本工作流零改动可跑；reset 后 output/ 已清空。

**部署纪律**：全量 `sync-modules.js` → `packages/workflow-host/build.js`（v0.15.0，lib 求值级加载验证）→ persona/mjs 副本 cp 至 `~/.dsh/.agent-presets/workflow-orchestrator/`（diff 一致）→ **提醒用户重启 dsh.service（不自行 systemctl）**。

## 7. 文档治理与 Iter-26R 登记

- 本文件为 Iter-26 设计权威；收尾产 `iter26-report.md`；
- `development-plan.md` 更新（实施第一步）：§2 队列改为 `…→ Iter-26 → **Iter-26R 运行时 items 展开** → Iter-27 →…`，§3 增 Iter-26R 详述小节（范围：运行期上游 output 作 items 的延迟展开——loop/concurrent 组占位节点、组完成语义、下游 `depends-on: [组id]` 引用语义（现架构组 id 无对应任务节点，潜伏缺口一并修）、DAG 晚现节点渲染；依赖 Iter-26 提取器/注入地基）；`iteration-replan-draft.md` 不再更新。
