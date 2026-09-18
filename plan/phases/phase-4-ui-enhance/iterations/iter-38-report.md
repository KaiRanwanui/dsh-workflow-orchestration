# Iter-38 报告 — params 影响分析与单轨化

- **状态**：✅ 完成关闭（2026-09-17，用户真机验收通过）
- **阶段**：阶段 4（现有功能修复/补全）
- **版本**：host `v0.26.16 ~ v0.26.20`（阶段内第三格顺延；单包；与 Iter-37 验收修复交错发行）
- **测试**：602 单测全绿（含 p38 patch.params 四断言、c38 dup 两断言）+ 产物级验证通过
- **提交**：见 git log（8d6f4ea / 629c574 / df87125 等）

## 1. 背景与概念基线

创建时实参存 `metadata.json`（meta.params），instance.yaml 的 params 节是「声明+default」且 **default 不参与 ${param} 注入（假默认）**——双轨无同步、源码态看不到实参、编辑器改实参与源码脱节。

**用户概念澄清（本轮关键输入）**：instance.yaml 是创建时从模板复制出的**实例私有副本**，编辑它零跨实例污染——「params 与定义分离」不是防污染必要，纯属架构现状，可以统一。

## 2. 用户拍板

> 全局 params 作为工作流定义的一部分，保留在预置模板或 instance.yaml 中。**不设置 default，仅设置当前值**。meta 中的 params 删除，不再使用。

## 3. 交付件（单轨化）

| # | 交付件 | 说明 |
|---|---|---|
| 1 | params 节扁平化 | parser：params = `{key: 当前值}`（兼容旧对象形态取 default）；serialize 往返保真 |
| 2 | 单一事实源 | instance.yaml params 节：${param} 注入（expandDefinition 自合并 yaml 节∪调用方覆盖）、workflow_status/workflow_begin 快照 params（engine.snapshot 直出）、编辑器 params 区、源码态——全部同源 |
| 3 | 保存通道统一 | params 随 `/wf/instance-yaml` 的 `patch.params` 提交（applyInstancePatch 顶层分支，非 RUNNING 可改）；`/wf/instance-params` 路由**删除** |
| 4 | 创建实参落 yaml | `/wf/create` 路由与 workflow_create 工具：args.params 经 mergeParamsIntoYamlText 落 instance.yaml params 节；createBind/beginInstance 不再写 meta.params |
| 5 | 重复键拦截 | parseYaml 对同名键静默折叠（取后者）→ 新增 detectParamsDuplicateKeys 文本层检测 → 错误级「params 参数重复定义: X」，源码保存被拒 |
| 6 | 头注释保留 | mergeParamsIntoYamlText 保留文件头注释块（实例溯源不被 parseYaml 往返丢弃） |
| 7 | 编辑器 | params 区可编辑（KvEditor），保存随页脚「保存」单通道；亮灯/可点条件含 paramsDirty |

## 4. 验证与验收修复（差分）

| 轮次 | 反馈 | 根因 | 修复（版本） |
|---|---|---|---|
| 1 | FAILED 实例 params 改不动；独立保存按钮灰 | 客户端门控未随服务端放宽；双保存按钮语义混乱 | 门控对齐仅拒 RUNNING + 统一保存（v0.26.14~15） |
| 2 | maxConcurrency 改无效；保存报 not found: /wf/instance-params | doAction 单通道替换**静默未命中**（old_string 不匹配），旧通道仍在且 params-only 跳过通道 1 | doAction 真正单通道化（v0.26.19） |
| 3 | 按钮不亮（可点）；重复参数名校验不查；thenSave is not defined | opacity 条件漏 paramsDirty；parseYaml 静默折叠；buildPatch 残留 thenSave 引用 | 三缺陷修复（v0.26.20） |
| 4 | 创建 params 仍写 metadata.json | GUI 创建走 /wf/create 路由（与工具是两条路径） | 双路径同改 + meta.params 写点全退役（v0.26.18） |

## 5. 验证结果

| 验证项 | 结果 | 证据 |
|---|---|---|
| 单测 | ✅ 602 全绿 | p38 patch.params 四断言 + c38 dup 两断言 + create 单轨断言（params 落 yaml/metadata 退役） |
| 产物级 | ✅ | bundle 求值 + 部署产物 grep 核验（merge/亮灯条件/旧文案=0） |
| 真机（用户 GUI） | ✅ 验收通过 | 创建带 params → yaml 落盘/metadata 无 params；表单编辑保存亮灯生效；源码态所见即所得；重复键被拦 |

## 6. 教训（沉淀 runtime memory 与 mnemon）

1. **替换式批量编辑必须断言命中**：python str.replace 静默 no-op 曾引发 doAction 未更新（v0.26.18 事故）——关键改动后 grep 断言新标记存在。
2. **同版本 file: tgz 不被 pnpm 刷新**：发版必须强删包目录 + `pnpm install --force`，并 grep 部署产物核验关键标记。
3. **GUI 与工具是两条独立路径**：/wf/create 路由与 workflow_create 工具、webserver reset 的 expandInstanceDef 与 tools-preset 的 expandInstanceDefinition——改参数流要双路径同查。
4. **插入式编辑先核作用域与变量声明序**（parsed 未赋值引用 / errors TDZ / thenSave 作用域外引用，三例同一模式）。

## 7. 遗留与后续

| 遗留 | 去向 |
|---|---|
| 旧实例 metadata.params 存量数据（已不读） | 无需迁移（测试数据）；生产化前可加清理脚本（候选） |
| 页签动态门控 | **Iter-39（下一迭代，方案先行）** |

## 8. 参考

- 影响分析：`iter-38-analysis.md`（双轨盘点 + 方案 + 用户拍板记录）
- 关联：Iter-37 报告 §11 补记
