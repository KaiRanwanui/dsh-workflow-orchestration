# Client UI 插件开发指南

本文档介绍如何开发、构建和安装 workflow-agent 的 Client UI 插件。

## 目录结构

```
workflow-agent/code/packages/
└── client-ui-monitor/          # 插件包目录
    ├── package.json            # npm 包配置
    ├── build.js                # 构建脚本
    ├── src/                    # 源代码目录
    │   └── client.js           # Client 端源代码
    └── lib/                    # 构建输出目录
        ├── index.js            # Host 端入口（空）
        └── client.js           # 构建后的 Client 端代码
```

## 开发流程

### 1. 编写源代码

在 `src/client.js` 中编写 Client UI 代码。源代码格式：

```javascript
export function register(ctx) {
  const slots = ctx.get('slots')
  if (!slots) return

  // 使用 ctx.interval 而不是 setInterval
  ctx.effect(function() {
    var d = ctx.interval(refresh, 2000)
    return function() { d() }
  })

  // 注册 Slot
  slots.inject('conversation.view', function() {
    return slots.register(
      { name: 'conversation.view', id: 'workflow', order: 25, label: function() { return 'Workflow' } },
      function(props) {
        // 返回 React 组件
        return React.createElement('div', {}, 'Hello')
      }
    )
  })
}
```

**注意事项：**
- 使用 `ctx.interval()` 而不是 `setInterval()`
- 使用 `ctx.get('slots')` 获取 slots 服务
- 使用 `React.createElement()` 创建 UI 元素
- 使用 `host.call()` 调用 Host RPC 方法

### 2. 构建

```bash
cd workflow-agent/code/packages/client-ui-monitor
node build.js
```

构建脚本会：
1. 读取 `src/client.js`
2. 转换为 DSH 模块格式
3. 输出到 `lib/client.js`

### 3. 安装到 DSH

```powershell
# 设置路径
$src = "C:\Users\ranwa\dsh_workspace\workflow-agent\code\packages\client-ui-monitor"
$dst = "$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@workflow-agent\client-ui-monitor"

# 删除旧版本
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }

# 创建目录并复制
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
```

### 4. 配置 Agent Preset

在 `agent.cordis.yml` 中添加插件行：

```yaml
# ── Client UI 插件（DAG 监控面板）─────────────────────────────────────
- id: workflow-monitor
  name: '@workflow-agent/client-ui-monitor'
```

### 5. 重启 DSH

重启 DSH Desktop 以加载新的 npm 包。

### 6. 验证

1. 打开 DSH Desktop
2. 使用 `workflow-orchestrator` preset 创建新 session
3. 查看底部是否出现 "Workflow" 标签页
4. 点击标签页查看 DAG 监控面板

## 快速构建脚本

创建 `workflow-agent/code/scripts/build-client-ui.ps1`：

```powershell
# 构建并安装 Client UI 插件
$ErrorActionPreference = "Stop"

$src = "C:\Users\ranwa\dsh_workspace\workflow-agent\code\packages\client-ui-monitor"
$dst = "$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@workflow-agent\client-ui-monitor"

Write-Host "Building client-ui-monitor..."
Set-Location $src
node build.js

Write-Host "`nInstalling to DSH..."
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force

Write-Host "`n✓ Installed to: $dst"
Write-Host "Please restart DSH Desktop to load the new plugin."
```

使用方式：

```powershell
cd workflow-agent/code/scripts
.\build-client-ui.ps1
```

## 调试技巧

### 查看浏览器控制台

按 F12 打开开发者工具，查看 Console 面板：
- 插件加载错误会显示红色错误信息
- 使用 `console.log()` 输出调试信息

### 检查模块是否注册

在控制台执行：

```javascript
// 检查模块是否已注册
window.__ModuleLoader__.modules.has("@workflow-agent/client-ui-monitor")
```

### 检查 Slot 是否注册

```javascript
// 检查 conversation.view slot 的 occupants
// 需要通过 DSH 内部 API 访问
```

## 常见问题

### 1. "setInterval is not available"

**原因：** 动态 Client 插件不允许使用 `setInterval`。

**解决：** 使用 `ctx.interval()` 代替：

```javascript
ctx.effect(function() {
  var d = ctx.interval(refresh, 2000)
  return function() { d() }  // 清理函数
})
```

### 2. 插件加载后没有显示

**可能原因：**
- Slot 注册失败
- React 组件渲染错误
- RPC 调用失败

**排查步骤：**
1. 检查浏览器控制台错误
2. 确认 `wf:status` RPC 方法可用
3. 确认 `conversation.view` slot 存在

### 3. 修改代码后没有生效

**原因：** DSH 需要重启才能加载新的 npm 包。

**解决：** 重启 DSH Desktop。

## 团队约定

1. **所有 Client UI 插件必须使用 npm 包方式**
   - 不使用动态 Cordis 插件（避免 JSON 转义问题）
   - 代码必须落盘，通过构建脚本生成

2. **目录结构统一**
   - 源代码在 `src/` 目录
   - 构建输出在 `lib/` 目录
   - 构建脚本为 `build.js`

3. **命名规范**
   - 包名：`@workflow-agent/client-ui-<name>`
   - Slot ID：使用有意义的标识符（如 `workflow`）

4. **构建流程**
   - 修改源代码后必须重新构建
   - 构建后必须重新安装到 DSH
   - 安装后必须重启 DSH

## 参考资源

- DSH Client UI 插件示例：`@deepseek-ai/dsh-client-ui-cordis`
- Cordis 插件开发 Skill：`cordis-plugin-development`
- DSH 架构文档：`plan/architecture/`
