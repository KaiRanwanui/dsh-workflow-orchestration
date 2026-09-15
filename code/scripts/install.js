#!/usr/bin/env node
// ============================================================================
// workflow-agent — 安装器（3c/3e：单包双端）
// 文件：code/scripts/install.js
//
// 把 workflow-agent 安装进指定 DSH profile（单包：Host 插件 + DAG 面板 bundle + preset）：
//   ① dsh plugin --profile <p> add <来源>   （来源三选一，见下）
//   ② preset 三件套复制到 ~/.dsh/.agent-presets/workflow-orchestrator/
//      （--tgz 模式从 tarball 内提取，保证「装的什么就装什么 preset」）
//   ③ 打印重启提示（Host 侧改动需重启 dsh.service）
//
// 来源（互斥）：
//   缺省        ：本地包目录 packages/workflow-host（link: 语义，构建即生效）
//   --tgz <dir> ：从 <dir> 内的 workflow-agent-workflow-host-*.tgz 安装（发行验收形态；
//                 preset 从 tarball 内提取，与安装的包严格同源）
//   --registry  ：按包名 @workflow-agent/workflow-host 安装（需已发布）
//
// 其他参数：
//   --profile <名>   默认 web
//   --preset-only    只同步 preset
//   --dry-run        只打印计划
//   （幂等：重复运行安全）
// ============================================================================

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const argv = process.argv.slice(2)
const argOf = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const PROFILE = argOf('--profile', 'web')
const DRY = argv.includes('--dry-run')
const PRESET_ONLY = argv.includes('--preset-only')
const USE_REGISTRY = argv.includes('--registry')
const TZZ_DIR = (() => {
  const i = argv.indexOf('--tgz')
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? path.resolve(argv[i + 1]) : null
})()

const CODE = path.resolve(__dirname, '..')
const PKG_DIR = path.join(CODE, 'packages', 'workflow-host')
const PRESET_SRC = path.join(CODE, 'agent-presets', 'workflow-orchestrator')
const PRESET_DST = path.join(os.homedir(), '.dsh', '.agent-presets', 'workflow-orchestrator')
const PRESET_FILES = ['preset.yml', 'agent.cordis.yml', 'system-prompt.md']
const PKG = '@workflow-agent/workflow-host'

const fail = (msg) => { console.error('✗ ' + msg); process.exit(1) }

// ── 来源解析 ────────────────────────────────────────────────────────────────
let addSpec = null            // dsh plugin add 的参数
let presetRead = null         // (rel) => 内容（preset 三件套来源）
if (TZZ_DIR) {
  const candidates = fs.readdirSync(TZZ_DIR)
    .filter((f) => /^workflow-agent-workflow-host-\d+\.\d+\.\d+\.tgz$/.test(f))
    .sort()
  if (candidates.length === 0) fail(`--tgz 目录内无 workflow-host tarball: ${TZZ_DIR}`)
  const tgz = path.join(TZZ_DIR, candidates[candidates.length - 1])
  addSpec = tgz
  presetRead = (rel) => {
    // 从 tarball 内提取 preset 文件内容（tar -xO）
    const r = spawnSync('tar', ['-xOzf', tgz, `package/presets/workflow-orchestrator/${rel}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (r.status !== 0) fail(`tarball 内提取 ${rel} 失败`)
    return r.stdout
  }
  console.log(`来源：tarball（${path.basename(tgz)}）`)
} else if (USE_REGISTRY) {
  addSpec = PKG
  console.log('来源：npm registry（' + PKG + '）')
} else {
  addSpec = PKG_DIR
  console.log('来源：本地包目录（link: 语义）')
}

// ── 前置检查 ────────────────────────────────────────────────────────────────
if (!TZZ_DIR && !fs.existsSync(PKG_DIR)) fail(`缺少目录: ${PKG_DIR}（先运行构建/确认仓库完整）`)
if (!TZZ_DIR) {
  if (!fs.existsSync(path.join(PKG_DIR, 'lib', 'index.js'))) fail('host 产物缺失：node code/packages/workflow-host/build.js')
  if (!fs.existsSync(path.join(PKG_DIR, 'lib', 'client.js'))) fail('client 产物缺失：node code/packages/workflow-host/build-client.mjs')
} else if (!PRESET_SRC && false) {
  // tarball 模式下 preset 从 tarball 提取，无本地依赖
}

console.log(`安装目标：profile "${PROFILE}"${DRY ? '（dry-run 预览）' : ''}`)
console.log('')

// ① 插件包安装
if (!PRESET_ONLY) {
  console.log(`① dsh plugin --profile ${PROFILE} add ${addSpec}（单包：Host 插件 + 面板 bundle + preset 随包）`)
  if (!DRY) {
    const r = spawnSync('dsh', ['plugin', '--profile', PROFILE, 'add', addSpec], { stdio: 'inherit', shell: process.platform === 'win32' })
    if (r.status !== 0) fail('dsh plugin add 失败')
  }
} else {
  console.log('① 跳过插件安装（--preset-only）')
}

// ② preset 三件套 → 用户 preset 根（幂等覆盖）
console.log(`② preset → ${PRESET_DST}`)
if (!DRY) {
  fs.mkdirSync(PRESET_DST, { recursive: true })
  for (const f of PRESET_FILES) {
    const content = presetRead ? presetRead(f) : fs.readFileSync(path.join(PRESET_SRC, f), 'utf8')
    fs.writeFileSync(path.join(PRESET_DST, f), content)
    console.log('   ✓ ' + f + (presetRead ? ' (from tarball)' : ''))
  }
} else {
  for (const f of PRESET_FILES) console.log('   [dry] ' + f)
}

// ③ 提示
console.log('')
console.log('✅ 安装完成。')
console.log('   - Host 改动生效：systemctl --user restart dsh.service（或你的启动方式）')
console.log('   - Client 改动生效：刷新浏览器页面')
console.log('   - 新会话：GUI 选择 workflow-orchestrator preset')
