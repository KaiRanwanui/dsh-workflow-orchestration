# code/legacy/ — 历史代码归档（非现役）

> **本目录内容不是现役交付物**：已被阶段 3（构建链合并重构）的单一生成器取代，按用户决策
> 「文档直接删除，代码保留（集中归档）」于 2026-09-14 移入此处。`git mv` 保留历史，随时可考古。
> **不要在本目录开发或修复**；如需参考旧实现，只读即可。

## 清单与退役原因

| 路径 | 原用途 | 退役原因 |
|---|---|---|
| `scripts/build-host.js` | 早期动态插件（cordis_define）形态的 dist 生成器（产 `plugins/workflow-host/dist/host-body.js`/`host-bundle.js`） | 该形态早已被 npm 包形态取代 |
| `scripts/sync-modules.js` | 把 12 个源模块同步进 `workflow-host.mjs` 内联 section（两步链第一步） | 阶段 3 单一生成器直接从源拼接，不再有内联副本 |
| `scripts/*.ps1`（build / install / verify） | Windows 时代构建/安装/验证（desktop profile + 文件锁预检） | 现役环境为 Linux + `dsh plugin add` + `link:`（构建即生效） |
| `plugins/workflow-host/index.js` | 早期动态插件入口（`require.main` 判定 + dist 加载） | 同上 |
| `plugins/workflow-host/rpc.js` | harness RPC 处理器（`wf:status` 等） | Iter-5 起 RPC 被 webServer 路由（`/wf/*`）取代 |
| `plugins/workflow-host/tools.js` | 早期工具定义 + `expandLoopTasks`（39 行旧实现） | 被 `tools-preset.js` 取代（82 行现役实现，含 Iter-30 修复）；其副本曾被单测误测（阶段 3 修正） |
| `plugins/workflow-host/dist/` | build-host.js 的输出（host-body / host-bundle / host-verify） | 同 build-host.js |
| `plugins/workflow-client/` | PoC/早期 Client 插件雏形 | 被 `packages/client-ui-monitor` 取代 |
| `plugins/workflow-rpc/` | RPC 相关早期代码 | 同 rpc.js |
| `ui/` | 空占位（早期规划残留） | 无内容 |
| `probes/` | Iter-SUBA / Iter-23 实证探针脚本（历史证据，报告中引用） | 探针已完成使命，留档 |
| `agent-presets/workflow-rpc.mjs` | preset 侧 RPC 本地插件 | Iter-5 起停用（未挂载） |

## 与现役的关系

- 现役构建链：`code/scripts/module-manifest.js` + `code/packages/workflow-host/build.js`（见 `code/scripts/README.md`）
- 现役源模块：`code/plugins/workflow-host/`、`code/plugins/workflow-host-preset/`、`code/shared/`
- 本目录**不参与**任何构建与部署；如误删现役文件请勿从这里拷贝补救（以 git 历史为准）
