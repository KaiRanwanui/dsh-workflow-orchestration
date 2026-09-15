# code/scripts/ — 构建 / 测试 / 同步脚本

> **构建链（阶段 3 起）**：源模块 → `packages/workflow-host/build.js`（单一生成器）→ 交付物。
> 旧的「sync-modules 同步内联副本」流程已随构建链合并**退役**（脚本移入 `../legacy/scripts/`）。
> `build-preset.js`（另一个更早的生成器）同样已废弃（运行即 `exit 1`，防覆盖现役文件）。

## 现役脚本

| 脚本 | 用途 | 常用命令 |
|---|---|---|
| `module-manifest.js` | **构建清单**：workflow-host 插件的 name/inject 与 14 项有序源模块表 | 被生成器 require（改清单即改产物结构） |
| `../packages/workflow-host/build.js` | **单一生成器**：源模块 → `lib/index.js`（CJS 交付物）+ `dist/workflow-host.mjs`（ESM 生成物，入库） | `node build.js`（默认 both）；`--format=cjs\|esm\|both`；`--check`（新鲜度，陈旧 exit 1） |
| `../packages/client-ui-monitor/build.js` | Client 产物：`src/client.js` → `lib/client.js` | `node build.js` |
| `test-host.js` | 单测 569 用例（解析/引擎/注册表/路由/工具/主从聚合/**产物级回归**）；启动时自动检查产物新鲜度并按需重建 | `node test-host.js` |
| `verify-client-bundle.js` | Client 产物**求值级**验证（bundle 执行 + apply/inject 导出断言） | `node verify-client-bundle.js` |
| `sync-persona.js` | `system-prompt.md` → `agent.cordis.yml` persona 块；`--check` 只校验 | `node sync-persona.js [--check]` |
| `simulate-exec.js` | 模拟工作流状态流转（生成演示 state.json，供 GUI 联调） | `node simulate-exec.js` |

## 典型流程

```bash
# Host 改动后
node code/packages/workflow-host/build.js && node code/scripts/test-host.js
# → 重启 dsh.service 生效

# Client 改动后
node code/packages/client-ui-monitor/build.js && node code/scripts/verify-client-bundle.js
# → 刷新浏览器页面生效

# persona 改动后
node code/scripts/sync-persona.js   # 细则见该文件头注释（3d 迭代计划文件化后退役）
```

## 历史脚本（`../legacy/scripts/`）

| 脚本 | 原用途 | 状态 |
|---|---|---|
| `build-host.js` | 早期动态插件（cordis_define）形态的 dist 生成器 | 已退役（无引用者） |
| `sync-modules.js` | 把源模块同步进 workflow-host.mjs 内联 section | 已退役（被单一生成器取代） |
| `build-workflow-plugins.ps1` / `install-workflow-plugins.ps1` / `verify-workflow-plugins.ps1` | Windows 时代的构建/安装/验证 | 已停用（Linux + `dsh plugin add` + `link:` 取代） |
