# code/plugins/workflow-host/ —— Host 端插件工程

工作流引擎 Host 端 Cordis 插件代码。

## 职责

- 工作流定义解析（YAML schema 解析与校验）
- 工作流实例管理（生命周期、状态持久化）
- Tool 注册：`workflow_begin`、`workflow_status`、`workflow_execute` 等
- RPC handler：状态查询、执行控制、日志获取
- 状态持久化到文件/会话存储
- 与外部 Agent 集成适配

## 开发指引

- 代码文件按功能模块拆分：`parser.js`、`engine.js`、`storage.js`、`tools.js`、`rpc.js`
- 使用 `cordis_define` → `cordis_run` 链路在 DSH 会话中增量验证
- 验证通过后固化至此目录