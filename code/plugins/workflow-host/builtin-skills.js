// ============================================================================
// workflow-agent — 内建技能数据 + 预定义目录物化（Iter-24）
// 文件：code/plugins/workflow-host/builtin-skills.js
// 说明：
//   - BUILTIN_SKILLS：随插件发布的内建技能（正文自 workflow_test_ws/skills/
//     收编，头部补 frontmatter name）。物化到预定义目录 skills/<id>/SKILL.md。
//   - materializeBuiltinAssets：插件启动时把内建资产物化到
//     ${DSH_HOME:-$HOME/.dsh}/workflow-agent/（Iter-27a 起模板写子目录布局
//     templates/<name>/<name>.yaml+静态文件；技能同名直接覆盖；README 仅缺失时写）。
//     幂等；任一文件失败不阻断其余。
//   - 本函数同时承担探针职责：Host fs 服务对用户主目录的写能力以
//     journalctl 中 '[workflow-agent] materialize' 日志为证（Iter-24 步骤 0）。
// ============================================================================

// ── 内建技能（正文原样收编；frontmatter name 供未来技能清单展示）──────────
const BUILTIN_SKILLS = [
  {
    id: 'deep-analysis',
    content: `---
name: deep-analysis
---
# 技能：深度分析（deep-analysis）

## 任务目标
产出一份**详尽、篇幅较长**的分析文档，用于验证长时工作流任务的暂停/控制能力。

## 执行步骤
1. 围绕主题「工作流编排系统的深度分析」展开分析。
2. 编写 Markdown 文档，包含以下 **12 个小节**，每节一个 \`##\` 标题，且**每节内容不少于 150 字**：
   - \`## 背景与动机\`：阐述为何需要工作流编排（结合 DSH 多代理协作场景）。
   - \`## 需求分析\`：分解 3 个核心需求，每个给 1 个具体业务场景。
   - \`## 架构设计\`：描述分层结构、各组件职责、数据流向与调用关系。
   - \`## 状态机设计\`：列出 PENDING/RUNNING/STOPPED/COMPLETED/FAILED 的转移规则与守卫。
   - \`## 并发模型\`：解释 max-concurrency、任务依赖与就绪推导。
   - \`## 质量门禁\`：说明独立 gate 子会话的作用与 PASS/FAIL 判定流程。
   - \`## 异常处理\`：列出常见失败（子会话失败/超时/门禁失败）与恢复策略。
   - \`## 性能考量\`：讨论 subagent 会话隔离、并发上限与资源占用。
   - \`## 安全与权限\`：说明沙箱、工作区访问边界与 loopback 围栏。
   - \`## 实例与绑定\`：说明实例目录、会话 1:1 绑定、孤儿与采用。
   - \`## 监控与干预\`：说明 DAG 面板、Start/Stop/Resume 控制与人工介入。
   - \`## 结论与改进\`：总结全文，并给出 3 条可执行的改进建议。
3. 全文 **不少于 2500 字**，内容具体、有推导过程（含举例/对比/权衡），避免空泛套话。
4. 使用中文；Markdown 格式规范，代码/结构清晰。

## 输出要求
- 把完整文档写入任务参数中指定的输出文件（outputs 列出的绝对路径）。
- 全部小节写完后再整体写入，完成后回复一行：\`DONE: <输出路径>\`。
- 不要创建输出路径之外的任何文件。
`,
  },
  {
    id: 'spec-writer',
    content: `---
name: spec-writer
---
# 技能：编写规格说明（spec-writer）

## 任务目标
编写一份简短的《功能规格说明》测试文档，用于验证工作流编排链路。

## 执行步骤
1. 确定主题：「工作流编排测试系统」。
2. 编写 Markdown 文档，包含以下小节：
   - \`## 目标\`：一句话说明系统目标。
   - \`## 范围\`：列出 3 条范围内的能力（任务调度、并发控制、质量门禁）。
   - \`## 验收标准\`：列出 2 条可检查的验收条件。
3. 全文 200~400 字，使用中文。

## 输出要求
- 将完整文档写入任务参数中指定的输出文件（outputs 列出的绝对路径）。
- 文件写入后，回复一行：\`DONE: <输出路径>\`。
- 不要创建输出路径之外的任何文件。
`,
  },
  {
    id: 'data-prep',
    content: `---
name: data-prep
---
# 技能：准备测试数据（data-prep）

## 任务目标
生成一份小型测试数据文档，供后续汇总任务引用。

## 执行步骤
1. 编写 Markdown 文档，包含：
   - \`## 数据说明\`：一句话说明这是编排测试用模拟数据。
   - \`## 指标表\`：一张 Markdown 表格，列为 \`指标 | 数值 | 说明\`，包含至少 3 行数据，自行拟定合理数值。
2. 使用中文。

## 输出要求
- 将完整文档写入任务参数中指定的输出文件（outputs 列出的绝对路径）。
- 文件写入后，回复一行：\`DONE: <输出路径>\`。
- 不要创建输出路径之外的任何文件。
`,
  },
  {
    id: 'integrator',
    content: `---
name: integrator
---
# 技能：汇总集成（integrator）

## 任务目标
阅读输入文件，产出一份汇总文档，将两份输入内容实质整合。

## 执行步骤
1. 逐个读取任务参数中列出的输入文件（inputs 命名字典给出的绝对路径）。
2. 编写汇总文档，包含：
   - \`## 概述\`：2~3 句话概括两份输入的内容。
   - \`## 规格要点\`：摘录规格说明中的验收标准（逐条列出）。
   - \`## 数据要点\`：摘录测试数据表中的全部指标（保留 Markdown 表格）。
   - \`## 来源\`：列出两份输入文件的绝对路径。
3. 汇总文档必须实质引用两份输入的内容，不允许只罗列文件名。

## 输出要求
- 将汇总文档写入任务参数中指定的输出文件（outputs 列出的绝对路径）。
- 完成后回复一行：\`DONE: <输出路径>\`。
- 不要修改任何输入文件。
`,
  },
  {
    id: 'integrator-checker',
    content: `---
name: integrator-checker
---
# 技能：质量门禁检查（integrator-checker）

你是独立质量门禁检查员。对指定任务输出做只读检查，绝不修改任何文件。

## 检查项
对任务参数中指定的输出文件（outputs 列出的绝对路径）逐项检查：
1. 文件存在且非空。
2. 包含 \`## 概述\`、\`## 规格要点\`、\`## 数据要点\`、\`## 来源\` 四个小节。
3. \`## 数据要点\` 含 Markdown 表格且至少 3 行数据。
4. \`## 来源\` 列出了任务参数中给出的全部输入文件绝对路径。

## 判定与输出
- 全部通过 → 只输出：\`PASS\`
- 任一不通过 → 第一行输出 \`FAIL\`，随后逐条列出未通过项及原因。
不要输出 PASS/FAIL 之外的结论性内容。
`,
  },
  {
    id: 'list-collector',
    content: `---
name: list-collector
---
# 技能：收集模块清单（list-collector）

## 任务目标
生成一份模块清单文件，供下游 loop/concurrent 任务作为 items 源（Iter-26R 运行时 items 展开演示）。

## 执行步骤
1. 编写一个纯文本文件，每行一个模块名（无空行、无注释）。
2. 固定包含以下 3 个模块（每行一个）：
   - \`login\`
   - \`order\`
   - \`payment\`

## 输出要求
- 将清单写入任务参数中指定的输出文件（outputs 列出的绝对路径）。
- 文件格式：纯文本，每行一个模块名，共 3 行。
- 完成后回复一行：\`DONE: <输出路径>\`。
- 不要创建输出路径之外的任何文件。
`,
  },
]

// 骨架 README（仅缺失时写，不覆盖用户内容）
// Iter-27a：samples 转纯参考性质——仅供阅读的样例，不再被任何预置定义引用
//（items 样例已迁入 templates/items-demo/inputs/items/，原文件保留作参考）。
const SAMPLES_README = `# 样例文件（samples）

本目录为**纯参考性质**：仅供人阅读的样例文件，不被任何预置工作流定义引用，
工作流实例也不会使用本目录文件（Iter-27a 起）。

items/ 子目录为 items 结构化提取参考样例（Iter-26 引入；Iter-27a 起工作副本
迁入 templates/items-demo/inputs/items/，此处保留作参考）：
- modules.md（markdown 列表，标量 item）
- modules-table.md（markdown 表格，对象 item，列名=字段名）
- components.json（JSON 数组，对象 item）
- features.yaml（YAML 并列 map，键=id、标量值=名称）
`

const DOCS_README = `# 工作流文档（docs）

本目录存放工作流与技能的使用说明文档。
`

// Iter-27a：templates 子目录布局说明（仅缺失时写；含平铺 legacy 迁移说明——
// fs 服务无删除 API，旧平铺 <name>.yaml 残留靠本说明引导手工清理；下拉扫描已
// 同名去重且子目录赢，残留不影响功能）。
const TEMPLATES_README = `# 预定义工作流模板（templates）

Iter-27a 起每个预定义工作流占用**一个子目录**（自包含发布单元，互不影响发布）：

    templates/<工作流名>/
      <工作流名>.yaml    # 工作流定义（实例化时写为实例 instance.yaml）
      inputs/...         # 该工作流引用的静态文件（与实例目录同名同位）
      output/            # 可有可无（运行期产出目录，预置通常不放）

- 子目录结构与实例目录同构：create 实例化时整目录 1:1 复制，相对引用路径零调整。
- 静态文件引用必须使用**相对路径**且落在本子目录内（语义校验 Iter-27b 起强制；
  绝对路径仅限 create 时用户经 params 指定或人工调整实例定义时使用）。
- 兼容：平铺的 templates/<名>.yaml（旧布局）仍会列出；与子目录同名时**子目录赢**。
  旧平铺文件建议手工删除（本系统 fs 服务无删除 API，不做自动清理）。
`

// ── Iter-26：items 提取样例（samples/items/ 参考件；Iter-27a 起工作副本迁入
// templates/items-demo/inputs/items/，由 BUILTIN_TEMPLATE_FILES 物化）────────
// 四文件覆盖四种提取形态：markdown 列表（标量）/ markdown 表格（对象）/ JSON 数组（对象）/
// YAML 并列 map（键=id、标量值=name）。
const BUILTIN_SAMPLES = [
  {
    path: 'samples/items/modules.md',
    content: [
      '# 待评审模块清单（markdown 列表 → 标量 item）',
      '',
      '- login',
      '- order',
      '- payment',
      '',
    ].join('\n'),
  },
  {
    path: 'samples/items/modules-table.md',
    content: [
      '# 模块登记表（markdown 表格 → 对象 item，列名=字段名）',
      '',
      '| name | slug | priority |',
      '|------|------|----------|',
      '| 登录模块 | login | 1 |',
      '| 订单模块 | order | 2 |',
      '',
    ].join('\n'),
  },
  {
    path: 'samples/items/components.json',
    content: JSON.stringify([
      { id: 'api', name: 'API 网关', slug: 'api-gateway' },
      { id: 'auth', name: '认证中心', slug: 'auth-core' },
    ], null, 2) + '\n',
  },
  {
    path: 'samples/items/features.yaml',
    content: [
      '# 特性清单（YAML 并列 map：键=id 字段，标量值=name 字段）',
      'search: 搜索服务',
      'export: 导出服务',
      '',
    ].join('\n'),
  },
]

// ── Iter-27a：items-demo 模板静态文件（templates/items-demo/inputs/items/）──
// 模板子目录=实例级同构镜像：create 1:1 复制后实例相对引用零调整、自包含。
// 与 BUILTIN_SAMPLES 内容一致（工作副本 vs 参考件）。
const BUILTIN_TEMPLATE_FILES = [
  {
    path: 'templates/items-demo/inputs/items/modules.md',
    content: BUILTIN_SAMPLES[0].content,
  },
  {
    path: 'templates/items-demo/inputs/items/modules-table.md',
    content: BUILTIN_SAMPLES[1].content,
  },
  {
    path: 'templates/items-demo/inputs/items/components.json',
    content: BUILTIN_SAMPLES[2].content,
  },
  {
    path: 'templates/items-demo/inputs/items/features.yaml',
    content: BUILTIN_SAMPLES[3].content,
  },
]

// ── 预定义目录根：${DSH_HOME:-$HOME/.dsh}/workflow-agent ───────────────────
function detectPredefinedRoot() {
  let home = null
  try {
    if (typeof process !== 'undefined' && process.env && process.env.HOME) home = process.env.HOME
  } catch (e) { /* 非 Node 上下文忽略 */ }
  if (!home) {
    try {
      if (typeof require !== 'undefined') home = require('os').homedir()
    } catch (e) { /* require 不可用忽略 */ }
  }
  if (!home) return null
  let dshHome = null
  try {
    if (typeof process !== 'undefined' && process.env && process.env.DSH_HOME) dshHome = process.env.DSH_HOME
  } catch (e) { /* 忽略 */ }
  const base = (dshHome || (home.replace(/\/+$/, '') + '/.dsh')).replace(/\/+$/, '')
  return base + '/workflow-agent'
}

// ── 物化：幂等写入内建资产；任一失败不阻断其余 ─────────────────────────────
// fs：DSH fs 服务（writeText 自动创建父目录——与实例目录创建同语义）
// templates：BUILTIN_TEMPLATES（[{name, description, yaml}]；由调用方传入）
// 返回：{ ok, root, written[], failed[] } 或 { ok:false, reason }
async function materializeBuiltinAssets(fs, templates) {
  if (!fs) return { ok: false, reason: 'fs service unavailable' }
  const root = detectPredefinedRoot()
  if (!root) return { ok: false, reason: 'cannot locate home directory' }
  const written = []
  const failed = []

  async function ensureFile(rel, content, overwrite) {
    const target = root + '/' + rel
    try {
      if (!overwrite) {
        // 真实 fs.stat 契约：不存在返回 undefined（不抛错）；异常一律视为缺失继续写
        let existing = null
        try { existing = await fs.stat(await fs.resolve(target)) } catch (e) { existing = null }
        if (existing) return // 已存在且不覆盖 → 跳过
      }
      await fs.writeText(await fs.resolve(target), content)
      written.push(rel)
    } catch (e) {
      failed.push(rel + ': ' + (e && e.message ? e.message : String(e)))
    }
  }

  // 目录骨架（.gitkeep 触发父目录创建；预定义目录未来交 git 仓版本控制）
  for (const d of ['templates', 'skills', 'samples', 'docs']) {
    await ensureFile(d + '/.gitkeep', '', true)
  }
  // 内建模板（Iter-27a 子目录布局：templates/<name>/<name>.yaml；同名直接覆盖
  // ——升级策略 A2，版本控制未来交 git 仓）
  for (const t of (templates || [])) {
    if (!t || !t.name || !t.yaml) continue
    await ensureFile('templates/' + t.name + '/' + t.name + '.yaml', t.yaml, true)
  }
  // 内建技能（同名直接覆盖）
  for (const s of BUILTIN_SKILLS) {
    await ensureFile('skills/' + s.id + '/SKILL.md', s.content, true)
  }
  // templates/samples/docs 骨架 README（仅缺失时写；templates README 含子目录布局与迁移说明）
  await ensureFile('templates/README.md', TEMPLATES_README, false)
  await ensureFile('samples/README.md', SAMPLES_README, false)
  await ensureFile('docs/README.md', DOCS_README, false)
  // Iter-26：items 提取参考样例（samples/items/ 参考件，同名覆盖，升级可更新内容）
  for (const s of BUILTIN_SAMPLES) {
    await ensureFile(s.path, s.content, true)
  }
  // Iter-27a：items-demo 模板静态文件（templates/items-demo/inputs/items/ 工作副本，
  // 同名覆盖；与参考件内容一致）
  for (const f of BUILTIN_TEMPLATE_FILES) {
    await ensureFile(f.path, f.content, true)
  }

  return { ok: failed.length === 0, root, written, failed }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BUILTIN_SKILLS, BUILTIN_SAMPLES, BUILTIN_TEMPLATE_FILES, SAMPLES_README, DOCS_README, TEMPLATES_README, detectPredefinedRoot, materializeBuiltinAssets }
}
