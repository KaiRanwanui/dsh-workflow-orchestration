# 阶段 3 — 构建链合并重构 + 发行工具 + 单包化（扩展）

- **时间**：2026-09-14（方案拍板）~ 2026-09-15（3a–3c + 扩展 3e–3i 完成）
- **DSH 基线**：`0.1.5-rc.2`（不变）
- **交付**：`@workflow-agent/workflow-host` **v0.23.0 单包**（Host 插件 + DAG 面板 bundle + preset 随包）；`@workflow-agent/client-ui-monitor` **退役**
- **测试基线**：**567 单测全绿**（用例 18 重写 / 用例 31 新增）+ 产物级验证 + 真机冒烟 + GUI 验收
- **状态**：✅ 已完成并冻结（3d persona 文件化移出，见「后续」）
- **实物验收**：✅ 三步验收通过（构建 tgz → 全量清除零残留[用户审核] → tarball 重装[六点核验] → 基本功能[用户 GUI 确认]；过程异常 3 起均已修复，见报告 §10）

## 阶段目标

消除「一份逻辑两份代码」的构建链，单测对准真实交付物；修复交付物导出面缺陷与停止级联缺陷；**按用户指令扩展**——打包形态收敛为单包、内建资产文件化、persona 文件化、npm 发布元数据——构建/打包类问题在阶段 3 内全部闭环，阶段 4 起纯功能迭代。

## 交付能力清单（阶段结果）

| 能力域 | 交付内容 |
|---|---|
| **单一生成器** | `build.js` 按 `module-manifest.js`（14 项有序清单）从源模块直出交付物；默认 CJS `lib/index.js`；`--format=esm` 按需产 `dist/workflow-host.mjs`（本地测试，不入库不随包）；`--check` 新鲜度 |
| **源模块化** | 2 段手编区成为真实源文件：`apply-prologue.js`（探针 + 注册表 + A1 tap）、`webserver-routes.js`（`/wf/*` 路由） |
| **单包双端** | 一个包承载 Host 插件（main）+ DAG 面板 bundle（`dsh.client`）；patch 双行（Host 行 + 子路径 Client 行）；`client-ui-monitor` 包退役 |
| **停止级联 v4** | 面板 Stop 叠加式三通道：cancel（原生级联）+ `drainContinuableChildren` 硬释放 + 逐子 interrupt 兜底 + 实例 `logs/stop-trace.log` 留痕 |
| **资产文件化** | `builtin-assets/{skills,templates,samples,docs}/` 真实文件随包；物化 = 递归复制（幂等覆盖，用户拍板）；`builtin-skills.js` → `builtin-materialize.js` |
| **persona 文件化** | `persona-file.mjs` 运行时读取 `system-prompt.md`（preset 作用域遮蔽全局）；`sync-persona.js` 退役 |
| **发行工具** | `build-release.js`（构建+打包+内容断言+版本矩阵）→ `release/*.tgz`；`install.js`（`dsh plugin add` + preset 同步，dry-run/幂等） |

## 迭代索引

| 迭代 | 主题 | 报告 |
|---|---|---|
| 3a | 构建链合并：抽取 2 段手编区为源文件、单一生成器、单测对准真实产物 | `iterations/iter-build-chain-report.md` §1–5 |
| 3b | legacy 集中归档 `code/legacy/` | 同上 §3 |
| — | 缺陷 #7：面板 Stop「空闲主会话」不停后台子会话（v3 互斥级联缺陷 → v4 叠加式修复） | 同上 §5 |
| 3c | 发行工具 v1（`build-release.js` + `install.js`） | 同上 §9 |
| **3e–3i 扩展** | 单包合并 + 资产文件化 + persona 文件化 + npm 元数据 + build.mjs 改名 | `iterations/iter-single-package-report.md` |

## 关键机制（阶段 3 后的构建链与部署）

```
源模块（14 项，scripts/module-manifest.js 有序表）
   └── packages/workflow-host/build.js（单一生成器）
         ├── lib/index.js               # CJS 交付物（运行时加载；剥离条件导出块）
         ├── lib/client.js              # DAG 面板浏览器 bundle
         ├── lib/monitor-entry.js       # 面板行 Host 侧空入口
         └── dist/workflow-host.mjs     # ESM 按需测试输出（--format=esm；不入库）
部署 ── profile link:（构建即生效；Host 重启 / Client 刷新页面）
      preset 三件套由 install.js 同步 ~/.dsh/.agent-presets/
发行 ── scripts/build-release.js → release/*.tgz；scripts/install.js → 一键安装
```

## 设计决议（用户拍板，详见 `plan.md` §6 与 §9.5）

1. section 作用域 = 模块作用域；2. dist 生成物入库但**不随发行包**（收尾修订）；3. 3c 发行工具纳入；4. 3d 独立迭代先探针；5. legacy 代码保留集中 `code/legacy/`；6. host 0.22.0→**0.23.0**（单包合并）；7. npm scope 维持 `@workflow-agent`；8. Client 行**双行子路径**（对齐 dsh-web-all 先例）；9. npm publish 暂不执行（元数据备齐）；10. 资产物化**幂等覆盖**。

## 阶段教训（已沉淀）

1. 单测必须对准真实交付物——否则测的是死代码/中间产物；
2. 生成产物不入库、不手编——入库的手编中间物会制造「源/产物两说」与误跑风险；
3. 停止类操作必须覆盖所有会话状态（主会话活跃/空闲两时序分别验收）；
4. 批量字符串替换必须带边界校验（本阶段 gitignore 追随、行名子串误替换均靠终检拦截）。

## 后续（阶段 4 候选与开放项）

| 项 | 说明 |
|---|---|
| persona 文件化遗留探针（async apply） | persona-file.mjs 用同步读取规避；热更新需求出现时再验证 |
| 门禁 subagent 分支真实链路复跑 | 功能迭代顺带 |
| `npm publish` | 需 npm 账号具备 `@workflow-agent` scope；元数据已备齐 |
| 节点详情面板 / 交互增强 / 主题适配（原 Iter-31 backlog） | **阶段 4 功能迭代队列（阶段 4 起仅功能，不再动构建打包）** |
| 部署期清单自动校验（install 后自检 preset/patch/导出面） | 可选增强，未排期 |
