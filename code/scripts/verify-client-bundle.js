// 临时验证：client bundle 求值 + __ModuleLoader__.load 注册 + factory 导出完整性
const fs = require('fs')
const path = require('path')
const libPath = path.join(__dirname, '..', 'packages', 'workflow-host', 'lib', 'client.js')
const code = fs.readFileSync(libPath, 'utf8')

const reactStub = {
  createElement: function (t, p) { return { type: t, props: p || {} } },
  useState: function (i) { return [typeof i === 'function' ? i() : i, function () {}] },
  useReducer: function (r, i) { return [typeof i === 'function' ? i() : i, function () {}] },
  useRef: function (v) { return { current: v === undefined ? null : v } },
  useEffect: function () {}, useCallback: function (f) { return f }, useMemo: function (f) { return f() },
  memo: function (c) { return c }, Fragment: 'Fragment',
}
const fakeRequire = (name) => {
  if (name === 'react') return reactStub
  throw new Error('unexpected require: ' + name)
}

let loadedDef = null
const loaderHolder = { __ModuleLoader__: { load(def) { loadedDef = def } } }

// 执行 bundle（window 为局部参数，不污染 global）
const fn = new Function('window', 'require', code)
fn(loaderHolder, fakeRequire)

if (!loadedDef) { console.error('FAIL: __ModuleLoader__.load 未被调用'); process.exit(1) }
if (loadedDef.id !== '@workflow-agent/workflow-host') { console.error('FAIL: id 不符: ' + loadedDef.id); process.exit(1) }

const mod = loadedDef.factory(fakeRequire)
if (typeof mod.apply !== 'function' || !Array.isArray(mod.inject)) {
  console.error('FAIL: exports 不完整: apply=' + typeof mod.apply + ' inject=' + JSON.stringify(mod.inject))
  process.exit(1)
}

// Iter-43 增强：apply 冒烟——用最小 stub ctx 实际执行 apply，捕获
// "X is not defined"（T 常量静默丢失类）/ TDZ 等 apply 期崩溃（v0.26.44 事故教训）
try {
  const React = { createElement: function () { return null }, useState: function (i) { return [typeof i === 'function' ? i() : i, function () {}] }, useRef: function (v) { return { current: v === undefined ? null : v } }, useEffect: function () {}, useCallback: function (f) { return f }, useMemo: function (f) { return f() }, useReducer: function (r, i) { return [typeof i === 'function' ? i() : i, function () {}] }, memo: function (c) { return c }, Fragment: 'Fragment', createElement: function (t, p) { for (var k in (p || {})) { if (k === 'children') continue } return { type: t, props: p } }, useCallback: function (f) { return f }, useReducer: function (r, i) { return [typeof i === 'function' ? i() : i, function () {}] } }
  const slotsCalls = []
  const stubCtx = {
    effect() {},
    get(n) {
      if (n === 'react') return React
      if (n === 'slots') {
        return { inject(name, factory) { slotsCalls.push(name); try { return factory(undefined) } catch (e) { return function () {} } }, register(o, c) { return function () {} } }
      }
      if (n === 'sessions') return { list: { getSnapshot() { return { current: null, byId: {} } }, subscribe() { return function () {} } } }
      return undefined
    },
  }
  mod.apply(stubCtx)
  if (!slotsCalls.includes('conversation.view')) { console.error('FAIL: apply 未注册 conversation.view'); process.exit(1) }
  console.log('OK: apply 冒烟通过（conversation.view 已注册）')
} catch (e) {
  console.error('FAIL: apply 冒烟异常: ' + (e && e.message ? e.message : String(e)))
  process.exit(1)
}
console.log('OK: bundle 求值 + load 注册 + factory 导出 apply/inject 全部通过; inject=' + JSON.stringify(mod.inject))
