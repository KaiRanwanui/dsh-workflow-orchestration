# Iter-MIG2 · Mac 环境重建与挂载报告（阶段 6 · DSH 0.2.0-rc.2 迁移）

> **状态**：✅ 完成（全部计划项闭环；Host 侧 HMR 生效方式一项降级为 MIG3 顺带实证，见 §4）
> **环境**：macOS + `~/.dsh-dev`（DSH 0.2.0-rc.2，web profile）+ host **v0.28.1**（MIG1 编码轮 0.28.0 + B4 修复轮 0.28.1）
> **前置报告**：[Iter-MIG1 代码适配](iter-migration-020rc2-report.md)（含 B1–B4 断裂修复）

---

## 1. 环境重建步骤（真机执行记录）

| # | 步骤 | 结果 | 备注 |
|---|---|---|---|
| 1 | web profile 初始化（用户预建 `~/.dsh-dev/profiles/web`） | ✓ | 已含 dsh-mnemon 等既有 bundle |
| 2 | `install.js --tgz release/` 从打包产物安装 | ✓ | **`dsh plugin add` 自动完成 `dsh.profile.bundles` 注册**（0.1.5 需手工编辑 profile package.json，此步退役） |
| 3 | preset 随包声明注册（B2 交付形态） | ✓ | `--dump-config` 组合树见 `preset-workflow-orchestrator` 全 11 行插件；**用户 GUI preset 选择器实见 Workflow Orchestrator**（MIG0 唯一未实证项闭合） |
| 4 | persona 随包子路径 | ✓ | 组合树 `@workflow-agent/workflow-host/persona` 正确解析 |
| 5 | 资产物化（B4 修复后） | ✓ | `materialize ok written=30`，docs/samples/skills/templates 四层落盘 |
| 6 | 服务管理（macOS） | ✓ | 用户终端手动 `dsh web` 启动（无 systemd/launchd 依赖）；"Host 改动需重启"惯例延续，HMR 见 §4 |

## 2. 运行时验证（正式 3080 实例，用户重启后复核）

| 验证项 | 结果 |
|---|---|
| `/wf/list` | ✓ `{"instances":[],"recoveredOrphans":[]}` 正常 |
| `/wf/templates` | ✓ **`predefined` 首次列出模板**（default-demo 完整 YAML）——0.1.5 时代模板链路在 0.2.0 全通 |
| fs 服务语义（`/wf/create` 全链路） | ✓ 语义校验（含 E-SKILL-MISSING 技能探测）→ 实例目录落盘 → 探针实例已清理 |
| 物化幂等 | ✓ 重启后重复物化同 root，无报错无重复 |

## 3. 过程中发现并修复的问题

### 3.1 B4（已计入 MIG1 报告）：DSH fs 服务 workspace-write 沙箱
物化经 fs 服务写 home 全拒 → 改 node:fs 直写。定位过程使用**独立探针 profile**（wf-probe，3081 端口）捕获启动日志完成，不扰动现役实例；探针已清理。

### 3.2 install 流程缺陷：悬空 file: 依赖（本轮修复）
- **现象**：0.28.0 安装把 `file:<tgz 绝对路径>` 写死进 profile dependencies；build-release 重建 release/ 后旧 tgz 消失，pnpm 任何操作先撞 ENOENT，后续 plugin add 全部失败。
- **修复**：`install.js` 增加 ⓪ 前置——检测 profile dependencies 中指向不存在路径的 `file:` 引用，自动改写指向本次 tgz（dry-run 可预览）。0.28.1 已按修正流程落进正式 profile。

### 3.3 版本纪律修正
B4 修复轮最初复用 0.28.0 版本号重打 tgz（同号不同内容）→ 按纪律 bump **0.28.1**（MIG1 报告 §3.1 追加轮已记录）。

### 3.4 B5 🔴 实例写入遭 fs 沙箱拒（GUI 创建实例实证，2026-10-03）

- **现象**：GUI 创建实例报 `cannot write ".../wf_dev_ws/.workflow-agent/instances/.gitkeep": file access denied under workspace-write mode` ——**工作区内路径也被拒**。
- **根因**：fs-sandbox 可写根 = `policy.workspaceRoot + /tmp + tmpdir()`（dsh-sandbox writableRoots 实包）；实例写入发生在 **Host 进程作用域**（面板路由/装配期），其 workspaceRoot ≠ 用户会话工作区 → 工作区内路径同样出界。
- **修复（B5）**：新增 `shared/fs-host.js` Host 侧适配层——按 DSH fs 服务 + 测试 mock 的形状契约（resolve/writeText/readText/stat/listDir）实现 node:fs 直写；22 处 `ctx.get('fs')` 消费点统一改「hostFs 优先、fs 服务兜底」形态（产物内恒直写；`WF_HOST_FS=0` 时置空供测试走 mock 注入）；test-host 顶部置开关。603 单测全绿。
- **版本**：**v0.28.2**（B5 修复轮）。
- **配套流程硬化（install.js）**：⓪ 悬空 file: 依赖前置修正 + ⓪.5 **装后实体版本校验**（file: 依赖换版本时 pnpm add 惰性不刷实体 added=0 → 校验 node_modules version 与 tgz 一致，不符则 pnpm install 强制同步）。两缺陷均真机实证后闭环。

## 4. 已知限制 / 顺延项

1. **Host 侧改动热生效未实证**：0.2.0 web bundle 常驻官方 `client-hmr` 行（client bundle 由 watcher 重建时热推送）；**Host（node 侧）插件改动**是否同样免重启，留 MIG3 回归期改一处小实现顺带实证，再决定 GUIDE「重启生效」文档段落去留。
2. preset 选择器**会话级验证**（用 Workflow Orchestrator 新建会话 → workflow_* 工具可用）属 MIG3 行为回归首轮内容。

## 5. 结论

Mac 环境（`~/.dsh-dev`，DSH 0.2.0-rc.2）下 workflow-agent v0.28.1 完成安装、注册、物化与路由全链路挂载；MIG0 遗留的唯一未实证项（preset 声明制真机注册）已闭合。阶段 6 剩余：MIG3 行为回归 + 缺陷修复轮、MIG4 收尾。
