# code/plugins/ — Host 插件源模块

按构建清单（`scripts/module-manifest.js`）拼入 `packages/workflow-host/lib/index.js` 的源模块：

| 目录 / 文件 | 内容 |
|---|---|
| `workflow-host/` | `apply-prologue.js`（applyInternal：探针 + 注册表 + A1 tap）、`engine.js`（状态机/并发/循环）、`storage.js`（持久化）、`instance-store.js`（注册表/绑定/孤儿/归档）、`builtin-skills.js`（内建模板与技能）、`webserver-routes.js`（`/wf/*` 路由） |
| `workflow-host-preset/` | `tools-preset.js`（`workflow_*` 十个工具：begin/create/start/status/stop/reset/resume/adopt/validate/archive…） |

> `workflow-client/`、`workflow-rpc/` 等历史目录已移至 `../legacy/plugins/`（非现役）。
> 构建链与维护规则见 [`README.md`](../README.md) 与 [`scripts/README.md`](../scripts/README.md)。
