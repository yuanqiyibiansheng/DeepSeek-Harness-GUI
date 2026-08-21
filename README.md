# DeepSeek Harness GUI

> **二创项目（Fork / Derivative work）**
> 本项目基于 **DeepSeek Harness**（`dsh`）二次开发，原作者与项目归属 **DeepSeek AI 官方团队**（https://deepseek.ai / https://github.com/deepseek-ai/deepseek-harness）。
> 本仓库是在官方开源版基础上做**定制增强**的分支，仅代表本项目的定制部分；**底层架构、插件模型、核心能力均归属于官方 DeepSeek Harness 团队**。

[English](README.md) | 中文

## 关于本源

- **上游项目**：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 由 DeepSeek AI 开发的开放源代码 Agent Harness。
- **架构**：*everything is a plugin*，基于 [Cordis](https://github.com/cordiverse/cordis)（设计见 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)）。
- 本项目的[开发预览](#developer-preview)、[运行方式](#运行)、[开发指南](#开发)、[许可](#许可) 等均继承自官方上游，并保留官方署名与致谢。

## 本项目（二创）新增/定制内容

在本项目的官方上游基础上，额外集成了以下定制功能：

- **内置主题插件**：随安装包内置 `dsh-theme-firefly`（含自定义壁纸、音量滑块等）、`dsh-modef`、`dsh-market`（插件市场），并作为默认启用项。
- **桌面端内置运行时**：安装包自带 Node、npm、Memorix，以及**便携版 Git**（`bundle/Git`），使用户无需系统安装即可运行项目记忆等依赖 Git 的功能。
- **项目记忆（Memorix）增强**：使用**内置 Git** 自动初始化项目、按项目根路径识别项目、跨会话记忆；新会话注入最近记忆摘要。
- **自定义 UI 模块**：桌面桌宠（`ui-pet`）、终端（`ui-terminal`）、会话回退（`ui-session-rewind` / `rewind`）等。
- **工程增强**：持久 PowerShell、web_search 并发、Python 代码运行时、goal/plan 图文输入、Files API 图像预处理、SQLite 性能与新存储格式（SCHEMA_VERSION）。

> 具体实现与运行说明，请以仓库内实际代码为准。

## Developer preview

DeepSeek Harness 目前处于 *developer preview* 阶段，迭代迅速。**可能存在破坏性变更。**

## 运行

### 从源码运行

```sh
git clone <本仓库地址>
cd <本仓库目录>
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 生成仓库构建产物；`pnpm dsh web` 使用已构建产物启动 Web UI（默认 `http://127.0.0.1:3080`）。

### 打包桌面端

Windows 下运行 `build-desktop.bat`，会构建桌面端安装包（内置 Node/npm/Memorix/Git 及内置插件）。

## 社区与支持

- 官方：通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 反馈问题。
- 话题标签：[`dsh-plugin`](https://github.com/topics/dsh-plugin)。
- [DeepSeek Harness Discord 社区](https://discord.gg/Ycq5dCaS4)。

## 贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

入门请阅读 [development guide](docs/development.md) 与 [architecture documentation](docs/architecture.md)。
Agent 协助开发请遵循 [AGENTS.md](AGENTS.md)。

## 许可

本项目遵循 [MIT](LICENSE)（继承自官方 DeepSeek Harness）。

第三方依赖及许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 致谢

感谢 **DeepSeek AI 官方团队** 的 DeepSeek Harness 开源项目，本项目的核心架构与能力均源自该上游项目。
