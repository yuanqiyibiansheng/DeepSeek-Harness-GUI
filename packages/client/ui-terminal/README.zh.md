# @deepseek-ai/dsh-client-ui-terminal

[English](README.md) | 中文

Web GUI 的**集成终端 Shell 偏好**：通用设置区中的**终端**行，选择代理运行命令所用的 Shell 模式——PowerShell 7、Windows PowerShell、命令提示符、Git Bash 或 WSL——通过 `terminal` 设置命名空间持久化。所选择的模式由宿主 `dsh-pwsh-local` provider 消费，命令工具通过所选 Shell 启动。

## 配置

插件通过共享设置作用域绑定 `terminal` 设置命名空间（由 `dsh-terminal-host` 拥有）。持久化的 `shell`（默认 `pwsh`）选择代理命令工具启动命令所用的可执行文件；通用设置下拉即时更新。

## 模型体验

### 模型看到什么

无：该行是面向用户的设置。不注册任何工具，也不进入会话日志。

### Token 影响

无。

### KV Cache 影响

无。

## 已知限制与暂缓事项

- **Shell 可用性在启动时探测**——所选 Shell 未安装时回退到 `pwsh`；设置持久化前不探测。
- **设置行标签暂为中文**——设置导航的本地化标签尚未接入 locale 注册表。
