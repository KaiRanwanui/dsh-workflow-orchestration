# code/ —— 交付代码与构建链

> 本目录是 workflow-agent 的全部交付代码。构建链细节与「改哪里 → 跑什么」对照表见仓库根 [`GUIDE.md`](../GUIDE.md)；项目管理文档见 [`../plan/`](../plan/)。

## 目录结构（现役）

| 路径 | 角色 | 说明 |
|---|---|---|
| `packages/workflow-host/` | **交付物（Host）** | npm 包 `@workflow-agent/workflow-host`：`lib/index.js`（CJS，**运行时真正加载的那份**）+ `cordis.patch.yml`（profile bundle 插入行） |
| `packages/client-ui-monitor/` | **交付物（Client）** | npm 包 `@workflow-agent/client-ui-monitor`：`src/client.js`（单一源）→ `lib/client.js`（浏览器 bundle）+ `lib/index.js`（Host 侧空入口） |
| `plugins/workflow-host/` | 源模块 | `engine.js`（状态机/并发/循环）、`storage.js`（持久化）、`instance-store.js`（实例注册表/绑定/孤儿回收/归档）、`builtin-skills.js`（内建模板与技能） |
| `plugins/workflow-host-preset/` | 源模块 | `tools-preset.js`：`workflow_*` 十个工具定义（preset 形态注册） |
| `shared/` | 源模块 | `workflow-schema.js`、`workflow-parser.js`、`workflow-paths.js`、`workflow-validate.js`、`workflow-edit.js`、`items-extract.js`、`zip-writer.js` |
| `agent-presets/workflow-orchestrator/` | Agent Preset | `preset.yml`、`agent.cordis.yml`（composition）、`system-prompt.md`（persona 单一源）、`workflow-host.mjs`（构建中间产物，当前未被挂载） |
| `scripts/` | 构建与测试 | 见下表 |
| `probes/` | 历史探针 | Iter-SUBA / Iter-23 的实证探针脚本（留档） |

## 构建与测试脚本（阶段 3 起：单一生成器）

| 脚本 | 用途 |
|---|---|
| `scripts/module-manifest.js` | **构建清单**：name/inject + 14 项有序源模块表 |
| `packages/workflow-host/build.js` | **单一生成器**：源模块 → `lib/index.js`（CJS 交付物）+ `dist/workflow-host.mjs`（ESM，入库）；`--format=cjs\|esm\|both`；`--check` 新鲜度 |
| `packages/client-ui-monitor/build.js` | Client：`src/client.js` → `lib/client.js` |
| `scripts/test-host.js` | 单测 569 用例（启动时自动检查产物新鲜度并按需重建） |
| `scripts/verify-client-bundle.js` | Client 产物求值级验证 |
| `scripts/sync-persona.js` | persona 注入（`system-prompt.md` → `agent.cordis.yml`；`--check` 校验） |
| `scripts/simulate-exec.js` | 模拟工作流状态流转（GUI 联调演示数据） |

> 历史脚本（build-host.js / sync-modules.js / *.ps1 等）集中在 `legacy/scripts/`，见 [`legacy/README.md`](legacy/README.md)。

## 开发规范

- 全部代码为**纯 JavaScript**：Host 端无 TypeScript/JSX；Client 端用 `React.createElement`（禁 JSX）。
- 源模块是**单一源**，改动后按构建链同步；不要直接编辑生成物（`lib/*`、`workflow-host.mjs` 的 section 区）。
- 部署形态：profile 以 `link:` 依赖本仓库两个包 → 构建后无需重装；**Host 改动重启 `dsh.service`，Client 改动刷新页面**。
- 提交前必须跑：`node code/scripts/test-host.js`（全绿）+ 涉及 Client 时 `verify-client-bundle.js`。
