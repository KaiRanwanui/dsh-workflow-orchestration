// Workflow Agent DAG 监控面板 - npm 包版本
// 从动态插件 wff-9/pkg-14 迁移而来

export function register(ctx) {
  const slots = ctx.get('slots')
  if (!slots) return

  // ── 模块级数据层（防止 remount 闪烁）────────────────────────────
  let latest = null, lastError = null
  const listeners = new Set()
  let pollingActive = false, wfRoot = '', wfLoaded = false
  // Iter-12：cwd 跟随 + 实例列表（activeRoot=当前轮询锚点；wfInstanceId=面板选择）
  let activeRoot = null, wfInstances = [], wfInstanceId = ''
  // Iter-19：当前会话派生状态（/wf/list 返回；create 按钮 gating 用）
  let wfSessionState = null
  // Iter-23(A3)：Case I 停止无效提示（/wf/list stopHint；状态触发：RUNNING+主 idle+子会话在跑）
  let wfStopHint = null
  // Iter-20：当前会话 id（/wf/list 查询用，路由据此返回轻量 sessionState）
  let wfSessionId = ''
  // Iter-13：列表加载器引用（面板创建成功后即时刷新）
  let wfListLoader = null
  // Iter-20(S5)：当前会话是否为 workflow-orchestrator 预设（预设门控；false 时短路轮询）
  let wfSessionActive = false
  // Iter-21(R3)：会话切换检测（activeRoot 相同也需重置并重拉，消除状态残留）
  let wfLastSessionId = ''
  // Iter-21：控制中间态——Start/Stop/Resume 点击后进入 Starting/Stopping/Resuming（按钮禁用显示对应文案），
  // 直到 agent 真正把实例切到目标 stage 才清掉、DAG 才切换。防 LLM 等待期重复点击。
  let wfPendingCmd = null, wfPendingAt = 0
  // Iter-21(R3)：稳定组件类型——session 更新（subagent 创建等）会频繁触发 factory 重渲染，
  // 若 WorkflowView 每次重定义会 remount（闪烁 + 局部状态丢失）。用模块级缓存一次。
  let WfComponent = null
  // Iter-28：编辑前台组件同款防 remount 缓存（KeyValueEditor / EditorPanel 均定义一次）
  let KvComponent = null
  let EditorComponent = null

  // ── Iter-28：key-value 行编辑器（创建弹窗 params 预填 / 编辑器 inputs 复用）──
  // entries=[{key,value}]；readOnly 隐藏增删改；onAdd 空 key 占位新增行。
  function getKeyValueComponent() {
    if (KvComponent) return KvComponent
    KvComponent = function KeyValueEditor(props) {
      const { entries, onChange, readOnly, keyPlaceholder, valuePlaceholder } = props
      const inputStyle = { border: '1px solid rgba(148,163,184,0.4)', borderRadius: 5, padding: '3px 7px', background: 'rgba(148,163,184,0.08)', color: 'inherit', fontSize: 12, minWidth: 0, flex: 1 }
      const delStyle = { border: 'none', background: 'transparent', color: '#f87171', cursor: readOnly ? 'default' : 'pointer', fontSize: 13, padding: '0 4px', lineHeight: '20px' }
      const upd = (i, field, v) => {
        if (readOnly) return
        const next = entries.map((e, j) => j === i ? Object.assign({}, e, { [field]: v }) : e)
        onChange(next)
      }
      const rows = entries.map((e, i) => React.createElement('div', { key: i, style: { display: 'flex', gap: 4, alignItems: 'center' } }, [
        React.createElement('input', { key: 'k', value: e.key, placeholder: keyPlaceholder || '键', onChange: (ev) => upd(i, 'key', ev.target.value), readOnly: !!readOnly, style: Object.assign({}, inputStyle, { flex: '0 0 34%' }) }),
        React.createElement('input', { key: 'v', value: e.value, placeholder: valuePlaceholder || '值', onChange: (ev) => upd(i, 'value', ev.target.value), readOnly: !!readOnly, style: inputStyle }),
        readOnly ? null : React.createElement('button', { key: 'd', title: '删除此行', onClick: () => onChange(entries.filter((_, j) => j !== i)), style: delStyle }, '\u00d7'),
      ]))
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        rows.length ? rows : React.createElement('div', { style: { color: '#9ca3af', fontSize: 12 } }, '（无）'),
        readOnly ? null : React.createElement('button', {
          onClick: () => onChange(entries.concat([{ key: '', value: '' }])),
          style: { alignSelf: 'flex-start', border: '1px dashed rgba(148,163,184,0.5)', background: 'transparent', color: '#9ca3af', borderRadius: 5, padding: '1px 8px', fontSize: 11, cursor: 'pointer' }
        }, '+ 添加')
      )
    }
    return KvComponent
  }

  // ── Iter-28：实例编辑前台（DAG 下方折叠编辑器）──────────────────────────
  // 双栏：左任务列表（类型/状态）、右选中任务属性表单；顶部实例级（name 只读、
  // maxConcurrency 可改、params 只读）。保存走 /wf/validate-instance → /wf/instance-yaml
  // 服务端闸门（Iter-27b 校验，errors 非空不落盘）；权限矩阵由服务端 editable 驱动。
  function getEditorComponent() {
    if (EditorComponent) return EditorComponent
    EditorComponent = function EditorPanel(props) {
      const { workspaceRoot, instanceId, stage: stageProp, onClose, onSaved } = props
      const [data, setData] = React.useState(null)
      const [skills, setSkills] = React.useState([])
      const [selId, setSelId] = React.useState('')
      const [draft, setDraft] = React.useState({ maxConcurrency: undefined, tasks: {} })
      const [valRes, setValRes] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [err, setErr] = React.useState('')

      const load = React.useCallback(() => {
        if (!workspaceRoot || !instanceId) return
        fetch('/wf/instance-yaml?workspaceRoot=' + encodeURIComponent(workspaceRoot) + '&instanceId=' + encodeURIComponent(instanceId))
          .then(r => r.json())
          .then(r => {
            if (r && r.error && !r.tasks) { setErr(r.error); return }
            setErr('')
            setData(r)
            if (!r.tasks || !r.tasks.some(t => t.id === selId)) setSelId(r.tasks && r.tasks.length ? r.tasks[0].id : '')
          })
          .catch(e => setErr(e && e.message ? e.message : String(e)))
      }, [workspaceRoot, instanceId, selId])

      // Iter-28 修正3：外部 stage（面板 2s 轮询权威值）与编辑器内数据不一致 → 重拉。
      // 场景：编辑器展开期间实例启动（CREATED→RUNNING），权限须即时转禁用，
      // 而不是等用户点保存才被服务端拦。
      React.useEffect(() => {
        if (!stageProp || !workspaceRoot || !instanceId) return
        if (data && data.stage && data.stage !== stageProp) load()
      }, [stageProp, data, load])

      React.useEffect(() => {
        let stop = false
        setData(null); setSkills([]); setSelId(''); setDraft({ maxConcurrency: undefined, tasks: {} }); setValRes(null); setErr('')
        if (!workspaceRoot || !instanceId) return () => { stop = true }
        fetch('/wf/instance-yaml?workspaceRoot=' + encodeURIComponent(workspaceRoot) + '&instanceId=' + encodeURIComponent(instanceId))
          .then(r => r.json())
          .then(r => {
            if (stop) return
            if (r && r.error && !r.tasks) { setErr(r.error); return }
            setData(r)
            setSelId(r.tasks && r.tasks.length ? r.tasks[0].id : '')
          })
          .catch(e => { if (!stop) setErr(e && e.message ? e.message : String(e)) })
        fetch('/wf/skills?workspaceRoot=' + encodeURIComponent(workspaceRoot))
          .then(r => r.json())
          .then(r => { if (!stop) setSkills((r && r.skills) || []) })
          .catch(() => {})
        return () => { stop = true }
      }, [workspaceRoot, instanceId])

      const editable = (data && data.editable) || { stage: '', definition: false, runtime: false, readonlyAll: true }
      const tasks = (data && data.tasks) || []
      const inst = (data && data.instance) || { name: '', params: {} }
      const selTask = tasks.find(t => t.id === selId) || null

      // draft 访问器：draft 值优先，回落原值
      const td = selId ? (draft.tasks[selId] || {}) : {}
      const getF = (field, orig) => (td[field] !== undefined ? td[field] : orig)
      const setF = (field, value) => {
        setDraft(prev => {
          const t = Object.assign({}, (prev.tasks[selId] || {}))
          t[field] = value
          return { maxConcurrency: prev.maxConcurrency, tasks: Object.assign({}, prev.tasks, { [selId]: t }) }
        })
        setValRes(null)
      }

      const dirty = draft.maxConcurrency !== undefined || Object.keys(draft.tasks).some(id => Object.keys(draft.tasks[id]).length > 0)

      const buildPatch = () => {
        const patch = {}
        if (draft.maxConcurrency !== undefined) patch.maxConcurrency = draft.maxConcurrency
        const tp = {}
        for (const id of Object.keys(draft.tasks)) {
          const t = draft.tasks[id]
          if (!Object.keys(t).length) continue
          const out = {}
          for (const f of Object.keys(t)) {
            if (f === 'inputsEntries') {
              // Iter-28 修正1：entries → 对象转换推迟到此（空 key 行过滤=未完成行不发送；
              // 原值为数组形态的键按逗号拆回）
              const orig = ((tasks.find(x => x.id === id) || {}).inputs) || {}
              const obj = {}
              for (const e of t[f]) {
                const k = String(e.key || '').trim()
                if (!k) continue
                obj[k] = Array.isArray(orig[k]) ? String(e.value).split(',').map(s => s.trim()).filter(Boolean) : String(e.value)
              }
              out.inputs = obj
            } else out[f] = t[f]
          }
          tp[id] = out
        }
        if (Object.keys(tp).length) patch.tasks = tp
        return patch
      }

      const doAction = async (thenSave) => {
        if (!dirty || busy) return
        setBusy(true); setErr(''); setValRes(null)
        try {
          const url = thenSave ? '/wf/instance-yaml' : '/wf/validate-instance'
          const resp = await fetch(url, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workspaceRoot, instanceId, patch: buildPatch() })
          })
          const r = await resp.json()
          if (!resp.ok) {
            const editErrors = (r && r.editErrors) || []
            setValRes({
              ok: false, kind: thenSave ? 'save' : 'validate',
              // 校验错误（workflowBeginErrors=服务端 formatValidationItem 格式化）或原始 error
              lines: (r && r.workflowBeginErrors && r.workflowBeginErrors.length ? r.workflowBeginErrors : null) || (r && r.error ? [r.error] : []),
              // 禁改/非法值错误（workflow-edit 自有格式）
              editLines: editErrors.map(e2 => '[' + e2.code + '] 任务 "' + (e2.task || '-') + '" ' + (e2.field || '') + ': ' + e2.message),
            })
            return
          }
          setValRes({ ok: true, kind: thenSave ? 'save' : 'validate', warnings: (r && r.warnings) || [] })
          if (thenSave) {
            setDraft({ maxConcurrency: undefined, tasks: {} })
            load()
            if (typeof onSaved === 'function') onSaved()
          }
        } catch (e) {
          setErr(e && e.message ? e.message : String(e))
        } finally { setBusy(false) }
      }

      const inputStyle = { border: '1px solid rgba(148,163,184,0.4)', borderRadius: 5, padding: '3px 7px', background: 'rgba(148,163,184,0.08)', color: 'inherit', fontSize: 12, width: '100%', boxSizing: 'border-box' }
      const btnStyle2 = { border: '1px solid rgba(148,163,184,0.4)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '3px 12px', cursor: 'pointer', fontSize: 12 }
      const labelStyle = { display: 'inline-block', minWidth: 86, color: '#9ca3af', fontSize: 11 }
      const rowStyle = { display: 'flex', alignItems: 'center', gap: 6 }
      const dis = (allowed) => busy || !allowed || editable.readonlyAll

      // 技能下拉（value=相对形态 relPath；当前值不在列表时保留显示为警示项）
      const mkSkillSelect = (value, onChange, disabled, emptyLabel) => {
        const opts = []
        if (emptyLabel) opts.push({ v: '', label: emptyLabel })
        if (value && !skills.some(s => s.relPath === value)) opts.push({ v: value, label: '⚠ ' + value + '（当前值，不在技能列表）' })
        skills.forEach(s => opts.push({
          v: s.relPath,
          label: (s.name || s.id) + (s.version ? ' (v' + s.version + ')' : '') + (s.source === 'workspace' ? ' · 工作区' : '') + (s.predefinedShadowed ? '（顶替预定义同名）' : ''),
        }))
        return React.createElement('select', { value: value == null ? '' : value, onChange, disabled, style: inputStyle },
          opts.map(o => React.createElement('option', { key: o.v || '__e', value: o.v }, o.label)))
      }

      const KvEditor = getKeyValueComponent()

      // inputs 编辑形态（Iter-28 修正1：draft 直接存 entries 数组——空 key 行是合法中间态，
      // "+ 添加" 立即可见可编辑；对象转换推迟到 buildPatch）
      const inputsOrig = (selTask && selTask.inputs) || {}
      const inputsDraftEntries = getF('inputsEntries', null)
      const inputsEntries = (inputsDraftEntries !== null && inputsDraftEntries !== undefined)
        ? inputsDraftEntries
        : Object.keys(inputsOrig).map(k => ({ key: k, value: Array.isArray(inputsOrig[k]) ? inputsOrig[k].join(', ') : String(inputsOrig[k]) }))
      const onInputsChange = (entries) => setF('inputsEntries', entries)

      // outputs 行编辑器（string[]）
      const outputsVal = getF('outputs', (selTask && selTask.outputs) || [])
      const onOutputsChange = (arr) => setF('outputs', arr.map(s => String(s)))

      // params 只读展示（instance.meta.params）
      const paramEntries = Object.keys(inst.params || {}).map(k => ({ key: k, value: inst.params[k] === null || inst.params[k] === undefined ? '' : String(inst.params[k]) }))

      const stageColor = { CREATED: '#9ca3af', PENDING: '#9ca3af', RUNNING: '#3b82f6', STOPPED: '#f59e0b', COMPLETED: '#22c55e', FAILED: '#ef4444' }
      const typeLabel = { 'llm-task': 'LLM', 'loop': '↻ loop', 'concurrent': '⚡ conc', 'human-decision': '人审', 'external-agent': '外部' }
      const stC = { PENDING: '#9ca3af', RUNNING: '#3b82f6', DONE: '#22c55e', FAILED: '#ef4444', SKIPPED: '#f59e0b' }

      const taskListEl = React.createElement('div', {
        style: { flex: '0 0 180px', borderRight: '1px solid rgba(148,163,184,0.25)', overflowY: 'auto', maxHeight: 230, display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 4 }
      },
        tasks.length === 0 ? React.createElement('div', { style: { color: '#9ca3af', fontSize: 12 } }, '（无任务）') :
        tasks.map(t => React.createElement('button', {
          key: t.id,
          onClick: () => setSelId(t.id),
          style: {
            textAlign: 'left', border: selId === t.id ? '1px solid rgba(59,130,246,0.7)' : '1px solid rgba(148,163,184,0.25)',
            background: selId === t.id ? 'rgba(59,130,246,0.12)' : 'transparent',
            color: 'inherit', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }
        }, [
          React.createElement('span', { key: 'd', style: { width: 8, height: 8, borderRadius: 4, background: stC[t.status] || '#9ca3af', flexShrink: 0 } }),
          React.createElement('span', { key: 'n', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: t.id }, t.name || t.id),
          React.createElement('span', { key: 't', style: { color: '#9ca3af', fontSize: 10, flexShrink: 0 } }, typeLabel[t.type] || t.type),
        ]))
      )

      const taskFormEl = !selTask ? React.createElement('div', { style: { color: '#9ca3af', fontSize: 12, padding: 8 } }, '← 选择左侧任务查看属性') : React.createElement('div', {
        style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0, overflowY: 'auto', maxHeight: 230, paddingRight: 4 }
      }, [
        React.createElement('div', { key: 'tt', style: { fontWeight: 600 } }, (selTask.name || selTask.id) + '  ', React.createElement('span', { style: { color: '#9ca3af', fontWeight: 400, fontSize: 11 } }, selTask.id + ' · ' + (typeLabel[selTask.type] || selTask.type))),
        React.createElement('div', { key: 'p', style: rowStyle }, [
          React.createElement('span', { key: 'l', style: labelStyle }, 'processor'),
          mkSkillSelect(getF('processor', selTask.processor), (e) => setF('processor', e.target.value), dis(editable.definition), null),
        ]),
        React.createElement('div', { key: 'g', style: rowStyle }, [
          React.createElement('span', { key: 'l', style: labelStyle }, 'gateChecker'),
          mkSkillSelect(getF('gateChecker', selTask.gateChecker), (e) => setF('gateChecker', e.target.value), dis(editable.definition), '（无门禁）'),
        ]),
        React.createElement('div', { key: 'i', style: rowStyle }, [
          React.createElement('span', { key: 'l', style: labelStyle }, 'inputs'),
          React.createElement('div', { key: 'v', style: { flex: 1, minWidth: 0 } },
            React.createElement(KvEditor, { entries: inputsEntries, onChange: onInputsChange, readOnly: dis(editable.definition), keyPlaceholder: '输入名', valuePlaceholder: '路径（多值逗号分隔）' })),
        ]),
        React.createElement('div', { key: 'o', style: rowStyle }, [
          React.createElement('span', { key: 'l', style: labelStyle }, 'outputs'),
          React.createElement('div', { key: 'v', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } }, [
            ...outputsVal.map((o, i) => React.createElement('div', { key: 'or' + i, style: { display: 'flex', gap: 4, alignItems: 'center' } }, [
              React.createElement('input', { key: 'in', value: o, onChange: (e) => onOutputsChange(outputsVal.map((x, j) => j === i ? e.target.value : x)), disabled: dis(editable.definition), placeholder: '输出路径', style: inputStyle }),
              dis(editable.definition) ? null : React.createElement('button', { key: 'd', title: '删除', onClick: () => onOutputsChange(outputsVal.filter((_, j) => j !== i)), style: { border: 'none', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 13 } }, '\u00d7'),
            ])),
            dis(editable.definition) ? null : React.createElement('button', { key: 'oa', onClick: () => onOutputsChange(outputsVal.concat([''])), style: { alignSelf: 'flex-start', border: '1px dashed rgba(148,163,184,0.5)', background: 'transparent', color: '#9ca3af', borderRadius: 5, padding: '1px 8px', fontSize: 11, cursor: 'pointer' } }, '+ 添加'),
          ]),
        ]),
        React.createElement('div', { key: 'r', style: rowStyle }, [
          React.createElement('span', { key: 'l', style: labelStyle }, 'retries'),
          React.createElement('input', {
            key: 'in', type: 'number', min: 0, disabled: dis(editable.runtime),
            value: getF('retries', selTask.retries) === null || getF('retries', selTask.retries) === undefined ? 0 : getF('retries', selTask.retries),
            onChange: (e) => setF('retries', e.target.value === '' ? 0 : Number(e.target.value)), style: Object.assign({}, inputStyle, { width: 90 }) }),
          React.createElement('span', { style: { color: '#9ca3af', fontSize: 11 } }, '门禁失败重试次数（保存后对下一次 reset/启动生效）'),
        ]),
        React.createElement('div', { key: 'c', style: rowStyle }, [
          React.createElement('span', { key: 'l', style: labelStyle }, 'concurrency'),
          React.createElement('input', {
            key: 'in', type: 'number', min: 1, disabled: dis(editable.runtime),
            value: getF('concurrency', selTask.concurrency) === null || getF('concurrency', selTask.concurrency) === undefined ? '' : getF('concurrency', selTask.concurrency),
            onChange: (e) => setF('concurrency', e.target.value === '' ? null : Number(e.target.value)), style: Object.assign({}, inputStyle, { width: 90 }),
            placeholder: '默认' }),
          React.createElement('span', { style: { color: '#9ca3af', fontSize: 11 } }, '任务级并发上限（仅 loop/concurrent 组有意义）'),
        ]),
      ])

      const valResEl = !valRes ? null : (
        valRes.ok
          ? React.createElement('div', { key: 'vok', style: { border: '1px solid rgba(34,197,94,0.45)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', borderRadius: 6, padding: '6px 9px', fontSize: 12 } },
              (valRes.kind === 'save' ? '✓ 已保存' : '✓ 校验通过') + (valRes.warnings && valRes.warnings.length ? ('；' + valRes.warnings.length + ' 项警告（不阻断）：' + valRes.warnings.join('；')) : '，无警告'))
          : React.createElement('div', { key: 'verr', style: { border: '1px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.08)', color: '#f87171', borderRadius: 6, padding: '6px 9px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 140, overflowY: 'auto' } }, [
              React.createElement('div', { key: 't', style: { fontWeight: 600 } }, '✗ ' + (valRes.kind === 'save' ? '保存被拦（校验未通过，未落盘）' : '校验未通过')),
              ...(valRes.editLines || []).map((l, i) => React.createElement('div', { key: 'el' + i }, '· ' + l)),
              ...(valRes.lines || []).map((l, i) => React.createElement('div', { key: 'wl' + i }, '· ' + l)),
            ])
      )

      return React.createElement('div', {
        style: { margin: '6px 12px 12px', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7, background: 'rgba(148,163,184,0.04)' }
      }, [
        React.createElement('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
          React.createElement('span', { key: 't', style: { fontWeight: 600, fontSize: 13 } }, '✎ 实例编辑'),
          React.createElement('span', { key: 's', style: { fontSize: 11, color: stageColor[editable.stage] || '#9ca3af', border: '1px solid ' + (stageColor[editable.stage] || '#9ca3af') + '66', borderRadius: 5, padding: '0 6px' } }, editable.stage || '…'),
          editable.readonlyAll ? React.createElement('span', { key: 'ro', style: { color: '#f59e0b', fontSize: 11 } }, '运行中不可编辑（停止后可改并发/重试；定义字段仅 CREATED 可改）') : null,
          !editable.definition && !editable.readonlyAll ? React.createElement('span', { key: 'pd', style: { color: '#9ca3af', fontSize: 11 } }, '已启动：processor/gateChecker/inputs/outputs 只读（重定义请 reset 后经编辑器或重新 create）') : null,
          React.createElement('span', { key: 'sp', style: { flex: 1 } }),
          React.createElement('button', { key: 'x', onClick: onClose, style: btnStyle2 }, '收起'),
        ]),
        err ? React.createElement('div', { key: 'err', style: { color: '#f87171', fontSize: 12 } }, err) : null,
        !data ? React.createElement('div', { key: 'ld', style: { color: '#9ca3af', fontSize: 12 } }, '加载中…') : [
          React.createElement('div', { key: 'ins', style: { display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start', borderBottom: '1px solid rgba(148,163,184,0.2)', paddingBottom: 7 } }, [
            React.createElement('div', { key: 'n', style: rowStyle }, [
              React.createElement('span', { key: 'l', style: labelStyle }, 'name'),
              React.createElement('span', { key: 'v', style: { fontSize: 12 } }, inst.name || '-'),
            ]),
            React.createElement('div', { key: 'mc', style: rowStyle }, [
              React.createElement('span', { key: 'l', style: labelStyle }, 'maxConcurrency'),
              React.createElement('input', {
                key: 'in', type: 'number', min: 1, disabled: dis(editable.runtime),
                value: draft.maxConcurrency !== undefined ? draft.maxConcurrency : (inst.maxConcurrency || 1),
                onChange: (e) => { setDraft(prev => ({ maxConcurrency: e.target.value === '' ? 1 : Number(e.target.value), tasks: prev.tasks })); setValRes(null) },
                style: Object.assign({}, inputStyle, { width: 80 }) }),
              React.createElement('span', { style: { color: '#9ca3af', fontSize: 11 } }, '全局并发上限'),
            ]),
            React.createElement('div', { key: 'pp', style: Object.assign({}, rowStyle, { flex: '1 1 260px', minWidth: 0 }) }, [
              React.createElement('span', { key: 'l', style: labelStyle }, 'params'),
              React.createElement('div', { key: 'v', style: { flex: 1, minWidth: 0, opacity: 0.75 } },
                React.createElement(KvEditor, { entries: paramEntries, readOnly: true })),
            ]),
          ]),
          React.createElement('div', { key: 'cols', style: { display: 'flex', gap: 10 } }, [taskListEl, taskFormEl]),
          valResEl,
          React.createElement('div', { key: 'ft', style: { display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' } }, [
            dirty && !editable.readonlyAll ? React.createElement('span', { key: 'dh', style: { color: '#f59e0b', fontSize: 11 } }, '有未保存修改') : null,
            React.createElement('button', { key: 'v', onClick: () => doAction(false), disabled: !dirty || busy, style: Object.assign({}, btnStyle2, { opacity: !dirty || busy ? 0.5 : 1 }) }, busy ? '处理中…' : '仅校验'),
            React.createElement('button', {
              key: 's', onClick: () => doAction(true), disabled: !dirty || busy || editable.readonlyAll,
              style: Object.assign({}, btnStyle2, { background: '#3b82f6', color: '#fff', border: 'none', opacity: !dirty || busy || editable.readonlyAll ? 0.5 : 1 })
            }, busy ? '处理中…' : '保存（校验通过才落盘）'),
          ]),
        ],
      ])
    }
    return EditorComponent
  }

  // ── Iter-29：实例管理子页签（活动/归档两段 + 归档/删除/多选打包下载）──────
  // 数据源：/wf/list（活动实例）+ /wf/archives（归档条目）；打开与每次操作后重拉。
  // 归档门控（lifecycle-design §4.1）：STOPPED/COMPLETED/FAILED 可归档；RUNNING 灰禁
  // （须先停止）；CREATED/PENDING 灰禁（无执行内容）。删除仅归档段（不可恢复，二次确认）。
  // 下载：两段复选框多选 → POST /wf/download → downloadUrl（一次性 token）触发浏览器保存。
  let ManagerComponent = null
  function getManagerComponent() {
    if (ManagerComponent) return ManagerComponent
    ManagerComponent = function ManagerPanel(props) {
      const { workspaceRoot, onClose, onChanged } = props
      const [instances, setInstances] = React.useState([])
      const [archives, setArchives] = React.useState([])
      const [checked, setChecked] = React.useState({}) // key 'i:<id>' / 'a:<id>/<entry>' → true
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null) // { kind: 'ok'|'err', text }
      const [loaded, setLoaded] = React.useState(false)

      const load = React.useCallback(() => {
        if (!workspaceRoot) return
        fetch('/wf/list?workspaceRoot=' + encodeURIComponent(workspaceRoot) + '&sessionId=')
          .then(r => r.json())
          .then(r => { setInstances((r && r.instances) || []); setLoaded(true) })
          .catch(() => setLoaded(true))
        fetch('/wf/archives?workspaceRoot=' + encodeURIComponent(workspaceRoot))
          .then(r => r.json())
          .then(r => setArchives((r && r.archives) || []))
          .catch(() => {})
      }, [workspaceRoot])

      React.useEffect(() => { load() }, [load])

      const stageColor = { CREATED: '#9ca3af', PENDING: '#9ca3af', RUNNING: '#3b82f6', STOPPED: '#f59e0b', COMPLETED: '#22c55e', FAILED: '#ef4444' }
      const fmtBytes = (n) => (n == null ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
      const fmtTime = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '—')
      const archivable = (st) => st === 'STOPPED' || st === 'COMPLETED' || st === 'FAILED'

      const toggle = (key) => setChecked(prev => Object.assign({}, prev, { [key]: !prev[key] }))
      const checkedKeys = Object.keys(checked).filter(k => checked[k])
      const checkedTargets = checkedKeys.map(k => k.slice(0, 2) === 'i:'
        ? { kind: 'instance', instanceId: k.slice(2) }
        : (function () { const s = k.slice(2); const i = s.indexOf('/'); return { kind: 'archive', instanceId: s.slice(0, i), entry: s.slice(i + 1) } })())

      const doArchive = async (instanceId, stage) => {
        if (!confirm('归档实例 ' + instanceId + ' ？\n\n归档后实例移出实例池（原始目录删除），全部内容备份到 archive/，绑定会话进入终态（DONE）。')) return
        setBusy(true); setMsg(null)
        try {
          const resp = await fetch('/wf/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot, instanceId }) })
          const r = await resp.json()
          if (!resp.ok) throw new Error(r.error || ('HTTP ' + resp.status))
          setMsg({ kind: 'ok', text: '✓ 已归档 ' + instanceId + '（' + (r.stage || '') + '）→ ' + (r.backupDir || '') })
          setChecked(prev => { const n = Object.assign({}, prev); delete n['i:' + instanceId]; return n })
          load(); if (onChanged) onChanged()
        } catch (e) { setMsg({ kind: 'err', text: '归档失败：' + (e && e.message ? e.message : String(e)) }) }
        setBusy(false)
      }

      const doDeleteArchive = async (instanceId, entry) => {
        if (!confirm('删除归档 ' + instanceId + '/' + entry + ' ？\n\n该归档内容将被永久删除，不可恢复。')) return
        setBusy(true); setMsg(null)
        try {
          const resp = await fetch('/wf/delete-archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot, instanceId, entry }) })
          const r = await resp.json()
          if (!resp.ok) throw new Error(r.error || ('HTTP ' + resp.status))
          setMsg({ kind: 'ok', text: '✓ 已删除归档 ' + instanceId + '/' + entry })
          setChecked(prev => { const n = Object.assign({}, prev); delete n['a:' + instanceId + '/' + entry]; return n })
          load(); if (onChanged) onChanged()
        } catch (e) { setMsg({ kind: 'err', text: '删除失败：' + (e && e.message ? e.message : String(e)) }) }
        setBusy(false)
      }

      const doDownload = async () => {
        if (!checkedTargets.length) return
        setBusy(true); setMsg(null)
        try {
          const resp = await fetch('/wf/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot, targets: checkedTargets }) })
          const r = await resp.json()
          if (!resp.ok) throw new Error(r.error || ('HTTP ' + resp.status))
          const a = document.createElement('a')
          a.href = r.downloadUrl
          a.download = r.filename || 'workflow-agent.zip'
          document.body.appendChild(a)
          a.click()
          a.remove()
          setMsg({ kind: 'ok', text: '✓ 打包完成（' + (r.fileCount || 0) + ' 个文件）：' + (r.filename || '') })
        } catch (e) { setMsg({ kind: 'err', text: '下载失败：' + (e && e.message ? e.message : String(e)) }) }
        setBusy(false)
      }

      const cell = { padding: '3px 8px', fontSize: 12, borderBottom: '1px solid rgba(148,163,184,0.15)', whiteSpace: 'nowrap', textAlign: 'left' }
      const headCell = Object.assign({}, cell, { color: '#9ca3af', fontSize: 11, fontWeight: 600, borderBottom: '1px solid rgba(148,163,184,0.3)' })
      const btn = (color, dis) => ({ border: '1px solid ' + color + '66', background: 'transparent', color, borderRadius: 5, padding: '1px 8px', fontSize: 11, cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.4 : 1 })
      const checkbox = (checkedKey, dis) => React.createElement('input', {
        type: 'checkbox', checked: !!checked[checkedKey], disabled: !!dis,
        onChange: () => toggle(checkedKey), style: { cursor: dis ? 'default' : 'pointer', accentColor: '#3b82f6' },
      })

      const sectionTitle = (text, count) => React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 4px' } }, [
        React.createElement('span', { key: 't', style: { fontSize: 12, fontWeight: 600 } }, text),
        React.createElement('span', { key: 'c', style: { fontSize: 11, color: '#9ca3af' } }, String(count)),
      ])

      const activeRows = instances.map(it => {
        const dis = busy || !archivable(it.stage)
        const key = 'i:' + it.instanceId
        return React.createElement('tr', { key: it.instanceId }, [
          React.createElement('td', { key: 'c', style: cell }, checkbox(key, false)),
          React.createElement('td', { key: 'n', style: cell }, String(it.workflowName || '')),
          React.createElement('td', { key: 'i', style: Object.assign({}, cell, { color: '#9ca3af', fontFamily: 'monospace', fontSize: 11 }) }, String(it.instanceId).slice(-8)),
          React.createElement('td', { key: 's', style: cell }, [
            React.createElement('span', { key: 'd', style: { display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: stageColor[it.stage] || '#9ca3af', marginRight: 5 } }),
            React.createElement('span', { key: 't', style: { color: stageColor[it.stage] || '#9ca3af' } }, it.stage || 'CREATED'),
          ]),
          React.createElement('td', { key: 'p', style: cell }, it.phase === 'READY' ? (it.taskDone + '/' + it.taskTotal + (it.taskFailed ? ' ✗' + it.taskFailed : '')) : '—'),
          React.createElement('td', { key: 'b', style: cell }, it.sessionId ? String(it.sessionId).slice(-6) + (it.active ? '' : '（离线）') : '未绑定'),
          React.createElement('td', { key: 't', style: Object.assign({}, cell, { color: '#9ca3af' }) }, fmtTime(it.createdAt)),
          React.createElement('td', { key: 'a', style: cell }, React.createElement('button', {
            title: !archivable(it.stage) ? (it.stage === 'RUNNING' ? '运行中：须先停止再归档' : '未启动：无执行内容，不支持归档') : '归档（移出池并备份）',
            disabled: dis, onClick: () => doArchive(it.instanceId, it.stage), style: btn('#a78bfa', dis),
          }, '📦 归档')),
        ])
      })

      const archiveRows = archives.map(a => {
        const key = 'a:' + a.instanceId + '/' + a.entry
        return React.createElement('tr', { key }, [
          React.createElement('td', { key: 'c', style: cell }, checkbox(key, false)),
          React.createElement('td', { key: 'n', style: cell }, String(a.workflowName || '')),
          React.createElement('td', { key: 'i', style: Object.assign({}, cell, { color: '#9ca3af', fontFamily: 'monospace', fontSize: 11 }) }, String(a.instanceId).slice(-8) + '/' + String(a.entry)),
          React.createElement('td', { key: 'k', style: cell }, (a.kind === 'reset' ? '↻ 重置备份' : a.kind === 'archive' ? '📦 显式归档' : (a.kind || '—')) + ' · ' + (a.state || '')),
          React.createElement('td', { key: 'f', style: Object.assign({}, cell, { color: '#9ca3af' }) }, (a.files || 0) + ' 文件 · ' + fmtBytes(a.bytes)),
          React.createElement('td', { key: 't', style: Object.assign({}, cell, { color: '#9ca3af' }) }, fmtTime(a.archivedAt)),
          React.createElement('td', { key: 'd', style: cell }, React.createElement('button', {
            title: '删除此归档（不可恢复）', disabled: busy, onClick: () => doDeleteArchive(a.instanceId, a.entry), style: btn('#f87171', busy),
          }, '🗑 删除')),
        ])
      })

      const table = (heads, rows, emptyText) => rows.length
        ? React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } }, [
            React.createElement('thead', { key: 'h' }, React.createElement('tr', {}, heads.map((h, i) => React.createElement('td', { key: i, style: headCell }, h)))),
            React.createElement('tbody', { key: 'b' }, rows),
          ])
        : React.createElement('div', { style: { color: '#9ca3af', fontSize: 12, padding: '6px 8px' } }, emptyText)

      return React.createElement('div', {
        style: { margin: '0 12px 10px', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(148,163,184,0.04)' },
      }, [
        React.createElement('div', { key: 'bar', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
          React.createElement('span', { key: 't', style: { fontSize: 13, fontWeight: 600 } }, '实例管理'),
          React.createElement('span', { key: 'hint', style: { fontSize: 11, color: '#9ca3af' } }, '活动实例可归档（备份后移出池）；归档可下载/删除'),
          React.createElement('div', { key: 'sp', style: { flex: 1 } }),
          React.createElement('span', { key: 'sel', style: { fontSize: 11, color: checkedKeys.length ? '#60a5fa' : '#9ca3af' } }, '已选 ' + checkedKeys.length + ' 项'),
          React.createElement('button', { key: 'dl', disabled: busy || !checkedKeys.length, onClick: doDownload, title: '把选中项打包为一个 zip 下载', style: btn('#60a5fa', busy || !checkedKeys.length) }, '⬇ 下载'),
          React.createElement('button', { key: 'rf', disabled: busy, onClick: load, style: btn('#9ca3af', busy) }, '↻ 刷新'),
          React.createElement('button', { key: 'x', onClick: onClose, style: btn('#9ca3af', false) }, '✕ 关闭'),
        ]),
        msg ? React.createElement('div', {
          key: 'msg',
          style: {
            fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', borderRadius: 6, padding: '6px 9px',
            border: '1px solid ' + (msg.kind === 'ok' ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)'),
            background: msg.kind === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            color: msg.kind === 'ok' ? '#22c55e' : '#f87171',
          },
        }, msg.text) : null,
        React.createElement('div', { key: 'active', style: { display: 'flex', flexDirection: 'column' } },
          sectionTitle('活动实例', instances.length),
          table(['', '名称', 'ID', '状态', '进度', '绑定', '创建时间', '操作'], activeRows, loaded ? '当前没有活动实例。' : '加载中…')),
        React.createElement('div', { key: 'archive', style: { display: 'flex', flexDirection: 'column' } },
          sectionTitle('归档', archives.length),
          table(['', '名称', 'ID / 条目', '类别 · 状态', '内容', '归档时间', '操作'], archiveRows, '当前没有归档。')),
      ])
    }
    return ManagerComponent
  }

  function fingerprint(state) {
    if (!state || !state.tasks) return ''
    const t = state.tasks.map(x => x.id + ':' + x.status).join(',')
    return [state.stage || '', state.gateResult || '', state.retries || 0, t].join('|')
  }

  function publish(state) {
    // /wf/status 返回包装 {state,error,instanceId}；fingerprint 应从嵌套 state 取 tasks/stage（否则去重恒失效 → 每 2s 无谓重渲染）
    const inner = state && state.state ? state.state : state
    const fp = inner ? fingerprint(inner) : ''
    if (fp && latest && latest.__fp === fp) return
    if (state) state.__fp = fp
    latest = state; lastError = state ? null : 'disconnected'
    listeners.forEach(fn => { try { fn() } catch(e) {} })
  }

  // ── 实例列表轮询 ─────────────────────────────────────────────
  let listPollingTimer = null
  function startListPolling() {
    if (!activeRoot || !wfSessionActive) return
    // 清理旧的轮询
    if (listPollingTimer) {
      clearInterval(listPollingTimer)
    }
    
    const loadList = async () => {
      if (!activeRoot || !wfSessionActive) return
      try {
        const resp = await fetch('/wf/list?workspaceRoot=' + encodeURIComponent(activeRoot) + (wfSessionId ? '&sessionId=' + encodeURIComponent(wfSessionId) : ''))
        const r = await resp.json()
        wfInstances = r && Array.isArray(r.instances) ? r.instances : []
        wfSessionState = r && r.sessionState ? r.sessionState : null
        wfStopHint = r && r.stopHint && r.stopHint.active ? r.stopHint : null // Iter-23(A3)
        listeners.forEach(fn => { try { fn() } catch (e2) {} })
      } catch (e) {
        // 静默失败，下次轮询重试
      }
    }
    
    // 立即加载一次
    loadList()
    // 每 10 秒轮询
    listPollingTimer = setInterval(loadList, 10000)
  }

  // ── 轮询逻辑 ───────────────────────────────────────────────────
  ctx.effect(() => {
    if (pollingActive) return
    pollingActive = true
    let stop = false

    window.__wfSetRoot = r => { wfRoot = r }

    const refresh = async () => {
      if (stop || !wfSessionActive) return
      try {
        // Iter-5：webServer HTTP 路由替代 harness RPC（host.call）
        // Iter-20：只查询**本会话绑定实例**（不存在→空态）；绝不取"工作区最新实例"
        const boundId = wfInstances.find(it => it.sessionId === wfSessionId)
        const q = '/wf/status?workspaceRoot=' + encodeURIComponent(wfRoot || '') + (boundId ? '&instanceId=' + encodeURIComponent(boundId.instanceId) : '')
        const resp = await fetch(q)
        const s = await resp.json()
        if (!stop) publish(s)
      } catch(e) {
        if (!stop) {
          lastError = e && e.message ? e.message : String(e)
          listeners.forEach(fn => { try { fn() } catch(e2) {} })
        }
      }
    }

    refresh()
    // 浏览器原生定时器（npm 包 Client 半边无 timer 服务；官方 client 插件同用 setInterval）
    const d = window.setInterval(refresh, 2000)

    return () => {
      stop = true
      pollingActive = false
      window.clearInterval(d)
      delete window.__wfSetRoot
    }
  })

  // ── 颜色映射 ────────────────────────────────────────────────────
  const C = {
    PENDING: '#9ca3af',
    RUNNING: '#3b82f6',
    DONE: '#22c55e',
    FAILED: '#ef4444',
    SKIPPED: '#f59e0b'
  }

  // ── LoopGroup 节点组件 ─────────────────────────────────────────
  function LoopGroupNode(props) {
    const { x, y, gW, gH, group, selectedId, onSelect, isExpanded, onToggle } = props
    const items = group.items, total = items.length
    const counts = { PENDING: 0, RUNNING: 0, DONE: 0, FAILED: 0, SKIPPED: 0 }
    items.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1 })
    const aggStatus = counts.RUNNING > 0 ? 'RUNNING' : counts.FAILED > 0 ? 'FAILED' : counts.SKIPPED > 0 ? 'SKIPPED' : counts.DONE === total ? 'DONE' : 'PENDING'
    const mc = C[aggStatus] || C.PENDING
    const isSel = selectedId === group.key

    const segs = []
    const segTypes = ['DONE','RUNNING','FAILED','SKIPPED','PENDING']
    segTypes.forEach(st => { if (counts[st] > 0) segs.push({ c: C[st], n: counts[st] }) })

    const tx = x + 8, ty = y + 16, barY = y + 33, countY = y + 45
    const barW = gW - 16
    const els = [
      React.createElement('rect', {
        key: 'bg', x, y, width: gW, height: gH, rx: 8,
        fill: mc, opacity: 0.92,
        stroke: isSel ? '#fff' : 'transparent',
        strokeWidth: isSel ? 3 : 0,
        cursor: 'pointer',
        onClick: () => onSelect(group.key)
      }),
      React.createElement('text', {
        key: 'tt', x: tx, y: ty, fill: '#fff', fontSize: 11, fontWeight: 600
      }, (props.label || '\u21BB ') + group.name + ' (' + total + ')'),
    ]

    // 进度条
    if (segs.length > 0) {
      els.push(
        React.createElement('rect', {
          key: 'pb', x: tx, y: barY, width: barW, height: 6, rx: 3,
          fill: 'rgba(0,0,0,0.2)'
        })
      )
      let segX = tx
      segs.forEach((s, i) => {
        const segW = Math.max(s.n / total * barW, 8)
        els.push(React.createElement('rect', {
          key: 'ps' + i, x: segX, y: barY, width: segW, height: 6, rx: 3, fill: s.c
        }))
        segX += segW
      })
    }

    // 计数标签
    const countStr = ['DONE','RUNNING','FAILED','SKIPPED'].map(st => {
      const c = counts[st]
      if (!c) return ''
      const sym = st === 'DONE' ? '\u2713' : st === 'RUNNING' ? '\u25CF' : st === 'FAILED' ? '\u2717' : '\u23ED'
      return c + sym
    }).filter(Boolean).join(' ')
    els.push(React.createElement('text', {
      key: 'ct', x: tx, y: countY, fill: 'rgba(255,255,255,0.9)', fontSize: 9
    }, countStr))

    // 展开/折叠图标
    els.push(
      React.createElement('text', {
        key: 'ex', x: x + gW - 8, y: ty, textAnchor: 'end', fill: '#fff', fontSize: 11, cursor: 'pointer',
        onClick: (e) => { e.stopPropagation(); onToggle() }
      }, isExpanded ? '\u25B2' : '\u25B6'),
    )

    return els
  }

  // ── DAG 画布组件 ───────────────────────────────────────────────
  const DagCanvas = React.memo(function DagCanvas(props) {
    const { stage, gateResult, tasks, selectedId, onSelect, workflowName, retries, error } = props
    const mc = stage === 'COMPLETED' ? (gateResult === 'FAIL' ? C.FAILED : C.DONE) : stage === 'FAILED' ? C.FAILED : stage === 'RUNNING' ? C.RUNNING : C.PENDING

    // 构建流程节点：start + 普通task / 垂直组(dependsOn相同无框) / loop折叠框 / concurrent折叠框 + end（Iter-8）
    const flat = Array.isArray(tasks) ? tasks : []
    const flowNodes = [], loopGroups = [], concGroups = []
    const depKeyOf = (t) => JSON.stringify((t.dependsOn || []).slice().sort())

    // start 节点（流程起点）
    flowNodes.push({ type: 'start' })

    for (let gi = 0; gi < flat.length;) {
      const t = flat[gi]
      if (t._loopGroup) {
        // loop 折叠框
        const g = { key: t._loopGroup, name: t._loopGroupName || t._loopGroup, items: [] }
        while (gi < flat.length && flat[gi]._loopGroup === g.key) { g.items.push(flat[gi]); gi++ }
        loopGroups.push(g)
        // Iter-26R：检测占位组框（单元素 + _pendingItems 非空 + !_expanded）
        const isPlaceholder = g.items.length === 1 && g.items[0]._pendingItems && !g.items[0]._expanded
        flowNodes.push({ type: 'loop', group: g, isPlaceholder })
      } else if (t._concurrentGroup) {
        // Iter-8：concurrent 折叠框（⚡ 并发）
        const g = { key: t._concurrentGroup, name: t._concurrentGroupName || t._concurrentGroup, items: [] }
        while (gi < flat.length && flat[gi]._concurrentGroup === g.key) { g.items.push(flat[gi]); gi++ }
        concGroups.push(g)
        // Iter-26R：检测占位组框
        const isPlaceholder = g.items.length === 1 && g.items[0]._pendingItems && !g.items[0]._expanded
        flowNodes.push({ type: 'concgroup', group: g, isPlaceholder })
      } else {
        // 垂直组：连续多个 dependsOn 相同的 task（无线框，垂直排列，可并发）
        const depKey = depKeyOf(t)
        let j = gi + 1
        while (j < flat.length && !flat[j]._loopGroup && !flat[j]._concurrentGroup && depKeyOf(flat[j]) === depKey) j++
        if (j - gi > 1) {
          flowNodes.push({ type: 'vertgroup', tasks: flat.slice(gi, j), key: 'vg-' + t.id })
          gi = j
        } else {
          flowNodes.push({ type: 'task', task: t })
          gi++
        }
      }
    }

    // end 节点（流程终点）
    flowNodes.push({ type: 'end' })

    const gW = 132, gH = 46, gHLoop = 64, gap = 44, pad = 24
    const gapV = 8, padV = 10 // Iter-7：并发组内垂直间隔 + 组框内 padding
    let svgX = pad
    const svgChildren = []

    // 展开状态
    const [expanded, setExpanded] = React.useState({})
    const toggleGroup = React.useCallback(key => {
      setExpanded(prev => {
        const n = {}
        for (const k in prev) n[k] = prev[k]
        n[key] = !prev[key]
        return n
      })
    }, [])

    // 最高节点高度（统一垂直中心 + SVG 高度）
    const nodeHeightOf = (fn) => {
      if (fn.type === 'loop' || fn.type === 'concgroup') return gHLoop
      if (fn.type === 'vertgroup') return 2 * padV + fn.tasks.length * gH + (fn.tasks.length - 1) * gapV
      return gH
    }
    const maxH = flowNodes.reduce((mx, fn) => Math.max(mx, nodeHeightOf(fn)), 0)
    const centerY = maxH / 2 + pad

    // 节点位置
    const nodePositions = []

    flowNodes.forEach((fn, fi) => {
      const h = nodeHeightOf(fn)
      const cy = fn.type === 'start' || fn.type === 'end' ? centerY - gH / 2 : centerY - h / 2

      if (fn.type === 'task') {
        const t = fn.task
        const isSel = selectedId === t.id
        svgChildren.push(
          React.createElement('rect', {
            key: 'r' + t.id, x: svgX, y: cy, width: gW, height: h, rx: 8,
            fill: C[t.status] || C.PENDING, opacity: 0.92,
            stroke: isSel ? '#fff' : 'transparent', strokeWidth: isSel ? 3 : 0,
            cursor: 'pointer', onClick: () => onSelect(t.id)
          }),
          React.createElement('text', {
            key: 't' + t.id, x: svgX + gW / 2, y: cy + h / 2 + 5,
            textAnchor: 'middle', fill: '#fff', fontSize: 12, fontWeight: 600
          }, t.name || t.id),
          React.createElement('text', {
            key: 'u' + t.id, x: svgX + gW / 2, y: cy + h / 2 + 18,
            textAnchor: 'middle', fill: 'rgba(255,255,255,0.85)', fontSize: 10
          }, t.id),
        )
      } else if (fn.type === 'start') {
        // start 节点（绿色实心小圆点，流程起点）
        const cx = svgX + gW / 2
        svgChildren.push(
          React.createElement('circle', { key: 'st', cx, cy: centerY, r: 12, fill: '#22c55e' }),
        )
      } else if (fn.type === 'end') {
        // end 节点（红色空心小圆圈，流程终点）
        const cx = svgX + gW / 2
        svgChildren.push(
          React.createElement('circle', { key: 'en', cx, cy: centerY, r: 12, fill: 'none', stroke: '#ef4444', strokeWidth: 3 }),
        )
      } else if (fn.type === 'loop') {
        // Loop 组节点
        const g = fn.group
        if (fn.isPlaceholder) {
          // Iter-26R：占位组框（虚线琥珀色 + "⏳ 等待 items..."）
          svgChildren.push(
            React.createElement('rect', {
              key: 'ph-r-' + g.key, x: svgX, y: cy, width: gW, height: gHLoop, rx: 8,
              fill: 'rgba(245, 158, 11, 0.15)', opacity: 0.92,
              stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6,3',
            }),
            React.createElement('text', {
              key: 'ph-t-' + g.key, x: svgX + gW / 2, y: cy + gHLoop / 2 - 2,
              textAnchor: 'middle', fill: '#f59e0b', fontSize: 12, fontWeight: 600
            }, '↻ ' + (g.name || g.key)),
            React.createElement('text', {
              key: 'ph-u-' + g.key, x: svgX + gW / 2, y: cy + gHLoop / 2 + 14,
              textAnchor: 'middle', fill: '#f59e0b', fontSize: 10, opacity: 0.8
            }, '⏳ 等待 items...'),
          )
        } else {
          const lgEls = LoopGroupNode({
            x: svgX, y: cy, gW, gH: gHLoop, group: g,
            selectedId, onSelect, isExpanded: !!expanded[g.key], onToggle: () => toggleGroup(g.key)
          })
          svgChildren.push(...lgEls)
        }
      } else if (fn.type === 'concgroup') {
        // Iter-8：concurrent 节点——复用 LoopGroupNode（实线 + 进度 + 状态 + 可展开），标注 ⚡ 并发
        const g = fn.group
        if (fn.isPlaceholder) {
          // Iter-26R：占位组框（虚线琥珀色 + "⏳ 等待 items..."）
          svgChildren.push(
            React.createElement('rect', {
              key: 'ph-r-' + g.key, x: svgX, y: cy, width: gW, height: gHLoop, rx: 8,
              fill: 'rgba(245, 158, 11, 0.15)', opacity: 0.92,
              stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6,3',
            }),
            React.createElement('text', {
              key: 'ph-t-' + g.key, x: svgX + gW / 2, y: cy + gHLoop / 2 - 2,
              textAnchor: 'middle', fill: '#f59e0b', fontSize: 12, fontWeight: 600
            }, '⚡ ' + (g.name || g.key)),
            React.createElement('text', {
              key: 'ph-u-' + g.key, x: svgX + gW / 2, y: cy + gHLoop / 2 + 14,
              textAnchor: 'middle', fill: '#f59e0b', fontSize: 10, opacity: 0.8
            }, '⏳ 等待 items...'),
          )
        } else {
          const cgEls = LoopGroupNode({
            x: svgX, y: cy, gW, gH: gHLoop, group: g,
            selectedId, onSelect, isExpanded: !!expanded['cc-' + g.key], onToggle: () => toggleGroup('cc-' + g.key),
            label: '\u26A1 并发 '
          })
          svgChildren.push(...cgEls)
        }
      } else {
        // Iter-8：依赖同一前驱的节点——垂直并列，无线框（各自独立，可并发）
        fn.tasks.forEach((t, i) => {
          const ty = cy + padV + i * (gH + gapV)
          const isSel = selectedId === t.id
          svgChildren.push(
            React.createElement('rect', {
              key: 'r' + t.id, x: svgX + 4, y: ty, width: gW - 8, height: gH, rx: 6,
              fill: C[t.status] || C.PENDING, opacity: 0.92,
              stroke: isSel ? '#fff' : 'transparent', strokeWidth: isSel ? 3 : 0,
              cursor: 'pointer', onClick: () => onSelect(t.id)
            }),
            React.createElement('text', {
              key: 't' + t.id, x: svgX + gW / 2, y: ty + gH / 2 + 5,
              textAnchor: 'middle', fill: '#fff', fontSize: 12, fontWeight: 600
            }, t.name || t.id),
            React.createElement('text', {
              key: 'u' + t.id, x: svgX + gW / 2, y: ty + gH / 2 + 18,
              textAnchor: 'middle', fill: 'rgba(255,255,255,0.85)', fontSize: 10
            }, t.id),
          )
        })
      }

      nodePositions.push({
        x: svgX, w: gW, h,
        type: fn.type,
        key: fn.type === 'start' || fn.type === 'end' ? fn.type
          : fn.type === 'loop' || fn.type === 'concgroup' ? fn.group.key
          : fn.type === 'vertgroup' ? fn.key
          : fn.task.id
      })
      svgX += gW + gap

      // 箭头（统一 centerY，对准所有节点中心）
      if (fi < flowNodes.length - 1) {
        svgChildren.push(
          React.createElement('line', {
            key: 'a' + fi,
            x1: svgX - gap + 3, y1: centerY,
            x2: svgX - 3, y2: centerY,
            stroke: '#94a3b8', strokeWidth: 2, markerEnd: 'url(#da)'
          }),
        )
      }
    })

    // 箭头标记
    if (flowNodes.length > 0) {
      svgChildren.push(
        React.createElement('defs', { key: 'd' },
          React.createElement('marker', {
            id: 'da', viewBox: '0 0 10 10', refX: 9, refY: 5,
            markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
          },
          React.createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#94a3b8' }))))
    }

    const svgW = flowNodes.length ? pad * 2 + flowNodes.reduce((s, fn, i) => s + (i > 0 ? gap : 0) + gW, 0) : 0
    const svgH = maxH + 2 * pad

    // 展开的列表（SVG 下方）
    const listElems = []
    loopGroups.forEach(g => {
      if (!expanded[g.key]) return
      const pos = nodePositions.find(p => p.type === 'loop' && p.key === g.key)
      if (!pos) return
      const listX = pos.x
      const listW = gW
      listElems.push(
        React.createElement('div', {
          key: 'll' + g.key,
          style: {
            marginLeft: listX + 'px',
            width: listW + 'px',
            background: 'rgba(148,163,184,0.05)',
            border: '1px solid rgba(148,163,184,0.2)',
            borderTop: 'none',
            borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
            padding: '4px 0',
            fontSize: 12,
          },
        }, g.items.map((t, i) => {
          const sel = selectedId === t.id
          return React.createElement('div', {
            key: t.id, onClick: () => onSelect(t.id),
            style: {
              display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px',
              cursor: 'pointer', background: sel ? 'rgba(59,130,246,0.1)' : 'transparent',
            },
          }, [
            React.createElement('span', {
              style: { width: 8, height: 8, borderRadius: 4, background: C[t.status] || C.PENDING, flexShrink: 0 }
            }),
            React.createElement('span', { style: { flex: 1, color: '#475569' } }, (i + 1) + '. ' + (t.name || t.id)),
            React.createElement('span', { style: { color: '#64748b', fontSize: 11 } }, t.status),
          ])
        }))
      )
    })

    // Iter-8：concurrent 组展开列表（SVG 下方，同 loop）
    concGroups.forEach(g => {
      if (!expanded['cc-' + g.key]) return
      const pos = nodePositions.find(p => p.type === 'concgroup' && p.key === g.key)
      if (!pos) return
      const listX = pos.x
      const listW = gW
      listElems.push(
        React.createElement('div', {
          key: 'cl' + g.key,
          style: {
            marginLeft: listX + 'px',
            width: listW + 'px',
            background: 'rgba(59,130,246,0.05)',
            border: '1px solid rgba(59,130,246,0.2)',
            borderTop: 'none',
            borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
            padding: '4px 0',
            fontSize: 12,
          },
        }, g.items.map((t, i) => {
          const sel = selectedId === t.id
          return React.createElement('div', {
            key: t.id, onClick: () => onSelect(t.id),
            style: {
              display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px',
              cursor: 'pointer', background: sel ? 'rgba(59,130,246,0.1)' : 'transparent',
            },
          }, [
            React.createElement('span', {
              style: { width: 8, height: 8, borderRadius: 4, background: C[t.status] || C.PENDING, flexShrink: 0 }
            }),
            React.createElement('span', { style: { flex: 1, color: '#475569' } }, (i + 1) + '. ' + (t.name || t.id)),
            React.createElement('span', { style: { color: '#64748b', fontSize: 11 } }, t.status),
          ])
        }))
      )
    })

    return React.createElement('div', { style: { padding: '14px 18px 10px' } }, [
      // 状态栏
      React.createElement('div', {
        key: 'sb',
        style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, fontSize: 12, color: '#64748b', flexWrap: 'wrap' },
      }, [
        React.createElement('span', { key: 'w', style: { fontWeight: 600, color: '#334155' } }, workflowName || '-'),
        React.createElement('span', { key: 's' }, 'S: ', React.createElement('span', { style: { color: mc, fontWeight: 700 } },
          (stage || '-') + ' ' + (stage === 'PENDING' ? 'Pd' : stage === 'RUNNING' ? 'Rn' : stage === 'COMPLETED' ? 'Cp' : 'Fl'))),
        React.createElement('span', { key: 'g' }, 'G: ', gateResult
          ? React.createElement('span', { style: { color: gateResult === 'PASS' ? C.DONE : C.FAILED, fontWeight: 700 } }, gateResult)
          : '-'),
        retries > 0 ? React.createElement('span', { key: 'r' }, 'R: ' + retries) : null,
        error ? React.createElement('span', { key: 'e', style: { color: C.FAILED } }, error) : null,
      ]),
      // SVG 流程图
      flowNodes.length > 0 ? React.createElement('svg', {
        key: 'svg', width: svgW, height: svgH,
        xmlns: 'http://www.w3.org/2000/svg',
        style: { background: 'rgba(148,163,184,0.08)', borderRadius: 8, width: '100%', maxWidth: svgW, marginBottom: 0 },
      }, svgChildren) : null,
      // 展开的列表
      React.createElement('div', { key: 'lx', style: { position: 'relative', marginTop: -4 } }, listElems),
    ])
  })

  // ── Slot 注册 ──────────────────────────────────────────────────
  slots.inject('conversation.view', () => {
    return slots.register(
      { name: 'conversation.view', id: 'workflow', order: 25, label: () => 'Workflow' },
      function WorkflowViewFactory(props) {
        const workspaceHook = props.useWorkspaces
        const sessionId = props.sessionId
        wfSessionId = (sessionId === undefined || sessionId === null) ? '' : String(sessionId)
        const useSessions = props.useSessions
        // Iter-12：跟随当前 session 的 cwd（切 session → 实例目录跟随）
        const sessionCwd = useSessions
          ? useSessions((s) => (sessionId === undefined || sessionId === null) ? undefined : (s.byId && s.byId[sessionId] ? s.byId[sessionId].cwd : undefined))
          : undefined
        // Iter-15：提取 parentSessionId（用于 subagent session 的消息注入）
        const parentSessionId = useSessions
          ? useSessions((s) => (sessionId === undefined || sessionId === null) ? undefined : (s.byId && s.byId[sessionId] ? s.byId[sessionId].parentSessionId : undefined))
          : undefined
        // Iter-20(S5)：当前会话 agent preset（预设门控；仅 workflow-orchestrator 显示面板）
        const sessionPreset = useSessions
          ? useSessions((s) => (sessionId === undefined || sessionId === null) ? undefined : (s.byId && s.byId[sessionId] ? s.byId[sessionId].agentPreset : undefined))
          : undefined
        // Iter-21(R2)：子会话（origin==='subagent'）一律占位，不显示工作流面板
        const sessionOrigin = useSessions
          ? useSessions((s) => (sessionId === undefined || sessionId === null) ? undefined : (s.byId && s.byId[sessionId] ? s.byId[sessionId].origin : undefined))
          : undefined
        const isWorkflowSession = sessionPreset === 'workflow-orchestrator' && sessionOrigin !== 'subagent'
        wfSessionActive = isWorkflowSession

        if (!WfComponent) {
          WfComponent = function(props) {
            const sessionId = props.sessionId
            const isWorkflowSession = props.isWorkflowSession
            const sessionCwd = props.sessionCwd
            const parentSessionId = props.parentSessionId
            const workspaceHook = props.workspaceHook
          const [, forceUpdate] = React.useReducer(x => x + 1, 0)
          const [selectedId, setSelectedId] = React.useState(null)

          React.useEffect(() => {
            listeners.add(forceUpdate)
            return () => listeners.delete(forceUpdate)
          }, [])

          // Iter-20(S5)：非编排会话 → 停止实例列表轮询（状态轮询由 wfSessionActive 短路）
          React.useEffect(() => {
            if (isWorkflowSession) {
              // Iter-21(R3)：成为 workflow 会话（如 preset 异步加载 false→true）→ 启动列表轮询
              if (activeRoot) startListPolling()
            } else {
              if (listPollingTimer) { clearInterval(listPollingTimer); listPollingTimer = null }
            }
            return () => {}
          }, [isWorkflowSession])

          // ── Iter-12：workspaceRoot 解析——session cwd 优先，回退当前工作区首项 ──
          React.useEffect(() => {
            let next = null
            if (typeof sessionCwd === 'string' && sessionCwd) {
              next = String(sessionCwd).replace(/\\/g, '/')
              // 如果是相对路径，转换为绝对路径
              if (!next.startsWith('/')) {
                next = '/home/zhaokai/Projects/dsh_projects/' + next
              }
            }
            if (!next && workspaceHook) {
              try {
                const wsList = workspaceHook()
                if (wsList && wsList.data && Array.isArray(wsList.data.items) && wsList.data.items.length > 0) {
                  next = String(wsList.data.items[0].path).replace(/\\/g, '/')
                }
              } catch (e) {}
            }
            if (!next || next === activeRoot) return
            activeRoot = next
            wfRoot = next
            wfLoaded = true
            latest = null; lastError = null
            wfInstances = []; wfInstanceId = ''
            if (typeof window.__wfSetRoot === 'function') window.__wfSetRoot(next)
            listeners.forEach(fn => { try { fn() } catch (e2) {} })
            // 启动实例列表轮询
            startListPolling()
          }, [sessionCwd, workspaceHook])

          // ── Iter-21(R3)：会话切换（含同工作区 cwd 不变）→ 重置会话派生态并重拉列表 ──
          React.useEffect(() => {
            const sid = (sessionId === undefined || sessionId === null) ? '' : String(sessionId)
            if (sid === wfLastSessionId) return
            wfLastSessionId = sid
            // 仅重置派生态（gating 用）；不重置 wfInstances（工作区级列表，同工作区仍有效/避免采用池空）
            // 不重置 latest（由 /wf/status 按新 boundId 更新，避免 DAG 闪空白）
            wfSessionState = null; wfInstanceId = ''; wfStopHint = null
            // 仅 workflow 会话重拉列表；非编排会话保持占位 + 短路轮询
            if (isWorkflowSession && activeRoot) startListPolling()
            listeners.forEach(fn => { try { fn() } catch (e) {} })
          }, [sessionId, isWorkflowSession])

          // ── Iter-12：实例列表轮询（只读；选择经 wfInstanceId 参与 status 轮询）──
          // 注意：轮询在 workspaceRoot 解析 effect 里启动，不依赖 React state
          // 这里只负责清理
          React.useEffect(() => {
            return () => {
              if (wfListLoader) {
                wfListLoader.stop = true
                wfListLoader = null
              }
            }
          }, [])

          const snap = latest
          const stateData = (snap && snap.state) ? snap.state : null
          const tasks = stateData && Array.isArray(stateData.tasks) ? stateData.tasks : []
          const hasData = stateData && stateData.workflow

          // ── Iter-13：面板创建（"+" + 表单；hooks 全部置于条件返回之前）────
          const [formOpen, setFormOpen] = React.useState(false)
          const [adoptOpen, setAdoptOpen] = React.useState(false) // Iter-20：采用未绑定实例
          // Iter-28：实例编辑器折叠开关（hooks 区声明；渲染条件在 hasData 分支内）
          const [editorOpen, setEditorOpen] = React.useState(false)
          // Iter-29：实例管理子页签开关（hooks 区声明；渲染在条件 return 之后）
          const [mgmtOpen, setMgmtOpen] = React.useState(false)
          const [tplOpts, setTplOpts] = React.useState([])
          const [tplSel, setTplSel] = React.useState('custom')
          const [yamlText, setYamlText] = React.useState('')
          const [pathText, setPathText] = React.useState('')
          // Iter-28：params 由 JSON textarea 改为 key-value 编辑器（模板默认值预填）
          const [paramsEntries, setParamsEntries] = React.useState([])
          // Iter-28：创建成功结果视图（warnings 非空/解绑冲突时展示，承接 Iter-25 遗留面板展示）
          const [createResult, setCreateResult] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const [formErr, setFormErr] = React.useState('')

          React.useEffect(() => {
            if (!formOpen || !activeRoot) return
            let stop = false
            fetch('/wf/templates?workspaceRoot=' + encodeURIComponent(activeRoot))
              .then(r => r.json())
              .then(r => {
                if (stop) return
                const opts = [{ v: 'custom', label: '自定义路径…' }]
                // Iter-24：单一 predefined 列表（预定义目录扫描优先 + 内建兜底去重）；工作区 templates/ 不再列入
                const descOf = (p) => {
                  if (!p || !p.yaml) return p && p.name
                  const m = p.yaml.match(/^description:\s*(.+)$/m)
                  return m ? m[1].replace(/^["']|["']$/g, '').trim() : p.name
                }
                ;(r.predefined || []).forEach(p => opts.push({ v: 'tpl:' + p.name, label: '[模板] ' + (descOf(p) || p.name) + (p.fallback ? '（内建兜底）' : ''), t: p }))
                setTplOpts(opts)
                if (opts.length > 1) {
                  setTplSel(opts[1].v); setYamlText(opts[1].t ? opts[1].t.yaml : '')
                  // Iter-28：默认模板 params 默认值预填（{key: default 原值} → 行编辑器形态）
                  const pv = opts[1].t && opts[1].t.params ? opts[1].t.params : {}
                  setParamsEntries(Object.keys(pv).map(k => ({ key: k, value: pv[k] === null || pv[k] === undefined ? '' : String(pv[k]) })))
                }
              })
              .catch(() => {})
            return () => { stop = true }
          }, [formOpen, activeRoot])

          const openForm = () => { setFormErr(''); setCreateResult(null); setFormOpen(true) }
          const pickTpl = (v) => {
            setTplSel(v)
            const opt = tplOpts.find(o => o.v === v)
            setYamlText(opt && opt.t ? opt.t.yaml : '')
            // Iter-28：切模板重置 params 预填
            const pv = opt && opt.t && opt.t.params ? opt.t.params : {}
            setParamsEntries(Object.keys(pv).map(k => ({ key: k, value: pv[k] === null || pv[k] === undefined ? '' : String(pv[k]) })))
          }
          // Iter-28：key-value 行 → params 对象（空 key 跳过；数字/布尔解析与旧 JSON 输入等价）
          const entriesToParams = (entries) => {
            const out = {}
            const seenDup = new Set()
            for (const e of entries) {
              const k = String(e.key || '').trim()
              if (!k) continue
              if (seenDup.has(k)) throw new Error('params 存在重复键: ' + k)
              seenDup.add(k)
              let v = String(e.value)
              try { v = JSON.parse(e.value) } catch (e2) { /* 保持字符串 */ }
              out[k] = v
            }
            return out
          }
          const submitCreate = async () => {
            setFormErr(''); setBusy(true)
            try {
              const params = entriesToParams(paramsEntries)
              const payload = { workspaceRoot: activeRoot, params, sessionId } // Iter-19：面板创建即绑定当前 sessionId
              if (tplSel === 'custom') {
                if (!pathText.trim()) throw new Error('请填写 workflowPath')
                payload.workflowPath = pathText.trim()
              } else if (tplSel.startsWith('tpl:')) {
                // Iter-24：模板选择统一走可编辑 yaml → workflowText（预定义与内建兜底同构）
                if (!yamlText.trim()) throw new Error('模板内容为空')
                payload.workflowText = yamlText
              }
              const resp = await fetch('/wf/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
              const r = await resp.json()
              if (!resp.ok) throw new Error((r && r.error) || ('HTTP ' + resp.status))
              if (typeof wfListLoader === 'function') wfListLoader()
              // Iter-28：创建成功 → 结果视图（warnings 面板展示，承接 Iter-25 遗留；
              // recoveredConflict 一并展示替代旧 alert）。warnings 为空且无冲突 → 直接关弹窗。
              const warns = r && Array.isArray(r.warnings) ? r.warnings : []
              const conflicts = r && Array.isArray(r.recoveredConflict) ? r.recoveredConflict : []
              if (warns.length > 0 || conflicts.length > 0) {
                setCreateResult({ warnings: warns, recoveredConflict: conflicts, instanceId: r.instanceId })
              } else {
                setFormOpen(false)
              }
            } catch (e) {
              setFormErr(e && e.message ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }

          const fieldStyle = { border: '1px solid rgba(148,163,184,0.4)', borderRadius: 6, padding: '4px 8px', background: 'rgba(148,163,184,0.08)', color: 'inherit', fontSize: 12, width: '100%', boxSizing: 'border-box' }
          const monoStyle = Object.assign({}, fieldStyle, { fontFamily: 'monospace', resize: 'vertical' })
          const btnStyle = { border: '1px solid rgba(148,163,184,0.4)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '3px 12px', cursor: 'pointer', fontSize: 12 }

          // Iter-15：面板控制按钮（Start/Stop/Reset）
          const controlBtns = []
          const currentStage = stateData && stateData.stage
          // Iter-20：当前实例 = 本会话绑定实例（snap 优先，其次 wfInstances 中绑本会话的实例）
          const boundInstance = wfInstances.find(it => it.sessionId === wfSessionId)
          const currentInstanceId = (snap && snap.instanceId) || (boundInstance && boundInstance.instanceId) || ''
          const sessionBound = !!(wfSessionState && wfSessionState.state === 'BOUND')

          // Iter-21：控制中间态终止——stage 已从 origin 移开（操作完成）或超时兜底
          if (wfPendingCmd && currentStage) {
            const originOk = wfPendingCmd === 'start'
              ? (currentStage === 'CREATED' || currentStage === 'PENDING')
              : wfPendingCmd === 'stop' ? (currentStage === 'RUNNING')
              : (currentStage === 'STOPPED')
            if (!originOk || (wfPendingAt && Date.now() - wfPendingAt > 30000)) {
              wfPendingCmd = null; wfPendingAt = 0
            }
          }
          
          // Start 按钮（仅本会话已绑定实例（BOUND）且为可启动态时显示）
          if (sessionBound && (!currentStage || currentStage === 'CREATED' || currentStage === 'PENDING')) {
            if (wfPendingCmd === 'start') {
              // Iter-21：中间态——agent 尚未把实例切到 RUNNING，禁用并显示"启动中…"
              controlBtns.push(React.createElement('button', {
                key: 'start', title: '启动中…', disabled: true,
                style: { border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: '#94a3b8', borderRadius: 6, padding: '1px 9px', fontSize: 12, cursor: 'default' }
              }, '启动中…'))
            } else {
              controlBtns.push(React.createElement('button', {
                key: 'start', title: '启动实例',
                onClick: async () => {
                  if (!currentInstanceId || !activeRoot) return
                  wfPendingCmd = 'start'; wfPendingAt = Date.now()
                  try {
                    const resp = await fetch('/wf/start', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        workspaceRoot: activeRoot, 
                        instanceId: currentInstanceId,
                        sessionId: sessionId, // 传递当前 session ID
                        parentSessionId: parentSessionId // 传递 parent session ID（用于 subagent session）
                      })
                    })
                    if (!resp.ok) {
                      const err = await resp.json()
                      alert('启动失败: ' + (err.error || '未知错误'))
                    }
                  } catch (e) {
                    alert('启动失败: ' + e.message)
                  }
                },
                style: { border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.1)', color: '#22c55e', borderRadius: 6, padding: '1px 9px', fontSize: 12, cursor: 'pointer' }
              }, '▶ Start'))
            }
          }
          
          // Stop 按钮（仅 RUNNING 时显示；PENDING 属待启动，非执行中）
          if (sessionBound && currentStage === 'RUNNING') {
            if (wfPendingCmd === 'stop') {
              // Iter-21：中间态——agent 尚未把实例切到 STOPPED，禁用并显示"停止中…"
              controlBtns.push(React.createElement('button', {
                key: 'stop', title: '停止中…', disabled: true,
                style: { border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: '#94a3b8', borderRadius: 6, padding: '1px 9px', fontSize: 12, cursor: 'default' }
              }, '停止中…'))
            } else {
              controlBtns.push(React.createElement('button', {
                key: 'stop', title: '停止实例',
                onClick: async () => {
                  if (!currentInstanceId || !activeRoot) return
                  wfPendingCmd = 'stop'; wfPendingAt = Date.now()
                  try {
                    const resp = await fetch('/wf/stop', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ workspaceRoot: activeRoot, instanceId: currentInstanceId, sessionId: sessionId, parentSessionId: parentSessionId }) // Iter-21：带 session 供消息注入
                    })
                    if (!resp.ok) {
                      const err = await resp.json()
                      alert('停止失败: ' + (err.error || '未知错误'))
                    }
                  } catch (e) {
                    alert('停止失败: ' + e.message)
                  }
                },
                style: { border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: 6, padding: '1px 9px', fontSize: 12, cursor: 'pointer' }
              }, '⏹ Stop'))
            }
          }
          
          // Iter-21(R5)：Resume 按钮（STOPPED 时显示；续跑保 DONE）
          if (sessionBound && currentStage === 'STOPPED') {
            if (wfPendingCmd === 'resume') {
              // Iter-21：中间态——agent 尚未把实例切到 RUNNING，禁用并显示"恢复中…"
              controlBtns.push(React.createElement('button', {
                key: 'resume', title: '恢复中…', disabled: true,
                style: { border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: '#94a3b8', borderRadius: 6, padding: '1px 9px', fontSize: 12, cursor: 'default' }
              }, '恢复中…'))
            } else {
              controlBtns.push(React.createElement('button', {
                key: 'resume', title: '恢复实例（续跑，保留已完成）',
                onClick: async () => {
                  if (!currentInstanceId || !activeRoot) return
                  wfPendingCmd = 'resume'; wfPendingAt = Date.now()
                  try {
                    const resp = await fetch('/wf/resume', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ workspaceRoot: activeRoot, instanceId: currentInstanceId, sessionId: sessionId, parentSessionId: parentSessionId }) // Iter-21：带 session 供消息注入
                    })
                    if (!resp.ok) {
                      const err = await resp.json()
                      alert('恢复失败: ' + (err.error || '未知错误'))
                    }
                  } catch (e) {
                    alert('恢复失败: ' + e.message)
                  }
                },
                style: { border: '1px solid rgba(59,130,246,0.5)', background: 'rgba(59,130,246,0.1)', color: '#3b82f6', borderRadius: 6, padding: '1px 9px', fontSize: 12, cursor: 'pointer' }
              }, '▶ Resume'))
            }
          }
          
          // Reset 按钮（STOPPED、COMPLETED、FAILED 时显示）
          if (sessionBound && (currentStage === 'STOPPED' || currentStage === 'COMPLETED' || currentStage === 'FAILED')) {
            controlBtns.push(React.createElement('button', {
              key: 'reset', title: '重置实例（清空状态，保留产物）',
              onClick: async () => {
                if (!currentInstanceId || !activeRoot) return
                if (!confirm('确定要重置实例吗？状态将被清空，产物文件保留。')) return
                try {
                  const resp = await fetch('/wf/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workspaceRoot: activeRoot, instanceId: currentInstanceId, sessionId: sessionId, parentSessionId: parentSessionId }) // Iter-22(S4)：带 session 供"已重置"消息注入
                  })
                  if (!resp.ok) {
                    const err = await resp.json()
                    alert('重置失败: ' + (err.error || '未知错误'))
                  }
                } catch (e) {
                  alert('重置失败: ' + e.message)
                }
              },
              style: { border: '1px solid rgba(245,158,11,0.5)', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', borderRadius: 6, padding: '1px 9px', fontSize: 12, cursor: 'pointer' }
            }, '↻ Reset'))
          }

          // Iter-19：创建按钮仅当会话 UNBOUND（无绑定实例）时显示
          const canCreate = !wfSessionState || wfSessionState.state === 'UNBOUND'
          // Iter-28：编辑器折叠开关（已绑定实例且有定义数据时可见）；
          // editorOpen state 声明在条件 return 之前的 hooks 区（见 formOpen 旁）。
          // 修正2：RUNNING 时按钮灰色禁用（运行中不可编辑，避免展开空编辑器）
          const EditorPanel = getEditorComponent()
          const stageNow = (stateData && stateData.stage) || ''
          const editBtn = (!canCreate && hasData && currentInstanceId)
            ? React.createElement('button', {
                key: 'edit',
                title: stageNow === 'RUNNING' ? '运行中不可编辑（停止后可改并发/重试）' : '展开/收起实例编辑器（保存触发 Iter-27b 校验）',
                disabled: stageNow === 'RUNNING',
                onClick: () => setEditorOpen(o => !o),
                style: {
                  border: editorOpen ? '1px solid rgba(59,130,246,0.7)' : '1px solid rgba(148,163,184,0.35)',
                  background: editorOpen ? 'rgba(59,130,246,0.15)' : 'transparent',
                  color: editorOpen ? '#60a5fa' : 'inherit',
                  borderRadius: 6, padding: '1px 9px', fontSize: 12,
                  cursor: stageNow === 'RUNNING' ? 'default' : 'pointer',
                  opacity: stageNow === 'RUNNING' ? 0.45 : 1,
                  lineHeight: '18px',
                }
              }, '✎ 编辑')
            : null
          const plusBtn = canCreate ? React.createElement('button', {
            key: 'plus', title: '新建 workflow 实例（只创建，不启动）', onClick: openForm,
            style: { border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '1px 9px', fontSize: 14, cursor: 'pointer', lineHeight: '18px' }
          }, '+ 创建') : null
          // Iter-20(R3)：会话 UNBOUND 时提供"采用"入口（选未绑定实例并绑定本会话）
          const adoptBtn = canCreate ? React.createElement('button', {
            key: 'adopt', title: '采用一个未绑定实例（绑定本会话）', onClick: () => { if (activeRoot) startListPolling(); setAdoptOpen(true) }, // Iter-21：打开即刷新列表，避免采用池空/延迟;孤儿可采纳(需 S3 recoverOrphan)属 Iter-22
            style: { border: '1px solid rgba(59,130,246,0.5)', background: 'rgba(59,130,246,0.1)', color: '#3b82f6', borderRadius: 6, padding: '1px 9px', fontSize: 12, cursor: 'pointer', lineHeight: '18px' }
          }, '采用') : null
          // Iter-29：实例管理子页签按钮（所有 workflow 会话可见：管理列表展示全量实例+归档，
          // UNBOUND 会话也可查看/下载/删除；与 DAG 视图互斥切换）
          const mgmtBtn = activeRoot ? React.createElement('button', {
            key: 'mgmt',
            title: '实例管理（活动/归档两段列表：归档、下载、删除）',
            onClick: () => setMgmtOpen(o => !o),
            style: {
              border: mgmtOpen ? '1px solid rgba(167,139,250,0.7)' : '1px solid rgba(148,163,184,0.35)',
              background: mgmtOpen ? 'rgba(167,139,250,0.15)' : 'transparent',
              color: mgmtOpen ? '#a78bfa' : 'inherit',
              borderRadius: 6, padding: '1px 9px', fontSize: 12,
              cursor: 'pointer', lineHeight: '18px',
            }
          }, '📋 管理') : null
          // 会话 UNBOUND → 显示 创建/采用；已绑定 → 显示状态机控制按钮（+ Iter-28 编辑入口）
          // Iter-29：管理按钮恒在末尾（与视图状态无关）
          const toolbar = React.createElement('div', {
            key: 'tb', style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, padding: '6px 12px 0' }
          }, (canCreate ? [plusBtn, adoptBtn] : (editBtn ? controlBtns.concat([editBtn]) : controlBtns)).concat(mgmtBtn ? [mgmtBtn] : []))

          const KvEditor = getKeyValueComponent()
          const formOverlay = !formOpen ? null : React.createElement('div', {
            style: { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
            onClick: () => setFormOpen(false)
          }, React.createElement('div', {
            style: { background: 'var(--dsw-alias-bg-base, #1e293b)', color: 'var(--dsw-alias-label-primary, #e2e8f0)', borderRadius: 10, padding: 16, width: 460, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 },
            onClick: (e) => e.stopPropagation()
          }, createResult ? [
            // Iter-28：创建成功结果视图（warnings / 解绑冲突清单展示）
            React.createElement('div', { key: 't', style: { fontSize: 13, fontWeight: 600, color: '#22c55e' } }, '✓ 创建成功（' + (createResult.instanceId || '') + '）'),
            createResult.recoveredConflict.length > 0 ? React.createElement('div', {
              key: 'cf', style: { border: '1px solid rgba(59,130,246,0.45)', background: 'rgba(59,130,246,0.08)', color: '#60a5fa', borderRadius: 6, padding: '6px 9px', whiteSpace: 'pre-wrap' }
            }, '检测到实例绑定冲突：已自动解绑 [' + createResult.recoveredConflict.join(', ') + '] 回未绑定池；当前实例已绑定本会话。') : null,
            React.createElement('div', { key: 'wl', style: { fontWeight: 600 } }, createResult.warnings.length > 0 ? '⚠ 校验警告（' + createResult.warnings.length + ' 项，不阻断创建）' : '校验通过，无警告'),
            createResult.warnings.length > 0 ? React.createElement('div', {
              key: 'ws', style: { border: '1px solid rgba(245,158,11,0.45)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', borderRadius: 6, padding: '6px 9px', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }
            }, createResult.warnings.map((w, i) => React.createElement('div', { key: i }, '· ' + w))) : null,
            React.createElement('div', { key: 'btns', style: { display: 'flex', justifyContent: 'flex-end' } }, [
              React.createElement('button', { key: 'c', onClick: () => setFormOpen(false), style: Object.assign({}, btnStyle, { background: '#3b82f6', color: '#fff', border: 'none' }) }, '关闭'),
            ]),
          ] : [
            React.createElement('div', { key: 't', style: { fontSize: 13, fontWeight: 600 } }, '新建 workflow 实例（只创建，不启动）'),
            React.createElement('label', { key: 'l1' }, '模板 / 来源'),
            React.createElement('select', { key: 's1', value: tplSel, onChange: e => pickTpl(e.target.value), style: fieldStyle },
              tplOpts.map(o => React.createElement('option', { key: o.v, value: o.v }, o.label))
            ),
            tplSel === 'custom' ? React.createElement('input', { key: 'p', value: pathText, onChange: e => setPathText(e.target.value), placeholder: 'workflow YAML 绝对路径', style: fieldStyle }) : null,
            tplSel.indexOf('tpl:') === 0 ? React.createElement('textarea', { key: 'y', value: yamlText, onChange: e => setYamlText(e.target.value), rows: 10, style: monoStyle, spellCheck: false }) : null,
            React.createElement('label', { key: 'l2' }, 'params（键值对；模板默认值已预填，可增删改）'),
            React.createElement(KvEditor, { key: 'pj', entries: paramsEntries, onChange: setParamsEntries, keyPlaceholder: '参数名', valuePlaceholder: '值' }),
            formErr ? React.createElement('div', { key: 'err', style: { color: '#f87171', whiteSpace: 'pre-wrap' } }, formErr) : null,
            React.createElement('div', { key: 'btns', style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } }, [
              React.createElement('button', { key: 'c', onClick: () => setFormOpen(false), style: btnStyle }, '取消'),
              React.createElement('button', { key: 'o', onClick: submitCreate, disabled: busy, style: Object.assign({}, btnStyle, { background: '#3b82f6', color: '#fff', border: 'none' }) }, busy ? '创建中…' : '创建'),
            ]),
          ]))

          // Iter-20(S5)：非 workflow-orchestrator 会话 → 占位（不显示面板/控件）
          if (!isWorkflowSession) {
            return React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 420, color: '#9ca3af', fontSize: 13 }
            }, '此会话不是 Workflow 编排会话，无监控面板。')
          }
          // Iter-20(S5)：BROKEN → 环境异常告警（隐藏操作按钮）
          if (wfSessionState && wfSessionState.state === 'BROKEN') {
            return React.createElement('div', {
              style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: '100%', minHeight: 420, color: '#ef4444', fontSize: 13 }
            }, [
              React.createElement('div', { key: 't', style: { fontWeight: 600, fontSize: 14 } }, '⚠ 环境异常，需新建 workflow 会话'),
              React.createElement('div', { key: 'r', style: { color: '#9ca3af', fontSize: 12, textAlign: 'center', maxWidth: 420 } },
                wfSessionState.reason ? ('原因：' + wfSessionState.reason) : '工作流工作区损坏或存在绑定冲突，无法继续使用当前实例。'),
            ])
          }
          // Iter-20(S5)：DONE（归档声明本会话）→ 已归档提示（不可再启动）
          if (wfSessionState && wfSessionState.state === 'DONE') {
            return React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 420, color: '#9ca3af', fontSize: 13 }
            }, '该工作流实例已归档（完成）。如需新建请开启新的 Workflow 编排会话。')
          }

          if (!wfLoaded) {
            return React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 420, color: '#9ca3af', fontSize: 13 }
            }, '...')
          }

          if (!wfRoot) {
            return React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 420, color: '#9ca3af', fontSize: 13, flexDirection: 'column', gap: 8 }
            }, [
              React.createElement('span', { key: 'a' }, 'No workspace'),
              React.createElement('span', { key: 'b', style: { fontSize: 11 } }, 'Open a workspace first')
            ])
          }


          // ── Iter-20(R3)：移除常驻实例切换条；改为"采用"弹窗（可选未绑定实例并绑定本会话）──
          const poolInstances = wfInstances.filter(it => it.sessionId == null)
          const instBar = null // R3：不再常驻展示实例列表
          const doAdopt = async (pid) => {
            if (!sessionId || !activeRoot) { alert('无会话上下文，无法采用'); return }
            try {
              const resp = await fetch('/wf/adopt', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceRoot: activeRoot, instanceId: pid, sessionId })
              })
              const r = await resp.json()
              if (!resp.ok) throw new Error((r && r.error) || ('HTTP ' + resp.status))
              setAdoptOpen(false); wfInstanceId = ''
              if (typeof wfListLoader === 'function') wfListLoader()
            } catch (e) { alert('采用失败: ' + (e && e.message ? e.message : String(e))) }
          }
          const adoptOverlay = !adoptOpen ? null : React.createElement('div', {
            style: { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
            onClick: () => setAdoptOpen(false)
          }, React.createElement('div', {
            style: { background: 'var(--dsw-alias-bg-base, #1e293b)', color: 'var(--dsw-alias-label-primary, #e2e8f0)', borderRadius: 10, padding: 16, width: 420, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 },
            onClick: (e) => e.stopPropagation()
          }, [
            React.createElement('div', { key: 'tt', style: { fontSize: 13, fontWeight: 600 } }, '采用未绑定实例（绑定到本会话）'),
            (poolInstances.length === 0
              ? React.createElement('div', { key: 'e', style: { color: '#9ca3af', fontSize: 12 } }, '当前没有未绑定实例。请先「创建」一个新实例。')
              : React.createElement('div', { key: 'lst', style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' } },
                poolInstances.map(it => React.createElement('button', {
                  key: it.instanceId, onClick: () => doAdopt(it.instanceId),
                  style: { textAlign: 'left', border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }
                }, it.workflowName + ' · ' + String(it.instanceId).slice(-8) + (it.poolNote ? ' · ' + it.poolNote : (it.stage ? ' · ' + it.stage : ' · 未启动')))))),
            React.createElement('button', { key: 'c', onClick: () => setAdoptOpen(false), style: btnStyle }, '取消'),
          ]))

          // Iter-23(A3)：Case I 停止无效提示条（状态触发非点击触发：绑定实例 RUNNING + 主会话
          // 空闲 + 子会话在跑时 /wf/list 返回 stopHint；状态解除自动消失）
          const stopHintBar = !wfStopHint ? null : React.createElement('div', {
            key: 'stopHint', role: 'status',
            style: { margin: '6px 12px 0', padding: '7px 12px', borderRadius: 8, fontSize: 12, lineHeight: '18px', border: '1px solid rgba(245,158,11,0.45)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }
          }, '⏸ ' + (wfStopHint.message || '编排会话空闲等待中：会话内的停止按钮此刻无效。后台任务执行中——要停止工作流请点面板 Stop'))

          // Iter-29：管理子页签组件（activeRoot 存在时可用；与 DAG 视图互斥）
          const ManagerPanel = getManagerComponent()
          const mgmtView = (mgmtOpen && activeRoot)
            ? React.createElement(ManagerPanel, {
                workspaceRoot: activeRoot,
                onClose: () => setMgmtOpen(false),
                onChanged: () => { if (typeof wfListLoader === 'function') wfListLoader() },
              })
            : null

          if (!hasData) {
            return React.createElement('div', {
              style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, fontFamily: 'inherit', fontSize: 13 }
            },
              toolbar,
              stopHintBar,
              formOverlay,
            adoptOverlay,
              mgmtView ? mgmtView : React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9ca3af', fontSize: 13, border: '1px dashed rgba(148,163,184,0.35)', borderRadius: 8, margin: 12, background: 'rgba(148,163,184,0.05)' }
              }, stateData && stateData.error ? 'Workflow Error: ' + stateData.error : (canCreate ? '尚未绑定工作流实例。点击「创建」新建，或「采用」绑定一个未绑定实例。' : 'Waiting for workflow...'))
            )
          }


          return React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, fontFamily: 'inherit', fontSize: 13 }
          },
            toolbar,
            stopHintBar,
            // Iter-29：管理子页签打开时替换 DAG+编辑器主区（互斥切换）
            mgmtView ? mgmtView : React.createElement(React.Fragment, { key: 'dagview' },
              React.createElement(DagCanvas, {
                stage: stateData.stage,
                gateResult: stateData.gateResult || null,
                tasks,
                selectedId,
                onSelect: id => setSelectedId(prev => prev === id ? null : id),
                workflowName: stateData.workflow,
                retries: stateData.retries || 0,
                error: stateData.error || null,
              }),
              // Iter-28：折叠编辑器（DAG 下方；默认收起，✎ 编辑展开）；
              // stage=外部 2s 轮询权威值（修正3：编辑器展开期间实例启停 → 权限即时刷新）
              editorOpen && currentInstanceId && activeRoot
                ? React.createElement(EditorPanel, {
                    workspaceRoot: activeRoot,
                    instanceId: currentInstanceId,
                    stage: stateData ? stateData.stage : '',
                    onClose: () => setEditorOpen(false),
                    onSaved: () => { if (typeof wfListLoader === 'function') wfListLoader() },
                  })
                : null,
            ),
            formOverlay,
            adoptOverlay
          )
          }
        }
        return React.createElement(WfComponent, { sessionId, isWorkflowSession, sessionCwd, parentSessionId, workspaceHook })
      },
    )
  })
}
