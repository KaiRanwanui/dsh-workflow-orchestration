// ============================================================================
// workflow-agent — Host 模型工具
// 文件：code/plugins/workflow-host/tools.js
// 说明：注册工作流相关因果工具（Agent Loop 层调用端）：
//       - workflow_begin   ：解析并启动工作流（YAML 文本或路径）
//       - workflow_status  ：Agent 按编排进展上报状态
// 依赖：ctx（fs）、engine、storage、harness、schema/parser 常量（同作用域内联）。
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
// PARAM_PATTERN 由同作用域 schema 提供；独立加载时兜底
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

// ├── 工作流文件加载：优先 workflowPath（读文件），兜底 workflowText（直接用）
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
async function expandLoopTasks(fs, loopTask, items, itemVar, params) {
  const expanded = []
  const loopDeps = loopTask.dependsOn || []
  let prevId = null

  for (let i = 0; i < items.length; i++) {
    const item = String(items[i]).trim()
    if (!item) continue

    const iterParams = { ...params }
    iterParams[itemVar] = item

    const sanitized = item.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/^-+|-+$/g, '') || ('iter-' + i)
    const iterId = loopTask.id + '/' + sanitized

    expanded.push({
      id: iterId,
      name: (loopTask.name || loopTask.id) + ' - ' + item,
      type: 'llm-task',
      dependsOn: prevId ? [prevId] : loopDeps,
      timeout: loopTask.timeout || 600,
      processor: injectParams(loopTask.processor || '', iterParams),
      inputs: injectInputsMap(loopTask.inputsRaw || {}, iterParams),
      outputs: injectArray(loopTask.outputsRaw || [], iterParams),
      gate: loopTask.gate ? {
        checker: loopTask.gate.checker,
        onFailure: loopTask.gate.onFailure,
        maxRetries: loopTask.gate.maxRetries,
      } : null,
      _loopGroup: loopTask.id,
      _loopGroupName: loopTask.name || loopTask.id,
      _loopItem: item,
      _loopIndex: i,
    })
    prevId = iterId
  }

  return expanded
}

function registerWorkflowTools(ctx, harness, engine, storage) {
  const fs = ctx.get('fs')

  // ── workflow_begin ────────────────────────────────────────────────────────
  const beginTool = harness.defineTool({
    name: 'workflow_begin',
    description: '解析并启动一个工作流定义（YAML）。参数 workflowPath 为本机绝对路径；或传 workflowText 直接给 YAML 文本。可选 params 对象注入工作流级 ${param} 模板变量。可选 workspaceRoot（推荐：传会话工作区根，如 C:/Users/<user>/dsh_workspace）决定状态文件默认落盘位置 <root>/.workflow-agent/state.json；或直接传 statePath 完全指定状态文件路径。成功返回解析出的任务列表（含处理技能绝对路径、门禁配置）与初始 PENDING 状态；定义不合法时返回 errors 列表。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        workflowPath: { type: 'string', description: '工作流 YAML 的绝对路径' },
        workflowText: { type: 'string', description: '工作流 YAML 文本（与 workflowPath 二选一）' },
        workspaceRoot: { type: 'string', description: '状态落盘根目录（推荐会话工作区）；默认无则状态不落盘' },
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
    async execute(args) {
      try {
        if (!fs) throw new Error('fs service unavailable')
        if (args && args.workspaceRoot && storage) storage.setWorkspaceRoot(String(args.workspaceRoot))
        if (args && args.statePath && storage) storage.setStatePath(String(args.statePath))
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
            out.itemsFromRaw = t.itemsFromRaw
            out.itemVar = t.itemVar
          }
          return out
        }))
        parsed.tasks = tasks

        // ── 循环展开：将 loop Task 替换为 N 个串行迭代实例 ──
        const finalTasks = []
        for (const t of tasks) {
          if (t.type === 'loop' && t.itemsFrom && t.itemVar) {
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
  })
  harness.registerTool(ctx, beginTool)

  // ── workflow_status ───────────────────────────────────────────────────────
  const statusTool = harness.defineTool({
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
    async execute(args) {
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
  })
  harness.registerTool(ctx, statusTool)
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registerWorkflowTools, resolveRel, injectParams, expandLoopTasks }
}