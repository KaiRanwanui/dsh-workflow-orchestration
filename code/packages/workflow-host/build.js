#!/usr/bin/env node
// ============================================================================
// workflow-agent — workflow-host 单一生成器（阶段 3：构建链合并）
// 文件：code/packages/workflow-host/build.js
//
// 输入：code/scripts/module-manifest.js（有序源模块清单）
// 输出：① lib/index.js                 （CJS 交付物，运行时由 profile 加载，入库）
//       ② dist/workflow-host.mjs      （ESM 生成物，入库；应急/preset 本地插件形态）
//
// 与旧链的差异（0.1.5 迁移收尾后确立）：
//   - 不再经过手编中间物 workflow-host.mjs（原 sync-modules + build.js 两步合一）
//   - CJS 产物**剥离**源模块尾部的 `if (typeof module !== 'undefined')` 条件导出块
//     （否则 apply() 执行时会篡改 module.exports —— 阶段 2 验证报告缺陷）
//   - 导出面：{ name, inject, apply, registerWebRoutes, loadStateFromFile }
//     （后两者供 test-host 对真实产物直测路由）
//
// 用法：
//   node build.js                     # 默认产出 CJS + ESM
//   node build.js --format=cjs        # 只产 CJS
//   node build.js --format=esm        # 只产 ESM
//   node build.js --check             # 只做产物新鲜度检查（陈旧 exit 1）
//   作为模块：const { build, needsBuild } = require('./build.js')
// ============================================================================

const fs = require('fs')
const path = require('path')

const PKG_DIR = __dirname
const CODE_DIR = path.join(PKG_DIR, '..', '..')
const MANIFEST_PATH = path.join(CODE_DIR, 'scripts', 'module-manifest.js')
const LIB_PATH = path.join(PKG_DIR, 'lib', 'index.js')
const DIST_DIR = path.join(PKG_DIR, 'dist')
const DIST_ESM_PATH = path.join(DIST_DIR, 'workflow-host.mjs')

const manifest = require(MANIFEST_PATH)

// ── 源读取 ──────────────────────────────────────────────────────────────────
// CJS/ESM 产物统一剥离源模块尾部的条件导出块：
//   ESM 下本就是死代码；CJS 下会篡改 module.exports（阶段 2 验证报告缺陷）。
function readSources() {
  return manifest.modules.map((m) => {
    const p = path.join(CODE_DIR, m.path)
    let text = fs.readFileSync(p, 'utf8')
    text = text.replace(/\nif \(typeof module !== 'undefined'[\s\S]*$/, '\n')
    text = text.replace(/\s+$/, '\n')
    return { id: m.id, path: m.path, text }
  })
}

// ── 产物新鲜度：清单或任一源模块 mtime 晚于产物 → 陈旧 ─────────────────────
function inputPaths() {
  return [MANIFEST_PATH, ...manifest.modules.map((m) => path.join(CODE_DIR, m.path))]
}
function needsBuild() {
  const outs = [LIB_PATH, DIST_ESM_PATH]
  if (!outs.every((o) => fs.existsSync(o))) return true
  const newestInput = Math.max(...inputPaths().map((p) => fs.statSync(p).mtimeMs))
  return outs.some((o) => fs.statSync(o).mtimeMs < newestInput)
}

// ── 拼接 ────────────────────────────────────────────────────────────────────
function assemble(format) {
  const srcs = readSources()
  const prologue = srcs[0] // apply-prologue（applyInternal 定义）
  const sections = srcs.slice(1)

  const banner = [
    `// @workflow-agent/workflow-host — ${format.toUpperCase()} 产物（AUTO-GENERATED，勿手编）`,
    '// 生成器：code/packages/workflow-host/build.js；清单：code/scripts/module-manifest.js',
    '// 源模块：' + manifest.modules.map((m) => m.path).join(', '),
    '',
  ]

  if (format === 'cjs') {
    const parts = [...banner]
    parts.push(`const name = ${JSON.stringify(manifest.name)}`)
    parts.push(`const inject = ${JSON.stringify(manifest.inject)}`)
    parts.push('')
    parts.push(prologue.text)
    for (const s of sections) {
      parts.push('// ---- module: ' + s.id + ' (' + s.path + ') ----')
      parts.push(s.text)
    }
    parts.push('function apply(ctx) {')
    parts.push('  applyInternal(ctx)')
    parts.push('}')
    parts.push('')
    parts.push('module.exports = { name, inject, apply, registerWebRoutes, loadStateFromFile }')
    return parts.join('\n')
  }

  // esm
  const parts = [...banner]
  parts.push(`export const name = ${JSON.stringify(manifest.name)}`)
  parts.push(`export const inject = ${JSON.stringify(manifest.inject)}`)
  parts.push('')
  parts.push(prologue.text)
  for (const s of sections) {
    parts.push('// ---- module: ' + s.id + ' (' + s.path + ') ----')
    parts.push(s.text)
  }
  parts.push('export function apply(ctx) {')
  parts.push('  applyInternal(ctx)')
  parts.push('}')
  parts.push('')
  parts.push('export { registerWebRoutes, loadStateFromFile }')
  return parts.join('\n')
}

// ── 构建 ────────────────────────────────────────────────────────────────────
function build(options = {}) {
  const format = options.format || 'both'
  const written = []
  if (format === 'cjs' || format === 'both') {
    fs.mkdirSync(path.dirname(LIB_PATH), { recursive: true })
    fs.writeFileSync(LIB_PATH, assemble('cjs'), 'utf8')
    written.push(LIB_PATH)
  }
  if (format === 'esm' || format === 'both') {
    fs.mkdirSync(DIST_DIR, { recursive: true })
    fs.writeFileSync(DIST_ESM_PATH, assemble('esm'), 'utf8')
    written.push(DIST_ESM_PATH)
  }
  return written
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2)
  if (argv.includes('--check')) {
    if (needsBuild()) {
      console.error('✗ 产物陈旧（源模块/清单晚于产物）——请运行 node build.js')
      process.exit(1)
    }
    console.log('✓ 产物为最新')
    process.exit(0)
  }
  let format = 'both'
  const fi = argv.indexOf('--format')
  if (fi >= 0) {
    format = (argv[fi + 1] || '').toLowerCase()
    if (!['cjs', 'esm', 'both'].includes(format)) {
      console.error('✗ --format 仅支持 cjs | esm | both')
      process.exit(1)
    }
  }
  const written = build({ format })
  for (const w of written) {
    console.log('✓ 生成 ' + w + '（' + fs.statSync(w).size + ' bytes）')
  }
}

module.exports = { build, needsBuild, assemble }
