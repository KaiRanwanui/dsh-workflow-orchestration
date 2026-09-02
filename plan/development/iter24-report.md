# Iter-24 报告 — 预定义目录与安装布局（~/.dsh/workflow-agent/）

- **状态**：✅ 完成关闭（2026-09-02，用户 GUI 全链路验证通过后收尾）
- **版本**：host v0.13.0 / client v0.6.1
- **提交**：7896bc3（设计定稿）→ c9d89e5（步骤 0+1 物化落地）→ c2fad87（解析链+模板切源）→ 734fc31 / 8c65d10（探针存档）
- **配套**：`iter24-design.md`（设计定稿）、`iter24-probe-fs.md`（探针存档）、`../requirements/工作流数据管理需求.md`（R1-R4 上游）

## 背景

需求定稿 R1-R4 的地基迭代：全局唯一预定义目录 + 内建资产随插件分发 + 相对引用两级解析 + 模板下拉切源。目标一句话：**任何空白工作区开箱即用 default-demo**。

## 探针结论（动态插件 probe-1/probe-2，用后 undefine）

- **步骤 0（fs 写 ~/.dsh）**：✅ 放行。`sandboxPolicy` 报 `workspaceRoot=/home/zhaokai`（=HOME）。
- **追问（作用域边界）**：**全盘读写无硬限制**——HOME 根级/`.dsh` 深层/HOME 子目录/`/tmp` 写全通，`/etc` 读通。`sandboxPolicy(workspace-write)` 是 opt-in（调用方显式传参才生效），非 fs 服务内置强制。
- **勘误**：早前"/tmp 写入被拒"是 bwrap `--tmpfs /tmp` 观测假象（DSH 写真实 /tmp，沙箱看不见）。
- **Client**：浏览器端无直接文件能力，一切经 Host 路由/RPC 间接。
- 工程纪律（自律约定）：插件写盘只落 `~/.dsh/workflow-agent/`、工作区 `.workflow-agent/`、用户明示目录。

## 设计定稿（两决策点用户拍板）

- 预定义目录 = **`~/.dsh/workflow-agent/`**（`${DSH_HOME:-~/.dsh}` 定位，DSH_HOME 优先）；
- 工作区 `templates/` **不再进下拉**（迁移=手工移入预定义目录，用户接受）；
- 物化策略：模板 2 + 技能 5 同名覆盖幂等（A2），samples/docs 骨架 README 仅缺失写；物化失败不阻断插件启动；
- 解析链：workspace 根优先 → 预定义根兜底；绝对/`~` 直通；双 miss 回退 workspace 相对（报错语义不变）；
- 模板下拉：预定义目录扫描为主 + 内嵌常量兜底合并（同名去重，磁盘版赢）。

## 交付

- `plugins/workflow-host/builtin-skills.js`（新源模块，sync-modules 新增 section）：5 内建技能常量（自 workflow_test_ws/skills/ 收编，补 frontmatter `name`）+ `detectPredefinedRoot` + `materializeBuiltinAssets`。
- `tools-preset.js`：`registerWorkflowToolsPreset` 启动时 fire-and-forget 物化（探针日志 `[workflow-agent] materialize`）；`resolveRel`（定义目录上探）→ **`resolveRefPath`** 两级链；`expandDefinition` 基准 `src.base`→`src.workspaceRoot`（begin=args.workspaceRoot||sessionCwd，实例=meta.sessionCwd）；删除 `instanceSourceBase`；`mergeTemplateLists` 合并去重。
- `workflow-host.mjs`：`/wf/templates` 新契约 `{builtin, predefined}`——扫预定义目录为主，工作区 templates/ 退出。
- `client.js`（v0.6.1）：下拉单一 `predefined` 列表（`[模板]` 标签 + yaml `description:` 提取 + 兜底标记），`tpl:` 前缀统一可编辑 yaml→workflowText 提交；移除 `ws:`/`builtin:` 分支。

## 过程问题与修复

1. **sync 单 section 遗漏**：改 tools-preset 源后只 sync 了 builtin-skills → mjs/lib 调用点缺失，物化静默不跑。定位=动态探针排除法（fs 可写✓、console 进 journal✓ → 只剩部署链）。修复=全量 sync。**纪律升级：改任何源模块后一律全量 sync；测试加载源文件而部署跑 mjs 副本，两者无一致性校验，是结构性盲区。**
2. **`fs.stat` 契约误用**：真实契约"缺失返回 `undefined` 不抛错"，原 try/catch 判定把 undefined 误当"已存在"跳过 README 写入。修复 + mock fs 对齐真实语义。
3. **测试夹具路径漏改**：case 10 改造时夹具补了 `/workflow-agent` 段、断言期望路径没同步——两处必须同改。

## 验证结论

- **单测**：250 全绿（221 → 250：用例 18 物化幂等/根定位、用例 19 两级链四情形+集成+合并去重、用例 10 改新契约含 DSH_HOME 注入扫描）。
- **部署**：host 0.13.0（npm link 生效）+ 预设 mjs 副本同步 + client 0.6.1（verify-client-bundle 求值级通过）+ 用户执行 systemctl 重启 ×3。
- **物化幂等**：三次重启 `materialize ok written=11`；覆盖生效（skills/templates mtime 随重启刷新）、用户 README 不被覆盖（仅缺失写）。
- **空白工作区**：POST /wf/create（workflowText=预定义模板）→ CREATED + 五件套落盘。
- **全链路（用户 GUI 验证）**：空白工作区 /home/zhaokai/wf-blank-e2e 开 orchestrator 会话 → default-demo 完整跑到 COMPLETED，Session 记录确认 **skills 全部读自 `~/.dsh/workflow-agent/skills/`**（预定义兜底生效，开箱即用达成）。
- **回归**：workflow_test_ws 44 实例完好；workspace 优先命中路径不变。

## 部署纪律更新（用户明确要求）

Agent **不自行 systemctl restart dsh.service**（会终止 DSH 进程=中断当前会话）；正确流程=完成文件部署后提醒用户重启，等"已重启"回复再验证 journalctl。

## 范围外与后续

samples/docs 内容建设、多文件技能物化、frontmatter 解析与技能清单展示（Iter-28）、`${workspace}` 等目录变量（Iter-25）、语义校验（Iter-27）。**下一迭代 = Iter-25 数据流显性化**（按团队约定先设计确认）。
