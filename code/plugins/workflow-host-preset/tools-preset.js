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
function registerWorkflowToolsPreset(ctx, engine, storage) {
  const fs = ctx.get('fs')

  // ── workflow_begin ────────────────────────────────────────────────────────
  const beginTool = {
    name: 'workflow_begin',
    description: '解析并启动一个工作流定义（YAML）。参数 workflowPath 为本机绝对路径；或传 workflowText 直接给 YAML 文本。可选 params 对象注入工作流级 ${param} 模板变量。可选 workspaceRoot（推荐：传会话工作区根，如 C:/Users/<user>/dsh_workspace）决定状态文件默认落盘位置 <root>/.workflow-agent/state.json；或直接传 statePath 完全指定状态文件路径。未传 workspaceRoot 时自动使用当前会话工作区。成功返回解析出的任务列表（含处理技能绝对路径、门禁配置）与初始 PENDING 状态；定义不合法时返回 errors 列表。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        workflowPath: { type: 'string', description: '工作流 YAML 的绝对路径' },
        workflowText: { type: 'string', description: '工作流 YAML 文本（与 workflowPath 二选一）' },
        workspaceRoot: { type: 'string', description: '状态落盘根目录（默认取会话工作区）' },
        statePath: { type: 'string', description: '完全自定义的状态文件绝对路径（优先级高于 workspaceRoot）' },
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
      try {
        if (!fs) throw new Error('fs service unavailable')
        if (args && args.workspaceRoot && storage) storage.setWorkspaceRoot(String(args.workspaceRoot))
        if (args && args.statePath && storage) storage.setStatePath(String(args.statePath))
        // 未显式指定 workspaceRoot 时，从会话上下文取工作区
        if ((!args || !args.workspaceRoot) && storage) {
          const cwd = sessionCwd(exec)
          if (cwd) storage.setWorkspaceRoot(cwd)
        }
        const src = await loadWorkflowSource(fs, args)
        if (!src) throw new Error('需要 workflowPath 或 workflowText 参数')
        const parsed = parseWorkflow(src.text)
        const params = (args && args.params) || {}
        if (parsed.errors && parsed.errors.length > 0) {
          engine.setError('workflow 定义不合法: ' + parsed.errors.join('; '))
          await storage.save()
          const s = engine.snapshot()
          s.workflowBeginErrors = parsed.errors
          return s
        }
        // 注入 params + 解析相对路径为绝对路径
        const tasks = await Promise.all(parsed.tasks.map(async (t) => {
          const out = { ...t }
          out.inputs = injectInputsMap(t.inputsRaw, params)
          out.outputs = injectArray(t.outputsRaw, params)
          if (t.processorRaw) {
            const procRel = injectParams(t.processorRaw, params)
            out.processor = src.base ? await resolveRel(fs, src.base, procRel) : procRel
          }
          if (t.gateRaw) {
            const gateRel = injectParams(t.gateRaw, params)
            out.gate = {
              checker: src.base ? await resolveRel(fs, src.base, gateRel) : gateRel,
              onFailure: t.gateOnFailure,
              maxRetries: t.gateMaxRetries,
            }
          }
          if (t.itemsFromRaw) {
            const itemsRel = injectParams(t.itemsFromRaw, params)
            out.itemsFrom = src.base ? await resolveRel(fs, src.base, itemsRel) : itemsRel
            out.itemsFromRaw = t.itemsFromRaw // 保留原始值供循环展开二次注入
            out.itemVar = t.itemVar
          }
          return out
        }))
        parsed.tasks = tasks

        // ── 循环展开：将 loop Task 替换为 N 个串行迭代实例 ──
        const finalTasks = []
        for (const t of tasks) {
          if (t.type === 'loop' && t.itemsFrom && t.itemVar) {
            // 读取 items-from 文件
            const text = await fs.readText(await fs.resolve(t.itemsFrom))
            const items = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
            if (items.length === 0) {
              engine.setError('循环 Task "' + t.id + '" 的 items-from 文件为空: ' + t.itemsFrom)
              await storage.save()
              return engine.snapshot()
            }
            const iterations = await expandLoopTasks(fs, t, items, t.itemVar, params)
            finalTasks.push(...iterations)
          } else {
            finalTasks.push(t)
          }
        }
        parsed.tasks = finalTasks
        engine.begin(parsed)
        engine.setError(null)
        const r = await storage.save()
        engine.setPersist(r)
        return engine.snapshot()
      } catch (error) {
        engine.setError(error.message)
        await storage.save()
        return engine.snapshot()
      }
    },
  }
  ctx.tools.register(beginTool)

  // ── workflow_status ───────────────────────────────────────────────────────
  const statusTool = {
    name: 'workflow_status',
    description: '按编排进展更新工作流状态并同步持久化与 UI：stage（PENDING|RUNNING|COMPLETED|FAILED）、gateResult（PASS|FAIL）、task/tasktatus 更新单个任务（PENDING|RUNNING|DONE|FAILED|SKIPPED）、retries 重试计数、error 错误信息。每次调用返回最新快照。',
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
      try {
        if (!args) args = {}
        if (args.stage) engine.setStage(String(args.stage))
        if (args.gateResult) engine.setGateResult(String(args.gateResult))
        if (typeof args.retries === 'number') engine.setRetries(args.retries)
        if (args.error !== undefined) engine.setError(args.error ? String(args.error) : null)
        if (args.task && args.taskStatus) {
          engine.updateTask(String(args.task), { status: String(args.taskStatus) })
        }
        const r = await storage.save()
        engine.setPersist(r)
        return engine.snapshot()
      } catch (error) {
        engine.setError(error.message)
        return engine.snapshot()
      }
    },
  }
  ctx.tools.register(statusTool)
}

// 供 Node 独立验证（与宿主体内同构）：{ registerWorkflowToolsPreset, resolveRel, injectParams, injectArray, injectInputsMap, sessionCwd }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registerWorkflowToolsPreset, resolveRel, injectParams, injectArray, injectInputsMap, sessionCwd, expandLoopTasks }
}