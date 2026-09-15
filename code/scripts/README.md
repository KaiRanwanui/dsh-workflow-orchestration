# code/scripts/ — 构建 / 测试 / 发行 / 安装脚本

> **构建链总览与发行流程的完整说明见 [`../../plan/build/build-and-release.md`](../../plan/build/build-and-release.md)**；本文件只做脚本级速查。

## 现役脚本

| 脚本 | 用途 | 常用命令 |
|---|---|---|
| `module-manifest.js` | **构建清单**：name/inject 与 14 项有序源模块表（apply-prologue / webserver-routes 等） | 被生成器 require（改清单即改产物结构） |
| `../packages/workflow-host/build.js` | **Host 单一生成器**：源模块 → `lib/index.js`（CJS 交付物，入库随包）；`--format=esm` 按需产 `dist/workflow-host.mjs`（本地测试输出，不入库不随包；默认 cjs） | `node build.js`；`--format=cjs\|esm\|both`；`--check`（新鲜度，陈旧 exit 1） |
| `../packages/workflow-host/build-client.mjs` | **Client 面板 bundle**：`src/client.js` → `lib/client.js`（注册 id = 包名，供 dsh.client 挂载） | `node build-client.mjs` |
| `build-release.js` | **发行打包**：Host 双产物 + Client bundle + preset 暂存 → `npm pack` 单 tgz → 内容断言 + 版本矩阵 → `release/*.tgz` | `node build-release.js` |
| `install.js` | **安装器**：`dsh plugin add` 单包 + preset 三/四件套同步 `~/.dsh/.agent-presets/`；`--tgz release` 从发行包安装；`--dry-run` / `--preset-only` / 幂等 | `node install.js --profile web --tgz release` |
| `test-host.js` | 单测 567 用例（解析/引擎/注册表/路由/工具/主从聚合/**产物级回归**）；启动时按 mtime 自动重建陈旧产物 | `node test-host.js` |
| `verify-client-bundle.js` | Client bundle **求值级**验证（bundle 执行 + 注册 id + apply/inject 断言） | `node verify-client-bundle.js` |
| `simulate-exec.js` | 模拟工作流状态流转（生成演示 state.json，供 GUI 联调） | `node simulate-exec.js` |

> `build-preset.js` 已**废弃**（运行即 `exit 1`——它会用陈旧模板覆盖现役文件）。
> `sync-persona.js` 已**退役**（阶段 3g persona 文件化：`persona-file.mjs` 运行时读 `system-prompt.md`，无需构建期注入）。

## 典型流程

```bash
# Host 改动（引擎/工具/路由/探针）
node code/packages/workflow-host/build.js && node code/scripts/test-host.js
# → 重启 dsh.service 生效

# 面板 UI 改动
node code/packages/workflow-host/build-client.mjs && node code/scripts/verify-client-bundle.js
# → 刷新浏览器页面生效

# persona 提示词改动（阶段 3g：运行时读取，无构建步骤）
#   改 code/agent-presets/workflow-orchestrator/system-prompt.md
#   → 重部署 preset（install.js 或手工 cp）→ 新建/重载 preset 会话生效

# 发行（构建 + 打包 + 内容断言 + 版本矩阵）
node code/scripts/build-release.js
# 安装（从发行 tgz）
node code/scripts/install.js --profile web --tgz release
```

## 历史脚本（`../legacy/scripts/`）

| 脚本 | 原用途 | 状态 |
|---|---|---|
| `build-host.js` | 早期动态插件（cordis_define）形态的 dist 生成器 | 已退役（无引用者） |
| `sync-modules.js` | 把源模块同步进 workflow-host.mjs 内联 section | 已退役（被单一生成器取代） |
| `sync-persona.js` | 把 system-prompt.md 内联进 agent.cordis.yml persona 块 | 已退役（阶段 3g persona 文件化取代） |
| `build-workflow-plugins.ps1` / `install-workflow-plugins.ps1` / `verify-workflow-plugins.ps1` | Windows 时代的构建/安装/验证 | 已停用（Linux + `dsh plugin add` + `link:` 取代） |
