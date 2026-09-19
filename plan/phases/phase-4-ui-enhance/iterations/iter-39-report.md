# Iter-39 报告 — 页签动态门控

- **状态**：🚧 编码与单测完成，v0.26.21 已发行部署，**待用户真机验收**
- **阶段**：阶段 4（现有功能修复/补全）
- **版本**：host `v0.26.21`（阶段内第三格顺延；单包；纯 Client 改动）
- **测试**：602 单测全绿（无回归）+ bundle 求值验证
- **提交**：见 git log

## 1. 目标与增量边界

门控判定层 Iter-20/21 已交付（preset/origin 判定、占位文案、轮询短路）。本迭代增量：**非编排会话与子会话完全不出现 Workflow 页签**（原实现 slot entry 常驻 → 占位空 tab 始终存在）。

## 2. 契约探针结论（方案依据）

| 契约 | 来源 |
|---|---|
| 页签 = `viewTabs()` 遍历 `slots.entries('conversation.view')`，entry 存在即有页签 | dsh-client-ui-conversation lib/client.js |
| `register()` 返回 disposer，注销即 markDirty 刷页签 | dsh-client-ui-slots lib/index.js |
| conversation.view 声明 `{kind:'list', scope:'session'}` → 每会话 scope 独立 entries | conversation.session children 声明 |
| 同 id 重复注册抛错 → 重注册前必须先 disposer | register 同 id 守卫 |

## 3. 实施（用户拍板：仅编排主会话有 Workflow 页签；非编排会话、子会话都隐藏；preset 异步加载接受首帧一次性补现）

| # | 改动 |
|---|---|
| 1 | `slots.inject` factory 按 scopeArg（sessionId，string/对象形态自适应）查判定缓存 `sessionGateMap`：已判定非编排 → 返回 no-op disposer，不注册 → 页签不存在 |
| 2 | 注册内容改为门控哨兵 WorkflowGate：渲染层读 sessions store（projectionValues.agentPreset 官方路径+兜底）判定 → 编排会话渲染 WfComponent（面板不回归）；非编排 → effect 调 disposer 注销自身 entry（页签消失）+ 回填缓存 |
| 3 | WfComponent 定义前置到 apply 作用域（原 factory 内惰性定义改为启动期定义）；内部占位分支保留为死防御 |

## 4. 验证结果

| 验证项 | 结果 |
|---|---|
| 单测 | ✅ 602 全绿（无回归） |
| 产物级 | ✅ bundle 求值 + verify-client-bundle + 部署产物 grep（sessionGateMap=3） |
| 真机 | ⏳ 待验收（§5） |

## 5. 真机验收清单（用户 GUI：重启后台 + 强刷浏览器）

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | workflow-orchestrator 主会话 | Workflow 页签正常显示，面板功能不回归 |
| 2 | 普通 preset 会话 | 无 Workflow 页签 |
| 3 | 子会话（subagent） | 无 Workflow 页签 |
| 4 | 会话间切换 | 页签随会话出现/消失，无残留、控制台无同 id 重注册报错 |

## 6. 教训

- 区域重建式编辑（大段替换）后必须 `node --check` + 括号配平核查（本轮出现多一层 `})` 与变量名撞车两处）。
- 版本号 sed 后立即 grep 核验（再次出现静默空转，靠部署产物不存在的报错暴露）。

## 7. 参考

- 设计：`iter-39-design.md`（契约探针结论 + 主/降级路径 + 用户拍板三项）
