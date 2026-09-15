# code/plugins/workflow-client/ —— Client 端插件工程

工作流引擎 Client 端 Cordis 插件代码。

## 职责

- 工作流编排 UI（DAG 图形化编辑，节点拖拽、连线、参数配置）
- 工作流执行监控面板（实时状态、颜色驱动、日志列表）
- LLM 会话交互界面（Task 子 Agent 对话查看、人工干预入口）
- 状态轮询与实时更新（RPC 轮询/WebSocket）
- 与 Host 端的 JSON RPC 通信

## 开发指引

- 使用纯 JavaScript + React.createElement（无 JSX，无 TypeScript）
- UI 组件按功能模块拆分：`editor/`、`monitor/`、`session-viewer/`
- 模块级数据层（单例轮询 + 发布订阅）避免 remount 闪烁
- 先在 DSH 会话中验证 Slot 注入，再固化至此