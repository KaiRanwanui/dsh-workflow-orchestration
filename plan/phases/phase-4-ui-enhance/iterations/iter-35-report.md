# Iter-35 报告 — 定义全文编辑（YAML 源码模式）

- **状态**：🚧 编码与单测完成，v0.26.6 已发行部署，**待用户真机验收**（四组）
- **阶段**：阶段 4（现有功能修复/补全）
- **版本**：host `v0.26.5 → v0.26.6`（阶段内第三格顺延；单包）
- **测试**：589 单测全绿（+GET `text` 字段断言）+ bundle 产物级验证通过
- **提交**：见 git log

## 1. 目标与范围

改进项 #1（实例定义全文编辑）：编辑器增加 **YAML 源码模式**（与表单态互切），保存走既有语义校验关口。按用户拍板并扩展两项：**创建弹窗去除 yaml 编辑**（统一「创建→再编辑」）、**技能全文只读浏览**（skills 不物化进实例，仅浏览）。

**不做什么**：YAML 语法着色；params 编辑（Iter-37）；表单字段补全（Iter-36）；技能编辑（预定义资产治理，后续范畴）。

## 2. 设计决议（用户拍板项）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 源码态默认 | 默认表单态，点「源码」切换 |
| 2 | textarea 尺寸 | 占满编辑区（内滚动） |
| 3 | 创建弹窗 yaml 编辑 | **移除**——模板选择仅提交 workflowPath（模板引用语义）；统一「创建后再编辑」；'custom' 路径直填保留 |
| 4 | 技能全文 | 只读浏览（processor/gateChecker 下拉旁「查看」→ 只读弹层）；不物化不编辑 |

**连带语义**：验证清单「文本创建」项随能力移除闭合；**validation-probe 语义校验探针改由源码态保存承接**（粘贴坏定义保存 → 同样触发结构化硬拦），校验覆盖面不变。

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `code/plugins/workflow-host/webserver-routes.js` | ① GET /wf/instance-yaml 响应补 `text`（strip 后原文）② 新增 **POST /wf/instance-yaml-raw**：定义全文替换保存——同一语义校验关口（parse + instance 语境校验，errors 非空不落盘）、注释头原样保留（同 patch 管道规则）、权限矩阵服务端兜底（definition/readonlyAll → 403）、patchMeta 校验快照同步 |
| `code/packages/workflow-host/src/client.js` | ① EditorPanel 两态切换（未保存弹确认）+ 源码 textarea（占满编辑区、等宽、内滚动、只读态禁改）+ 保存按钮（doSaveSrc → /wf/instance-yaml-raw）② mkSkillSelect 增「查看」入口 → GET /wf/skill 只读弹层（processor/gateChecker 两处）③ 创建弹窗 tpl 分支 workflowPath-only + textarea 移除（改只读提示） |
| `code/scripts/test-host.js` | +GET `text` 字段断言 |

## 4. 实施与验证过程（差分）

| 步骤 | 改动 | 验证 | 结果 |
|---|---|---|---|
| 1 | GET 补 `text` | 单测（strip 后原文含实例名、不以注释头开头） | ✅ |
| 2 | 编辑器两态 + textarea | 构建 + verify-client-bundle | ✅ 求值级三断言通过 |
| 3 | 技能查看弹层 | 构建 | ✅ |
| 4 | 创建弹窗 workflowPath-only | 全量单测（create 路径既有断言无回归） | ✅ 589 全绿 |
| 5 | v0.26.6 发行重装 | 内容断言 + 部署核验 | ✅ |

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 589 全绿 | +text 字段断言 |
| 产物级 | ✅ | bundle 求值三断言 + 发行内容断言 |
| 真机（用户 GUI） | ⏳ 待验收 | §7 四组 |

## 7. 真机验收清单（用户 GUI）

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | 展开 RUNNING 实例编辑器 → 切「源码」 | 全文只读可看（textarea 禁改、保存禁用）——「全文查看」场景 |
| 2 | CREATED/STOPPED 实例源码态编辑保存 | 保存成功 → 表单态/重新打开内容一致；onSaved 联动刷新 |
| 3 | 源码态粘贴坏定义保存 | 结构化错误清单（语义校验闸拦截、不落盘）；修正后可保存 |
| 4 | 模板创建实例 | 弹窗无 yaml textarea；创建成功且 instance.yaml=模板副本、静态文件复制正常 |
| 5 | processor / gateChecker「查看」 | 技能全文只读弹层（含 gateChecker=（无门禁）时按钮禁用） |
| 6 | 权限矩阵 | RUNNING/readonlyAll 下源码态只读、保存禁用 |

## 8. 遗留与后续

| 遗留 | 去向 |
|---|---|
| YAML 语法着色/格式化 | 远期（需求出现再做） |
| validation-probe 样例的验证入口说明更新（文本创建→源码态保存） | Iter-36 顺带（checklist/文档同步） |
| max-retries 配非 retry 模式 W 级警告 | Iter-36/37 候选 |
| Iter-40（详情/文件预览）方案评估 | 本迭代落地后评估（源码 textarea 组件可复用） |

## 9. 参考

- 设计：`iter-35-design.md`
- 来源：改进项 #1 + 用户三项要求（创建去除 yaml 编辑 / 技能全文浏览 / 两态细节确认）

## 10. 补记：验收缺陷两处（v0.26.7，2026-09-17）

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 源码态保存失败时校验结果不呈现（有错误但界面无反馈） | `valResEl` 只在表单态分支渲染，源码态分支缺失 | 源码视图同样渲染 `valResEl`（保存成功/失败反馈在两态一致呈现） |
| 2 | processor/gateChecker「查看」报错读不到技能文件 | 下拉值是**相对路径**（skills/<名>/SKILL.md），/wf/skill 的 fs.resolve 相对解析不到 | openSkillView 相对路径拼 workspaceRoot 成绝对路径（已是绝对路径则原样） |

## 12. 补记：多错误合并呈现（v0.26.8，2026-09-17）

用户验证反馈：源码态保存仅报一条错误（依赖引用未定义任务），后续错误未显示。诊断：**非解析器限制**——raw 路由原实现「解析层有错即跳过语义校验」，而语义层在同一份定义上还能并报更多错误（实测用户定义可并报 E-DEP-CYCLE + E-SKILL-MISSING + E-PROCESSOR-MISSING + W-ITEMS-INPUT-DUP）。修正：解析错误（E-PARSE）与语义错误**全量合并呈现**（语义校验异常时保留解析错误兜底）。注意：YAML 语法断点错误仍受解析器固有限制（一次一条），属解析层既有行为。
