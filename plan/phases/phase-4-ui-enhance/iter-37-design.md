# Iter-37 设计 — 全局参数编辑（params）

- **阶段**：阶段 4（现有功能修复/补全）
- **日期**：2026-09-17
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.26.9` → 发行时阶段内第三格顺延
- **状态**：**待用户确认后编码**（§A6）
- **来源**：改进项（创建实例后全局 params 无法修改——验证清单遗留 + 分诊归 Iter-37）

---

## 1. 背景与目标

全局 params 存 `metadata.json`（`meta.params`），创建后无任何修改入口：编辑器 params 区只读、保存通道（instance-yaml patch）不触 meta。而 params 直接影响目录变量注入与编排派发上下文（`${param}` 替换、workflow_status 快照 `params` 字段）。

**做完后达成什么**：编辑器 params 区可增删改（KvEditor 已有组件），独立「保存参数」按钮经新通道落 `meta.params`；仅允许在未运行阶段修改；保存后 workflow_status 快照 params 即时反映。

**不做什么**：定义内 params **声明**（defaults）的编辑（属定义，源码态已可改）；RUNNING/COMPLETED/FAILED 阶段开放；模板默认值回写。

## 2. 交付件

| # | 交付件 | 路径 | 说明 |
|---|---|---|---|
| 1 | 参数保存通道 | `webserver-routes.js` | 新增 `POST /wf/instance-params`：`{workspaceRoot, instanceId, params}` → 阶段门控（CREATED/PENDING/STOPPED 放行；RUNNING/COMPLETED/FAILED 403）→ 校验（对象形态、键非空）→ `registry.patchMeta(root, instanceId, { params })` → 返回生效快照 |
| 2 | 编辑器 params 编辑区 | `src/client.js` | params KvEditor 改可编辑（复用创建弹窗同款组件与行为）；独立「保存参数」按钮（与定义保存按钮分离，通道不同）；成功提示「✓ 参数已保存（对下一次 begin/reset 生效）」 |
| 3 | 迭代报告 | `iterations/iter-37-report.md` | |

## 3. 技术方案

### 3.1 阶段门控

| 阶段 | params 编辑 |
|---|---|
| CREATED | ✅（创建后未启动即可调参——推荐开放） |
| PENDING | ✅ |
| STOPPED | ✅（reset/续跑用新值） |
| RUNNING / COMPLETED / FAILED | ✗ 403（对齐权限矩阵 readonlyAll 语义） |

### 3.2 保存交互

- params KvEditor 可编辑（增删改行），与定义保存按钮**相互独立**：params 有改动时「保存参数」按钮亮起；定义保存不携带 params（两通道互不覆盖）。
- 值解析沿用创建弹窗 entriesToParams 逻辑（JSON.parse 宽松：数字/布尔/其余字符串；重复键报错；空 key 跳过）。
- 保存成功 → 重新 GET（params 区回显落盘值）+ 提示「对下一次 begin/reset 生效」。

### 3.3 服务端校验

- `params` 须为对象（非数组/null）；键 trim 后非空；值允许字符串/数字/布尔（JSON.parse 宽松解析在客户端完成，服务端只做形态守卫）。
- 非法 → 400 + 错误信息。

## 4. 执行顺序与差分验证

| 步骤 | 改动 | 验证 | 通过标准 |
|---|---|---|---|
| 1 | POST /wf/instance-params 路由 | 单测：CREATED/PENDING/STOPPED 放行+落盘、RUNNING/FAILED 403、非法 params 400 | 断言全绿 |
| 2 | 编辑器 params 编辑区 + 保存按钮 | 构建 + verify-client-bundle + 手动 | 增删改行、保存、重进回显一致 |
| 3 | 真机验收（用户） | 改 params → workflow_status 快照 params 反映 → begin/reset 后目录变量注入用新值 | §5 |
| 4 | v0.26.x 发行重装 + 报告 | 内容断言 | — |

## 5. 验证标准（完成线）

- [ ] 单测全绿（+params 路由三断言：放行落盘/阶段 403/非法 400）
- [ ] 产物级：bundle + verify-client-bundle + 发行内容断言
- [ ] 真机：①STOPPED 实例改 params 保存 → workflow_status params 反映 ②begin/reset 后目录变量注入用新值 ③RUNNING 实例 params 区只读 ④非法输入 400

## 6. 决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 可编辑阶段 | a) CREATED/PENDING/STOPPED（含 CREATED） b) 仅 PENDING/STOPPED | **a**（创建后未启动即可调参，语义安全——未 begin 无执行态耦合） |
| 2 | 保存交互 | a) 独立「保存参数」按钮（通道分离） b) 并入定义保存（一次 POST 双写） | **a**（通道清晰，互不覆盖） |

## 7. 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| params 改动与定义内 params 声明不一致（如删除了声明中的键） | 语义校验对 params 实参只做宽松形态校验（多余键无害，begin 注入按声明取用）；编辑器在声明键缺失时标注「非声明参数」提示 | 用户自行清理 |
| patchMeta 与并发编辑冲突（定义保存同时发生） | 两通道都走 registry 串行加载；params 键独立不互覆 | — |

## 8. 工作量估计

**约 0.5 人天**：路由 0.2 + 编辑区 0.2 + 测试报告 0.1。
