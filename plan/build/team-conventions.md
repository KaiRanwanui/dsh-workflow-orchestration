# Client UI 插件开发团队约定

**生效日期：** 2026-08-26  
**适用范围：** workflow-agent 项目所有 Client UI 插件

---

## 核心原则

### 1. 代码必须落盘

**禁止** 使用动态 Cordis 插件（`cordis_define`）开发 Client UI 插件。

**原因：**
- 动态插件通过 JSON 传递代码，存在转义问题
- 大量 `\n`、`\u` 等转义字符容易出错
- 调试困难，错误信息不清晰
- 代码不在文件系统中，难以版本控制

**正确做法：**
- 所有 Client UI 插件必须使用 npm 包方式
- 源代码存储在 `src/` 目录
- 通过构建脚本生成可部署的代码
- 代码提交到 Git 仓库

### 2. 统一的目录结构

每个 Client UI 插件必须遵循以下结构：

```
packages/
└── client-ui-<name>/
    ├── package.json          # npm 包配置
    ├── build.js              # 构建脚本
    ├── src/                  # 源代码
    │   └── client.js         # Client 端代码
    └── lib/                  # 构建输出
        ├── index.js          # Host 端入口
        └── client.js         # Client 端构建产物
```

### 3. 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 包名 | `@workflow-agent/client-ui-<name>` | `@workflow-agent/client-ui-monitor` |
| Slot ID | 使用有意义的标识符 | `workflow`, `monitor`, `dashboard` |
| 插件 ID | 与包名对应 | `workflow-monitor` |

### 4. 构建流程

每次修改 Client UI 代码后，必须执行以下步骤：

```bash
# 1. 进入插件目录
cd workflow-agent/code/packages/client-ui-<name>

# 2. 构建
.\workflow-agent\code\scripts\build-workflow-plugins.ps1

# 3. 安装到 DSH（使用 PowerShell）
.\workflow-agent\code\scripts\install-workflow-plugins.ps1 -Profile desktop

# 4. 重启 DSH Desktop
```

**禁止** 跳过任何步骤。

### 5. 代码规范

#### 5.1 使用 `ctx.interval()` 而不是 `setInterval()`

```javascript
// ❌ 错误
setInterval(refresh, 2000)

// ✅ 正确
ctx.effect(function() {
  var d = ctx.interval(refresh, 2000)
  return function() { d() }  // 清理函数
})
```

#### 5.2 使用 `ctx.get()` 获取服务

```javascript
// ❌ 错误
const slots = ctx.slots

// ✅ 正确
const slots = ctx.get('slots')
if (!slots) return
```

#### 5.3 使用 `React.createElement()` 创建 UI

```javascript
// ❌ 错误（JSX 不支持）
<div>Hello</div>

// ✅ 正确
React.createElement('div', {}, 'Hello')
```

#### 5.4 使用 `host.call()` 调用 RPC

```javascript
// ❌ 错误（直接调用）
wfStatus({ workspaceRoot: root })

// ✅ 正确
const result = await host.call('wf:status', { workspaceRoot: root })
```

### 6. 版本控制

- `src/` 目录必须提交到 Git
- `lib/` 目录可以提交（方便部署）或忽略（每次构建）
- `build.js` 必须提交到 Git
- `package.json` 必须提交到 Git

### 7. 文档要求

每个 Client UI 插件必须包含：

1. **README.md** - 插件说明
   - 功能描述
   - 使用方法
   - 配置选项

2. **CHANGELOG.md** - 变更日志
   - 版本号
   - 变更日期
   - 变更内容

3. **代码注释** - 关键逻辑说明
   - 函数说明
   - 复杂逻辑
   - TODO/FIXME

### 8. 测试要求

- 修改代码后必须在本地验证
- 验证步骤：
  1. 构建成功
  2. 安装成功
  3. 重启 DSH
  4. 功能正常
  5. 无控制台错误

### 9. 发布流程

1. 更新 `package.json` 版本号
2. 更新 `CHANGELOG.md`
3. 提交代码
4. 创建 Git tag
5. 通知团队成员更新

### 10. 问题反馈

遇到问题时：

1. 检查浏览器控制台错误
2. 查阅 `plan/build/client-ui-plugin-guide.md`
3. 在团队群中反馈
4. 记录到 Issue Tracker

---

## 附录

### A. 快速构建脚本

使用当前脚本体系（`code/scripts/`）：

```powershell
cd workflow-agent/code/scripts
.\build-workflow-plugins.ps1                    # 构建所有插件
.\install-workflow-plugins.ps1 -Profile desktop # 安装到 desktop profile（DSH 需退出）
.\verify-workflow-plugins.ps1 -Profile desktop  # 验证安装
```

### B. 常用命令

```bash
# 构建单个插件
cd workflow-agent/code/packages/client-ui-monitor
node build.js

# 构建所有插件
.\workflow-agent\code\scripts\build-workflow-plugins.ps1

# 安装到 profile（desktop/web）
.\workflow-agent\code\scripts\install-workflow-plugins.ps1 -Profile desktop

# 验证安装
.\workflow-agent\code\scripts\verify-workflow-plugins.ps1 -Profile desktop

# 检查插件是否安装
ls "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@workflow-agent"
```

### C. 参考插件

- `@deepseek-ai/dsh-client-ui-cordis` - Cordis 插件管理 UI
- `@deepseek-ai/dsh-client-ui-workspace` - 工作区管理 UI
- `@deepseek-ai/dsh-client-ui-tool` - 工具调用 UI

---

**最后更新：** 2026-08-26  
**维护者：** workflow-agent 团队
