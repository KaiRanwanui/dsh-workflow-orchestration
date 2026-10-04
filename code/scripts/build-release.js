#!/usr/bin/env node
// ============================================================================
// workflow-agent — 发行构建（3c 创立；阶段 6 / B2 改造：preset 随包声明制）
// 文件：code/scripts/build-release.js
//
// 一键产出可分发的 npm tarball 并做内容断言：
//   ① 构建 Host 双产物（lib/index.js + dist/workflow-host.mjs）
//      —— 阶段 6 起 build.js 同步把 persona 随包资产（persona-file.mjs +
//      system-prompt.md，唯一源在 code/agent-presets/workflow-orchestrator/）
//      复制进 lib/
//   ② 构建 Client 产物（lib/client.js）+ 产物级验证
//   ③ npm pack（单包）→ release/ 目录
//      —— 阶段 6 / B2：preset 不再目录暂存；随包交付物为入库静态文件
//      presets/workflow-orchestrator.patch.yml（进 dsh.bundle.patch 链）
//   ④ 内容断言：tarball 内必须含 patch 链 + persona 资产 + 引擎产物
//   ⑤ 版本矩阵一致性（engines 对齐 0.2.0）
//
// 用法：node code/scripts/build-release.js
// 产物：release/workflow-agent-workflow-host-<ver>.tgz
// （单 tgz 发行；安装：node code/scripts/install.js --tgz release/）
// ============================================================================

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const CODE = path.resolve(__dirname, '..')
const ROOT = path.resolve(CODE, '..')
const PKG = path.join(CODE, 'packages', 'workflow-host')
const RELEASE_DIR = path.join(ROOT, 'release')
// npm 缓存指向仓库本地（默认 ~/.npm 在受限环境可能只读，导致 pack EROFS）
const NPM_CACHE = path.join(ROOT, '.npm-cache-release')

// 阶段 6 / B2：随包断言清单（preset 声明 + persona 资产为包内一等交付物）
const MUST_BUNDLE = [
  'package/presets/workflow-orchestrator.patch.yml',
  'package/lib/persona-file.mjs',
  'package/lib/system-prompt.md',
]
const fail = (msg) => { console.error('✗ ' + msg); process.exit(1) }
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
  if (r.status !== 0) fail(`命令失败: ${cmd} ${args.join(' ')}`)
}

console.log('── ① Host 双产物 ──')
const hostBuild = require(path.join(PKG, 'build.js'))
hostBuild.build({ format: 'both' })

console.log('── ② Client 产物 + 验证 ──')
run('node', [path.join(PKG, 'build-client.mjs')])
run('node', [path.join(CODE, 'scripts', 'verify-client-bundle.js')])

console.log('── ③ npm pack ──')
fs.rmSync(RELEASE_DIR, { recursive: true, force: true })
fs.mkdirSync(RELEASE_DIR, { recursive: true })
const packs = {}
for (const [label, pkgDir] of [['workflow-host', PKG]]) {
  const r = spawnSync('npm', ['pack', '--json', '--cache', NPM_CACHE, '--pack-destination', RELEASE_DIR], {
    cwd: pkgDir, encoding: 'utf8',
  })
  if (r.status !== 0) fail(`npm pack 失败（${label}）`)
  let info
  try { info = JSON.parse(r.stdout)[0] } catch (e) { fail(`npm pack 输出解析失败（${label}）`) }
  packs[label] = { filename: info.filename, tgz: path.join(RELEASE_DIR, info.filename) }
  console.log(`  ${label}: ${info.filename}`)
}

console.log('── ④ 内容断言 ──')
const MUST_HOST = [
  'package/lib/index.js',
  'package/cordis.patch.yml',
  'package/package.json',
  ...MUST_BUNDLE,
]
const MUST_CLIENT = [
  'package/lib/client.js',
]
function tarList(tgz) {
  const r = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
  if (r.status !== 0) fail(`tar 列表失败: ${tgz}`)
  return r.stdout.trim().split('\n')
}
for (const [label, must] of [['workflow-host', MUST_HOST.concat(MUST_CLIENT)]]) {
  const entries = new Set(tarList(packs[label].tgz))
  for (const f of must) {
    if (!entries.has(f)) fail(`${label} 包缺内容: ${f}`)
  }
  console.log(`  ${label} 包内容断言通过（${must.length} 项必含）`)
}

console.log('── ⑤ 版本矩阵一致性 ──')
for (const [label, pkgDir] of [['workflow-host', PKG]]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  const engines = pkg.dsh && pkg.dsh.engines && pkg.dsh.engines.dsh
  if (!engines || !/0\.2\.0/.test(engines)) fail(`${label} 的 dsh.engines.dsh 未对齐 0.2.0: ${engines}`)
  console.log(`  ${label}: v${pkg.version} | engines ${engines}`)
}
console.log('  注：ESM 形态（dist/workflow-host.mjs）为 --format=esm 按需的本地测试输出，不随发行包')

console.log('')
console.log('✅ 发行构建完成 → ' + RELEASE_DIR + '（单包：Host 插件 + 面板 bundle + preset 随包声明）')
console.log('   安装：node code/scripts/install.js --tgz release/ [--dry-run]')
