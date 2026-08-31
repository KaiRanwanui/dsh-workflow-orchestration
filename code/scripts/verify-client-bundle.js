// 临时验证：client bundle 求值 + __ModuleLoader__.load 注册 + factory 导出完整性
const fs = require('fs')
const path = require('path')
const libPath = path.join(__dirname, '..', 'packages', 'client-ui-monitor', 'lib', 'client.js')
const code = fs.readFileSync(libPath, 'utf8')

const reactStub = { createElement: function () { return null } }
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
if (loadedDef.id !== '@workflow-agent/client-ui-monitor') { console.error('FAIL: id 不符: ' + loadedDef.id); process.exit(1) }

const mod = loadedDef.factory(fakeRequire)
if (typeof mod.apply !== 'function' || !Array.isArray(mod.inject)) {
  console.error('FAIL: exports 不完整: apply=' + typeof mod.apply + ' inject=' + JSON.stringify(mod.inject))
  process.exit(1)
}
console.log('OK: bundle 求值 + load 注册 + factory 导出 apply/inject 全部通过; inject=' + JSON.stringify(mod.inject))
