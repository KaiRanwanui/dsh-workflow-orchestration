# ============================================================================
# build-workflow-plugins.ps1 — 构建 workflow-agent 所有 npm 包插件
#
# 说明：
#   - 构建 @workflow-agent/workflow-host 与 @workflow-agent/client-ui-monitor
#   - 构建产物输出到各包的 lib/ 目录（node build.js 的默认行为）
#   - 不安装、不复制；安装请用 install-workflow-plugins.ps1
#   - 脚本自身不硬编码任何绝对路径（源目录从 $PSScriptRoot 推导）
#
# 用法：
#   .\build-workflow-plugins.ps1              # 构建全部
#   .\build-workflow-plugins.ps1 -Package host, client
#   .\build-workflow-plugins.ps1 -Package client
#
# 参数：
#   -Package  要构建的包名数组（host|client，默认两者）
#   -SkipTest 跳过构建后的冒烟验证（默认执行）
# ============================================================================

[CmdletBinding()]
param(
    [ValidateSet('host', 'client')]
    [string[]]$Package = @('host', 'client'),
    [switch]$SkipTest
)

$ErrorActionPreference = 'Stop'

# ── 路径推导（不硬编码）──────────────────────────────────────────────────
$scriptsDir = $PSScriptRoot
$packagesDir = Join-Path (Split-Path -Parent $scriptsDir) 'packages'
$pkgMap = @{
    host   = Join-Path $packagesDir 'workflow-host'
    client = Join-Path $packagesDir 'client-ui-monitor'
}

Write-Host '=== Workflow Agent - Build Plugins ===' -ForegroundColor Cyan
Write-Host "packages dir: $packagesDir" -ForegroundColor DarkGray
Write-Host ''

foreach ($p in $Package) {
    $pkgDir = $pkgMap[$p]
    $pkgName = if ($p -eq 'host') { '@workflow-agent/workflow-host' } else { '@workflow-agent/client-ui-monitor' }

    Write-Host "[$p] Building $pkgName ..." -ForegroundColor Yellow

    # 源目录检查
    $buildJs = Join-Path $pkgDir 'build.js'
    if (-not (Test-Path $buildJs)) {
        Write-Host "  [ERROR] build.js not found: $buildJs" -ForegroundColor Red
        exit 1
    }

    # 构建
    Push-Location $pkgDir
    try {
        node build.js
        if ($LASTEXITCODE -ne 0) {
            throw "build.js exited with code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    # 产物冒烟验证（可选）
    if (-not $SkipTest) {
        $artifact = if ($p -eq 'host') { 'lib/index.js' } else { 'lib/client.js' }
        $artifactPath = Join-Path $pkgDir $artifact
        if (-not (Test-Path $artifactPath)) {
            Write-Host "  [ERROR] artifact missing: $artifactPath" -ForegroundColor Red
            exit 1
        }
        Write-Host "  [OK] artifact: $artifact ($((Get-Item $artifactPath).Length) bytes)" -ForegroundColor Green
    }
}

Write-Host ''
Write-Host '=== Build Complete ===' -ForegroundColor Cyan
