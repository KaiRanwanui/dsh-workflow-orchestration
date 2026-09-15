# 阶段 3 扩展迭代报告（3e–3i）— 单包合并 · 资产文件化 · persona 文件化 · 发行收尾

- **状态**：✅ 3e–3i 全部完成关闭（2026-09-15，用户 GUI 验收通过）
- **阶段**：阶段 3 扩展（构建/打包收尾全部并入阶段 3；阶段 4 起纯功能）
- **版本**：`@workflow-agent/workflow-host` **v0.23.0**（单包：Host 插件 + 面板 bundle + preset 随包）；`@workflow-agent/client-ui-monitor` **退役**
- **测试**：567 单测全绿（用例 18 重写 / 用例 31 ESM 按需验证 / c21 对准资产文件本体）

## 3e 单包合并

- **背景**：DSH 无「必须分两包」要求；官方 client-ui 全系为同包双端结构（`main` Host 入口 + `dsh.client` 浏览器 bundle + `exports['./client']`）；`@linxin666/dsh-web-all` 单包 26 行（自身行 + 子路径行）承载 20 个子插件并与独立安装共存——先例完备。
- **实施**：`client-ui-monitor` 并入 `workflow-host` 包——Host `main`（引擎/工具/路由）+ `dsh.client`（DAG 面板 bundle）+ `exports['./client']` + patch 双行（`workflow-host` Host 行 / `ui-workflow-monitor` Client 行，行名 `@workflow-agent/workflow-host/monitor` 子路径）。
- **验证**：569 单测全绿（合并后）+ 真机面板 DAG 正常渲染。
- `client-ui-monitor` 包退役入 `code/legacy/packages/`。

## 3f 内建资产文件化

- **背景**：4 模板 + 7 技能 + samples/docs 以 JS 字符串内嵌 `builtin-skills.js`（~800 行，数据占绝大多数）——改技能要动 JS、处理转义。
- **实施**：22 个资产文件抽取为真实文件 `packages/workflow-host/builtin-assets/{skills,templates,samples,docs}/`（与部署目录 1:1 镜像），`files` 随包分发；`builtin-skills.js` → `builtin-materialize.js`（内嵌数据退役，物化 = 递归复制包内 `builtin-assets/` → `~/.dsh/workflow-agent/`，幂等覆盖语义，用户拍板）；读取走 node:fs（CJS 形态可用），ESM 生成物形态明确返回不可用（仅本地测试用）。
- **验证**：22 文件复制 + 幂等覆盖（用户改写被包内规范内容覆盖）+ 降级路径；`/wf/templates` 去内嵌兜底（预定义扫描为主，`builtin` 兼容字段移除——GUI 下拉走 `predefined`）。

## 3g persona 文件化

- **背景**：`dsh-persona` 仅收内联 `prefix`（0.1.5-rc.2 复核仍如此；官方 4 个发行 preset 也全部内联——官方标准形态）。
- **实施**：preset 本地插件 `persona-file.mjs` 运行时读取同目录 `system-prompt.md`，经 `systemPrompt` 服务注册 `deployment:persona-prefix` 段（preset 作用域遮蔽全局，机制对齐官方）；`agent.cordis.yml` persona 行改为挂载 `./persona-file.mjs`；`sync-persona.js` 退役入 legacy。
- **收益**：`system-prompt.md` 成为运行时单一源——改提示词 = 改文件 + 重部署 preset，无需任何构建期注入。
- **验证**：部署后 orchestrator 会话 persona 正常（GUI 验收）。

## 3h npm 发布元数据

- 两包补 `repository`（GitHub）/ `publishConfig`（`access: public`）；client `dsh.engines.dsh` 已对齐 `>=0.1.5-rc.1`（S7 完成）。
- **实际 publish 未执行**（用户决策：暂不发布）；后续发布 = `npm publish --access public`（需 npm 账号具备 `@workflow-agent` scope）。

## 3i build.mjs 改名

- client 构建脚本 `build.js` → `build-client.mjs`（迁入单包后随包改名），消除 Node reparse 警告；`package.json scripts.build:client` 同步。

## 缺陷与修正记录（本扩展迭代内）

| # | 问题 | 处置 |
|---|---|---|
| 1 | 沙箱路径笔误导致的移动失败/相对深度错误 | 当场修正（未入提交） |
| 2 | `.gitignore` 7 条规则未跟随 legacy 路径 → 调试残留件误入索引 | 规则全部对齐 + 移出索引（磁盘保留） |
| 3 | `build-release.js` 头部注释替换丢 `//` 前缀致语法错误 | 修复；`--check` 型校验前移到每次改动后 |
| 4 | test-host 路径深度/清单断言目标错误（plugins vs packages、builtin-skills vs webserver-routes 的 BUILTIN_TEMPLATES/SAMPLES 归属） | 断言对准真实资产文件本体 |

## 遗留（阶段 4 起处理）

| 项 | 说明 |
|---|---|
| persona 文件化 4 项探针中「async apply 支持」未单独验证 | persona-file.mjs 采用同步读取（模块加载时一次），规避该问题；如需热更新再验证 |
| 门禁 subagent 分支真实链路复跑 | 功能迭代顺带 |
| `npm publish` | 需 npm 账号具备 `@workflow-agent` scope；元数据已备齐 |


---

## 10. 清理-重装实物验收（用户主持的三步验收）

验收流程（用户设计）：① 构建脚本产出 npm 包 → ② 从现行 DSH **全量清除** workflow-agent 并审核零残留 → ③ 用安装器从**发行 tgz** 重装 → 审核基本功能。

### 清除结果

| 清除项 | 结果 |
|---|---|
| profile 依赖与 bundles 清单（workflow-host / client-ui-monitor） | ✅ 清零 |
| profile `node_modules/@workflow-agent/`（两条 link 符号链接） | ✅ 清零（pnpm remove 未清的符号链接残留手工补删） |
| preset 目录 `~/.dsh/.agent-presets/workflow-orchestrator/` | ✅ 清零 |
| 物化资产 `~/.dsh/workflow-agent/`（27 文件） | ✅ 清零 |
| **功能级反证**：重启后 GUI 无任何 workflow 内容 | ✅ 用户确认 |

### 清除-重装过程中的异常（3 起，均已修复）

| # | 异常 | 根因 | 修复 |
|---|---|---|---|
| A1 | DSH 启动报 `loaded without registering "@workflow-agent/workflow-host" via __ModuleLoader__.load`，面板不可用 | **Client bundle 注册 id 用了子路径名**（`…/monitor`），而 bundle 注册 id 必须与 profile bundles 列表的**包名**一致 | 注册 id 改为包名；patch 回退单行（决策 2 原选「双行子路径」修订为「单行双端」） |
| A2 | tarball 模式安装后 preset 无法加载（`./persona-file.mjs` 断链） | 安装器 `PRESET_FILES` 清单**漏 3g 新增的 persona-file.mjs**（仍为三件套） | 清单补第四件；部署副本与源 diff 一致 |
| A3 | preset 切换报 `cannot get property "systemPrompt" without inject` | `persona-file.mjs` 的 `name`/`inject` **未加 export**（ESM 加载器要求显式导出才会预注入服务） | 补 `export const` |

**共性根因**：单包合并把两包职责合一后，四类**分散的隐性清单**（bundle 注册 id、patch 行、安装器 preset 清单、ESM 导出面）必须与新形态对齐——旧约定无一处集中声明，合并时集中显形。防御措施已落地：`build-release.js` 内容断言覆盖包内文件；安装器 preset 清单补齐并支持 tarball 同源提取；「部署期清单」的自动校验列为后续可选增强。

### 重装后验收结果

| 验收项 | 结果 |
|---|---|
| 安装正确性（六点核验：注册/实装形态/内容/patch 双行/preset/可加载性） | ✅ 全过（tarball 真实副本非符号链接；注册 id = 包名） |
| 基本功能（用户 GUI 审核） | ✅ **基本工作流操作正常**（建实例/执行/面板/操作全链路） |

## 11. 阶段收尾状态

阶段 3 全部子迭代（3a/3b/3c + 扩展 3e–3i）与实物验收完成；阶段 4 起仅做功能增强（节点详情面板/交互增强/主题适配等 backlog），不再处理构建打包问题。
