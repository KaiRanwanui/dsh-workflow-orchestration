# ============================================================================
# verify-workflow-plugins.ps1 — 验证已安装的 workflow-agent 插件产物
#
# 说明：
#   - 检查 <profile>/node_modules/@workflow-agent/ 下插件的版本、路由、fetch 引用
#   - 供安装后或排障时使用；不修改任何文件
#
# 用法：
#   .\verify-workflow-plugins.ps1                  # 验证 desktop profile
#   .\verify-workflow-plugins.ps1 -Profile web     # 验证 web profile
#
# 参数：
#   -Profile  目标 profile 名（默认 desktop）
# ============================================================================

[CmdletBinding()]
param(
    [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'

$profileDir = Join-Path $env:USERPROFILE (".dsh\profiles\$Profile\node_modules\@workflow-agent")

Write-Host '=== Workflow Agent - Verify Plugins ===' -ForegroundColor Cyan
Write-Host "profile: $Profile" -ForegroundColor DarkGray
Write-Host "target:  $profileDir" -ForegroundColor DarkGray
Write-Host ''

if (-not (Test-Path $profileDir)) {
    Write-Host "[ERROR] Not found: $profileDir" -ForegroundColor Red
    Write-Host '       Plugins not installed yet. Run build-workflow-plugins.ps1 then install-workflow-plugins.ps1.'
    exit 1
}

$allOk = $true

# ── workflow-host ─────────────────────────────────────────────────────────
Write-Host '[host] @workflow-agent/workflow-host' -ForegroundColor Yellow
$hostPkg = Join-Path $profileDir 'workflow-host\package.json'
if (Test-Path $hostPkg) {
    $v = (Get-Content $hostPkg -Raw -Encoding UTF8 | ConvertFrom-Json).version
    Write-Host "  version: $v"
} else {
    Write-Host '  [MISSING] package.json' -ForegroundColor Red
    $allOk = $false
}

$hostLib = Join-Path $profileDir 'workflow-host\lib\index.js'
if (Test-Path $hostLib) {
    $hasRoute = Select-String -Path $hostLib -Pattern 'registerWebRoutes' -Quiet
    $hasStatus = Select-String -Path $hostLib -Pattern "'/wf/status'|/wf/status" -Quiet
    Write-Host "  webServer routes: $hasRoute"
    Write-Host "  /wf/status: $hasStatus"
    if (-not $hasRoute) { $allOk = $false }
} else {
    Write-Host '  [MISSING] lib/index.js' -ForegroundColor Red
    $allOk = $false
}

# ── client-ui-monitor ─────────────────────────────────────────────────────
Write-Host ''
Write-Host '[client] @workflow-agent/client-ui-monitor' -ForegroundColor Yellow
$clientPkg = Join-Path $profileDir 'client-ui-monitor\package.json'
if (Test-Path $clientPkg) {
    $v = (Get-Content $clientPkg -Raw -Encoding UTF8 | ConvertFrom-Json).version
    Write-Host "  version: $v"
}

$clientLib = Join-Path $profileDir 'client-ui-monitor\lib\client.js'
if (Test-Path $clientLib) {
    # 排除注释中的 "host.call" 字样：只匹配实际调用（host.xxx(）
    $hostCalls = Select-String -Path $clientLib -Pattern 'host\.[a-zA-Z]+\(' | Where-Object { $_.Line -notmatch '^\s*//' }
    $hasFetch = Select-String -Path $clientLib -Pattern "fetch\('/wf" -Quiet
    $hasInterval = Select-String -Path $clientLib -Pattern 'setInterval' -Quiet
    Write-Host "  no host.call: $(-not $hostCalls)"
    Write-Host "  fetch('/wf: $hasFetch"
    Write-Host "  setInterval: $hasInterval"
    if ($hostCalls -or -not $hasFetch) { $allOk = $false }
} else {
    Write-Host '  [MISSING] lib/client.js' -ForegroundColor Red
    $allOk = $false
}

# ── 结论 ──────────────────────────────────────────────────────────────────
Write-Host ''
if ($allOk) {
    Write-Host '=== Verify OK — plugins ready ===' -ForegroundColor Green
    exit 0
} else {
    Write-Host '=== Verify FAILED — see errors above ===' -ForegroundColor Red
    exit 1
}
