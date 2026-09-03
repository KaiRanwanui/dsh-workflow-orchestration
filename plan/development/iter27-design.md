# Iter-27 设计稿 — 语义校验（R8/R12）【拆分版 v3：27a 结构 / 27b 校验】

- **状态**：▶ **27a 已实现关闭**（2026-09-03，host v0.17.0，419 单测，GUI 验收通过=四内建模板开箱即用，报告 iter27a-report.md）；**27b 待启动**（设计已确认）
- **前置阅读**：development-plan.md §Iter-27 / iter25-report.md（D4）/ 需求 R8/R11/R12
- **基线**：git 7288b73，host v0.16.0 / client v0.6.1，387 单测全绿

---

## 0. 拆分总览（S1=B 拍板）

| | Iter-27a 预定义目录结构与实例化 | Iter-27b 语义校验 |
|---|---|---|
| 版本 | host **0.17.0**（client 不动） | host **0.18.0**（client 不动） |
| 主题 | templates 子目录自包含（实例级镜像结构）+ create 1:1 复制 + 扫描下钻 + 内建模板迁移 | 校验引擎 + 错误码 + workflow_validate + create/start 关口 |
| 依赖 | 无（纯结构，向后兼容） | 依赖 27a 的 defDir 锚点、路径分类与实例 1:1 副本 |
| 验收 | items-demo 迁移后开箱即跑；实例自包含（删原文件仍可 start） | default-demo 四连破坏逐项报错；完好定义零误报 |

两步各走全套纪律：sync → 改版本 → build → test（387 基线+新增全绿）→ cp persona/mjs → 提醒重启 → GUI 验收 → push master:main。development-plan.md 在 27a 关闭时插节（27a/27b 替代原 Iter-27 节）。

## 1. 背景与目标

Iter-25（D4）把"缺 processor / gate 缺 checker"降为 create warnings 临时放行；用户表态：缺 processor 是**需要修改的问题，不能告警放过**。终局目标（27b）= R8 语义校验：结构化错误清单（非警告）+ create/start 关口。

前置地基（27a）= 用户四点调整（2026-09-03，见 §3 第 4 轮）：预置工作流子目录自包含且镜像实例级结构、create 1:1 复制（定义+静态文件，相对路径不调整）、绝对路径只能是用户指定行为的产物。这是 27b 双语境校验的锚点前提。

前台展示归 Iter-28，两步均只打通数据通道与落盘。

## 2. 现状与缺口（代码事实）

| 现状 | 缺口 | 归属 |
|---|---|---|
| parser（workflow-parser.js:255/264/283）"缺 processor / gate 无 checker"= warning | 须升**错误级**结构化清单 | 27b |
| create 关口（tools-preset.js:913）：parse errors 拦截；warnings 放行 | 语义校验不存在 | 27b |
| dependsOn 仅查"引用不存在"（parser:207），**无环检测** | 造环→引擎死锁（R8 要求无环） | 27b |
| 26R 延迟谓词 shouldDeferExpansion（tools-preset.js:245） | 须与校验共用单一事实源 | 27b |
| 内建模板平铺物化 `templates/<name>.yaml`；/wf/templates 只扫平铺（mjs:4159）；items-demo 引 `samples/items/*`（两级链跨目录取文件） | 模板非自包含、发布互有影响；samples 混工作文件 | **27a** |
| items 无实例物化（inputs 有：begin/start/reset 两级链物化+改写实例绝对路径，materializeInputsIntoInstance:381） | 预置实例不自包含 | **27a** |
| `isAbsoluteishPath`（tools-preset.js:23）正则 `^([a-zA-Z]:[\\/]|\/|~\/|~$)` | 判定在 tools-preset 内，27b 校验需共享 | **27a** 前移 |

## 3. 已拍板记录（四轮）

| 轮次 | 点 | 决议 |
|---|---|---|
| 1 | ① create 关口语义 | **B create 硬拦截**：语义 errors 非空拒绝创建（begin 同拒）；start/resume 闸门保留（防创建后退化+legacy）；reset 回传不拦；"定义不完整"标示缩圈为创建后退化+legacy；R11 流程变化=Iter-28 前补全=修定义/补技能后重新 create |
| 1 | ② items-from 存在性 | **双语境规则**：items-from ∈ {现存文件, 上游 output}；实例语境查实例目录及子目录；定义语境查预定义目录的工作流子目录 |
| 2 | Q1 | **create 物化静态文件进实例**（实例自包含闭环） |
| 2 | Q2 | **结构调整**：templates 每工作流一子目录；samples/ 转纯参考性质 |
| 2 | Q3 | 绝对路径豁免 → **被第 4 轮收窄**（见下） |
| 3 | S1 | **拆分**：27a 结构 → 27b 校验，两版两验收 |
| 4 | 静态文件模型（四点，本稿依据） | ①预定义工作流校验：静态文件**必须**在工作流子目录下，**禁用绝对路径**（保证预置发布完整）；②create 把定义文件+引用静态文件 copy 进实例目录（实例完整）；③预置子目录=**实例级同构**（output 可无、inputs 可有），实例化直接复制、相对路径不调整；④绝对路径仅两个入口=**create 时用户指定（params）+ 人工调整定义**（手工改 instance.yaml/Iter-28 编辑），运行期保持原样除非用户再改（未来可能限制可填范围，backlog） |

## 4. Iter-27a 设计细案（预定义目录结构与实例化，host 0.17.0）

### 4.1 目标布局（模板子目录=实例级同构镜像）

```
~/.dsh/workflow-agent/
  docs/                      # 不变
  samples/                   # 转纯参考性质：仅供阅读，不再被任何预置定义引用（README 声明；四件 items 样例保留原地作参考）
  skills/                    # 不变（两级链共享，R4 技能不复制不物化）
  templates/
    default-demo/            # 每预定义工作流一子目录（自包含发布单元）
      default-demo.yaml      # 定义（↔ 实例 instance.yaml）
      inputs/...             # 静态文件（可有可无；↔ 实例 inputs/，同名同位）
      output/                # 可有可无（运行期产出目录，预置通常不放）
    items-demo/
      items-demo.yaml
      inputs/items/...       # 原 samples/items/* 四件迁入（refs 改 inputs/items/...）
    runtime-items-demo/      # 延迟组（items 来自上游 output）→ 仅定义 YAML
    serial-demo/
```

### 4.2 交付

1. **物化改造**（builtin-skills.js materializeBuiltinAssets）：内建模板写子目录布局（A2 同名覆盖作用于子目录内）；四个内建模板迁移（default-demo/runtime-items-demo/serial-demo 仅移 YAML；items-demo 迁 YAML+四件 items 文件并改 refs 为 `inputs/items/...`）；
2. **create 1:1 复制（四点②③）**：preset 来源（templates/ 子目录）创建实例时——定义 → instance.yaml（现状），子目录其余文件树**原样复制**进实例目录（保相对结构，refs 零调整；readText/writeText **文本 only**，未引用文件一并复制=R19 自由文件）；非 preset 来源（workspace YAML/inline text）保持现状（inputs 走既有 begin/start/reset 物化，items 不复制）；
3. **解析链扩展（静态文件 inputs/items）**：实例语境=**实例目录及子目录优先**（1:1 副本命中）→ 两级链兜底（非 preset/旧实例）；定义语境（preset）=**模板子目录锚点**；技能 processor/gateChecker 恒两级链不变（resolveRefPath 增实例目录/defDir 优先形参）；
4. **绝对路径语义（四点④）**：字面绝对（`/`、`~`、盘符，isAbsoluteishPath）与 `${param}` 展开后绝对 → 直通保持原样（现状语义不变）；params 注入展开为绝对=用户指定合法入口（create 时）；
5. **扫描下钻**（mjs /wf/templates）：templates/ 顶层 file *.yaml（平铺 legacy 继续列出）+ dir（下钻取定义 YAML，`<子目录名>.yaml` 优先）；同名去重**子目录赢**；旧平铺残留（fs 无删除 API）→ docs 迁移说明，必要时 pendingCleanup 清理清单（沿 Iter-26 契约）；
6. **共享模块** `code/shared/workflow-paths.js`（新增，section 排 items-extract 后）：`isAbsoluteishPath` 前移（tools-preset 改调共享版）+ defDir/实例目录锚点解析函数 + 路径分类（字面绝对/变量/相对）——27b 校验复用；
7. persona/mjs 描述同步（布局、1:1 复制、绝对路径入口）。

### 4.3 27a 验收

1. 单测：387 基线全绿（items-demo refs 用例同步迁移）+ 新增约 12 项（子目录物化/扫描下钻/平铺去重/create 1:1 复制含未引用文件/实例目录优先解析/defDir 锚点/路径分类三形态/params 注入绝对直通）；
2. GUI：模板下拉四内建模板正常；items-demo 建实例开箱即跑；**自包含**——建实例后移除 samples/ 原件仍可 start（命中实例副本）；
3. 部署纪律全套 + push。

## 5. Iter-27b 设计细案（语义校验，host 0.18.0）

### 5.1 校验引擎

新增 `code/shared/workflow-validate.js`（纯函数，fs 探针注入；section 排 workflow-paths 后）。

**输入**：`{ parsed, params, workspaceRoot, predefinedRoot, defDir?, preset?, wfDir?, context, fs }`。**输出**：`{ ok, errors: [{code, task, field, message}], warnings: [] }`，纯异步零副作用。

**静态文件校验规则（按来源双轨）**：

| 来源 / 语境 | 相对路径 | 字面绝对 | 变量路径（`${...}`） |
|---|---|---|---|
| **preset 定义语境**（templates/ 子目录） | **必须在该子目录内存在**（四点①；不走两级链） | **E-ABS-IN-DEF**（禁用，保证预置完整） | 跳过（params 未知；create 时展开后按实例语境判） |
| 非 preset 定义语境（workspace YAML/inline） | 两级链（workspace→预定义，现状） | 允许（用户指定产物），仅查存在 | params 已知则展开重判，否则跳过 |
| **实例语境**（create 后） | 实例目录及子目录优先（1:1 副本）→ 两级链兜底 | 直通仅查存在（Q3-A 保留于实例层） | 展开：绝对→直通查存在；相对→实例目录优先链；含 `${item` → 跳过（迭代期才定） |

**错误码（稳定枚举）**：

| code | 级别 | 触发 |
|---|---|---|
| E-DEP-CYCLE | error | dependsOn 环/自依赖（DFS 三色） |
| E-PROCESSOR-MISSING | error | 任务未指定 processor（自 parser warning 升级） |
| E-SKILL-MISSING | error | processor 两级链解析 miss |
| E-GATE-CHECKER-MISSING | error | quality-gate 对象存在但无 checker（自 parser warning 升级） |
| E-INPUT-MISSING | error | input 非上游产出且按上表语境规则未命中 |
| E-ITEMS-MISSING | error | 静态 items 文件未命中（同上；显式 deferred:false 同报） |
| E-ABS-IN-DEF | error | **preset 定义引用字面绝对路径静态文件**（四点①） |
| E-ITEMS-PARSE | error | items 文件存在但提取失败（坏 JSON/顶层标量；**空提取不算错**，26R Q1-b 占位迭代合法） |
| W-REF-MISMATCH | warning | input 与上游 output basename 相同但完整路径不同（疑似拼写不一致） |
| W-ITEMS-INPUT-DUP | warning | items-from 与 inputs 声明同一文件（27a 补丁拍板 2026-09-03：items-from=专用条目获取输入仅用于循环/并发控制，条目值经 _loopItem 随派发传入子会话；inputs=业务内容来源，两者互斥） |

**延迟组判定（26R 不误报）**：`shouldDeferExpansion` 抽成共享 `deferDisposition()`（入 workflow-paths.js），expandDefinition 与校验共用单一事实源；判定=延迟 → 跳过 items 存在性。inputs 衔接同款：命中任一任务 outputs（相对精确+basename 兜底）→ 成立不查文件。

**小决策（默认方案，可否决）**：parser 两处 warning 下线归 validate 统一出口；begin errors 整体拒；reset 回传不拦；resume 沿用 start 闸门；inputs 不套 preset 特例（1:1 副本后实际同锚点）。

### 5.2 关口语义（拍板①=B）

| 关口 | 行为 |
|---|---|
| workflow_create | parse errors（现状）+ E-DEP-CYCLE + 全部语义 errors → **拒绝创建**；通过 → 1:1 复制（preset）+ 落盘 validation 快照 |
| workflow_begin | 同 create 整体拒（不建实例） |
| workflow_start / resume | 展开前实时校验（不信任落盘），errors → 拒绝+清单+引导 |
| workflow_reset | 校验回传不拦 |
| workflow_validate | **新工具**只读：`{instanceId}` 或 `{workflowPath|workflowText, params?}` |

配套：metadata.json 增 `validation: {ok, errors, validatedAt}`（创建后退化标示+Iter-28 数据源）；status/begin 附 validation 摘要；/wf/create 200 补 `errors`；persona 契约（create 被拦→转告清单+引导修定义；start 被拦→引导补全）。

### 5.3 27b 验收

1. 单测：基线全绿 + 新增约 32 项：
   - 引擎：缺 processor/gate checker→error；技能两级链四情形；input=上游精确/basename 兜底/存在/双 miss error/`${item}` 跳过；环（双节点/自环/正常链不报）；items 六情形+**preset 子目录锚点**+**preset 绝对路径 E-ABS-IN-DEF**+非 preset 两级链兼容；空 items 不报错；
   - 关口：create errors 硬拦；造环拦；start errors 拒；start 延迟组放行（26R 零回归）；reset 回传；begin 整体拒；
   - 工具与落盘：workflow_validate 两形态；metadata hydrate 兼容（旧实例无字段=ok）；
2. 破坏性验收：default-demo 四连破坏（删技能/删上游输出/造环/缺 processor）逐项可读错误；完好定义零误报；
3. GUI：缺 processor 定义 create→被拦+清单转告；修复后 create 成功；创建后删技能再 start→被拦（退化）；runtime-items-demo 延迟组零误报；
4. 部署纪律全套 + push。

## 6. 文件改动清单

| 文件 | 27a | 27b |
|---|---|---|
| `code/shared/workflow-paths.js` | **新增**：isAbsoluteishPath 前移+路径分类+锚点解析 | + deferDisposition() |
| `code/shared/workflow-validate.js` | — | **新增**：校验引擎 |
| `code/shared/workflow-parser.js` | — | 下线两处 warning |
| `code/plugins/workflow-host/builtin-skills.js` | 子目录物化+四模板迁移+samples 重定位 | — |
| `code/plugins/workflow-host-preset/tools-preset.js` | isAbsoluteishPath 改调共享；create 1:1 复制；解析链实例目录/defDir 优先 | create/start/resume 闸门；reset 回传；begin 拒；注册 workflow_validate；status/begin 附摘要 |
| `code/agent-presets/workflow-orchestrator/workflow-host.mjs` | sync；/wf/templates 扫描下钻 | sync；/wf/create 补 errors |
| `code/agent-presets/workflow-orchestrator/system-prompt.md` + `agent.cordis.yml` | 布局/1:1 复制/绝对路径入口契约 | 校验关口契约 |
| `code/scripts/sync-modules.js` | 登记 workflow-paths（8→**9** section） | 登记 workflow-validate（9→**10** section） |
| `code/packages/workflow-host/package.json` | 0.16.0 → **0.17.0** | 0.17.0 → **0.18.0** |
| `code/scripts/test-host.js` | +约 12 项 | +约 32 项 |

## 7. 边界与已知局限

- 27a 阶段无校验引擎：用户手工预置的子目录完整性（refs 出子目录/绝对路径）27a 不拦，由 27b E-ABS-IN-DEF / 锚点校验接管；内建四模板迁移后自身即自包含；
- outputs 含 `${item.*}` 跨任务匹配仅精确串相等（26R 局限，逃生门=deferred:true）；
- 校验与展开竞态由 expandDefinition 原有报错兜底；start 闸门永远实时校验不信任落盘；
- 1:1 复制仅文本文件（fs readText/writeText，无 copy/delete）；旧平铺模板残留靠去重+docs（必要时 pendingCleanup）；
- 非 preset 实例（workspace/inline 来源）items 无 create 复制 → 不完全自包含（现状延续，与前版一致）；
- 绝对路径可填范围限制（四点④未来项）入 backlog。
