# plan/ —— 项目运行文档目录

本目录存放 workflow-agent 正式版项目的所有管理和技术文档。

## 子目录说明

| 目录 | 用途 |
|------|------|
| `requirements/` | 需求分析文档：原始需求、需求变更、需求规格说明（SRS） |
| `design/` | 架构与设计文档：架构方案、设计决策记录（ADR）、接口规范、设计文档（SAD） |
| `development/` | 开发计划：迭代规划、任务分解、测试计划、发布计划 |

## 文档管理原则

- 关键文档使用 Markdown 格式，保持 git 可追踪
- 重大设计决策记录在 `design/` 目录下的 ADR（Architecture Decision Record）文件中
- 开发计划按迭代组织，每个迭代一个文件