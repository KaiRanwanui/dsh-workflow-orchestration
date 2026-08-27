# install-iter5.ps1
# Iter-5 插件安装脚本：构建产物已就绪，直接复制到 desktop profile
# 前提：DSH Desktop 已完全退出（所有进程已结束），否则文件被锁无法覆盖
$ErrorActionPreference = "Stop"

$profileDir = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@workflow-agent"
$packagesDir = "C:\Users\ranwa\dsh_workspace\workflow-agent\code\packages"

Write-Host "=== Iter-5 插件安装 ===" -ForegroundColor Cyan

# 预检：DSH 是否仍在运行
$dshRunning = Get-Process -Name "DSH Desktop" -ErrorAction SilentlyContinue
if ($dshRunning) {
    Write-Host "警告：DSH Desktop 仍在运行，文件可能被锁定。" -ForegroundColor Yellow
    Write-Host "请先完全退出 DSH Desktop（托盘图标右键 → 退出），再运行本脚本。" -ForegroundColor Yellow
    exit 1
}

# ── 1. workflow-host (0.3.0, tools + webServer routes) ─────────────────
Write-Host "[1/2] Installing @workflow-agent/workflow-host (0.3.0)..." -ForegroundColor Yellow
$src = Join-Path $packagesDir "workflow-host"
$dst = Join-Path $profileDir "workflow-host"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
Write-Host "  -> $dst" -ForegroundColor Green

# ── 2. client-ui-monitor (fetch polling) ───────────────────────────────
Write-Host "[2/2] Installing @workflow-agent/client-ui-monitor..." -ForegroundColor Yellow
$src2 = Join-Path $packagesDir "client-ui-monitor"
$dst2 = Join-Path $profileDir "client-ui-monitor"
if (Test-Path $dst2) { Remove-Item -Recurse -Force $dst2 }
New-Item -ItemType Directory -Path $dst2 -Force | Out-Null
Copy-Item -Path (Join-Path $src2 "*") -Destination $dst2 -Recurse -Force
Write-Host "  -> $dst2" -ForegroundColor Green

# ── 验证 ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== 验证 ===" -ForegroundColor Cyan
$ver = (Get-Content (Join-Path $dst "package.json") | ConvertFrom-Json).version
Write-Host "workflow-host version: $ver (期望 0.3.0)"
$hasRoute = Select-String -Path (Join-Path $dst "lib\index.js") -Pattern "registerWebRoutes" -Quiet
Write-Host "workflow-host 含 webServer 路由: $hasRoute"
$noHost = -not (Select-String -Path (Join-Path $dst2 "lib\client.js") -Pattern "host\.call|dsh-client-runtime.*host" -Quiet)
Write-Host "client 无 host.call 引用: $noHost"
$hasFetch = Select-String -Path (Join-Path $dst2 "lib\client.js") -Pattern "fetch\('/wf" -Quiet
Write-Host "client 使用 fetch('/wf': $hasFetch"

Write-Host ""
Write-Host "=== 安装完成，请重新启动 DSH Desktop ===" -ForegroundColor Cyan
