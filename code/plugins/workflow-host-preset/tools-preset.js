// ============================================================================
// workflow-agent — Host 模型工具（preset 本地插件版）
// 文件：code/plugins/workflow-host-preset/tools-preset.js
// 说明：与 plugins/workflow-host/tools.js 相同的两个工具定义，但注册方式改为
//       ctx.tools.register（preset 本地 .mjs 插件形态，custom-bash.mjs /
//       dsh-tool-workflow 先例），而非动态插件的 harness.defineTool。
//       另外从 exec.agent.session.header.cwd 取会话工作区作为默认落盘根，
//       解决宿主插件无会话上下文时写错目录的问题。
// 依赖：ctx（fs/exec）、engine、storage、schema/parser 常量（同作用域内联）。
// ============================================================================

// ── 相对路径解析（复用 PoC 逐级上探逻辑）───────────────────────────────────
function parentDir(p) {
  const norm = p.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return null
  return norm.slice(0, idx)
}

// 从 YAML 所在目录逐级向上探测，取第一个真实存在的拼接；兜底用 YAML 目录
async function resolveRel(fs, base, rel) {
  let d = base
  while (d) {
    const cand = d + '/' + rel.replace(/\\/g, '/')
    try {
      const st = await fs.stat(await fs.resolve(cand))
      if (st) return cand
    } catch (e) { /* keep climbing */ }
    d = parentDir(d)
  }
  return base + '/' + rel.replace(/\\/g, '/')
}

// ── ${param} 注入 ───────────────────────────────────────────────────────────
// PARAM_PATTERN 默认由同作用域 schema 模块提供；独立加载（Node 直测）时兜底
let E_PARAM_PATTERN = typeof PARAM_PATTERN !== 'undefined' ? PARAM_PATTERN : /\$\{(\w+)\}/g
// parseWorkflow 兜底：mjs 内联作用域有同名函数；Node 单独 require 时从 shared 加载
let E_parseWorkflow = typeof parseWorkflow !== 'undefined'
  ? parseWorkflow
  : (typeof require !== 'undefined' ? require('../../shared/workflow-parser').parseWorkflow : null)
function injectParams(value, params) {
  if (typeof value !== 'string') return value
  return value.replace(E_PARAM_PATTERN, (whole, key) => {
    if (params && params[key] !== undefined) return String(params[key])
    return whole // 未提供则保留原样，由调用方提示
  })
}

function injectArray(list, params) {
  return (list || []).map((x) => injectParams(x, params))
}

// v1.1：命名式 inputs 注入。值为 string → 注入后返回 string；
// 值为 string[] → 逐项注入后返回 string[]。
function injectInputsMap(map, params) {
  const out = {}
  for (const k of Object.keys(map || {})) {
    const v = map[k]
    out[k] = Array.isArray(v) ? v.map((x) => injectParams(x, params)) : injectParams(v, params)
  }
  return out
}

// 工作流文件加载：优先 workflowPath（读文件），兜底 workflowText（直接用）
async function loadWorkflowSource(fs, args) {
  if (args.workflowPath) {
    const p = String(args.workflowPath)
    const text = await fs.readText(await fs.resolve(p))
    return { text, base: p.replace(/[\\/][^\\/]*$/, '') }
  }
  if (args.workflowText) {
    return { text: String(args.workflowText), base: undefined }
  }
  return null
}

// ── 实例快照 instance.yaml 的注释头剥离（Iter-11：start/reset 读取实例定义）──
// 头部由 beginInstance 生成：连续 '#' 注释行 + 一个空行。剥离后即纯 YAML 定义。
function stripInstanceHeader(text) {
  const lines = String(text || '').split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i].startsWith('#')) i++
  if (i > 0 && i < lines.length && lines[i].trim() === '') i++ // 头部结束空行
  return lines.slice(i).join('\n')
}

// 定义不合法错误（携带 workflowBeginErrors 数组，begin 路径保持既有契约）
function definitionError(errors) {
  const e = new Error('workflow 定义不合法: ' + errors.join('; '))
  e.workflowBeginErrors = errors
  return e
}

// ── 定义展开（Iter-11：begin/start/reset 共用）────────────────────────────
// src: { text, base }；params: 工作流级参数。返回 parsed（tasks 已注入参数、
// 解析相对路径、展开 loop/concurrent）。定义不合法或 items-from 为空时 throw。
async function expandDefinition(fs, src, params) {
  const parsed = E_parseWorkflow(src.text)
  if (parsed.errors && parsed.errors.length > 0) throw definitionError(parsed.errors)
  const p = params || {}
  const tasks = await Promise.all(parsed.tasks.map(async (t) => {
    const out = { ...t }
    out.inputs = injectInputsMap(t.inputsRaw, p)
    out.outputs = injectArray(t.outputsRaw, p)
    if (t.processorRaw) {
      const procRel = injectParams(t.processorRaw, p)
      out.processor = src.base ? await resolveRel(fs, src.base, procRel) : procRel
    }
    if (t.gateRaw) {
      const gateRel = injectParams(t.gateRaw, p)
      out.gate = {
        checker: src.base ? await resolveRel(fs, src.base, gateRel) : gateRel,
        onFailure: t.gateOnFailure,
        maxRetries: t.gateMaxRetries,
      }
    }
    if (t.itemsFromRaw) {
      const itemsRel = injectParams(t.itemsFromRaw, p)
      out.itemsFrom = src.base ? await resolveRel(fs, src.base, itemsRel) : itemsRel
      out.itemsFromRaw = t.itemsFromRaw // 保留原始值供循环展开二次注入
      out.itemVar = t.itemVar
    }
    return out
  }))
  parsed.tasks = tasks
  const finalTasks = []
  for (const t of tasks) {
    if (t.type === 'loop' && t.itemsFrom && t.itemVar) {
      const text = await fs.readText(await fs.resolve(t.itemsFrom))
      const items = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      if (items.length === 0) throw new Error('循环 Task "' + t.id + '" 的 items-from 文件为空: ' + t.itemsFrom)
      const iterations = await expandLoopTasks(fs, t, items, t.itemVar, p)
      finalTasks.push(...iterations)
    } else if (t.type === 'concurrent' && t.itemsFrom && t.itemVar) {
      const text = await fs.readText(await fs.resolve(t.itemsFrom))
      const items = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      if (items.length === 0) throw new Error('并发 Task "' + t.id + '" 的 items-from 文件为空: ' + t.itemsFrom)
      const iterations = await expandConcurrentTasks(fs, t, items, t.itemVar, p)
      finalTasks.push(...iterations)
    } else {
      finalTasks.push(t)
    }
  }
  parsed.tasks = finalTasks
  return parsed
}

// ── 循环展开：将 loop Task 展开为 N 个串行迭代实例 ────────────────────────
// items 参数：从 items-from 文件解析出的非空非注释行数组
// itemVar：迭代变量名（如 "module"），在 inputs/outputs 中解决 ${itemVar}
// params：已注入的工作流级参数
// loopTask：原始 loop Task 对象（含 inputsRaw/outputsRaw/processor/gate/dependsOn）
// prevDeps：【内部使用】前一个迭代的 id，用于构建串行依赖链
async function expandLoopTasks(fs, loopTask, items, itemVar, params) {
  const expanded = []
  const loopDeps = loopTask.dependsOn || []
  let prevId = null

  for (let i = 0; i < items.length; i++) {
    const item = String(items[i]).trim()
    if (!item) continue

    // 构建迭代参数（工作流 params + 当前 item）
    const iterParams = { ...params }
    iterParams[itemVar] = item

    // 安全 ID：loopTaskId/sanitized-item
    const sanitized = item.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/^-+|-+$/g, '') || ('iter-' + i)
    const iterId = loopTask.id + '/' + sanitized

    // inputs/outputs 重新注入（含 item 变量）
    const iterInputs = injectInputsMap(loopTask.inputsRaw || {}, iterParams)
    const iterOutputs = injectArray(loopTask.outputsRaw || [], iterParams)

    // processor 路径重新注入（含 item 变量——虽然通常不变）
    const iterProcessor = injectParams(loopTask.processor || '', iterParams)

    // gate 复制（同一 checker，独立执行）
    const iterGate = loopTask.gate ? {
      checker: loopTask.gate.checker,
      onFailure: loopTask.gate.onFailure,
      maxRetries: loopTask.gate.maxRetries,
    } : null

    expanded.push({
      id: iterId,
      name: (loopTask.name || loopTask.id) + ' - ' + item,
      type: 'llm-task',
      dependsOn: prevId ? [prevId] : loopDeps,
      timeout: loopTask.timeout || 600,
      processor: iterProcessor,
      inputs: iterInputs,
      outputs: iterOutputs,
      gate: iterGate,
      // 循环错误处理策略
      _onError: loopTask.onError || 'break',
      // 循环组元数据（供 Client DAG 分组渲染）
      _loopGroup: loopTask.id,
      _loopGroupName: loopTask.name || loopTask.id,
      _loopItem: item,
      _loopIndex: i,
    })
    prevId = iterId
  }

  return expanded
}

// Iter-8：并发展开——对 items 的每个 item 生成一个独立迭代，迭代之间无依赖（可并发，受组级 max 约束）
async function expandConcurrentTasks(fs, task, items, itemVar, params) {
  const expanded = []
  const loopDeps = task.dependsOn || []
  const gMax = task.maxConcurrency || items.length // 组级并发（默认 items 数量，全部并发）

  for (let i = 0; i < items.length; i++) {
    const item = String(items[i]).trim()
    if (!item) continue

    const iterParams = { ...params }
    iterParams[itemVar] = item

    const sanitized = item.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/^-+|-+$/g, '') || ('iter-' + i)
    const iterId = task.id + '/' + sanitized

    const iterInputs = injectInputsMap(task.inputsRaw || {}, iterParams)
    const iterOutputs = injectArray(task.outputsRaw || [], iterParams)
    const iterProcessor = injectParams(task.processor || '', iterParams)

    const iterGate = task.gate ? {
      checker: task.gate.checker,
      onFailure: task.gate.onFailure,
      maxRetries: task.gate.maxRetries,
    } : null

    expanded.push({
      id: iterId,
      name: (task.name || task.id) + ' - ' + item,
      type: 'llm-task',
      dependsOn: loopDeps, // ← 关键：无串行依赖链，都依赖原始前驱 → 可并发
      timeout: task.timeout || 600,
      processor: iterProcessor,
      inputs: iterInputs,
      outputs: iterOutputs,
      gate: iterGate,
      // 并发组元数据（Client DAG 分组渲染 + engine 组级并发控制）
      _concurrentGroup: task.id,
      _concurrentGroupName: task.name || task.id,
      _concurrentItem: item,
      _concurrentIndex: i,
      _concurrentMax: gMax,
    })
  }

  return expanded
}

// 从工具执行上下文取会话工作区（preset 挂载后 exec.agent 可用）
function sessionCwd(exec) {
  try {
    const cwd = exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
  } catch (e) {
    return undefined
  }
}

// 注册工具：preset 本地插件形态（ctx.tools.register），不依赖 harness
// Iter-10：新增 registry 参数（instance-store 的 createInstanceRegistry 产物）。
//   - 会话上下文 + 无显式 statePath/workspaceRoot 参数 → 实例布局：
//     begin 时创建实例目录并绑定新 engine/storage；status 时按会话取活跃实例
//     （重启后惰性 hydrate）。快照附 instanceId 供调用方/前端识别。
//   - 显式 statePath/workspaceRoot 参数或无会话上下文 → 回退单实例绑定
//     （engine/storage 形参，保持既有行为与旧布局兼容）。
function registerWorkflowToolsPreset(ctx, engine, storage, registry) {
  const fs = ctx.get('fs')

  // ── 每次工具调用解析绑定的引擎/存储（避免跨会话闭包串扰，多会话并行安全）──
  async function bind(exec, args) {
    if (args && (args.statePath || args.workspaceRoot)) {
      return { engine, storage, instanceId: null }
    }
    if (registry) {
      const entry = await registry.forSession(exec)
      if (entry) return { engine: entry.engine, storage: entry.storage, instanceId: entry.instanceId }
    }
    return { engine, storage, instanceId: null }
  }

  function withInstanceId(snapshot, b) {
    if (b && b.instanceId) snapshot.instanceId = b.instanceId
    return snapshot
  }

  // ── workflow_begin ────────────────────────────────────────────────────────
  const beginTool = {
    name: 'workflow_begin',
    description: '解析并启动一个工作流定义（YAML）。参数 workflowPath 为本机绝对路径；或传 workflowText 直接给 YAML 文本。可选 params 对象注入工作流级 ${param} 模板变量。可选 workspaceRoot / statePath 指定状态落盘位置（兼容旧单实例布局）；默认在当前会话工作区创建实例目录 <cwd>/.workflow-agent/instances/<workflowName-uuid8>/（instance.yaml/state.json/metadata.json/output/logs），状态写入实例目录。成功返回解析出的任务列表（含处理技能绝对路径、门禁配置、instanceId）与初始 PENDING 状态；定义不合法时返回 errors 列表。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        workflowPath: { type: 'string', description: '工作流 YAML 的绝对路径' },
        workflowText: { type: 'string', description: '工作流 YAML 文本（与 workflowPath 二选一）' },
        workspaceRoot: { type: 'string', description: '（兼容旧布局）状态落盘根目录；默认走实例目录布局' },
        statePath: { type: 'string', description: '（兼容旧布局）完全自定义的状态文件绝对路径' },
        params: {
          type: 'object',
          additionalProperties: true,
          description: '工作流参数，替换字段中的 ${param_name}',
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) {
        return [{ type: 'text', text: JSON.stringify(v, null, 2) }]
      },
    },
    async execute(args, exec) {
      // 初始绑定（错误路径也要能落盘）
      let b = await bind(exec, args)
      try {
        if (!fs) throw new Error('fs service unavailable')
        if (args && args.workspaceRoot && b.storage) b.storage.setWorkspaceRoot(String(args.workspaceRoot))
        if (args && args.statePath && b.storage) b.storage.setStatePath(String(args.statePath))
        // 未显式指定 workspaceRoot 时，从会话上下文取工作区（legacy 单实例布局落点）
        if ((!args || !args.workspaceRoot) && b.storage) {
          const cwd = sessionCwd(exec)
          if (cwd) b.storage.setWorkspaceRoot(cwd)
        }
        const src = await loadWorkflowSource(fs, args)
        if (!src) throw new Error('需要 workflowPath 或 workflowText 参数')
        const params = (args && args.params) || {}
        let parsed
        try {
          parsed = await expandDefinition(fs, src, params)
        } catch (e) {
          if (e && e.workflowBeginErrors) {
            // 保持既有契约：解析错误经快照 workflowBeginErrors 字段返回
            b.engine.setError(e.message)
            await b.storage.save()
            const s = b.engine.snapshot()
            s.workflowBeginErrors = e.workflowBeginErrors
            return withInstanceId(s, b)
          }
          throw e
        }

        // ── Iter-10：多实例布局——成功路径创建实例目录并切换绑定 ──
        // （解析/展开失败不建实例目录；显式 statePath/workspaceRoot 参数走旧布局）
        if (registry && !args.statePath && !args.workspaceRoot) {
          const cwd = sessionCwd(exec)
          if (cwd) {
            const entry = await (registry.sessionIdOf(exec)
              ? registry.createBind(cwd, registry.sessionIdOf(exec), { // Iter-19：1:1 + CONFLICT 自愈
                workflowName: parsed.name,
                sourceText: src.text,
                sourcePath: args.workflowPath || null,
                params,
              })
              : registry.beginInstance({ cwd, sessionId: null, workflowName: parsed.name, sourceText: src.text, sourcePath: args.workflowPath || null, params }))
            b = { engine: entry.engine, storage: entry.storage, instanceId: entry.instanceId, recoveredConflict: entry._recoveredConflict || [] }
          }
        }

        b.engine.begin(parsed)
        b.engine.start() // Iter-19：begin 后即视为执行中 → RUNNING（与状态机一致）
        b.engine.setError(null)
        const r = await b.storage.save()
        b.engine.setPersist(r)
        const beginSnap = withInstanceId(b.engine.snapshot(), b)
        if (b.recoveredConflict && b.recoveredConflict.length > 0) beginSnap.recoveredConflict = b.recoveredConflict
        return beginSnap
      } catch (error) {
        b.engine.setError(error.message)
        await b.storage.save()
        return withInstanceId(b.engine.snapshot(), b)
      }
    },
  }
  ctx.tools.register(beginTool)

  // ── workflow_status ───────────────────────────────────────────────────────
  const statusTool = {
    name: 'workflow_status',
    description: '按编排进展更新工作流状态并同步持久化与 UI：stage（PENDING|RUNNING|COMPLETED|FAILED）、gateResult（PASS|FAIL）、task/tasktatus 更新单个任务（PENDING|RUNNING|DONE|FAILED|SKIPPED）、retries 重试计数、error 错误信息。状态写入当前会话活跃实例目录的 state.json（重启后自动从实例目录恢复）。每次调用返回最新快照（含 instanceId）。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        stage: { type: 'string', description: '全局阶段' },
        gateResult: { type: 'string', description: '门禁结果 PASS 或 FAIL' },
        task: { type: 'string', description: '要更新的任务 id' },
        taskStatus: { type: 'string', description: '该任务状态' },
        retries: { type: 'number', description: '失败重试计数' },
        error: { type: 'string', description: '错误信息' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) {
        return [{ type: 'text', text: JSON.stringify(v, null, 2) }]
      },
    },
    async execute(args, exec) {
      const b = await bind(exec, args)
      try {
        if (!args) args = {}
        if (args.stage) b.engine.setStage(String(args.stage))
        if (args.gateResult) b.engine.setGateResult(String(args.gateResult))
        if (typeof args.retries === 'number') b.engine.setRetries(args.retries)
        if (args.error !== undefined) b.engine.setError(args.error ? String(args.error) : null)
        if (args.task && args.taskStatus) {
          b.engine.updateTask(String(args.task), { status: String(args.taskStatus) })
        }
        const r = await b.storage.save()
        b.engine.setPersist(r)
        return withInstanceId(b.engine.snapshot(), b)
      } catch (error) {
        b.engine.setError(error.message)
        return withInstanceId(b.engine.snapshot(), b)
      }
    },
  }
  ctx.tools.register(statusTool)

  // ══ Iter-11：实例操控工具（操作当前会话工作区下的实例目录）══════════════
  // 定位语义：显式 instanceId → 本 cwd 实例目录精确解析；缺省 → 会话活跃实例。
  // 实例运行状态记实例目录 state.json；实例选择/切换由 DSH session 列表承担
  // （设计文档 §5.4）。

  // 实例定义的相对路径解析基目录（优先原始源定义所在目录）
  function instanceSourceBase(meta) {
    const sp = meta && meta.sourcePath
    if (sp && sp !== '(inline workflowText)') return sp.replace(/[\\/][^\\/]*$/, '')
    return undefined
  }

  // 读取实例 instance.yaml 并展开为 parsed（start/reset 共用）
  async function expandInstanceDefinition(entry) {
    const raw = await fs.readText(await fs.resolve(entry.dir + '/instance.yaml'))
    const text = stripInstanceHeader(raw)
    const params = (entry.meta && entry.meta.params) || {}
    return expandDefinition(fs, { text, base: instanceSourceBase(entry.meta) }, params)
  }

  // 条目是否有已落盘运行状态（一律以磁盘 state.json 为准，避免内存标记过期）
  async function entryStateOnDisk(entry) {
    try {
      const st = JSON.parse(await fs.readText(await fs.resolve(entry.dir + '/state.json')))
      return !!(st && st.workflow)
    } catch (e) {
      return false
    }
  }

  function errPayload(e) {
    const out = { error: (e && e.message) || String(e) }
    if (e && e.workflowBeginErrors) out.workflowBeginErrors = e.workflowBeginErrors
    return out
  }

  // ── workflow_list ─────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_list',
    description: '列出当前会话工作区下的全部 workflow 实例（按创建时间倒序）。phase=CREATED 表示仅创建未启动；READY 表示已有运行状态（stage/task 计数）。返回 {cwd, instances[], activeInstanceId}。',
    parameters: { type: 'object', additionalProperties: true, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        const cwd = registry.sessionCwdOf(exec)
        if (!cwd) throw new Error('无会话工作区（实例按 session cwd 隔离）')
        const instances = await registry.listInstances(cwd)
        const sid = registry.sessionIdOf(exec)
        // Iter-18：派生当前会话状态 UNBOUND/BOUND/DONE/BROKEN + 孤儿扫描提示
        let sessionState = null
        if (sid) sessionState = await registry.deriveSessionState(cwd, sid)
        const orphans = await registry.scanOrphans(cwd)
        const out = { cwd, instances, activeInstanceId: (sid && registry.activeIdFor(sid)) || null }
        if (sid) out.sessionState = sessionState
        if (orphans.length > 0) out.orphans = orphans.map(o => o.id)
        return out
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_create ───────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_create',
    description: '从工作流定义（workflowPath 或 workflowText）+ params 创建 workflow 实例目录（instance.yaml/metadata.json/output/logs），校验定义但不启动执行。返回 {instanceId, dir, workflowName, phase:"CREATED"}。启动用 workflow_start。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        workflowPath: { type: 'string', description: '工作流 YAML 的绝对路径' },
        workflowText: { type: 'string', description: '工作流 YAML 文本（与 workflowPath 二选一）' },
        params: { type: 'object', additionalProperties: true, description: '工作流参数快照（启动时复用）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        if (!fs) throw new Error('fs service unavailable')
        const cwd = registry.sessionCwdOf(exec)
        if (!cwd) throw new Error('无会话工作区（实例必须在会话工作区内创建）')
        const src = await loadWorkflowSource(fs, args)
        if (!src) throw new Error('需要 workflowPath 或 workflowText 参数')
        const parsed = E_parseWorkflow(src.text)
        if (parsed.errors && parsed.errors.length > 0) throw definitionError(parsed.errors)
        const entry = await (registry.sessionIdOf(exec)
          ? registry.createBind(cwd, registry.sessionIdOf(exec), { // Iter-19：1:1 + CONFLICT 自愈
            workflowName: parsed.name,
            sourceText: src.text,
            sourcePath: args.workflowPath || null,
            params: args.params || {},
          })
          : registry.beginInstance({ cwd, sessionId: null, workflowName: parsed.name, sourceText: src.text, sourcePath: args.workflowPath || null, params: args.params || {} }))
        return { instanceId: entry.instanceId, dir: entry.dir, workflowName: parsed.name, phase: 'CREATED', cwd, recoveredConflict: entry._recoveredConflict || [] }
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_start ────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_start',
    description: '启动一个已存在的 workflow 实例：读实例 instance.yaml → 解析展开 → 引擎置 PENDING → 写实例 state.json → 返回任务列表与 runnable（编排循环起点）。缺省 instanceId 时用当前会话活跃实例。RUNNING 中的实例会拒绝（先 stop 或 reset）。返回快照含 instanceId。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '实例 id（缺省=当前会话活跃实例）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        if (!fs) throw new Error('fs service unavailable')
        const entry = await registry.resolveEntry(exec, args && args.instanceId, { active: true })
        if (!entry) throw new Error('实例不存在' + (args && args.instanceId ? ': ' + args.instanceId : '（且当前会话无活跃实例，可先 workflow_create 或传 instanceId）'))
        // Iter-18：start 须会话已认领实例（UNBOUND→先 adopt；异会话→1:1 拒）
        const sessId = registry.sessionIdOf(exec)
        if (sessId && entry.meta.sessionId !== sessId) {
          if (!entry.meta.sessionId) throw new Error('实例 ' + entry.instanceId + ' 未绑定本会话；先用 workflow_adopt 采用')
          throw new Error('实例 ' + entry.instanceId + ' 已被会话 ' + entry.meta.sessionId + ' 占用（1:1），本会话不可启动')
        }
        // 状态机守卫
        const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
        if (stage === 'RUNNING') throw new Error('实例 ' + entry.instanceId + ' 正在运行中（stage=RUNNING）')
        if (stage === 'STOPPED') throw new Error('实例 ' + entry.instanceId + ' 已停止；用 workflow_resume 续跑')
        if (stage === 'COMPLETED' || stage === 'FAILED') throw new Error('实例 ' + entry.instanceId + ' 已完成/失败（stage=' + stage + '）；用 workflow_reset 重跑')
        if (!entry.hasState) {
          const parsed = await expandInstanceDefinition(entry)
          entry.engine.begin(parsed)
        }
        entry.engine.setError(null)
        entry.engine.start() // Iter-18：PENDING→RUNNING（引擎守卫仅 PENDING）
        const r = await entry.storage.save()
        entry.engine.setPersist(r)
        entry.hasState = true
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_stop ─────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_stop',
    description: '停止一个 workflow 实例：stage 置 STOPPED 并落盘实例 state.json（编排 Agent 看到 STOPPED 后不再推进）。缺省 instanceId 时用当前会话活跃实例。CREATED 未启动的实例无需停止。返回快照含 instanceId。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '实例 id（缺省=当前会话活跃实例）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        const entry = await registry.resolveEntry(exec, args && args.instanceId)
        if (!entry) throw new Error('实例不存在' + (args && args.instanceId ? ': ' + args.instanceId : '（且当前会话无活跃实例）'))
        if (!(await entryStateOnDisk(entry))) throw new Error('实例 ' + entry.instanceId + ' 尚未启动（CREATED），无需停止')
        entry.engine.stop() // Iter-18：仅 RUNNING→STOPPED（保进度，active=false）
        const r = await entry.storage.save()
        entry.engine.setPersist(r)
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_reset ────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_reset',
    description: '重置一个 workflow 实例并可直接重跑：从实例 instance.yaml 重新解析展开 → 引擎全新 PENDING → 覆盖实例 state.json → metadata 记 lastResetAt → 返回新快照与 runnable（等效清空状态重跑；output/logs 产物文件保留，同名输出会被覆盖）。缺省 instanceId 时用当前会话活跃实例。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '实例 id（缺省=当前会话活跃实例）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        if (!fs) throw new Error('fs service unavailable')
        const cwd = registry.sessionCwdOf(exec)
        if (!cwd) throw new Error('无会话工作区')
        const entry = await registry.resolveEntry(exec, args && args.instanceId, { active: true })
        if (!entry) throw new Error('实例不存在' + (args && args.instanceId ? ': ' + args.instanceId : '（且当前会话无活跃实例）'))
        // Iter-18：reset 仅 STOPPED/COMPLETED/FAILED（PENDING/CREATED/RUNNING 拒）
        const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
        if (stage === 'RUNNING') throw new Error('reset 仅允许 STOPPED/COMPLETED/FAILED；RUNNING 先 workflow_stop')
        if (stage === 'CREATED' || stage === 'PENDING') throw new Error('reset 仅允许 STOPPED/COMPLETED/FAILED（当前 ' + stage + '）')
        // Iter-18：先写 reset 归档备份（<ts>_reset_<state>/），再 engine.reset()
        const backupDir = await registry.writeArchiveBackup(cwd, entry.instanceId, 'reset', (stage || 'UNKNOWN'))
        // Iter-22：reset 不依赖内存 state.def（hydrate 不恢复 def，历史/重启/hydrate-only 实例
        // 必无 def）——从 instance.yaml 重新解析展开定义再重置，任意可 reset 实例都能重跑。
        const parsed = await expandInstanceDefinition(entry)
        entry.engine.resetWithDefinition(parsed) // → 全新 PENDING
        entry.engine.setError(null)
        const r = await entry.storage.save()
        entry.engine.setPersist(r)
        await registry.patchMeta(cwd, entry.instanceId, { lastResetAt: new Date().toISOString() })
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        snap.resetNote = '状态已重置（output/logs 产物保留，同名文件将被覆盖）'
        snap.resetBackup = backupDir
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_resume（Iter-18 新增：仅 STOPPED 续跑）────────────────────────
  ctx.tools.register({
    name: 'workflow_resume',
    description: '续跑一个已停止（STOPPED）的 workflow 实例：engine.resume() 从已存 state.json hydrate 续跑保进度（保 DONE）→ RUNNING。缺省 instanceId 用当前会话活跃实例。仅 STOPPED 可 resume；PENDING/RUNNING/COMPLETED/FAILED 拒绝。返回快照含 instanceId。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '实例 id（缺省=当前会话活跃实例）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        const entry = await registry.resolveEntry(exec, args && args.instanceId)
        if (!entry) throw new Error('实例不存在' + (args && args.instanceId ? ': ' + args.instanceId : '（且当前会话无活跃实例）'))
        if (!(await entryStateOnDisk(entry))) throw new Error('实例 ' + entry.instanceId + ' 尚未启动（CREATED），无进度可续跑')
        const stage = entry.engine.snapshot().stage
        if (stage !== 'STOPPED') throw new Error('resume 仅允许 STOPPED（当前 ' + stage + '）')
        entry.engine.resume() // STOPPED→RUNNING，保 DONE
        const r = await entry.storage.save()
        entry.engine.setPersist(r)
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_adopt（Iter-18 新增：采用池中 UNBOUND 实例并绑定本会话）────────
  ctx.tools.register({
    name: 'workflow_adopt',
    description: '采用一个池中 UNBOUND（sessionId==null）的 workflow 实例并绑定到当前会话（1:1 守卫；RUNNING 实例先 stop 再采用）。须传 instanceId。返回实例快照含 instanceId 与 adopted=true。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '要采用的实例 id（必填）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        if (!fs) throw new Error('fs service unavailable')
        const cwd = registry.sessionCwdOf(exec)
        if (!cwd) throw new Error('无会话工作区（实例必须在会话工作区内采用）')
        if (!(args && args.instanceId)) throw new Error('workflow_adopt 须传 instanceId')
        const sessId = registry.sessionIdOf(exec)
        if (!sessId) throw new Error('无会话 id，无法绑定实例')
        const entry = await registry.adoptInstance(cwd, sessId, args.instanceId)
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        snap.adopted = true
        snap.meta = entry.meta
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })
}

// 供 Node 独立验证（与宿主体内同构）：{ registerWorkflowToolsPreset, resolveRel, injectParams, injectArray, injectInputsMap, sessionCwd }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registerWorkflowToolsPreset, resolveRel, injectParams, injectArray, injectInputsMap, sessionCwd, expandLoopTasks, expandConcurrentTasks, stripInstanceHeader, expandDefinition, definitionError }
}