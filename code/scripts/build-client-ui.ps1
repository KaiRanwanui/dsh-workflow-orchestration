# build-client-ui.ps1
# 构建并安装所有 Client UI 插件
# 用法: .\build-client-ui.ps1

$ErrorActionPreference = "Stop"

# 插件列表
$packages = @(
    "client-ui-monitor"
    # 添加更多插件...
)

$dshRoot = "$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@workflow-agent"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Workflow Agent Client UI Builder" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$successCount = 0
$failCount = 0

foreach ($pkg in $packages) {
    $src = "C:\Users\ranwa\dsh_workspace\workflow-agent\code\packages\$pkg"
    $dst = "$dshRoot\$pkg"
    
    Write-Host "`n[$pkg] Building..." -ForegroundColor Yellow
    
    # 检查源目录
    if (-not (Test-Path $src)) {
        Write-Host "  ✗ Source directory not found: $src" -ForegroundColor Red
        $failCount++
        continue
    }
    
    # 构建
    try {
        Set-Location $src
        node build.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ✗ Build failed" -ForegroundColor Red
            $failCount++
            continue
        }
    } catch {
        Write-Host "  ✗ Build error: $_" -ForegroundColor Red
        $failCount++
        continue
    }
    
    # 安装
    Write-Host "[$pkg] Installing to DSH..." -ForegroundColor Yellow
    try {
        if (Test-Path $dst) { 
            Remove-Item -Recurse -Force $dst 
        }
        New-Item -ItemType Directory -Path $dst -Force | Out-Null
        Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
        Write-Host "  ✓ Installed to: $dst" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host "  ✗ Install error: $_" -ForegroundColor Red
        $failCount++
        continue
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Build Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Success: $successCount" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "  Failed:  $failCount" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan

if ($successCount -gt 0) {
    Write-Host "`nPlease restart DSH Desktop to load the new plugins." -ForegroundColor Yellow
}

# 返回原目录
Set-Location "C:\Users\ranwa\dsh_workspace"
