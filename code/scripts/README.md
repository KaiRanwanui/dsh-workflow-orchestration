# code/scripts/ — 工具脚本

构建、测试、部署等工具脚本。

## 内容约定

- PowerShell 脚本（Windows 安装/部署；**UTF-8 BOM 编码**，供 PowerShell 5.1 正确解析中文）
- Node.js 辅助脚本（构建/测试/代码生成，跨平台）

---

## 新脚本体系（推荐，参数化 + 不硬编码路径）

> 覆盖 desktop 与 web profile，可重复使用。

| 脚本 | 用途 | 用法示例 |
|------|------|---------|
| `build-workflow-plugins.ps1` | 构建所有 npm 包插件（输出到各包 lib/） | `.\build-workflow-plugins.ps1 -Package client` |
| `install-workflow-plugins.ps1` | 安装到指定 profile（含 DSH 运行预检 + 产物验证） | `.\install-workflow-plugins.ps1 -Profile web` |
| `verify-workflow-plugins.ps1` | 验证已安装插件（版本/路由/fetch，只读） | `.\verify-workflow-plugins.ps1 -Profile desktop` |

**典型流程**：

```powershell
# 1. 构建
.\build-workflow-plugins.ps1
# 2. 安装到 desktop profile（DSH 需已退出；web profile 无此限制）
.\install-workflow-plugins.ps1 -Profile desktop
# 3. 验证
.\verify-workflow-plugins.ps1 -Profile desktop
```

**参数速查**：

| 脚本 | 参数 | 默认 |
|------|------|------|
| build | `-Package host,client` / `-SkipTest` | 全部构建 + 冒烟验证 |
| install | `-Profile desktop,web,...` / `-Package` / `-SkipVerify` / `-AllowRunningDSH` | desktop / 全部 / 验证 / 检查 |
| verify | `-Profile` | desktop |

> 说明：`install` 对 `desktop` profile 会检查 DSH Desktop 是否运行（文件锁问题）；
> 对 `web`/其它 profile 无此检查。旧版 PowerShell 5.1 请用 `powershell -File` 执行。

---

## Node.js 辅助脚本

| 脚本 | 用途 |
|------|------|
| `build-host.js` | Host 插件构建（早期动态插件形态） |
| `build-preset.js` | 生成 `agent-presets/.../workflow-host.mjs`（预设本地插件拼接） |
| `test-host.js` | Host 单元测试（schema/parser/engine/expandLoop） |
| `simulate-exec.js` | 模拟工作流执行（状态流转验证） |

---

## 现有入口

- `bin/sd-agent` — 项目启动脚本（入口位置保持，后续可软链或拷贝到此目录）
