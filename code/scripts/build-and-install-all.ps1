# build-and-install-all.ps1
# 构建并安装 workflow-agent 的所有 npm 包插件到 desktop profile
#
# 用法:
#   cd workflow-agent/code/scripts
#   .\build-and-install-all.ps1

$ErrorActionPreference = "Stop"

$profileDir = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@workflow-agent"
$packagesDir = Split-Path -Parent $PSScriptRoot | Join-Path -ChildPath "packages"

Write-Host "=== Workflow Agent - Build & Install All ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. Host 插件 ─────────────────────────────────────────────────────────
Write-Host "[1/2] Building @workflow-agent/workflow-host..." -ForegroundColor Yellow
Set-Location (Join-Path $packagesDir "workflow-host")
node build.js
if ($LASTEXITCODE -ne 0) { throw "Host build failed" }

Write-Host "`nInstalling workflow-host to desktop profile..." -ForegroundColor Yellow
$dst = Join-Path $profileDir "workflow-host"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path ".\*" -Destination $dst -Recurse -Force
Write-Host "  -> $dst" -ForegroundColor Green

# ── 2. Client UI 插件 ────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/2] Building @workflow-agent/client-ui-monitor..." -ForegroundColor Yellow
Set-Location (Join-Path $packagesDir "client-ui-monitor")
node build.js
if ($LASTEXITCODE -ne 0) { throw "Client build failed" }

Write-Host "`nInstalling client-ui-monitor to desktop profile..." -ForegroundColor Yellow
$dst = Join-Path $profileDir "client-ui-monitor"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path ".\*" -Destination $dst -Recurse -Force
Write-Host "  -> $dst" -ForegroundColor Green

# ── 完成 ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Build & Install Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Installed packages:" -ForegroundColor White
Write-Host "  - @workflow-agent/workflow-host (tools + webServer routes /wf/*)"
Write-Host "  - @workflow-agent/client-ui-monitor (DAG monitor, fetch polling)"
Write-Host ""
Write-Host "RPC handlers (workflow-rpc.mjs) retired in Iter-5:" -ForegroundColor White
Write-Host "  - replaced by webServer HTTP routes (/wf/status /wf/skill /wf/config)"
Write-Host ""
Write-Host "Please restart DSH Desktop to load the new plugins." -ForegroundColor Yellow
