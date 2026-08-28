# Iter-13 报告 — 面板"新建 workflow 实例"按钮 + 模板库 v1

**日期**：2026-08-28
**版本**：@workflow-agent/workflow-host **v0.6.0**、@workflow-agent/client-ui-monitor **v0.3.0**
**前置**：Iter-11/12（已部署验证）、设计语义 v2（instance-creation-semantics.md）
**状态**：✅ **完成**（2b6a874，104/104 单测通过，面板功能验证通过）

---

## 交付内容

### 1. Host：`POST /wf/create`（只 create 不 start）

- `/wf` prefix handler 增加 POST 支持：method 判断 + chunk 收集（1MB 上限防滥用）
- 流程：JSON 解析 → workspaceRoot 必填 → 定义来源（`workflowText` 优先，`workflowPath` 经 fs 读取）→ `parseWorkflow` 校验（错误 400 + `workflowBeginErrors`）→ `registry.beginInstance`（**sessionId=null**：面板创建无会话上下文，实例所有权=cwd）→ 200 `{instanceId, dir, workflowName, phase:"CREATED"}`
- loopback 围栏沿用前置检查

### 2. Host：`GET /wf/templates` + 内置模板

- `BUILTIN_TEMPLATES` 常量内联（webserver-routes 内联-only section 既定例外）：`serial-gate`（串行+门禁骨架）、`concurrent-summary`（并发+汇总骨架），占位 `/TODO/...` 路径 + `${output_dir}` 参数由用户 start 前提供
- 响应 `{builtin[], workspace[]}`：workspace 为 `<workspaceRoot>/templates/*.yaml` 扫描（无目录仅内置）；用户可自行放入模板文件或 git 下载（下载能力后置）

### 3. Client：工具条 + 创建表单

- 常显工具条（右上"+"按钮）；**Waiting for workflow... 空状态也带工具条**——空工作区第一实例可直接从面板创建
- 表单 overlay：模板下拉（自定义路径 / [内置] / [工作区]）→ 选内置模板时 YAML 可编辑预览（实例化前定制初始内容，模板文件本身不变，符合"模板只读"语义）；params JSON；错误内联展示
- 提交 POST /wf/create → 成功关闭表单 + 经 `wfListLoader` 即时刷新实例列表（不等 10s 轮询）
- hooks 纪律：全部 useState/useEffect 置于条件返回之前

---

## 关键决策

| 决策 | 理由 |
|------|------|
| 面板创建 sessionId=null | 所有权=cwd（语义文档 §7）；无会话上下文时不伪造绑定，后续 start 的会话自然接管（forSession 最新兜底） |
| 内置模板内联 mjs 而非 yaml 文件 | webserver-routes 无独立源文件（既定例外）；内容数据内联零路径问题，将来模板多了再外置 |
| 内置模板 yaml 在表单中可编辑 | "模板只读"指模板文件不变；实例化前的初始内容定制是 create 输入的一部分 |
| 空状态也显示"+" | 首实例引导（用户流程第 2 步：先建 workflow 再看 DAG） |

## 验证

### 单测（用例 10 新增 11 断言，总 104/104 ✅）

dynamic import mjs 直测路由（mock webServer/fs/registry，模拟 POST chunk 流）：templates 内置 2 + 工作区扫描、create 成功（CREATED + id 形态 + 五件套 + params 入 metadata）、非法定义 400、缺参 400×2、workflowPath 读取、404 回退。

### 部署验证清单（重启后）

1. `systemctl --user restart dsh.service` + 浏览器刷新
2. `curl 'http://127.0.0.1:3080/wf/templates?workspaceRoot=/home/zhaokai/Projects/dsh_projects/workflow_test_ws'` → builtin 2 个
3. 面板 Workflow Tab → "+" → 选 [内置] serial-gate → 创建 → 切换条出现 chip（或在空工作区首次创建）
4. orchestrator session 里 `workflow_start` 该实例 → DAG 驱动

## 下一步

**Iter-14 消息注入技术穿刺**（go/no-go 决定 Iter-15 面板控制形态）。
