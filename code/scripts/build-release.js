#!/usr/bin/env node
// ============================================================================
// workflow-agent — 发行构建（3c）
// 文件：code/scripts/build-release.js
//
// 一键产出可分发的 npm tarball 并做内容断言：
//   ① 构建 Host 双产物（lib/index.js + dist/workflow-host.mjs）
//   ② 构建 Client 产物（lib/client.js）+ 产物级验证
//   ③ 把 preset（code/agent-presets/workflow-orchestrator/，唯一源）暂存进
//      host 包的 presets/（npm files 已收录；目录本身不入库，见 .gitignore）
//   ④ npm pack（单包）→ release/ 目录
//   ⑤ 内容断言：tarball 内必须含交付物 + preset 三件套；版本矩阵一致性
//
// 用法：node code/scripts/build-release.js
// 产物：release/@workflow-agent-workflow-host-<ver>.tgz
// （单 tgz 发行）
// ============================================================================

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const CODE = path.resolve(__dirname, '..')
const ROOT = path.resolve(CODE, '..')
const PKG = path.join(CODE, 'packages', 'workflow-host')
const PRESET_SRC = path.join(CODE, 'agent-presets', 'workflow-orchestrator')
const PRESET_STAGE = path.join(PKG, 'presets', 'workflow-orchestrator')
const RELEASE_DIR = path.join(ROOT, 'release')
// npm 缓存指向仓库本地（默认 ~/.npm 在受限环境可能只读，导致 pack EROFS）
const NPM_CACHE = path.join(ROOT, '.npm-cache-release')

const PRESET_FILES = ['agent.cordis.yml', 'preset.yml', 'system-prompt.md']
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

console.log('── ③ preset 暂存（唯一源 → host 包 presets/）──')
fs.rmSync(PRESET_STAGE, { recursive: true, force: true })
fs.cpSync(PRESET_SRC, PRESET_STAGE, { recursive: true })
for (const f of PRESET_FILES) {
  if (!fs.existsSync(path.join(PRESET_STAGE, f))) fail(`preset 暂存缺文件: ${f}`)
}

console.log('── ④ npm pack ──')
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

console.log('── ⑤ 内容断言 ──')
const MUST_HOST = [
  'package/lib/index.js',
  'package/cordis.patch.yml',
  'package/package.json',
  ...PRESET_FILES.map((f) => 'package/presets/workflow-orchestrator/' + f),
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

console.log('── ⑥ 版本矩阵一致性 ──')
for (const [label, pkgDir] of [['workflow-host', PKG]]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  const engines = pkg.dsh && pkg.dsh.engines && pkg.dsh.engines.dsh
  if (!engines || !/0\.1\.5/.test(engines)) fail(`${label} 的 dsh.engines.dsh 未对齐 0.1.5: ${engines}`)
  console.log(`  ${label}: v${pkg.version} | engines ${engines}`)
}
console.log('  注：ESM 形态（dist/workflow-host.mjs）为 --format=esm 按需的本地测试输出，不随发行包')

console.log('')
console.log('✅ 发行构建完成 → ' + RELEASE_DIR + '（单包：Host 插件 + 面板 bundle + preset 随包）')
console.log('   安装：node code/scripts/install.js --profile web   （或 --dry-run 预览）')
