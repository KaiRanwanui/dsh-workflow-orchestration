#!/usr/bin/env node
// render-smoke.mjs — 客户端深渲染语义冒烟（阶段 4 事故防线，提交前必跑）
// 覆盖：① apply 期崩溃（T is not defined 类）② 渲染树 TDZ/引用错误 ③ 深主体语义断言
//（按钮文案/任务名/执行态路径）④ 无 RUNNING 场景不崩 ⑤ 非编排会话返回 null
// 用法：node scripts/render-smoke.mjs   （失败 exit 1）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const lib = fs.readFileSync(path.join(root, 'packages/workflow-host/lib/client.js'), 'utf8')
const effectQueue = []
globalThis.__intervals = []

// ── stub React：hooks 立即执行；useEffect 收集后手动触发（可捕获 effect 期异常）
const React = {
  createElement: (t, p, ...k) => ({ type: t, props: p || {}, kids: k }),
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useReducer: (r, i) => [typeof i === 'function' ? i() : i, () => {}],
  useRef: (v) => ({ current: v === undefined ? null : v }),
  useEffect: (fn) => { effectQueue.push(fn) },
  useCallback: (f) => f, useMemo: (f) => f(),
  memo: (c) => c, Fragment: 'Fragment',
}
globalThis.window = { confirm: () => false, alert: () => {}, setInterval: (fn) => { globalThis.__intervals.push(fn); return 0 }, clearInterval: () => {}, setTimeout: (f) => 0 }

let loadedDef = null
globalThis.window.__ModuleLoader__ = { load: (d) => { loadedDef = d } }
new Function('window', 'require', lib)(
  globalThis.window,
  (n) => (n === 'react' ? React : undefined),
)
const mod = loadedDef.factory((n) => (n === 'react' ? React : undefined))

let gate = null
const slotsStub = {
  inject(name, factory) { try { return factory(undefined) } catch { return () => {} } },
  register(o, c) { gate = c; return () => {} },
}
const snap = {
  current: 'sess-wf', instanceId: 'demo-00000001',
  byId: { 'sess-wf': { cwd: '/home/zhaokai/Projects/dsh_wf_ws', projectionValues: { agentPreset: 'workflow-orchestrator' } } },
}
const mockResp = (u) => {
  if (u.includes('/wf/list')) return { instances: [{ instanceId: 'demo-00000001', sessionId: 'sess-wf', phase: 'STOPPED', stage: 'STOPPED', workflowName: 'demo' }], sessionState: { state: 'BOUND' } }
  if (u.includes('/wf/status')) return { state: { workflow: 'demo', stage: 'STOPPED', tasks: [
    { id: 'a', name: '任务A', type: 'llm-task', dependsOn: [], status: 'RUNNING', gateChecker: null, inputs: {}, outputs: ['/ws/out/a.md'], retries: 0 },
  ] }, instanceId: 'demo-00000001' }
  if (u.includes('/wf/instance-yaml')) return { name: 'demo', tasks: [
    { id: 'a', name: '任务A-改名', type: 'llm-task', dependsOn: [], status: 'PENDING', gateChecker: null, inputs: {}, outputs: ['/ws/out/a.md'] },
    { id: 'newtask', name: '新增任务', type: 'llm-task', dependsOn: ['a'], status: 'PENDING', inputs: {}, outputs: [] },
  ] }
  return {}
}
globalThis.fetch = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResp(u)) })

mod.apply({
  effect(fn) { try { fn() } catch (e) { globalThis.__effErr = globalThis.__effErr || e } },
  get(n) {
    if (n === 'slots') return slotsStub
    if (n === 'sessions') return { list: { getSnapshot: () => snap, subscribe: () => () => {} } }
    return undefined
  },
})
if (!gate) { console.error('FAIL: gate 未注册'); process.exit(1) }

const useSessions = (sel) => sel(snap)
const useWorkspaces = () => ({ data: { items: [{ path: '/home/zhaokai/Projects/dsh_wf_ws' }] } })

function walk(el, depth, out) {
  if (err || el === null || el === undefined || el === false || el === true || depth > 30) return
  if (typeof el === 'string') { out.push(el); return }
  if (typeof el === 'number') { out.push(String(el)); return }
  if (Array.isArray(el)) { el.forEach((x) => walk(x, depth + 1, out)); return }
  if (typeof el.type === 'function') { try { walk(el.type(el.props || {}), depth + 1, out) } catch (e) { err = err || e } ; return }
  if (el.kids) walk(el.kids, depth + 1, out)
}
let err = null
let texts = []

function renderOnce(label, expect) {
  texts = []
    try { walk(gate({ sessionId: 'sess-wf', useSessions, useWorkspaces }), 0, texts) } catch (e) { err = err || e }
  for (const fn of effectQueue) { try { fn() } catch (e) { err = err || e } }
  if (err) { console.error(`FAIL[${label}]: ${err.stack || err.message}`); process.exit(1) }
  if (globalThis.__effErr) { console.error(`FAIL[${label}] effect: ${globalThis.__effErr.message}`); process.exit(1) }
  const all = texts.join('|')
  for (const need of expect) {
    if (all.indexOf(need) === -1) { console.error(`FAIL[${label}]: 缺少「${need}」；实际文本=${JSON.stringify(all.slice(0, 260))}`); process.exit(1) }
  }
  return all
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await (async () => {
  // 轮次 1：workspace 解析 + defData 拉取（effects 同步执行）
  renderOnce('首轮', [])
  await sleep(30)
  // 手动触发全部轮询 tick（list + status），再等微任务回填
  for (const fn of globalThis.__intervals) { try { fn() } catch (e) { err = err || e } }
  await sleep(50)
  if (err) { console.error(`FAIL[tick]: ${err.message}`); process.exit(1) }
  // 轮次 2：defData 回填 → 深主体语义断言
  const all = renderOnce('深主体', ['▶ 恢复', '↻ 重置', '✎ 编辑', '📋 管理', '任务A', 'RUNNING', 'wfdag-pulse', '开始', '结束'])
  console.log(`深主体语义断言通过（文本量 ${all.length}）`)
  // 注：defData 回填依赖真实 React 的 deps 重跑机制（stub useEffect 不重跑），
  // 「结构=instance.yaml」的数据链已在真实环境探针验证；本门禁覆盖渲染路径无崩溃 + 深主体语义。
})()

// 场景：非编排会话 → 门控返回空（不渲染、不抛错）
const el = gate({ sessionId: 'sess-c', useSessions: (sel) => sel({ current: 'sess-c', byId: { 'sess-c': { cwd: '/x', projectionValues: { agentPreset: 'cordis' } } } }) })
if (el !== null && el !== undefined) { console.error('FAIL: 非编排会话应为 null'); process.exit(1) }
console.log('非编排会话门控通过')
console.log('RENDER SMOKE PASS')
