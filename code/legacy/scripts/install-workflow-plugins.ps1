# ============================================================================
# install-workflow-plugins.ps1 — 安装 workflow-agent 插件到指定 dsh profile
#
# 说明：
#   - 将 code/packages 下已构建的插件复制到 <profile>/node_modules/@workflow-agent/
#   - Profile 名称可参数化（desktop | web | workflow ...），默认 desktop
#   - 预检：目标 profile 目录是否存在；若为 desktop 且 DSH 在运行则警告（文件可能被锁）
#   - 不会自动构建；请先运行 build-workflow-plugins.ps1
#
# 用法：
#   .\install-workflow-plugins.ps1                          # 安装到 desktop profile
#   .\install-workflow-plugins.ps1 -Profile web             # 安装到 web profile
#   .\install-workflow-plugins.ps1 -Package client          # 只装 client
#   .\install-workflow-plugins.ps1 -SkipVerify              # 跳过安装后验证
#   .\install-workflow-plugins.ps1 -AllowRunningDSH         # 忽略 DSH 运行检查（危险）
#
# 参数：
#   -Profile         目标 profile 名（默认 desktop）
#   -Package         要安装的包名数组（host|client，默认两者）
#   -SkipVerify      跳过安装后的产物验证
#   -AllowRunningDSH 允许在 DSH 运行时安装（默认会检查并警告）
# ============================================================================

[CmdletBinding()]
param(
    [string]$Profile = 'desktop',
    [ValidateSet('host', 'client')]
    [string[]]$Package = @('host', 'client'),
    [switch]$SkipVerify,
    [switch]$AllowRunningDSH
)

$ErrorActionPreference = 'Stop'

# ── 路径推导（不硬编码）──────────────────────────────────────────────────
$scriptsDir = $PSScriptRoot
$packagesDir = Join-Path (Split-Path -Parent $scriptsDir) 'packages'
$profileDir = Join-Path $env:USERPROFILE (".dsh\profiles\$Profile\node_modules\@workflow-agent")
$pkgMap = @{
    host   = @{ dir = 'workflow-host';       expected = 'lib/index.js'  }
    client = @{ dir = 'client-ui-monitor';   expected = 'lib/client.js' }
}

Write-Host '=== Workflow Agent - Install Plugins ===' -ForegroundColor Cyan
Write-Host "profile: $Profile" -ForegroundColor DarkGray
Write-Host "target:  $profileDir" -ForegroundColor DarkGray
Write-Host ''

# ── 预检：目标 profile 存在 ───────────────────────────────────────────────
$profileBase = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
if (-not (Test-Path $profileBase)) {
    Write-Host "[ERROR] Profile not found: $profileBase" -ForegroundColor Red
    exit 1
}

# ── 预检：DSH Desktop 是否在运行（仅 desktop profile 有锁文件问题）──────
if (-not $AllowRunningDSH -and $Profile -eq 'desktop') {
    $dsh = Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue
    if ($dsh) {
        Write-Host '[WARN] DSH Desktop is running; plugin files may be locked.' -ForegroundColor Yellow
        Write-Host '       It is recommended to fully exit DSH Desktop first.' -ForegroundColor Yellow
        Write-Host '       Use -AllowRunningDSH to force (may partially fail).' -ForegroundColor Yellow
        exit 1
    }
}

# ── 安装每个包 ────────────────────────────────────────────────────────────
foreach ($p in $Package) {
    $cfg = $pkgMap[$p]
    $src = Join-Path $packagesDir $cfg.dir
    $dst = Join-Path $profileDir $cfg.dir
    $pkgName = if ($p -eq 'host') { '@workflow-agent/workflow-host' } else { '@workflow-agent/client-ui-monitor' }

    Write-Host "[$p] Installing $pkgName ..." -ForegroundColor Yellow

    # 源目录检查
    if (-not (Test-Path $src)) {
        Write-Host "  [ERROR] source not found: $src" -ForegroundColor Red
        exit 1
    }
    # 构建产物检查（避免装到未构建的包）
    $expected = Join-Path $src $cfg.expected
    if (-not (Test-Path $expected)) {
        Write-Host "  [ERROR] artifact missing (run build-workflow-plugins.ps1 first): $expected" -ForegroundColor Red
        exit 1
    }

    # 复制
    if (Test-Path $dst) {
        Remove-Item -Recurse -Force $dst -ErrorAction Continue
    }
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force -ErrorAction Continue
    Write-Host "  [OK] -> $dst" -ForegroundColor Green
}

# ── 安装后验证 ────────────────────────────────────────────────────────────
if (-not $SkipVerify) {
    Write-Host ''
    Write-Host '=== Verify Installed ===' -ForegroundColor Cyan
    $allOk = $true

    $hostVer = Join-Path $profileDir 'workflow-host\package.json'
    if (Test-Path $hostVer) {
        $v = (Get-Content $hostVer -Raw -Encoding UTF8 | ConvertFrom-Json).version
        Write-Host "workflow-host version: $v"
        $hasRoute = Select-String -Path (Join-Path $profileDir 'workflow-host\lib\index.js') -Pattern 'registerWebRoutes' -Quiet
        Write-Host "workflow-host webServer routes: $hasRoute"
        if (-not $hasRoute) { $allOk = $false }
    }

    $clientLib = Join-Path $profileDir 'client-ui-monitor\lib\client.js'
    if (Test-Path $clientLib) {
        # 排除注释中的 "host.call" 字样：只匹配实际调用（host.xxx(）
        $hostCalls = Select-String -Path $clientLib -Pattern 'host\.[a-zA-Z]+\(' | Where-Object { $_.Line -notmatch '^\s*//' }
        Write-Host "client no host.call: $(-not $hostCalls)"
        $hasFetch = Select-String -Path $clientLib -Pattern "fetch\('/wf" -Quiet
        Write-Host "client fetch('/wf: $hasFetch"
        if ($hostCalls -or -not $hasFetch) { $allOk = $false }
    }

    if ($allOk) {
        Write-Host ''
        Write-Host '=== Verify OK ===' -ForegroundColor Green
    } else {
        Write-Host ''
        Write-Host '=== Verify FAILED — check errors above ===' -ForegroundColor Red
        exit 1
    }
}

Write-Host ''
Write-Host "=== Install Complete (profile: $Profile) ===" -ForegroundColor Cyan
if ($Profile -eq 'desktop') {
    Write-Host 'Please restart DSH Desktop to load the new plugins.' -ForegroundColor Yellow
} else {
    Write-Host "Please restart the dsh $Profile process to load the new plugins." -ForegroundColor Yellow
}
