# @deepseek-ai/dsh-terminal-host

[English](README.md) | 中文

桌面 Web UI 的**集成终端面板后端**：通过 subprocess PTY 原语启动一个可选择的 Shell——PowerShell 7（`pwsh`）、Windows PowerShell、命令提示符、Git Bash 或 WSL——并以纯 HTTP 提供实时会话：终端输出以 SSE 流式下发，输入与尺寸调整走 POST。会话以随机 id 为键、仅驻留内存，SSE 流关闭（面板关闭）或插件销毁时终止。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `defaultShell` | `pwsh` | 未指定时启动的 Shell 类型。 |

`terminal` 设置命名空间携带相同的 `shell` 字段作为 `defaultShell` 覆盖；面板将其作为默认选择。

## Shell 解析

`resolveShell(kind)` 探测环境 PATH 与常见安装位置：

- `pwsh` → `pwsh.exe -NoLogo`，回退 `powershell.exe -NoLogo`
- `powershell` → `powershell.exe -NoLogo`
- `cmd` → `cmd.exe`
- `git-bash` → PATH 或 Git for Windows 安装中的 `bash.exe --login -i`
- `wsl` → `wsl.exe`

无法解析的 Shell 会在启动请求中明确失败。

## HTTP 接口

| 路由 | 方法 | 请求体 | 结果 |
|---|---|---|---|
| `/terminal/spawn` | POST | `{ cols, rows, shell?, cwd? }` | `{ ok, id, shell }` |
| `/terminal/:id/stream` | GET | — | SSE 事件：`output`（`{type,data}`）后跟 `exit`（`{type,code,signal}`） |
| `/terminal/:id/write` | POST | `{ data }` | `{ ok }` |
| `/terminal/:id/resize` | POST | `{ cols, rows }` | `{ ok }` |
| `/terminal/:id/kill` | POST | — | `{ ok }`（终止 PTY 会话） |

## 模型体验

### 模型看到什么

无：面板是面向用户的终端。后端不注册任何模型工具，也不进入会话日志。

### Token 影响

无。

### KV Cache 影响

无。

## 已知限制与暂缓事项

- **尺寸调整依赖 subprocess 终端 seam**——为面板新增了 `SubprocessTerminalHandle.resize`；E2B 提供方明确拒绝，因此面板仅适用于本地提供方。
- **不检测 Shell 就绪**——面板直接流式输出原始 PTY 数据并立即转发输入；没有提示符标记就绪握手（面向模型的使用仍由 `dsh-terminal-bash` 负责）。
- **每个面板会话一个终端**——无会话复用或多路复用。
