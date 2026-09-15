// ============================================================================
// Generate client-body for Iter-5: collapsed loop groups + break/continue
// Usage: node code/plugins/workflow-client/build-client.js
// ============================================================================
const fs = require('fs'), path = require('path')

function buildClient() {
  return `
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (!slots) return

    let latest = null, lastError = null
    const listeners = new Set()
    let pollingActive = false
    let wfRoot = ''
    let wfLoaded = false

    function fingerprint(state) {
      if (!state || !state.tasks) return ''
      const t = state.tasks.map(x => x.id + ':' + x.status).join(',')
      return [state.stage || '', state.gateResult || '', state.retries || 0, t].join('|')
    }
    function publish(state) {
      const fp = state ? fingerprint(state) : ''
      if (fp && latest && latest.__fp === fp) return
      if (state) state.__fp = fp
      latest = state
      lastError = state ? null : 'disconnected'
      listeners.forEach(function(fn) { try { fn() } catch(e) {} })
    }

    ctx.effect(function() {
      if (pollingActive) return
      pollingActive = true
      let stop = false
      window.__wfSetRoot = function(r) { wfRoot = r }
      var refresh = async function() {
        if (stop) return
        try {
          var s = await host.call('wf:status', { workspaceRoot: wfRoot || '' })
          if (!stop) publish(s)
        } catch(e) {
          if (!stop) {
            lastError = e && e.message ? e.message : String(e)
            listeners.forEach(function(fn) { try { fn() } catch(e2) {} })
          }
        }
      }
      refresh()
      var d = ctx.interval(refresh, 2000)
      return function() { stop = true; pollingActive = false; d(); delete window.__wfSetRoot }
    })

    var C = { PENDING: '#9ca3af', RUNNING: '#3b82f6', DONE: '#22c55e', FAILED: '#ef4444', SKIPPED: '#f59e0b' }

    // LoopGroup component: collapsible HTML section
    function LoopGroup(props) {
      var group = props.group, selectedId = props.selectedId, onSelect = props.onSelect
      var isExpanded = props.isExpanded, onToggle = props.onToggle
      var items = group.items, total = items.length
      var counts = {}
      items.forEach(function(t) { counts[t.status] = (counts[t.status] || 0) + 1 })
      var dn = counts.DONE || 0, rn = counts.RUNNING||0, fl = counts.FAILED||0
      var sk = counts.SKIPPED||0, pn = counts.PENDING||0, done = dn > 0, run = rn > 0
      var fail = fl > 0, skip = sk > 0, pend = pn > 0

      var countEls = []
      if (done) countEls.push(React.createElement('span', { style: { color: C.DONE, fontWeight: 600 } }, dn + '\\u2713'))
      if (run) countEls.push(React.createElement('span', { style: { color: C.RUNNING, fontWeight: 600 } }, rn + '\\u25C9'))
      if (fail) countEls.push(React.createElement('span', { style: { color: C.FAILED, fontWeight: 600 } }, fl + '\\u2717'))
      if (skip) countEls.push(React.createElement('span', { style: { color: C.SKIPPED, fontWeight: 600 } }, sk + '\\u23ED'))
      if (pend) countEls.push(React.createElement('span', { style: { color: C.PENDING, fontWeight: 600 } }, pn + '\\u23F3'))

      var segs = []
      if (dn) segs.push({ c: C.DONE, n: dn })
      if (rn) segs.push({ c: C.RUNNING, n: rn })
      if (fl) segs.push({ c: C.FAILED, n: fl })
      if (sk) segs.push({ c: C.SKIPPED, n: sk })
      if (pn) segs.push({ c: C.PENDING, n: pn })

      var bar = React.createElement('div', {
        style: { display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', flex: 1, maxWidth: 200 }
      }, segs.map(function(s, i) {
        return React.createElement('div', { key: i, style: { flex: s.n, background: s.c, minWidth: 4 + '%' } })
      }))

      var header = React.createElement('div', {
        onClick: onToggle, key: 'hdr',
        style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', cursor: 'pointer', borderRadius: 6, background: 'rgba(148,163,184,0.05)', marginBottom: 2 }
      }, [
        React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' } }, '\\u21BB ' + (group.name || group.key) + ' (' + total + ')'),
        bar,
        React.createElement('span', { style: { fontSize: 11, color: '#64748b', display: 'flex', gap: 4, flexWrap: 'wrap' } }, countEls),
        React.createElement('span', { style: { fontSize: 10, color: '#94a3b8', marginLeft: 'auto' } }, isExpanded ? '\\u25B2' : '\\u25B6')
      ])

      if (!isExpanded) return header

      var list = React.createElement('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px 8px' } },
        items.map(function(t, i) {
          var sel = selectedId === t.id
          return React.createElement('div', {
            key: t.id, onClick: function() { onSelect(t.id) },
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', background: sel ? 'rgba(59,130,246,0.1)' : 'transparent' }
          }, [
            React.createElement('span', { style: { width: 10, height: 10, borderRadius: 5, background: C[t.status] || C.PENDING, flexShrink: 0 } }),
            React.createElement('span', { style: { fontSize: 12, color: '#475569', flex: 1 } }, (i + 1) + '. ' + (t.name || t.id)),
            React.createElement('span', { style: { fontSize: 11, color: '#64748b' } }, t.status)
          ])
        })
      )

      return [header, list]
    }

    // DagCanvas renders status bar + non-loop SVG + loop groups
    var DagCanvas = React.memo(function DagCanvas(props) {
      var stage = props.stage, gateResult = props.gateResult
      var tasks = props.tasks, selectedId = props.selectedId, onSelect = props.onSelect
      var workflowName = props.workflowName, retries = props.retries, error = props.error

      var mc = stage === 'COMPLETED' ? (gateResult === 'FAIL' ? C.FAILED : C.DONE)
        : stage === 'FAILED' ? C.FAILED : stage === 'RUNNING' ? C.RUNNING : C.PENDING

      // Separate non-loop tasks vs loop groups
      var flat = Array.isArray(tasks) ? tasks : []
      var flow = flat.filter(function(t) { return !t._loopGroup })
      var loopGroups = []
      for (var gi = 0; gi < flat.length;) {
        var t = flat[gi]
        if (t._loopGroup) {
          var g = { key: t._loopGroup, name: t._loopGroupName || t._loopGroup, items: [] }
          while (gi < flat.length && flat[gi]._loopGroup === g.key) { g.items.push(flat[gi]); gi++ }
          loopGroups.push(g)
        } else { gi++ }
      }

      // SVG for non-loop flow items
      var gW = 132, gH = 46, gap = 44, pad = 24
      var svgX = pad, svgChildren = []
      if (flow.length > 0) {
        flow.forEach(function(t) {
          var isSel = selectedId === t.id
          svgChildren.push(
            React.createElement('rect', { key: 'r' + t.id, x: svgX, y: 28, width: gW, height: gH, rx: 8,
              fill: C[t.status] || C.PENDING, opacity: 0.92,
              stroke: isSel ? '#fff' : 'transparent', strokeWidth: isSel ? 3 : 0,
              cursor: 'pointer', onClick: function() { onSelect(t.id) } }),
            React.createElement('text', { key: 't' + t.id, x: svgX + gW/2, y: 55, textAnchor: 'middle', fill: '#fff', fontSize: 12, fontWeight: 600 }, t.name || t.id),
            React.createElement('text', { key: 'u' + t.id, x: svgX + gW/2, y: 69, textAnchor: 'middle', fill: 'rgba(255,255,255,0.85)', fontSize: 10 }, t.id)
          )
          // Arrow
          if (t !== flow[flow.length-1]) {
            svgChildren.push(
              React.createElement('line', { key: 'l' + t.id, x1: svgX + gW, y1: 51, x2: svgX + gW + gap, y2: 51, stroke: '#94a3b8', strokeWidth: 2, markerEnd: 'url(#da)' })
            )
          }
          svgX += gW + gap
        })
      }
      if (flow.length > 0) {
        svgChildren.push(
          React.createElement('defs', { key: 'd' }, React.createElement('marker', { id: 'da', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
            React.createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#94a3b8' })))
        )
      }

      var svgW = flow.length ? pad * 2 + Math.max(flow.length, 1) * (gW + gap) - gap : 0
      var svgH = flow.length ? 28 * 2 + gH : 0

      // Expand state
      var expState = React.useState({})
      var expanded = expState[0], setExpanded = expState[1]
      var toggleGroup = React.useCallback(function(key) {
        setExpanded(function(prev) {
          var n = {}; for (var k in prev) n[k] = prev[k]; n[key] = !n[key]; return n
        }) }, [])

      return React.createElement('div', { style: { padding: '14px 18px 10px' } }, [
        // Status bar
        React.createElement('div', { key: 'sb', style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, fontSize: 12, color: '#64748b', flexWrap: 'wrap' } }, [
          React.createElement('span', { key: 'w', style: { fontWeight: 600, color: '#334155' } }, workflowName || '-'),
          React.createElement('span', { key: 's' }, 'S: ', React.createElement('span', { style: { color: mc, fontWeight: 700 } }, (stage || '-') + ' ' + (stage === 'PENDING' ? 'Pd' : stage === 'RUNNING' ? 'Rn' : stage === 'COMPLETED' ? 'Cp' : 'Fl'))),
          React.createElement('span', { key: 'g' }, 'G: ', gateResult
            ? React.createElement('span', { style: { color: gateResult === 'PASS' ? C.DONE : C.FAILED, fontWeight: 700 } }, gateResult)
            : '-'),
          retries > 0 ? React.createElement('span', { key: 'r' }, 'R: ' + retries) : null,
          error ? React.createElement('span', { key: 'e', style: { color: C.FAILED } }, error) : null,
        ]),
        // Non-loop SVG
        flow.length > 0 ? React.createElement('svg', { key: 'svg', width: svgW, height: svgH, xmlns: 'http://www.w3.org/2000/svg',
          style: { background: 'rgba(148,163,184,0.08)', borderRadius: 8, width: '100%', maxWidth: svgW, marginBottom: 8 } }, svgChildren) : null,
        // Loop groups
        loopGroups.length > 0 ? React.createElement('div', { key: 'lp', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          loopGroups.map(function(g) {
            return React.createElement(LoopGroup, {
              key: g.key, group: g, selectedId: selectedId, onSelect: onSelect,
              isExpanded: expanded[g.key] || false, onToggle: function() { toggleGroup(g.key) }
            }) })) : null,
      ])
    })

    // Slot registration
    slots.inject('conversation.view', function() {
      return slots.register(
        { name: 'conversation.view', id: 'workflow', order: 25, label: function() { return 'Workflow' } },
        function WorkflowViewFactory(props) {
          var workspaceHook = props.useWorkspaces

          function WorkflowView() {
            var fu = React.useReducer(function(x) { return x + 1 }, 0)[1]
            var selState = React.useState(null)
            var selectedId = selState[0], setSelectedId = selState[1]

            React.useEffect(function() { listeners.add(fu); return function() { listeners.delete(fu) } }, [])

            React.useEffect(function() {
              if (wfLoaded) return
              try {
                if (workspaceHook) {
                  var wsList = workspaceHook()
                  if (wsList && wsList.data && Array.isArray(wsList.data.items) && wsList.data.items.length > 0) {
                    var r = String(wsList.data.items[0].path).replace(/\\\\/g, '/')
                    wfRoot = r
                    if (typeof window.__wfSetRoot === 'function') window.__wfSetRoot(r)
                    wfLoaded = true
                    return
                  }
                }
              } catch(e) {}
              host.call('wf:config', { workspaceRoot: 'C:/Users/ranwa/dsh_workspace' }).then(function(r) {
                if (r && r.valid) { wfRoot = r.workspaceRoot; if (typeof window.__wfSetRoot === 'function') window.__wfSetRoot(r.workspaceRoot) }
                wfLoaded = true
              }).catch(function() { wfLoaded = true })
            }, [workspaceHook])

            var snap = latest
            var stateData = (snap && snap.state) ? snap.state : null
            var tasks = stateData && Array.isArray(stateData.tasks) ? stateData.tasks : []
            var hasData = stateData && stateData.workflow

            if (!wfLoaded) return React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 420, color: '#9ca3af', fontSize: 13 } }, '...')
            if (!wfRoot) return React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 420, color: '#9ca3af', fontSize: 13, flexDirection: 'column', gap: 8 } },
              [React.createElement('span', { key: 'a' }, 'No ws'), React.createElement('span', { key: 'b', style: { fontSize: 11 } }, 'Open WO')])
            if (!hasData) return React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 420, color: '#9ca3af', fontSize: 13, border: '1px dashed rgba(148,163,184,0.35)', borderRadius: 8, margin: 12, background: 'rgba(148,163,184,0.05)' } },
              stateData && stateData.error ? 'Wf Error: ' + stateData.error : 'Wait...')

            return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420, fontFamily: 'inherit', fontSize: 13 } },
              React.createElement(DagCanvas, {
                stage: stateData.stage, gateResult: stateData.gateResult || null,
                tasks: tasks, selectedId: selectedId,
                onSelect: function(id) { return function() { setSelectedId(function(p) { return p === id ? null : id }) } },
                workflowName: stateData.workflow, retries: stateData.retries || 0, error: stateData.error || null
              })
            )
          }

          return React.createElement(WorkflowView)
        }
      )
    })
  },
}
`.trim()
}

// Main
const code = buildClient()
fs.writeFileSync(path.join(__dirname, '_client-gen.js'), code, 'utf8')
console.log('‚ú?Written to _client-gen.js (' + code.length + ' chars)')
try { new Function(code); console.log('‚ú?Syntax OK') }
catch(e) { console.log('‚ù?Syntax error: ' + e.message); process.exit(1) }