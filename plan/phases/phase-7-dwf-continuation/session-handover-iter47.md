# 新 Session 交接 Prompt —— 阶段 7 / Iter-47-1 → Iter-47

> 用法：将本文全文作为新 Session 的开场消息。

---

我是 workflow-agent 项目的负责人。你接手一个进行中的开发 Session，请先读本文与指定文档，然后按「本 Session 任务」开展工作。

## 项目与环境

- **项目**：workflow-agent——DSH 插件工程（单包 `@workflow-agent/workflow-host`：Host 插件 + DAG 面板 + workflow-orchestrator preset 随包声明）。仓库：`/Users/zhaokai/Projects/dsh_projects/workflow-agent`（git 分支 main，已推 GitHub）。
- **运行环境**：macOS，DSH **0.2.0-rc.2**；**开发 home 为 `~/.dsh-dev`（`DSH_HOME` 已设；`~/.dsh` 属 dsh-desktop，禁止混用/修改）**；web 在 127.0.0.1:3080（用户终端手动 `dsh web` 启动）。
- **当前基线**：host **v0.29.5**（阶段 6 迁移已关闭：DSH 0.1.5→0.2.0 迁移 + Mac 重建完成，608 单测全绿）。阶段 7 进行中，版本线自 **0.30.0** 起。
- **必读文档**（按序）：
  1. `plan/status.md`（当前状态唯一权威）
  2. `plan/phases/phase-7-dwf-continuation/README.md`（阶段 7 方案：G1 逐活动磨炼主线 + 遗留汇聚）
  3. `GUIDE.md` §3.5/§5（环境路径与「改哪里→生效方式」实证表）

## 本 Session 任务

**Iter-47-1（人工介入机制，先做）**：方案已成稿待用户确认——`plan/phases/phase-7-dwf-continuation/iterations/iter-47-1-design.md`。内容：
1. 子会话 ask 能力真机查证（任务 subagent 能否向人提问）→ 择定询问路径 A（同步提问）/ B（异步待澄清）；
2. 引擎**门禁耗尽人工处置**：gate retry 耗尽 → 实例 FAILED + `stopReason='gate-exhausted'` → 主会话注入三选一提示（修改交付件后继续 / 放行 WAIVED / 停止）；实现 `workflow_resume` 扩展 + 新 `workflow_approve_gate` 工具 + `/wf/approve-gate` 路由 + 单测；
3. 真机验收：never-pass 门禁（max-retries:1）走通三条分支。

**Iter-47（需求澄清活动做实，47-1 验收后）**：方案 v2/v3 成稿——`iterations/iter-47-design.md`。核心：活动定位为 **PRD.md → 初始需求 IR 的转换交付**（5W2H 方法），双交付件（初始需求描述文件 + 知识需求清单），门禁四查（格式/完整性=PRD 覆盖性/一致性/正确性）+ 检查报告（retry 改进输入），人工介入按 47-1 择定路径编写。

## 开发流程（硬规则）

```bash
# 构建/测试/发布/安装（一律从打包产物安装，不直接挂源码目录）
node code/packages/workflow-host/build.js          # Host CJS + persona 资产
node code/packages/workflow-host/build-client.mjs  # 面板 bundle
node code/scripts/test-host.js                     # 单测（当前基线 608，不允许净减少）
node code/scripts/build-release.js                 # 产出 release/*.tgz + 内容断言
node code/scripts/install.js --tgz release         # 安装到 ~/.dsh-dev（⓪ 自动修正悬空 file: 依赖 + ⓪.5 实体版本校验）
# 生效：Host 改动 → 用户重启 dsh web；Client 改动 → 用户强刷浏览器
```

- **纪律**：先方案后开发（方案→用户确认→编码→报告归档→用户验收→关闭）；版本号每轮递增；迭代可随时插入/调序（用户拍板的 G1 硬约定）；过程问题记 `plan/phases/phase-7-dwf-continuation/findings.md`（阻塞类）与 `optimization-backlog.md`（非阻塞，O 编号延续 O-12）。
- **DSH 0.2.0 关键语义（务必遵守，均真机实证）**：
  - fs 服务是 workspace-write 沙箱且 Host 作用域连工作区都写不了 → **插件私有写入一律走 `code/shared/fs-host.js` 适配层（hostFs），不用 `ctx.get('fs')`**（新消费点形态：`(typeof hostFs !== 'undefined' && hostFs) || ctx.get('fs')`；单测置 `WF_HOST_FS=0` 走 mock）；
  - `subagents.listChildren` 返回 `SubagentCatalogEntry`（无 kind 字段，有 id 即纳入）；
  - preset 为 agent-preset-registry 随包声明制（`presets/workflow-orchestrator.patch.yml`），无目录部署；
  - 客户端 sessions 快照无 `current` 字段（页签门控走 `retainedBy.mainView` 解析，详见 `plan/design/client-tab-gating-design.md`）。

## 真机资源

- 作业流现场：`/Users/zhaokai/Projects/dsh_projects/sysdesign-trial/`（sys-design.yaml v0.4 + 24 技能 + 占位 PRD「智能会议室预订系统」；技能改仓库 `workflow_samples/sys-design/` 后需同步现场）；
- 验证模板：`~/.dsh-dev/workflow-agent/templates/`（verify-gate/dir-vars/empty-items/skill-shadow 等 8 个）；
- 门禁 prompt 现状（O-7 问题现场）：host 派发门禁时指定检查报告路径（logs/gate-<id>-N.md）——47-1/47 设计中已按用户新定义处理（报告保留为 retry 改进输入）。

## 第一步

向用户确认 Iter-47-1 方案（若我已另行确认则直接开工）：先做子会话 ask 查证的实验设计，同步开始引擎 gate-exhausted 分支编码。
