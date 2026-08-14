# DeepSeek Harness GUI

![logo](assets/logo/dspk.png)

基于 DeepSeek Harness 二次创作的 Windows 桌面客户端。保留上游 Agent Harness 的完整能力，额外提供桌面壳、代码审阅、对话回滚、插件市场、人格设定、技能管理、供应商一键导入、中文命令面板与自定义安装器。

本项目属于二创：核心运行时来自 DeepSeek Harness，桌面壳与安装器为本地改造，功能参考了多个开源项目，具体来源见文末「功能来源」。

## 主要功能

### 桌面客户端
- Tauri 2 桌面壳，启动时自动拉起本地 `dsh web` 后端
- 侧边栏、对话区、设置页、详情面板完整适配桌面窗口
- 自定义安装器 `dsh-desktop-installer.exe`，内置最新桌面程序和运行资源，不依赖 NSIS

### 代码审阅
- 会话头部按钮或 `Ctrl+Alt+B` 打开右侧代码审阅抽屉
- 显示当前工作区的 git 变更列表、新增文件、stat 与 diff
- 本地服务提供变更快照与长轮询更新

### 对话回滚
- 每条用户自己发起的消息旁都有回滚按钮
- 点击哪条消息就精准回滚到该消息发出前的文件状态
- 会话日志按文件字节偏移截断，不再复制正在写入的日志，避免会话日志损坏
- 历史记录写入项目目录 `.recode/history.db`，完全本地，不需要服务器

### 插件市场
- 设置页「插件」分区提供「插件市场」标签页
- ComfyUI Manager 风格：搜索、安装、卸载、更新全部
- 底层通过 `dsh plugin` 管理 web profile 插件

### 人格设定
- 设置页提供「人格设定」页面
- 直接编辑用户级 `~/.dsh/AGENTS.md`，全局指令注入每个会话

### 技能管理
- 设置页提供「技能」页面
- 列出用户级技能，支持模型调用开关、用户调用开关与删除

### 供应商一键导入
- 模型设置内置一键供应商预设
- 支持 OpenAI、Anthropic、Google Gemini、Groq、OpenRouter、Kimi、MiniMax、Ollama、OpenAI 兼容中转站

### 中文命令面板
- `/compact` 压缩较旧的对话历史
- `/feedback` 记录本次会话的反馈
- `/goal` 设置或查看长期任务的目标
- `/permission` 切换权限预设（沙箱模式 + 审批策略）
- `/plan` 进入或退出规划模式
- `/export` 导出本次会话日志为 ZIP 压缩包
- `/model` 选择本会话使用的模型

### 其他修复
- 侧边栏按钮 Tooltip 气泡改为挂载到 `document.body` 并使用顶层 z-index，不再被侧边栏或面板遮挡
- 移除透明面板问题，详情面板保持不透明显示
- 移除主页侧边栏底部的重复「插件市场」入口，插件市场仅保留在设置页

## 项目结构

```
apps/desktop/                    Tauri 桌面壳与本地 diff/回滚服务
  src-tauri/src/diff_server.rs   代码审阅、快照、回滚、本地 SQLite 历史
  scripts/prepare-bundle.mjs     准备独立 dsh web 运行目录
apps/desktop-installer/          自定义安装器源码（Vite + Tauri）
  scripts/prepare-payload.mjs    打包 dsh-desktop.exe 与运行资源
  uninstaller/                   卸载器源码
packages/client/ui-sidebar-toggle/   代码审阅入口、回滚按钮、弹窗
packages/client/ui-settings-persona/ 人格设定页面
packages/client/ui-settings-skills/  技能管理页面
packages/client/ui-settings-plugin-inventory/  插件市场页面（设置页入口）
packages/client/ui-settings-models/  模型设置与供应商预设
packages/client/connection/     客户端通信与 wire 接口
packages/host/apiproxy/         宿主 API 网关、skills/pluginMarket/host 接口
packages/bundle/web-app/        Web 插件注册
```

## 构建安装

环境要求：

- Node.js `^22.19` 或 `>=24`
- pnpm
- Windows（当前桌面壳与安装器面向 Windows）

```sh
pnpm install
pnpm run build
```

生成桌面主程序与独立运行目录（不使用 NSIS）：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build:no-bundle
```

生成自定义安装器：

```sh
pnpm --filter @deepseek-ai/dsh-desktop-installer run build:setup
```

输出位置：

- 桌面主程序：`apps/desktop/src-tauri/target/release/dsh-desktop.exe`
- 独立运行目录：`apps/desktop/bundle`
- 自定义安装器：`apps/desktop-installer/src-tauri/target/release/dsh-desktop-installer.exe`
- 可选 NSIS 安装包：`apps/desktop/src-tauri/target/release/bundle/nsis/`

## 功能来源

- 上游基础：DeepSeek Harness（MIT）  
  https://github.com/deepseek-ai/deepseek-harness

- 插件市场、人格设定、技能管理、供应商一键导入参考：SnowSalt  
  https://github.com/KYZHXL/deepseek-harness-snowsalt

- 右侧面板、鲸鱼娘宠物、图像理解参考：dsh-web-ui  
  https://github.com/zhu1090093659/dsh-web-ui  
  说明：本仓库参考过 dsh-web-ui 的方案；最终发布版未内置右侧面板，宠物与图像理解可作为外部插件单独安装。

本项目为二创项目，保留上游 LICENSE 与 THIRD_PARTY_NOTICES 中的署名要求。涉及 GPL-3.0 / Apache-2.0 / MIT 的部分均按各自许可证保留来源说明。

## 数据目录

桌面端默认使用：

```
%APPDATA%\ai.deepseek.harness.desktop\dsh
```

- `profiles/web`：web profile 与已安装插件
- `sessions`：会话数据
- `storages`：存储数据
- `settings.yaml`：用户设置

## 更新日志

### 2026-08-15
- 修改目标：移除主页侧边栏底部重复的插件市场入口。
- 修改文件：`packages/client/ui-settings-plugin-inventory/src/client/index.ts`、`PluginMarketAction.tsx`、`PluginMarketAction.module.css`、`locales.ts`、`tests/browser-plugin.client.spec.tsx`、`README.md`。
- 修改内容：不再注册 `sidebar.footer.action` 插件市场按钮，删除该按钮组件与专用文案；设置页插件市场标签保持不变。
- 影响范围：桌面客户端主页左下角不再显示插件市场按钮；设置页插件市场功能不受影响。
- 注意事项：本次未改动插件市场 API 与安装卸载逻辑；重新构建桌面主程序与安装器后生效。
