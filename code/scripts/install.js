#!/usr/bin/env node
// ============================================================================
// workflow-agent — 安装器（阶段 6 / B2 重构：只从打包产物安装）
// 文件：code/scripts/install.js
//
// 0.2.0 起 preset 随包声明（presets/workflow-orchestrator.patch.yml 进
// dsh.bundle.patch 链），目录式 preset 部署（~/.dsh-dev/.agent-presets/）已随
// DSH 目录扫描机制一起退役——安装即完整交付（Host 插件 + DAG 面板 + preset）。
//
// 用户拍板（2026-10-03）：向环境安装一律从打包产物（构建出的 tgz）执行，
// 不再支持源码目录直挂（link: 语义随本版退役；开发期用 live profile HMR）。
//
// 用法：
//   node code/scripts/install.js --tgz <dir> [--profile <名>] [--dry-run]
//     从 <dir> 内最新的 workflow-agent-workflow-host-*.tgz 安装
//     （tgz 由 node code/scripts/build-release.js 产出）
//
// 其他参数：
//   --profile <名>   默认 web（开发环境 dsh home：~/.dsh-dev）
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
const TZZ_DIR = (() => {
  const i = argv.indexOf('--tgz')
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? path.resolve(argv[i + 1]) : null
})()

const CODE = path.resolve(__dirname, '..')
const PKG_DIR = path.join(CODE, 'packages', 'workflow-host')

const fail = (msg) => { console.error('✗ ' + msg); process.exit(1) }

// ── 来源：必须为打包产物 ────────────────────────────────────────────────────
if (!TZZ_DIR) {
  console.error('用法：node install.js --tgz <dir> [--profile web] [--dry-run]')
  console.error('')
  console.error('阶段 6 拍板：安装只接受打包产物（tgz）。先构建发行包：')
  console.error('  node code/scripts/build-release.js   # 产出 release/workflow-agent-workflow-host-*.tgz')
  process.exit(1)
}
const candidates = fs.readdirSync(TZZ_DIR)
  .filter((f) => /^workflow-agent-workflow-host-\d+\.\d+\.\d+\.tgz$/.test(f))
  .sort()
if (candidates.length === 0) fail(`--tgz 目录内无 workflow-host tarball: ${TZZ_DIR}`)
const tgz = path.join(TZZ_DIR, candidates[candidates.length - 1])

// tarball 完整性预检：patch 链与 persona 资产必须在内（B2 交付形态断言）
const tarballMustContain = [
  'package/cordis.patch.yml',
  'package/presets/workflow-orchestrator.patch.yml',
  'package/lib/index.js',
  'package/lib/client.js',
  'package/lib/persona-file.mjs',
  'package/lib/system-prompt.md',
]
console.log(`来源：tarball（${path.basename(tgz)}）`)
if (!DRY) {
  const listing = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (listing.status !== 0) fail('tarball 读取失败')
  const names = new Set(listing.stdout.split('\n'))
  for (const need of tarballMustContain) {
    if (!names.has(need)) fail(`tarball 缺少 ${need}（构建链不完整，检查 build.js / package.json files）`)
  }
  console.log('   ✓ patch 链与 persona 资产齐全（B2 交付形态）')
}

console.log(`安装目标：profile "${PROFILE}"${DRY ? '（dry-run 预览）' : ''}`)
console.log('')

// ⓪ 悬空 file: 依赖预修正（MIG2 流程缺陷，真机实证 2026-10-03）：历史安装会把
//    file:<旧 tgz 绝对路径> 写进 profile dependencies；release/ 重建后旧 tgz 消失，
//    pnpm 任何操作先撞 ENOENT 导致 add 失败。检测到悬空引用即改写指向本次 tgz。
if (!DRY) {
  const profileDir = path.join(os.homedir(), '.dsh-dev', 'profiles', PROFILE)
  const pkgPath = path.join(profileDir, 'package.json')
  const PKG_NAME = '@workflow-agent/workflow-host'
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const cur = pkg.dependencies && pkg.dependencies[PKG_NAME]
      if (typeof cur === 'string' && cur.startsWith('file:')) {
        const oldPath = cur.slice('file:'.length)
        if (path.resolve(oldPath) !== path.resolve(tgz) && !fs.existsSync(oldPath)) {
          pkg.dependencies[PKG_NAME] = 'file:' + path.resolve(tgz)
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
          console.log('⓪ 已修正悬空 file: 依赖 → 本次 tgz（旧引用: ' + oldPath + '）')
        }
      }
    } catch (e) { /* profile package.json 不可读则交给 dsh plugin add 自然报错 */ }
  }
}

// ① 插件包安装（单包：Host 插件 + 面板 bundle + preset 随包声明）
console.log(`① dsh plugin --profile ${PROFILE} add ${tgz}`)
if (!DRY) {
  const r = spawnSync('dsh', ['plugin', '--profile', PROFILE, 'add', tgz], { stdio: 'inherit' })
  if (r.status !== 0) fail('dsh plugin add 失败')

  // ⓪.5 实体版本校验（MIG2 流程缺陷 2，真机实证）：file: 依赖换版本时 pnpm add 可能
  // 惰性不刷新实体（added 0）——校验 node_modules 实体 version == tgz 版本，不一致则
  // pnpm install 强制同步。
  const profileDir = path.join(os.homedir(), '.dsh-dev', 'profiles', PROFILE)
  const entPkg = path.join(profileDir, 'node_modules', '@workflow-agent', 'workflow-host', 'package.json')
  const wantVer = tgz.match(/-(\d+\.\d+\.\d+)\.tgz$/)
  let entVer = null
  try { entVer = JSON.parse(fs.readFileSync(entPkg, 'utf8')).version } catch (e) { /* 实体缺失 */ }
  if (wantVer && entVer !== wantVer[1]) {
    console.log(`⓪.5 实体版本 ${entVer || '缺失'} ≠ tgz ${wantVer[1]} → pnpm install 强制同步`)
    const r2 = spawnSync('pnpm', ['install'], { cwd: profileDir, stdio: 'inherit' })
    if (r2.status !== 0) fail('pnpm install 同步失败')
  }
}

// ② 提示
console.log('')
console.log('✅ 安装完成。')
console.log('   - preset 随包声明生效：GUI preset 选择器应出现 Workflow Orchestrator')
console.log('   - Host 改动生效：0.2.0 live profile HMR 热生效；若无效重启 dsh web')
console.log('   - Client 改动生效：刷新浏览器页面')
