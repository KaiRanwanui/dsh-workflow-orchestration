// ============================================================================
// SD Workflow Dashboard — PoC 最终版插件源码固化
// ============================================================================
// 来源：Desktop 迁移验证（session 动态 Cordis 插件 swd-1，最终包 pkg-7）
// 用途：软件设计工作流 PoC 的呈现层（Dashboard）代码基线，正式版从此起步。
//
// 【如何运行本代码】
// 这是 Cordis 动态插件的两个半边（Host / Client）函数体，原样取自
// cordis_define 的 code.host / code.client。要重新挂载，在 DSH 会话中
// 用 cordis_define 提交本文件两个函数体，再 cordis_run 激活。
// 正式版则应把它打包为 npm 插件（dsh plugin --profile desktop add ...），
// 使进程重启后自动加载。
//
// 【v2（pkg-7）相对 v1（pkg-1 重建版）的变化】
//   1. 挂载点：conversation.input.dock（输入条上方面板）→ conversation.view
//      （会话顶部 Tab，与「聊天 / 轨迹」并列，label "工作流"）。
//   2. 布局：上下两栏 —— 上栏横向 SVG DAG（节点+箭头+状态行），
//      下栏展示选中节点的 skill 文本（点击节点触发 wf:skill RPC 读取）。
//   3. Host 增强：workflow_begin 预载每个节点 processor skill 全文
//      （t.skillText / insts.gateSkill）；新增 wf:skill RPC。
//   4. 闪烁根治（用户实测验证）：LLM 执行时会话快照高频更新导致父级把
//      conversation.view 组件整体卸载重挂（remount），组件内 useState 清零，
//      视觉表现为闪"连接中"。修复 = 状态外置到 apply 级模块数据层
//      （latest + listeners + 单例轮询），组件只做订阅式投影：挂载即得最新
//      数据、卸载仅注销监听，重挂无感。指纹防抖下沉到模块层（fingerprint
//      相同则跳过通知，杜绝无谓重渲染）。
//   5. 边界（沿用 v1 已验证）：Host 侧无会话上下文，fs 写入必须显式传
//      sandboxPolicy 指定 workspaceRoot；harness.defineTool schema 注意
//      additionalProperties 显式化、parameters 根开放；React hook 必须在
//      条件 return 之前全部调用（否则 Minified React error #310）。
// ============================================================================

// ---------------------------------------------------------------------------
// code.host —— Host 半边：工具 + RPC + 状态存储（内存 + 持久化）
// ---------------------------------------------------------------------------
module.exports = {
  host: function host() {
    return {
      inject: ['timer', 'fs'],
      apply(ctx) {
        const WORKSPACE = 'C:/Users/ranwa/dsh_workspace'
        const STATE_PATH = WORKSPACE + '/.swd-workflow-state.json'
        const insts = {
          workflow: null,
          tasks: [],
          stage: 'PENDING',
          gateResult: null,
          retries: 0,
          error: null,
          updatedAt: 0,
          persist: null,
          // p7：hydrateSkills 预载的技能文本（不进持久化，只进内存）
          gateSkill: null,
        }

        // p7：Client 防抖依赖的稳定指纹 —— 只有展示相关字段变化时才变化
        function fingerprint() {
          const t = insts.tasks.map((x) => x.id + ':' + x.status).join(',')
          return [insts.stage, insts.gateResult || '', insts.retries, t].join('|')
        }

        function snapshot() {
          return {
            workflow: insts.workflow,
            tasks: insts.tasks.map((t) => ({ id: t.id, name: t.name, status: t.status })),
            stage: insts.stage,
            gateResult: insts.gateResult,
            retries: insts.retries,
            error: insts.error,
            updatedAt: insts.updatedAt,
            persist: insts.persist,
            fingerprint: fingerprint(),
          }
        }

        // Host 插件无会话上下文，fs 沙箱默认按 deployment root 判定 workshop；
        // 必须显式传 sandboxPolicy 把 workspaceRoot 指到会话工作区才能写入。
        const WRITE_POLICY = { mode: 'workspace-write', workspaceRoot: WORKSPACE }

        async function saveState() {
          const fs = ctx.get('fs')
          if (!fs) return 'err: no fs'
          try {
            const t = await fs.resolve(STATE_PATH)
            await fs.writeText(
              t,
              JSON.stringify({
                workflow: insts.workflow,
                tasks: insts.tasks,
                stage: insts.stage,
                gateResult: insts.gateResult,
                retries: insts.retries,
                updatedAt: insts.updatedAt,
              }),
              undefined,
              undefined,
              WRITE_POLICY,
            )
            return 'ok'
          } catch (e) {
            return 'err: ' + ((e && e.message) || String(e))
          }
        }

        async function loadState() {
          const fs = ctx.get('fs')
          if (!fs) return
          try {
            const t = await fs.resolve(STATE_PATH)
            const text = await fs.readText(t)
            const j = JSON.parse(text)
            if (j && j.workflow) {
              insts.workflow = j.workflow
              insts.tasks = Array.isArray(j.tasks) ? j.tasks : []
              insts.stage = j.stage || 'PENDING'
              insts.gateResult = j.gateResult || null
              insts.retries = j.retries || 0
              insts.updatedAt = Date.now()
            }
          } catch (e) { /* no previous state */ }
        }

        loadState()

        function parentDir(p) {
          const norm = p.replace(/\\/g, '/')
          const idx = norm.lastIndexOf('/')
          if (idx <= 0) return null
          return norm.slice(0, idx)
        }

        // YAML 内相对路径按“工程根”书写（如 PoC/skills/...），而非 YAML 所在目录；
        // 从 YAML 目录逐级向上探测，取第一个真实存在的拼接，兜底用 YAML 目录。
        async function resolveRel(base, rel) {
          const fs = ctx.get('fs')
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

        function parseWorkflow(text) {
          const name = /\n?name:\s*["']?([^\n"']+)/.exec(text)
          const tasks = []
          const blocks = text.split(/^\s*-\s*id:/m).slice(1)
          for (const block of blocks) {
            const id = /^\s*([A-Za-z0-9_-]+)/.exec(block)
            const nameMatch = /name:\s*["']?([^\n"']+)/.exec(block)
            const processor = /processor:\s*(\S+)/.exec(block)
            const checker = /checker:\s*(\S+)/.exec(block)
            const maxRetries = /max-retries:\s*(\d+)/.exec(block)
            if (!id) continue
            tasks.push({
              id: id[1].trim(),
              name: nameMatch ? nameMatch[1].trim() : id[1].trim(),
              processorRaw: processor ? processor[1].trim().replace(/["']/g, '') : null,
              gateRaw: checker ? checker[1].trim().replace(/["']/g, '') : null,
              maxRetries: maxRetries ? Number(maxRetries[1]) : 0,
              status: 'PENDING',
            })
          }
          return { name: name ? name[1].trim() : 'unnamed-workflow', tasks }
        }

        async function loadWorkflow(path) {
          const fs = ctx.get('fs')
          if (!fs) throw new Error('fs service unavailable')
          const p = String(path)
          const text = await fs.readText(await fs.resolve(p))
          const base = p.replace(/[\\/][^\\/]*$/, '')
          const wf = parseWorkflow(text, base)
          for (const t of wf.tasks) {
            if (t.processorRaw) t.processor = await resolveRel(base, t.processorRaw)
            if (t.gateRaw) t.gate = await resolveRel(base, t.gateRaw)
          }
          return wf
        }

        // p7：skill 文本读取（下栏展示用）
        async function readSkillText(path) {
          const fs = ctx.get('fs')
          if (!fs || !path) return '（未配置技能文件）'
          try {
            return await fs.readText(await fs.resolve(String(path)))
          } catch (e) {
            return '（技能文件不可读: ' + path + '）'
          }
        }

        async function hydrateSkills() {
          for (const t of insts.tasks) {
            if (t.skillText === undefined) t.skillText = await readSkillText(t.processor)
          }
          if (insts.tasks.length > 0 && insts.tasks[0].gate) {
            if (insts.gateSkill === undefined) insts.gateSkill = await readSkillText(insts.tasks[0].gate)
          }
        }

        harness.handle('wf:status', async () => snapshot())

        // p7：Client 下栏选中节点时查询其 skill 文本
        harness.handle('wf:skill', async (req) => {
          const id = req && req.id
          if (id === 'gate') {
            return { id: 'gate', name: '质量门禁', text: insts.gateSkill || '（门禁技能未加载）' }
          }
          const t = insts.tasks.find((x) => x.id === id)
          if (!t) return { id, name: id, text: '（未找到节点 ' + id + '）' }
          return { id: t.id, name: t.name, text: t.skillText || '（技能未加载）' }
        })

        harness.registerTool(ctx, harness.defineTool({
          name: 'workflow_begin',
          description: '解析并启动一个软件设计工作流定义（YAML），初始化 DAG 状态为 PENDING，并预加载每个节点的技能文本供 UI 展示。参数 workflowPath 必须是本机绝对路径。返回解析出的任务列表（含处理技能与门禁技能的绝对路径）与初始状态。',
          parameters: {
            type: 'object',
            properties: {
              workflowPath: { type: 'string', description: '工作流 YAML 的绝对路径' },
            },
            required: ['workflowPath'],
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
          },
          async execute(args) {
            try {
              const wf = await loadWorkflow(String(args.workflowPath))
              insts.workflow = wf.name
              insts.tasks = wf.tasks.map((t) => ({ ...t }))
              insts.stage = 'PENDING'
              insts.gateResult = null
              insts.retries = 0
              insts.error = null
              insts.updatedAt = Date.now()
              await hydrateSkills()
              insts.persist = await saveState()
              return snapshot()
            } catch (error) {
              insts.error = error.message
              insts.persist = await saveState()
              return snapshot()
            }
          },
        }))

        harness.registerTool(ctx, harness.defineTool({
          name: 'workflow_status',
          description: '按编排进展更新工作流状态并同步 UI 面板。stage 取值：PENDING | TASK_RUNNING | GATE_RUNNING | COMPLETED | FAILED；gateResult（可选）取值：PASS | FAIL；可标记单个任务为 RUNNING/DONE/FAILED；retries 为失败重试计数。状态面板颜色：灰=待定，蓝=任务执行中，橙=门禁执行中，绿=完成，红=失败。persist 字段报告最近一次状态持久化结果。',
          parameters: {
            type: 'object',
            additionalProperties: true,
            properties: {
              stage: { type: 'string', description: '全局阶段' },
              gateResult: { type: 'string', description: '门禁结果 PASS 或 FAIL' },
              task: { type: 'string', description: '要更新的任务 id' },
              taskStatus: { type: 'string', description: '该任务状态 PENDING | RUNNING | DONE | FAILED' },
              retries: { type: 'number', description: '失败重试计数' },
            },
            required: ['stage'],
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
          },
          async execute(args) {
            if (args.stage) insts.stage = String(args.stage)
            if (args.gateResult) insts.gateResult = String(args.gateResult)
            if (typeof args.retries === 'number') insts.retries = args.retries
            if (args.task && args.taskStatus) {
              const t = insts.tasks.find((x) => x.id === args.task)
              if (t) t.status = String(args.taskStatus)
            }
            insts.updatedAt = Date.now()
            insts.persist = await saveState()
            return snapshot()
          },
        }))

        ctx.effect(() => () => {})
      },
    }
  },

  // ---------------------------------------------------------------------------
  // code.client —— Client 半边：conversation.view 工作流视图（上栏 DAG 状态 /
  // 下栏选中节点 skill 文本），模块级数据层根治 remount 闪烁
  // ---------------------------------------------------------------------------
  client: function client() {
    return {
      inject: ['slots', 'timer'],
      apply(ctx) {
        const slots = ctx.get('slots')
        if (!slots) return

        const nodeColors = { PENDING: '#9ca3af', RUNNING: '#3b82f6', DONE: '#22c55e', FAILED: '#ef4444' }
        const stageLabels = { PENDING: '待定', TASK_RUNNING: '任务执行中', GATE_RUNNING: '门禁执行中', COMPLETED: '完成', FAILED: '失败' }
        const SWD_MARKER = 'swd-dash-arrow'

        function panelColor(stage, gateResult) {
          if (stage === 'COMPLETED') return gateResult === 'FAIL' ? '#ef4444' : '#22c55e'
          if (stage === 'GATE_RUNNING') return '#f59e0b'
          if (stage === 'TASK_RUNNING') return '#3b82f6'
          if (stage === 'FAILED') return '#ef4444'
          return '#9ca3af'
        }

        // ── 模块级数据层：跨组件 remount 存活（闪烁根治核心）──
        let latest = null
        const listeners = new Set()
        let lastError = false

        function publish(s) {
          // 防抖：指纹相同不通知，避免无谓重渲染
          if (s && s.fingerprint && latest && latest.fingerprint === s.fingerprint) return
          latest = s
          lastError = false
          listeners.forEach((fn) => { try { fn() } catch (e) { /* ignore */ } })
        }

        // apply 级单例轮询：只在插件激活时启动一次，与视图挂载无关
        ctx.effect(() => {
          let stop = false
          const refresh = async () => {
            if (stop) return
            try {
              const s = await host.call('wf:status')
              if (!stop) publish(s)
            } catch (e) {
              if (!stop) { lastError = true; listeners.forEach((fn) => { try { fn() } catch (e2) { /* ignore */ } }) }
            }
          }
          refresh()
          const d = ctx.interval(refresh, 1500)
          return () => { stop = true; d() }
        })

        // 纯展示组件：props 只含基础类型，仅在 statusText/stage/selectedId 变化时重渲
        const DagCanvas = React.memo(function DagCanvas(props) {
          const stage = props.stage
          const gateResult = props.gateResult
          const statusText = props.statusText
          const names = props.names
          const selectedId = props.selectedId
          const onSelect = props.onSelect
          const main = panelColor(stage, gateResult)
          const gw = 132, gh = 46, dx = 44
          const left = 24, cy = 28
          const gateStatus = stage === 'GATE_RUNNING' ? 'RUNNING' : stage === 'COMPLETED' ? 'DONE' : gateResult ? 'DONE' : 'PENDING'
          const gateLabel = gateResult ? '质量门禁 ' + gateResult : '质量门禁'

          const items = statusText ? statusText.split(',').filter(Boolean).map((s) => {
            const idx = s.lastIndexOf(':')
            return { id: s.slice(0, idx), status: s.slice(idx + 1) }
          }) : []

          const svg = []
          let x = left
          items.forEach((t, i) => {
            const isSel = selectedId === t.id
            const fill = nodeColors[t.status] || nodeColors.PENDING
            const rect = React.createElement('rect', {
              key: 'r' + t.id, x, y: cy, width: gw, height: gh, rx: 8,
              fill, opacity: 0.92,
              stroke: isSel ? '#fff' : 'transparent', strokeWidth: isSel ? 3 : 0,
              cursor: 'pointer',
              onClick: () => onSelect(t.id),
            })
            const txt = React.createElement('text', { key: 't' + t.id, x: x + gw / 2, y: cy + gh / 2 - 2, textAnchor: 'middle', fill: '#fff', fontSize: 12, fontWeight: 600 }, names[t.id] || t.id)
            const sub = React.createElement('text', { key: 'u' + t.id, x: x + gw / 2, y: cy + gh / 2 + 14, textAnchor: 'middle', fill: 'rgba(255,255,255,0.85)', fontSize: 10 }, t.id)
            svg.push(rect, txt, sub)
            if (i < items.length - 1) {
              svg.push(React.createElement('line', { key: 'l' + i, x1: x + gw, y1: cy + gh / 2, x2: x + gw + dx, y2: cy + gh / 2, stroke: '#94a3b8', strokeWidth: 2, markerEnd: 'url(#' + SWD_MARKER + ')' }))
            }
            x += gw + dx
          })
          svg.push(React.createElement('line', { key: 'lg1', x1: x - dx, y1: cy + gh / 2, x2: x - 4, y2: cy + gh / 2, stroke: '#94a3b8', strokeWidth: 2 }))
          const gSel = selectedId === 'gate'
          svg.push(React.createElement('rect', {
            key: 'rg', x, y: cy, width: gw, height: gh, rx: 8,
            fill: nodeColors[gateStatus] || nodeColors.PENDING, opacity: 0.92,
            stroke: gSel ? '#fff' : 'transparent', strokeWidth: gSel ? 3 : 0,
            cursor: 'pointer',
            onClick: () => onSelect('gate'),
          }))
          svg.push(React.createElement('text', { key: 'tg', x: x + gw / 2, y: cy + gh / 2 - 2, textAnchor: 'middle', fill: '#fff', fontSize: 12, fontWeight: 600 }, gateLabel))
          svg.push(React.createElement('text', { key: 'ug', x: x + gw / 2, y: cy + gh / 2 + 14, textAnchor: 'middle', fill: 'rgba(255,255,255,0.85)', fontSize: 10 }, 'gate'))
          svg.push(React.createElement('defs', { key: 'defs' }, React.createElement('marker', { id: SWD_MARKER, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, React.createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#94a3b8' }))))

          const width = left * 2 + Math.max(items.length, 1) * (gw + dx) + gw
          return React.createElement('div', { key: 'top', style: { padding: '14px 18px 10px', borderBottom: '1px solid rgba(148,163,184,0.3)' } }, [
            React.createElement('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, fontSize: 12, color: '#64748b' } }, [
              React.createElement('span', { key: 'w', style: { fontWeight: 600, color: '#334155' } }, props.workflowName),
              React.createElement('span', { key: 's' }, '阶段: ', React.createElement('span', { style: { color: main, fontWeight: 700 } }, stage + ' ' + (stageLabels[stage] || ''))),
              React.createElement('span', { key: 'g' }, '门禁: ', gateResult ? React.createElement('span', { style: { color: gateResult === 'PASS' ? '#22c55e' : '#ef4444', fontWeight: 700 } }, gateResult) : '—'),
              props.retries > 0 ? React.createElement('span', { key: 'r' }, '重试: ', props.retries) : null,
              props.error ? React.createElement('span', { key: 'e', style: { color: '#ef4444' } }, props.error) : null,
            ]),
            React.createElement('svg', { key: 'svg', width, height: cy * 2 + gh, xmlns: 'http://www.w3.org/2000/svg', style: { background: 'rgba(148,163,184,0.08)', borderRadius: 8 } }, svg),
          ])
        })

        slots.inject('conversation.view', () => {
          return slots.register(
            { name: 'conversation.view', id: 'workflow', order: 30, label: () => '工作流' },
            () => {
              function WorkflowView() {
                // 组件只订阅模块级快照：挂载即读到最新数据，重挂无感
                const [, force] = React.useReducer((x) => x + 1, 0)
                const [selected, setSelected] = React.useState(null)
                const [skill, setSkill] = React.useState(null)
                const [skillLoading, setSkillLoading] = React.useState(false)

                React.useEffect(() => {
                  listeners.add(force)
                  return () => listeners.delete(force)
                }, [])

                React.useEffect(() => {
                  if (!selected) return
                  let cancelled = false
                  setSkillLoading(true)
                  host.call('wf:skill', { id: selected.id }).then((r) => {
                    if (!cancelled) { setSkill(r); setSkillLoading(false) }
                  }).catch((e) => { if (!cancelled) { setSkill(null); setSkillLoading(false) } })
                  return () => { cancelled = true }
                }, [selected])

                const onSelect = React.useCallback((id) => {
                  setSelected({ id })
                  setSkill(null)
                }, [])

                // 所有 hooks 恒序，条件渲染都放在 hooks 之后
                const snap = latest
                const tasks = (snap && Array.isArray(snap.tasks)) ? snap.tasks : []
                const selTitle = React.useMemo(() => {
                  if (!selected) return '点击上方节点查看其 skill 内容'
                  const found = tasks.find((t) => t.id === selected.id)
                  if (selected.id === 'gate') return '节点: 质量门禁  ·  由质量评审 skill（poc-reviewer）定义'
                  if (found) return '节点: ' + found.name + ' (' + found.id + ')'
                  return '节点: ' + selected.id
                }, [selected, tasks])

                const skillContent = React.useMemo(() => {
                  if (!selected) return '点击上方任意节点，查看其 skill 内容。'
                  if (selected.id === 'gate') return '门禁技能：poc-reviewer/SKILL.md，定义 5 项评审检查与 PASS/FAIL 判定。'
                  if (skill && skill.text) return skill.text
                  return '（技能加载中…）'
                }, [selected, skill])

                // 无数据的稳定骨架：结构与 DAG 同构，杜绝跳变文本
                if (!snap || !snap.workflow) {
                  const hint = lastError ? '工作流数据暂不可用，等待恢复…' : '工作流仪表盘连接中…'
                  const skeleton = React.createElement('div', {
                    style: {
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      height: '100%', minHeight: 420, color: '#9ca3af', fontSize: 13,
                      border: '1px dashed rgba(148,163,184,0.35)', borderRadius: 8,
                      margin: 12, background: 'rgba(148,163,184,0.05)',
                    },
                  }, hint)
                  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, fontFamily: 'inherit' } }, [skeleton])
                }

                const statusText = tasks.map((t) => t.id + ':' + t.status).join(',')
                const names = {}
                tasks.forEach((t) => { names[t.id] = t.name })
                const selectedId = selected ? selected.id : null

                const bottomEl = React.createElement('div', { key: 'bottom', style: { flex: 1, overflow: 'auto', padding: '10px 16px 16px' } }, [
                  React.createElement('div', { key: 'bh', style: { fontSize: 12, color: '#64748b', marginBottom: 6 } }, selTitle),
                  skillLoading && selected
                    ? React.createElement('div', { key: 'load', style: { fontSize: 12, color: '#9ca3af' } }, '加载中…')
                    : React.createElement('pre', { key: 'pre', style: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.6, color: '#334155', background: 'rgba(148,163,184,0.08)', borderRadius: 8, padding: '10px 12px' } }, skillContent),
                ])

                const dagEl = React.createElement(DagCanvas, {
                  key: 'dag',
                  stage: snap.stage,
                  gateResult: snap.gateResult || null,
                  statusText,
                  names,
                  selectedId,
                  onSelect,
                  workflowName: snap.workflow,
                  retries: snap.retries || 0,
                  error: snap.error || null,
                })

                return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, fontFamily: 'inherit' } }, [dagEl, bottomEl])
              }
              return React.createElement(WorkflowView)
            },
          )
        })
      },
    }
  },
}