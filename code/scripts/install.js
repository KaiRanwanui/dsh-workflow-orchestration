#!/usr/bin/env node
// ============================================================================
// workflow-agent — 安装器（3c）
// 文件：code/scripts/install.js
//
// 把本仓库构建好的 workflow-agent 安装进指定 DSH profile：
//   ① dsh plugin --profile <p> add <host 包目录> <client 包目录>   （link: 语义，构建即生效）
//   ② preset 三件套复制到 ~/.dsh/.agent-presets/workflow-orchestrator/
//   ③ 打印重启提示（Host 侧改动需重启 dsh.service）
//
// 用法：
//   node code/scripts/install.js --profile web            # 完整安装（插件 + preset）
//   node code/scripts/install.js --profile web --dry-run  # 只打印计划
//   node code/scripts/install.js --preset-only            # 只同步 preset
//   node code/scripts/install.js --registry               # 用 registry 包名而非本地路径
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

const CODE = path.resolve(__dirname, '..')
const HOST_DIR = path.join(CODE, 'packages', 'workflow-host')
const CLIENT_DIR = path.join(CODE, 'packages', 'client-ui-monitor')
const PRESET_SRC = path.join(CODE, 'agent-presets', 'workflow-orchestrator')
const PRESET_DST = path.join(os.homedir(), '.dsh', '.agent-presets', 'workflow-orchestrator')
const PRESET_FILES = ['preset.yml', 'agent.cordis.yml', 'system-prompt.md']

const PKG_HOST = '@workflow-agent/workflow-host'
const PKG_CLIENT = '@workflow-agent/client-ui-monitor'
const fail = (msg) => { console.error('✗ ' + msg); process.exit(1) }

for (const d of [HOST_DIR, CLIENT_DIR, PRESET_SRC]) {
  if (!fs.existsSync(d)) fail(`缺少目录: ${d}（先运行构建/确认仓库完整）`)
}
if (!fs.existsSync(path.join(HOST_DIR, 'lib', 'index.js'))) {
  fail('host 产物缺失：先运行 node code/packages/workflow-host/build.js')
}
if (!fs.existsSync(path.join(CLIENT_DIR, 'lib', 'client.js'))) {
  fail('client 产物缺失：先运行 node code/packages/client-ui-monitor/build.js')
}

const pluginSpec = (dir) => (USE_REGISTRY ? JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name : dir)

console.log(`安装目标：profile "${PROFILE}"${DRY ? '（dry-run 预览）' : ''}`)
console.log('')

// ① 插件包安装（dsh plugin add → profile 内 pnpm；link:/registry 语义均可）
if (!PRESET_ONLY) {
  const spec = USE_REGISTRY ? `${pluginSpec(HOST_DIR) && PKG_HOST} ${PKG_CLIENT}` : `${HOST_DIR} ${CLIENT_DIR}`
  console.log(`① dsh plugin --profile ${PROFILE} add ${USE_REGISTRY ? PKG_HOST + ' ' + PKG_CLIENT : HOST_DIR + ' ' + CLIENT_DIR}`)
  if (!DRY) {
    const r = spawnSync('dsh', ['plugin', '--profile', PROFILE, 'add', HOST_DIR, CLIENT_DIR], { stdio: 'inherit', shell: process.platform === 'win32' })
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
    fs.copyFileSync(path.join(PRESET_SRC, f), path.join(PRESET_DST, f))
    console.log('   ✓ ' + f)
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
