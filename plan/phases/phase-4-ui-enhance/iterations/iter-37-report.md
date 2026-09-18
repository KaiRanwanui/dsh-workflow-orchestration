# Iter-37 报告 — 全局参数编辑（params）

- **状态**：🚧 编码与单测完成，v0.26.13 已发行部署，**待用户真机验收**
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
| 真机（用户 GUI） | ⏳ 待验收 | §7 三组 |

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
| U1 门禁角点 | Iter-39 |

## 9. 参考

- 设计：`iter-37-design.md`
- 版本 Incident：本迭代首次发行时误编 0.26.10（该号已被技能查看修复占用）——根因=sed 基线过期静默空转 + 预设版本号违反规则；已纠正为 0.26.13 并记入教训（版本号以发行时顺延为准，禁止预设）
