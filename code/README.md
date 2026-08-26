# code/ —— DSH 插件开发交付件

本目录存放 workflow-agent 正式版所有 DSH 插件开发的交付件源代码。

## 子目录说明

| 目录 | 用途 |
|------|------|
| `plugins/workflow-host/` | Host 端 Cordis 插件工程代码：工作流引擎核心逻辑、状态管理、RPC 及 Tool 注册 |
| `plugins/workflow-client/` | Client 端 Cordis 插件工程代码：工作流编排 UI、执行监控面板、LLM 会话交互界面 |
| `ui/` | UI 组件/页面代码（如果与 Cordis 插件分离，如独立 React 组件库） |
| `scripts/` | 构建、测试、代码生成等工具脚本 |
| `shared/` | 跨模块共享代码（YAML schema 常量、类型定义、工具函数） |

## 开发规范

- Host 端使用纯 JavaScript（无 TypeScript/JSX 转换），遵循 Cordis 插件开发规范
- Client 端使用纯 JavaScript + React.createElement（无 JSX）
- 所有代码经过 `cordis_define` → `cordis_run` 链路验证后固化至此
- 插件工程按 DSH 插件包规范组织，支持 `dsh plugin add` 安装