# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 桌面打包

可选的 Tauri 2 外壳可以将 Web UI 打包为 Windows 桌面应用：

```sh
build-desktop.bat
```

脚本会检查 Node.js 22.19+ 或 24+，安装依赖，构建工作区，在 `apps/desktop/bundle` 准备自包含的 `dsh web` 运行环境，并执行 `tauri build`。NSIS 安装包输出到 `apps/desktop/src-tauri/target/release/bundle/nsis/`。

外壳位于 `apps/desktop`，参考了 [NexBox](https://github.com/MuLiuSaMa/NexBox)（GPL-3.0）的 Tauri 外壳布局；应用图标统一使用 `LOGO/DeepSeek256x256.ico` 中的 DeepSeek logo。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 近期变更

### DeepSeek 余额小部件与任务完成通知

- 修改目标：在对话底部统计栏内联显示「本轮 ¥X · 余额 ¥Y」，并在 agent 回合完成时弹出 Windows 系统通知，参考 Deepseek-Harness-EAC 的实现。
- 修改文件：packages/client/ui-desktop-tools（新增客户端插件：余额小部件 + 回合结束通知监听）、packages/client/runtime/src/client/index.ts（新增 `session/turn-end` 事件）、packages/bundle/web-app（依赖与加载行）、apps/desktop/src-tauri/src/lib.rs（`balance_query` / `notify_task_done` / `open_recharge` 命令、通知插件）、apps/desktop/src-tauri/build.rs 与 apps/desktop/src-tauri/capabilities/default.json（命令权限）、apps/desktop/src-tauri/Cargo.toml 与 apps/desktop/src-tauri/Cargo.lock（`tauri-plugin-notification`、`ureq`）、tsconfig.client.json、pnpm-lock.yaml、README.md、README.zh.md。
- 修改内容：对话统计栏新增「本轮 ¥X · 余额 ¥Y」小部件，每 15 分钟自动刷新，点击后使用默认浏览器打开 DeepSeek 充值页。余额来自 `https://api.deepseek.com/user/balance`，密钥读取 `DEEPSEEK_API_KEY` 或 `$DSH_HOME/.credentials.yaml`；价格档位按 `settings.yaml` 中的当前模型选择。实时 `turn/end` 事件到达时，桌面壳弹出 Windows 通知（`DeepSeek Harness 任务完成`），同一会话每 30 秒最多一条；点击已安装客户端的通知可回到窗口。
- 影响范围：无需打开官网即可查看本轮费用与账户余额；客户端在后台时也能收到任务完成通知。
- 注意事项：余额显示需要已配置 DeepSeek API Key；未配置时只显示费用估算。桌面端 exe 与自定义安装器已从源码重新构建。

### 撤销 OpenCode Agent 引擎接入

- 修改目标：移除实验性的 Harness/OpenCode 引擎切换与内置 OpenCode Web 运行时，桌面客户端继续使用客户端内部的 DeepSeek Harness 对话界面。
- 修改文件：packages/client/ui-agent-engine（已删除）、apps/desktop/src-tauri/src/lib.rs、apps/desktop/src-tauri/build.rs、apps/desktop/src-tauri/capabilities/default.json、apps/desktop/scripts/prepare-bundle.mjs、apps/desktop-installer/scripts/prepare-payload.mjs、packages/bundle/web-app、tsconfig.client.json、pnpm-lock.yaml、README.md、README.zh.md。
- 修改内容：移除 Agent 引擎设置行、OpenCode 子进程生命周期、对应命令权限、OpenCode 运行时打包与安装器 payload。保留构建稳健性修复：当 pnpm 把 CLI 包部署到 node_modules 时，桌面包仍会补齐可用的 dsh 入口；若 bundled node 已是最新运行时可跳过自复制。
- 影响范围：安装器 payload 回到约 233 MB，不再包含 OpenCode；桌面客户端正常启动 DeepSeek Harness Web UI。
- 注意事项：桌面端 exe 与自定义安装器已从源码重新构建；冒烟测试已在本地端口启动打包后的 web 后端并返回 HTTP 200。

### 项目记忆（Memorix）集成

- 修改目标：在客户端 设置 → 通用 中新增“项目记忆”开关（默认启用），并内置 Memorix 作为本地项目记忆层，让新对话可以读取项目历史、进度与决策，而不是从空白开始。
- 修改文件：packages/client/ui-project-memory（新增设置开关插件）、packages/host/project-memory（新增管理 Memorix MCP 行的 host 插件）、packages/bundle/web-app（依赖与加载行）、packages/host/apiproxy/src/api-proxy.ts（设置白名单）、apps/desktop/scripts/prepare-bundle.mjs 与 apps/desktop-installer/scripts/prepare-payload.mjs（打包 Memorix 运行时）、tsconfig.client.json、tsconfig.host.json、README.md、README.zh.md。
- 修改内容：开关启用时，host 会自动向 `$DSH_HOME/cordis.patch.yml` 写入 `memory-memorix` 的 `@deepseek-ai/dsh-mcp-client` 行，使用内置 node 与 Memorix CLI 启动；关闭时移除该行。Memorix 通过 stdio 提供 MCP 工具，工具名称为 `mcp__memorix__*`；切换开关后需重启客户端生效。
- 全自动记录：开关启用后，host 会监听会话事件流；每个完成的对话回合会自动写入项目记忆（标题为“会话 <id> 第 N 回合”，内容包含用户提问、助手回答与使用工具），并在每个新回合组装系统提示时自动注入最近记忆摘要。无需手动调用 MCP 工具。
- 影响范围：设置 通用 出现“项目记忆”开关；安装器内置 Memorix 1.5.0 运行时（payload 增至约 233 MB）。
- 注意事项：Memorix 通过 MCP workspace roots 或 `memorix_session_start` 绑定项目；`apps/desktop/memorix-runtime` 目录不入 git，由桌面构建流程在打包前生成。

### 恢复 Agent 预设设置页的描述

- 修改目标：Agent 预设管理页不再显示每个预设的描述和标识，因为对话框编辑时移除了卡片主体渲染；对应的 CSS 与测试仍然存在。
- 修改文件：packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx（恢复 `CardDescription` 与卡片 id 行）；README.md、README.zh.md。
- 修改内容：每个预设卡片恢复显示本地化/自定义描述（缺失时显示“暂无描述”），描述被卡片截断时悬停显示完整内容，并恢复预设 id；保留新加的“创造模式”入口等对话框修改。已从源码重新构建桌面 bundle 与自定义安装器。
- 影响范围：设置中的 Agent 预设卡片重新显示完整描述；新会话选择器仍只显示名称。
- 注意事项：需重新安装重建后的安装器才能看到恢复的描述。

### WebView 启动清单缓存修复（client bundle 重建后不再报错）

- 修改目标：Agent 预设对话框与 client bundle 重建后，客户端出现 `Failed to load plugins`；原因是 WebView 使用了缓存的旧 `index.html`，而 bundle 已变化，旧启动清单缺少 `@deepseek-ai/dsh-client-runtime`，导致 `ui-theme` 无法解析 `dsh-client-runtime/client`。
- 修改文件：packages/host/frontend-static/src/index.ts（index 响应增加 `cache-control: no-store`）；packages/host/frontend-static/tests/frontend-static.spec.ts；README.md、README.zh.md。
- 修改内容：所有 index 响应禁止缓存，确保动态注入的 `__DSH_BOOT__` 始终为最新；从源码重新构建桌面 bundle 与自定义安装器；再次清理用户 profile 中无效的 `plaindeck` 公共插件条目。
- 影响范围：client bundle 重建后 WebView 不再使用旧启动清单，可避免升级或热重建后的 `client-modules` 模块表缺失报错。
- 注意事项：如果已打开的客户端仍显示该错误，关闭客户端后重新打开一次，WebView 会加载未缓存的 index。

### 预设切换菜单只显示名称；安装器重新构建

- 修改目标：新会话界面的 Agent 预设切换菜单在名称下方还显示每个预设的描述句子，导致切换列表冗长；切换列表应只显示模式名称（标准模式、PTC 模式、极简模式、创造模式）。
- 修改文件：packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx（菜单行只渲染名称，移除描述行）、packages/client/ui-agent-preset/src/client/AgentPresetSeat.module.css（删除不再使用的 `.itemDesc` 样式）、packages/client/ui-agent-preset/tests/components.client.spec.tsx（seat 菜单测试改为断言只显示名称、描述与“暂无描述”占位不再出现）、apps/web/tests/agent-preset-selection.e2e.ts（菜单场景改为断言四个名称且描述句子不出现）、apps/web/tests/snapshots/agent-preset-selection/menu.expected.md（golden 快照更新为仅名称行）、apps/desktop/bundle、apps/desktop-installer/src-tauri/target/release/dsh-desktop-installer.exe、README.md、README.zh.md。
- 修改内容：新会话预设切换菜单每行只显示预设名称。描述文案仍保留在设置的 Agent 预设管理区和会话头部提示中，其余不变。
- 影响范围：预设切换菜单变为四行的简短列表；设置页与会话头部展示不受影响。
- 注意事项：桌面 bundle 已用重建后的 `dsh-client-ui-agent-preset` 产物重新生成，安装器 exe 已重新构建（`dsh-desktop-installer build:setup`）。

### 用户插件层容错（公共插件不再卡启动）

- 修改目标：安装公共插件市场的插件时，可能向 web profile 写入非 Cordis 插件或损坏的 `cordis.patch.yml`，导致 profile 准备或启动阶段拒绝整棵插件树，客户端卡在 “Starting DeepSeek Harness...”。
- 修改文件：packages/boot/app-boot/src/profile.ts（loadProfile 遇到无法解析的 `cordis.patch.yml` 时记录警告并跳过，不再失败）、apps/cli/src/profile-boot.ts（home/profile 用户 patch 读取失败时降级为空层；首次 boot 失败后自动去掉用户层重试）、packages/boot/app-boot/tests/profile.spec.ts（新增损坏用户层与无 bundle 清单的容错测试）、README.md、README.zh.md。
- 修改内容：用户 patch 层改为尽力加载。格式损坏、仅注释或非数组文件会跳过并输出警告；若组合后的用户层在 boot 阶段仍失败，启动器会仅用 bundle 层与 overlay 层重试。当前 web profile 已清理：移除无效的 `pm-plaindeck` 插入和空的 `@microi.net/cli` bundle 条目。
- 影响范围：损坏的公共插件不再阻止桌面端打开；官方 bundle 层错误仍会明确失败。
- 注意事项：跳过的用户层会向 stderr 输出警告；可在设置中移除或修复问题插件后重启恢复。

### 插件市场安装反馈与一键重启服务

- 修改目标：点击安装后，结果卡片按钮又变回"安装"（只有下方已安装列表刷新），成功看起来像失败；且新插件要等服务重启才出现在设置 → 插件列表，界面里没有重启入口。
- 修改文件：packages/client/ui-plugin-marketplace/src/client/MarketplaceTab.tsx（安装/卸载成功后立即更新结果卡片的已安装状态，按钮如实变为已安装/卸载；成功提示旁新增"立即重启"按钮）、packages/client/ui-plugin-marketplace/src/client/marketplace.module.css（重启按钮样式）、apps/desktop/src-tauri/src/lib.rs（restart_service 命令：杀掉后端子进程、重新启动后端、重载主窗口与桌宠窗口；后端启动逻辑提取为 spawn_backend）、apps/desktop/src-tauri/build.rs（应用命令清单加 restart_service）、apps/desktop/src-tauri/capabilities/default.json（allow-restart-service）、README.md、README.zh.md。
- 修改内容：安装/卸载后结果卡片即时更新；安装成功后提示可一键重启，重启会重载 dsh 服务，新插件随即激活并出现在插件列表。
- 影响范围：插件市场操作期间按钮状态真实可信，激活已装插件只需一次点击。
- 注意事项：重启会中断当前正在运行的会话（历史保留）；按钮只在桌面壳内出现。

### 桌面端与安装器源码重建

- 修改目标：防止公共插件导致的启动失败再次发生，并用最新源码重新生成桌面端和自定义安装器；同时清理误写入 `packages/*/*/src` 的 TypeScript 编译产物。
- 修改文件：packages/boot/app-boot/src/profile.ts、packages/client/ui-plugin-marketplace/src/index.ts（已包含损坏 bundle 容错与更安全的插件安装参数）、apps/desktop/bundle、apps/desktop/src-tauri/target/release/dsh-desktop.exe、apps/desktop-installer/src-tauri/target/release/dsh-desktop-installer.exe、README.md、README.zh.md。
- 修改内容：使用内置 Node 24 与 pnpm 11.19 从源码执行 `pnpm run build`，重建桌面 bundle、`dsh-desktop.exe` 和 `dsh-desktop-installer.exe`，并重新生成安装器 payload；删除 package `src` 目录下 306 个陈旧的 `.js` / `.d.ts` / `.map` 编译产物，`src` 恢复为纯 TypeScript 源码。
- 影响范围：新的 `dsh-desktop-installer.exe` 已包含插件市场容错与启动修复；源码目录不再出现编译产物遮蔽 `.ts` 文件的问题。
- 注意事项：若旧安装仍存在损坏的 web profile，安装新版前可清理 `%APPDATA%\ai.deepseek.harness.desktop\dsh\profiles\web`；插件市场安装使用 `--legacy-peer-deps --install-strategy=hoisted`。

### 公共插件容错与启动修复

- 修改目标：安装公共插件市场的第三方插件后，桌面端卡在 “Starting DeepSeek Harness...” 并提示 `127.0.0.1` 拒绝连接；原因是 web profile 中存在损坏的外部 bundle，后端在 HTTP 服务绑定前退出。
- 修改文件：packages/boot/app-boot/src/profile.ts（loadProfile 对无法解析的 profile bundle 记录警告并跳过，不再中断启动）、packages/client/ui-plugin-marketplace/src/index.ts（安装命令增加 `--legacy-peer-deps --install-strategy=hoisted`，降低公共插件安装时的依赖重复与 peer 损坏风险）、README.md、README.zh.md。
- 修改内容：已从本地 web profile 移除损坏依赖 `@deepseek-ai/dsh-mcp-client` 与 `@deepseek-ai/dsh-web-search-deepseek`（后者依赖不存在的 `@deepseek-ai/dsh-environment`）；桌面 bundle 与自定义安装器已重新构建。
- 影响范围：启动过程可容忍单个损坏插件 bundle；该 bundle 会被跳过并输出警告，客户端可正常打开本地 Web UI。现有桌宠、视觉增强、终端功能不受影响。
- 注意事项：如用户仍遇到旧 profile 损坏，可清理 `%APPDATA%\ai.deepseek.harness.desktop\dsh\profiles\web` 后重新安装新版本；安装第三方插件仍需选择与该客户端兼容的版本。

### 插件市场打开标签页自动加载目录

- 修改目标：插件市场之前只有点搜索才显示结果，首次进入的用户只看到"已安装的插件"列表，以为市场里几乎没有插件。
- 修改文件：packages/client/ui-plugin-marketplace/src/client/MarketplaceTab.tsx（首次挂载自动执行默认目录搜索——空查询即 keywords:dsh-plugin；空结果提示也覆盖默认搜索无结果的情况）、README.md、README.zh.md。
- 修改内容：打开 设置 → 插件 → 插件市场 立即从 npm registry 拉取并渲染最多 250 个 dsh 插件；搜索框仍可按需过滤。
- 影响范围：标签页不再为空；约 700 个 dsh-plugin 包一次可见。
- 注意事项：搜索仍需联网访问 npm registry。

### 插件市场扩容：npm registry 搜索 + 内置 npm CLI

- 修改目标：插件市场标签页之前只返回 npm CLI 默认的 25 条搜索结果，且在未安装 Node/npm 的机器上根本无法安装，相比参考项目的插件中心显得很空。现在发现改用 npm registry 搜索 API（每页 250 条——与 studio 插件中心同源），桌面 bundle 同时内置完整 npm CLI（放在内置 node 旁边），无需系统 Node 即可安装/卸载。
- 修改文件：packages/client/ui-plugin-marketplace/src/index.ts（搜索改用 https://registry.npmjs.org/-/v1/search、250 条/页，不再依赖 npm CLI；安装/卸载仍驱动内置 npm）、apps/desktop/scripts/prepare-bundle.mjs（bundleNpm：构建时 `npm install --prefix bundle/npm npm@10`）、apps/desktop-installer/scripts/prepare-payload.mjs（把 bundle/npm 复制进安装包 payload）、apps/desktop/src-tauri/tauri.conf.json（bundle/npm 资源）、README.md、README.zh.md。
- 修改内容：npm 公共注册表约有 700 个带 dsh-plugin 标签的包；市场现在每次搜索最多列出 250 条。内置 npm（10.x，约 11MB）由 host 半在 `<bundle>/npm/node_modules/npm` 找到，并用内置 node 执行。
- 影响范围：设置 → 插件 的"插件市场"标签页可展示丰富的 dsh-plugin 目录，桌面应用无需系统 Node 即可在线安装/卸载。
- 注意事项：搜索需要联网访问 npm registry；安装写入 web profile，服务重启后生效。

### 启动加固：JSON 清单读取容忍 UTF-8 BOM

- 修改目标：桌面客户端曾在启动时卡住，原因是 web profile 的 package.json 带 UTF-8 BOM（Windows 编辑器会写入）且引用了已移除的外部插件；JSON.parse 拒绝 BOM，profile 启动失败。运行时状态已修复，代码现在容忍 BOM，编辑器写入的清单不会再让启动卡住。
- 修改文件：packages/boot/app-boot/src/profile.ts（新增 readJsonFile 助手剥离开头 BOM；readProfileManifest、healProfilesModuleFallback、profile bundle 读取均使用）、packages/client/modules/src/index.ts（package.json 读取）、packages/client/ui-plugin-marketplace/src/index.ts（profile 清单读取）、packages/hooks/hooks-claude-code/src/index.ts 与 packages/hooks/hooks-codex/src/index.ts（hook 配置读取）、packages/boot/app-boot/tests/profile.spec.ts（BOM 容忍测试）、README.md、README.zh.md。
- 修改内容：所有 JSON 清单/配置读取在解析前先剥离 UTF-8 BOM，带 BOM 的文件与干净文件解析结果一致。
- 影响范围：由 Windows 工具写入带 BOM 的 profile、bundle、hook 配置都能正常加载；启动不再依赖文件的字节前缀。
- 注意事项：用户 web profile 已不再引用 @linxin666 插件（依赖与 node_modules 已移除）；安装包已用修复后的产物重建。

### 移植视觉增强（百炼桥接）；移除旧的图像理解插件

- 修改目标：(1) 把 deepseek-harness-studio 项目的视觉增强移植进来——百炼（DashScope）Qwen3.8 视觉桥接，把消息中的图片块转换成模型可见的观察文本，让纯文本 Agent 能看图；附带 vision_analyze 工具、通用设置行与输入框快捷开关；(2) 移除旧的图像理解路径：用户 web profile 中的 `@linxin666/dsh-tool-describe-image` 工具与 `@linxin666/dsh-client-ui-web-ui-settings` webui 设置卡。
- 修改文件：packages/host/apiproxy/src/vision-enhancement.ts（新增——installVisionEnhancement：vision_analyze 工具、llm/stream 图片→观察文本桥接、vision-enhancement 设置命名空间、百炼凭证引用）、packages/host/apiproxy/src/api/vision.ts 与 api/vision.schema.ts（新增——vision.status/test/enable 契约）、packages/host/apiproxy/src/api/{index.ts、rpc-map.ts}（vision 域）、packages/host/apiproxy/src/index.ts（installVisionEnhancement + api.vision）、packages/host/apiproxy/src/api-proxy.ts（vision handlers、设置白名单加 vision-enhancement、开启时豁免 selectModel/发送的图片模型检查）、packages/host/apiproxy/src/fetch/{client.ts、handler.ts}（vision 线 schema 与路由）、packages/host/apiproxy/tsconfig.json（fs/scope/system-prompt 引用）、packages/client/ui-vision-enhancement（新增——VisionEnhancementRow/Dialog/Shortcut/controller/css + apply 注册 settings.general.item 与 conversation.input.left）、apps/web/public/dsh-desktop/default-background.webp（新增——验证用默认图片）、packages/client/ui-plugin-marketplace（新增——设置页插件市场标签页，npm 驱动的 host 半，移植自 EAC）、packages/bundle/web-app（ui-vision-enhancement 与 ui-plugin-marketplace 行）、tsconfig.client.json、README.md、README.zh.md。
- 修改内容：
  - 视觉增强开关开启后，host 在发出消息前把图片块改写为百炼（qwen3.8-max）生成的 `<vision_observation>` 文本，并写入持久的 vision/observation 会话事件；同时豁免模型的图片输入检查。vision_analyze 工具可读取工作区图片。设置行与输入框快捷开关共享同一控制器（状态/开启/关闭），配向导对话框用真实图片 + API Key 验证后开启。
  - 用户 web profile 不再依赖 @linxin666/dsh-tool-describe-image 与 @linxin666/dsh-client-ui-web-ui-settings（依赖与 node_modules 已移除）。
  - 插件市场标签页（从 npm 搜索/安装/卸载 dsh 插件到 web profile）已注册到设置 → 插件；其 host 半需要桌面 bundle 内置 npm CLI（打包待后续补充）。
- 影响范围：纯文本 DeepSeek Agent 可经百炼读取截图、照片、图表与图片文字；在 设置 → 通用 → 视觉能力增强 或输入框快捷开关开启（需要 DASHSCOPE_API_KEY）。
- 注意事项：视觉桥接只在图片验证成功后激活；API Key 保存在本地受保护凭证中。

### 桌宠随客户端一起退出（关闭主窗口）

- 修改目标：关闭客户端后桌宠窗口还留在桌面上——因为只要还有窗口（桌宠）开着，应用就不会退出。
- 修改文件：apps/desktop/src-tauri/src/lib.rs（主窗口收到 CloseRequested 时同步关闭桌宠窗口）。
- 修改内容：主窗口的关闭请求处理器现在一并关闭桌宠窗口，应用随客户端一起退出。
- 影响范围：关闭客户端时桌宠随之关闭；退出时桌宠最后位置仍会持久化。
- 注意事项：只隐藏桌宠（不退出应用）仍使用设置开关。

### 修复桌宠无法拖动（deep 拖拽区域）

- 修改目标：桌宠窗口显示、开关正常后，桌宠拖不动。Tauri 拖拽脚本把裸的 `data-tauri-drag-region` 当作"仅自身"（点击必须落在该元素本身）；点在鱼身上（子元素）向上查找时被拒绝。
- 修改文件：apps/web/src/pet/main.tsx（data-tauri-drag-region="deep"）。
- 修改内容：桌宠窗口拖拽区域改为 `deep`，在窗口任意位置（含鱼身）按下即可拖动窗口；隐藏菜单按钮仍可点击（无属性的可点击元素仍阻止拖动）。
- 影响范围：桌宠可拖到桌面任意位置，位置继续通过 pet-position.json 持久化。
- 注意事项：右键仍弹出隐藏菜单；菜单按钮不会触发拖动。

### 修复桌宠：设置命名空间未暴露 + 远程域命令 ACL

- 修改目标：安装透明窗口版后，桌宠窗口不出现、设置开关点了没反应。两个独立根因：(1) `ui-pet` 设置命名空间不在 Web 配置客户端白名单中，每次开关写入都返回 `settings-not-exposed`，开关卡死；(2) Tauri 拒绝了主窗口与桌宠窗口（http://127.0.0.1 远程域）对 `pet_control` 应用命令的调用——没有生成应用 ACL manifest，也没有 capability 授权该命令。
- 修改文件：packages/host/apiproxy/src/api-proxy.ts（WEB_SETTINGS_NAMESPACES 增加 ui-pet）、apps/desktop/src-tauri/build.rs（app_manifest 声明 pet_control，让 tauri-build 自动生成应用 ACL）、apps/desktop/src-tauri/capabilities/default.json 与 pet.json（remote URL 基础上授予 allow-pet-control）、README.md、README.zh.md。
- 修改内容：开关写入现在能落到持久的 ui-pet.enabled 配置；桌宠窗口的 show/hide/toggle 命令在两个窗口的远程域获得授权，插件的设置同步能显示窗口，右键隐藏也生效。
- 影响范围：桌宠开关可正常切换并持久记忆；开启后桌宠出现在桌面。
- 注意事项：本地已复现验证（修复前点击开关 → settings.mutate 返回 settings-not-exposed）与生成 ACL 验证（allow-pet-control 存在、capability 构建校验通过）。

### 桌宠改为独立透明窗口；设置开关；右键菜单；修复消息布局

- 修改目标：(1) 桌宠移出主窗口，改为独立透明置顶桌面窗口（真正的桌面宠物：可拖到桌面任意位置，主窗口最小化/关闭后仍在）；(2) 在"通用"设置中新增桌宠开关，开关状态持久化，下次启动保持上次选择；(3) 右键不再直接消失，改为弹出菜单（隐藏）；(4) 修复用户消息布局：回滚按钮回到每条用户消息右侧的操作条（之前被改成悬浮在消息左侧，用户看到"消息在左侧"）。
- 修改文件：apps/desktop/src-tauri/tauri.conf.json（pet 窗口：透明、无边框、置顶、跳过任务栏、初始隐藏，开关决定显示；capability 增加 main/pet 的 remote URL，使 http://127.0.0.1 后端页面可访问 IPC）、apps/desktop/src-tauri/capabilities/pet.json（新增——pet 窗口拖拽权限）、apps/desktop/src-tauri/capabilities/default.json（main 窗口 remote URL）、apps/desktop/src-tauri/src/lib.rs（后端就绪后把 pet 窗口导航到 pet.html；pet-position.json 记忆窗口屏幕位置；pet_control 命令：show/hide/toggle）、apps/web/pet.html（新增——独立桌宠页入口）、apps/web/src/pet/{main.tsx、pet-page.module.css、vendor/*}（新增——桌宠舞台：BroadcastChannel 监听、拖拽区域、悬停跳跃/点击挥手、右键隐藏菜单；渲染源码从 ui-pet 复制）、apps/web/src/css-modules.d.ts（新增）、apps/web/vite.config.ts（多入口：main + pet）、packages/client/ui-pet/src/index.ts（注册 ui-pet 设置命名空间）、packages/client/ui-pet/src/pet-settings.ts（新增——命名空间/schema）、packages/client/ui-pet/src/client/index.ts（把 session/activity 通过 BroadcastChannel dsh:pet-activity 转发给桌宠窗口；绑定设置并驱动 pet_control；注册通用设置里的开关行）、packages/client/ui-pet/src/client/{PetToggleRow.tsx、PetToggleRow.module.css、pet-toggle-store.ts、locales.ts}（新增）、packages/client/ui-pet/src/client/PetDock.tsx（删除——由独立窗口取代）、packages/client/ui-pet/tests（apply.client.spec.ts、pet-toggle-row.client.spec.tsx 取代 pet-dock.client.spec.tsx）、packages/client/ui-conversation/src/client/chat/MessageItem.module.css（移除锚点 position: relative）、packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.module.css（回滚按钮回到操作条内）、tsconfig.base.json（补充 @deepseek-ai/dsh-client-ui-settings/client 显式 paths 条目）、README.md、README.zh.md。
- 修改内容：
  - 桌宠窗口加载同源 pet.html（dsh web 后端直接服务）；活动状态由主窗口 ui-pet 插件通过同源 BroadcastChannel 转发给桌宠窗口（无需跨窗口 IPC）；窗口任意位置可拖（Tauri 拖拽区域）；右键弹出隐藏菜单；屏幕位置持久化在 pet-position.json。
  - 通用设置新增"桌宠"开关（ui-pet 命名空间）。选择被持久化；启动时插件把开关状态镜像到外壳（pet_control show/hide），因此上次的状态在重启后保持。纯浏览器（无桌面外壳）下开关无副作用。
  - 回滚按钮回到消息操作条（右侧），用户消息气泡保持右对齐。
  - 顺带修复了环境问题：一次过期的 tsc -b 运行把 .js/.d.ts 产物写进了 packages/*/src/（vite 优先加载 .js，测试因此静默加载构建产物并在浏览器模块加载器全局变量上崩溃）；已删除污染文件并补全 ui-pet 的 tsconfig references，tsc -b 重新只输出到 lib/types。
- 影响范围：DeepSeek 大肥鱼在独立桌面窗口中随代理状态（修改代码/思考中/空闲）变换动画，可拖动并记忆位置；设置开关持久控制；右键不再让桌宠无声消失。
- 注意事项：桌宠窗口初始隐藏，只有开关打开时才显示；隐藏桌宠后通过设置开关恢复显示。桌宠窗口尺寸固定 240x260。

### 修复桌宠插件激活失败（移除 inject: ['runtime']）

- 修改目标：修复 web 启动失败 `1 entry did not activate @deepseek-ai/dsh-client-ui-pet: pending (waiting for service: runtime)`。客户端插件声明了 `inject: ['runtime']`，但 dsh-client-runtime 并不提供 `runtime` 服务（它提供 `slots`、`sessions`、`workspaces`），导致插件一直等待、桌宠不出现。
- 修改文件：packages/client/ui-pet/src/client/index.ts。
- 修改内容：插件 `inject` 改为 `[]`。它只监听共享 context 上的 `session/activity` 事件（由 dsh-client-runtime 随每个 mux 消息发出），不需要任何服务注入；激活不再被不存在的服务阻塞。
- 影响范围：DeepSeek 大肥鱼桌宠随 web 启动正常加载，随代理状态（修改代码/思考中/空闲）变换动画，可拖动并记忆位置，右键隐藏。
- 注意事项：packages/client/ui-pet/package.json 的 `dsh.client.inject` 保留为信息性包依赖边（`@deepseek-ai/dsh-client-runtime`），不参与激活排序。

### 桌宠（DeepSeek 大肥鱼，窗口内浮动）；移除旧桌宠

- 修改目标：用免费的本地浮动桌宠替换第三方页面内桌宠（`@linxin666/dsh-pet` 已从 web profile 移除）。桌宠使用 DeepSeek 大肥鱼 spritesheet（来自 deepseek-fat-fish-codex-pet 同人项目），展示代理实时状态——工具执行（修改代码）、思考中、空闲——各有不同动画；可拖动并记忆位置，右键隐藏本次会话。（曾尝试独立透明窗口方案，已放弃：桌宠现在直接在主窗口页面内。）
- 修改文件：packages/client/ui-pet（新增——package.json、tsconfig.json、tsdown.config.ts、src/index.ts、src/invariant.ts、src/client/{index.ts、PetDock.tsx、PetRenderer.tsx、petAnimation.ts、petTypes.ts、builtinPets.ts、pet.module.css、css-modules.d.ts}、tests/pet-dock.client.spec.tsx）、packages/client/runtime/src/client/index.ts（session/activity 事件：从 mux 会话事件推导 working/thinking/idle）、packages/bundle/web-app/cordis.patch.yml 与 package.json（ui-pet 行）、tsconfig.client.json（ui-pet 引用）、apps/web/public/pets/deepseek-fat-fish.webp（由 frontend-static fallback 直接服务）、README.md、README.zh.md。
- 修改内容：
  - `@deepseek-ai/dsh-client-ui-pet` 把全局浮动桌宠挂到 `document.body`（单一 React root，无会话维度）。Dock 监听 runtime 的 `session/activity` 事件并映射为大肥鱼动画：working → running、thinking → waiting、idle → idle；悬停播放跳跃、点击挥手、拖动移动并持久化位置到 localStorage、右键隐藏本次会话。
  - runtime（packages/client/runtime/src/client/index.ts）现在按 mux 会话事件发出 `session/activity`：`tool/call` → working、`step/start`/`turn/start`/`assistant/message` → thinking、`tool/result`/`turn/end` → idle。单个事件，不新增连接。
  - 大肥鱼 spritesheet 放在 `apps/web/public/pets/`（vite 复制进 dist，frontend-static fallback 原样服务），以 URL 引用——tsdown 无法打包图片资源。
  - 旧 `@linxin666/dsh-pet` 包、其 bundle 行与 `pet.json` 已从用户 web profile 移除；此前的 cc-haha 内置宠物已删，仅保留大肥鱼。
- 影响范围：免费本地 DeepSeek 大肥鱼桌宠悬浮在 GUI 左下角，随代理状态（修改代码/思考中/空闲）变换动画；数据全部在本机，不联网、不需账号、不收费。
- 注意事项：桌宠尺寸固定 140；选宠/尺寸设置尚未接入 GUI 设置页。

### 权限模式中文化、窗口尺寸记忆、启动居中、代码审阅重试修复

- 修改目标：(1) 权限预设标签（Read Only / Workspace Write / Full access）改为中文；(2) 主窗口尺寸跨启动记忆；(3) 启动时窗口居中显示；(4) 修复代码审阅抽屉首次打开报 "Failed to fetch"。
- 修改文件：packages/client/ui-permission-presets/src/client/presentation.ts、packages/client/ui-permission-presets/src/client/locales.ts、packages/client/ui-permission-presets/tests（3 个 spec）、packages/client/ui-permission-presets/package.json、apps/desktop/src-tauri/src/lib.rs、apps/desktop/src-tauri/src/diff_server.rs、apps/desktop/src-tauri/tauri.conf.json、packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.tsx、README.md、README.zh.md。
- 修改内容：
  - 预设标签改为 `presentation.ts` 中的中文映射：只读 / 工作区写入 / 完全访问；zh 字典中完全访问的确认文案同步更新。自定义宿主配置的预设名仍原样透传。
  - 桌面外壳在每次窗口尺寸变化时把尺寸持久化到应用数据目录的 `window-size.json`，启动时恢复尺寸并居中（tauri.conf.json 增加 `center: true`，另有显式 `restore_and_center`）。
  - diff server 改为对 3199 端口绑定重试（200ms 间隔），不再在上一个实例 socket 尚未释放时静默退出；前端加载重试由 3 次提升到 5 次（间隔 800ms）。
  - PermissionRow 组件测试改用 `react-dom/client` createRoot 挂载（`@testing-library/react` 挂载在仓库级 react 19/18 混用下崩溃），并断言中文标签。
- 影响范围：权限下拉全中文；窗口保持上次尺寸并居中启动；代码审阅抽屉首次打开不再报错。
- 注意事项：需重新构建桌面 bundle 与安装器，外壳改动才能发布。

### 安装器内置用户技能种子（中文描述）

- 修改目标：让 GUI 的技能设置页展示一套可用的内置技能。用户机器 `~/.trae-cn/skills` 中有 Trae IDE 技能；将其中可用的子集（Anthropic/Vercel 原版与通用开发技能）随桌面安装器发布，并在安装时种入用户技能根目录，描述全部改为中文单行。
- 修改文件：apps/desktop-installer/skills-seed（27 个技能目录，SKILL.md frontmatter 已改写）、apps/desktop-installer/scripts/prepare-payload.mjs、apps/desktop-installer/scripts/rewrite-skill-frontmatter.mjs（新增）、apps/desktop-installer/skills-zh-desc.json（新增）、apps/desktop-installer/src-tauri/src/installer.rs、README.md、README.zh.md。
- 修改内容：
  - `prepare-payload.mjs` 额外把 `skills-seed/` 复制进 payload 的 `resources/skills/`，每个安装器都携带技能集。
  - `installer.rs` 新增 `seed_user_skills`（及 `copy_dir_all`）：解压 payload 后把内置技能复制到 `%APPDATA%\ai.deepseek.harness.desktop\dsh\skills`（即技能设置页读取的 DSH_HOME 根目录）。已存在的技能目录永不覆盖，重装后用户修改与新增得以保留。
  - `rewrite-skill-frontmatter.mjs` 与 `skills-zh-desc.json`：每个种入的 SKILL.md frontmatter 的 `name` 与目录名一致（kebab-case，如 `vercel-composition-patterns` → `composition-patterns`），`description` 改为中文单行——Web 管理解析器只读 `key: value` 行，折叠式多行描述会显示为空。
  - 排除来源：字节系内部技能（douyin-*、douyinpay、byted-bp、iga-pages、hook/report 视频工具链）、Intel AIPC `local-*` 硬件技能、依赖外部账号的技能（alipay、figma MCP、Notion 检索、天眼一下 tyc OAuth）。
- 影响范围：全新安装后，设置 → 技能页展示 27 个中文描述技能，每个都可切换（模型/用户）与删除；当前机器的 `%APPDATA%\...\dsh\skills` 也已立即种入。
- 注意事项：需重新构建安装器才能随包发布；种子目录位于安装器工作区，不属于 dsh bundle。

### 终端 Shell 下拉框：弹层宽度与收起交互修复

- 修改目标："集成终端 Shell"下拉的弹层比触发框宽（内联列表保留了 218px 卡片最小宽度），且再次点击触发框无法收起。
- 修改文件：packages/client/ui-terminal/src/client/TerminalShellRow.tsx、packages/client/ui-terminal/tests/TerminalShellRow.client.spec.tsx、README.md、README.zh.md。
- 修改内容：
  - `TerminalShellRow` 的 `Menu` 启用 `portal`（与权限模式及其它设置行一致），弹层改为 fixed 定位并按触发框宽度取值（NexBox 风格），不再受 218px 内联卡片最小宽度影响。
  - 触发框点击改为切换 `open` 而非只打开，再次点击触发框即可收起；点击外部与 Escape 仍可关闭。
  - 新增测试用例断言触发框再次点击的收起行为。
- 影响范围：Shell 选择行在宽度与交互上与其他设置下拉一致。
- 注意事项：需重新构建桌面 bundle/安装器，GUI 才能生效。

### 移除终端面板，保留 Shell 选择，下拉框统一 NexBox 样式

- 修改目标：移除面向用户的集成终端面板（侧边栏底部入口 + xterm 面板）——终端是给代理用的，不是给用户用的；只保留设置中的"集成终端 Shell"下拉行，并让所有下拉框与 NexBox `CustomSelect` 样式一致（弹层与触发框同宽、箭头旋转、悬停过渡）。
- 修改文件：packages/client/ui-terminal（src/client/index.ts、src/client/locales.ts、src/client/terminal-model.ts、src/client/TerminalShellRow.tsx、package.json、tsconfig.json、README.md、README.zh.md；删除 src/client/SidebarTerminalAction.tsx、src/client/TerminalPanel.tsx、src/client/TerminalAction.module.css、src/client/TerminalPanel.module.css、tests/terminal-model.client.spec.ts）、packages/client/ui-primitives/src/Menu.tsx 与 Menu.module.css、packages/bundle/web-app/cordis.patch.yml、README.md、README.zh.md。
- 修改内容：
  - `ui-terminal` 现在只注册 `settings.general.item` 行（`terminal-shell`）；`sidebar.footer.action` 注册、面板、xterm 依赖与 SSE `parseSseFrames` 助手全部移除。`terminal` 设置命名空间（宿主拥有）仍驱动 `dsh-pwsh-local` 的执行 Shell，代理按设置中选中的终端模式运行命令。
  - 语言 key 精简为行内实际使用的两个（`terminal.shellSetting`、`terminal.shellSettingDesc`）。
  - `Menu` 的 portal 模式弹层现在与触发框同宽（`width: r.width`），portal 列表去掉最小宽度限制，对齐 NexBox `CustomSelect`；Shell 行的箭头展开时旋转 180 度并带过渡。
  - 依赖清理：`ui-terminal` 移除 `@deepseek-ai/dsh-client-ui-sidebar` 与 xterm 包，显式声明 `ui-primitives` 与 `clsx`。
- 影响范围：侧边栏不再出现终端入口；设置通用区保留 Shell 选择；基于共享 `Menu` 的所有下拉框现在与触发框同宽。
- 注意事项：无需修改 profile 补丁——内置 profile 同时启用两行；需重新构建桌面 bundle/安装器，GUI 才不带面板发布。

### 集成终端 Shell 选择（PowerShell / CMD / Git Bash / WSL）

- 修改目标：为桌面 Web UI 新增集成终端，并支持在设置中选择启动 Shell——PowerShell 7、Windows PowerShell、命令提示符、Git Bash 或 WSL。
- 修改文件：packages/subprocess/subprocess/src/types.ts、packages/subprocess/subprocess-local/src/terminal.ts、packages/subprocess/subprocess-e2b/src/terminal.ts、packages/terminal/terminal-host（新增）、packages/client/ui-terminal（新增）、packages/host/apiproxy/src/api-proxy.ts、packages/bundle/web-app/cordis.patch.yml 与 package.json、tsconfig.host.json、tsconfig.client.json、README.md、README.zh.md。
- 修改内容：
  - `SubprocessTerminalHandle` 新增 `resize(cols, rows)`（本地 node-pty 实现；E2B 提供方显式拒绝）。
  - Windows 终端支持：`createProcessInspector` 在 win32 返回空检查器（node-pty 的 spawn/write/resize 可用；前台检查、子进程跟踪与信号投递不可用，因此清理仅停止顶层 shell）——这也使 Windows 上可进行 `dsh-terminal-bash` 式启动。
  - 新增 `@deepseek-ai/dsh-terminal-host`：Shell 解析与探测（pwsh/powershell/cmd/git-bash/wsl）、`terminal` 设置命名空间、HTTP 接口——POST `/terminal/spawn`、GET `/terminal/:id/stream`（SSE 输出与退出事件）、POST write/resize/kill。会话驻留内存，流关闭或插件销毁时终止。
  - 新增 `@deepseek-ai/dsh-client-ui-terminal`：xterm.js 终端面板（侧边栏底部操作打开，Shell 取设置值、面板内无选择器）；通用设置区新增"集成终端 Shell"偏好行（下拉，与权限预设行同形）持久化选择。
  - `dsh-pwsh-local` 每次调用按 `terminal.shell` 偏好切换执行 Shell：`cmd` 走 `cmd /d /s /c`、`git-bash` 走 Git Bash 的 `bash -c`、`wsl` 走 `wsl bash -c`；其余保持 PowerShell 方言。即 agent 的命令工具按你在设置中选择的终端模式执行。
  - `terminal` 设置命名空间加入 Web 设置白名单。
- 影响范围：GUI 提供面向用户的、可选择性 Shell 的终端；面向模型的终端行为（dsh-terminal-bash）不变。
- 注意事项：面板依赖本地 subprocess 提供方（E2B 不支持尺寸调整）；需重新构建桌面 bundle 以携带新包。

### 消息快照改为差异存储（history.db 体积）

- 修改目标：history.db 体积膨胀——此前每条消息快照都完整存储工作区全部文本文件内容，未更改的文件不应进入数据库。
- 修改文件：apps/desktop/src-tauri/src/diff_server.rs、README.md、README.zh.md。
- 修改内容：
  - 消息快照改为差异存储：首个快照保存完整会话基线，后续快照仅保存 mtime 变化的文件，删除的文件记录 NULL 行；未变化文件不再入库（500 文件工作区仅 2 个变化时存 502 行而非 1500 行）。
  - 删除全量内容表 `file_state`，新增仅含 path+mtime 的 `file_meta`；变更记录的对比参照对从未记录过的路径回退到首个快照；审阅/回滚/预览按每个路径读取最近快照记录。
  - 一次性迁移（user_version 守护）删除旧全量表并 VACUUM 回收空间；迁移为尽力而为（并发写可能持有 VACUUM 所需的独占锁，此时推迟到下次打开）。写批次改用 BEGIN IMMEDIATE，使并发快照请求串行化而非交错执行或同时跑全量基线扫描。
- 影响范围：history.db 随实际变化量增长而非工作区大小；既有回滚数据仍然有效（旧全量快照可视为基线+逐消息全量，最近记录查询可正确处理）。
- 注意事项：后端在 Rust 桌面壳，需重新构建安装器后生效。

### 代码审阅抽屉性能与并发修复

- 修改目标：代码审阅抽屉首次打开耗时数十秒，大型非 git 工作区上第二次打开可能空白。
- 修改文件：apps/desktop/src-tauri/src/diff_server.rs、packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.tsx、README.md、README.zh.md。
- 修改内容：
  - diff server 改为每连接一线程处理，慢请求（如全量消息快照）不再阻塞后续审阅/回滚请求；SQLite 连接增加 busy timeout 应对并发写。
  - 批量写入（会话初始化、消息快照、变更记录）改为单事务提交，取代逐行自动提交——这是首次打开慢的主要成本。
  - `snapshot_review` 不再读取整个工作区：只读取基线已知路径的内容，新增文件来自仅 stat 的目录遍历。
  - 抽屉在两次打开之间重置失效的文件选择，避免载荷变化后 diff 区保持空白。
  - 重新打开抽屉时保留上次载荷并后台刷新（loading 仅阻塞首次请求），快照审阅在服务端缓存 3 秒，重复打开即时显示而非等待下一次全量计算。
- 影响范围：非 git 审阅从数十秒降至秒级，重复打开始终有内容。
- 注意事项：后端在 Rust 桌面壳，需重新构建安装器后生效。

### 回滚预览与安全恢复（复刻 cc-haha rewind 契约）

- 修改目标：将对话回滚提升到 cc-haha rewind 的安全契约——确认前先预览将恢复的文件（逐文件 diff 与 +/- 统计）、拒绝路径逃逸与符号链接写入、如实报告无法恢复的文件。
- 修改文件：apps/desktop/src-tauri/src/diff_server.rs、packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.tsx、packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.module.css、packages/client/ui-sidebar-toggle/src/client/locales.ts、packages/client/ui-sidebar-toggle/tests/ConversationRollbackAction.client.spec.tsx、README.md、README.zh.md。
- 修改内容：
  - 新增 `/code-review/rollback/preview` 端点：逐文件快照 vs 当前 diff（状态 `modified`/`deleted`/`created`）、+/- 统计与跳过列表；前端对话框先加载预览，展示文件列表与可展开 diff 后再启用确认按钮。
  - `restore_files` 的每个目标经 `safe_target` 校验：规范化后的父目录必须位于规范化工作区内（拦截 `..` 逃逸与被篡改的 history.db 路径），拒绝经由符号链接写入；回滚响应携带 `skipped` 列表。
  - 无法恢复的文件在对话框中明确列出，不再静默跳过。
- 影响范围：回滚改为"先预览再确认"，含逐文件 diff 与明确的跳过报告；恶意或意外快照路径无法再写出工作区。非 git 工作区不受影响（沿用上一项的会话基线审阅）。
- 注意事项：后端端点位于 Rust 桌面壳，需重新构建安装器后生效。

### 代码审阅抽屉：逐文件语法高亮 Diff 审阅

- 修改目标：将桌面端代码审阅抽屉从纯文本 `<pre>` 升级为逐文件审阅界面——行号、+/- 前缀、语法高亮（对齐 Claude Code Haha 的 workspace-diff 审阅体验）。
- 修改文件：packages/client/ui-sidebar-toggle/src/client/diff-model.ts（新增）、packages/client/ui-sidebar-toggle/src/client/DiffReviewSurface.tsx（新增）、packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.tsx、packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.module.css、packages/client/ui-sidebar-toggle/src/client/locales.ts、packages/client/ui-sidebar-toggle/tests/diff-model.client.spec.ts、packages/client/ui-sidebar-toggle/tests/DiffReviewSurface.client.spec.tsx、packages/client/ui-primitives/src/index.ts、README.md、README.zh.md。
- 修改内容：
  - 新增 `parseWorkspaceDiff` / `parseUntrackedFiles` / `untrackedRows` / `languageFromPath`（纯函数 diff 解析：hunk 行号、元数据行、未跟踪新文件内容）。
  - 新增 `DiffReviewSurface` 纯展示组件：双列行号 gutter、+/- 前缀、hunk/元数据样式、逐行 shiki 高亮（复用共享 `highlightLines`）、超长 diff 中间折叠。
  - 审阅抽屉文件列表改为可点击选择，diff 区按选中文件渲染（已跟踪 diff 或未跟踪新文件）。
  - `@deepseek-ai/dsh-client-ui-primitives` 导出 `highlightLines` / `HighlightSpan`（此前为 markdown 模块内部）。
  - 审阅抽屉将 diff server 的非 git 仓库错误映射为本地化提示（"当前目录不是 Git 仓库"），不再显示原始英文报错。
  - 非 git 工作区新增会话基线审阅：提供 session 时，diff server 返回快照 diff（file_state/changes 历史 vs 当前内容），抽屉携带 session 参数并跳过 git 变更轮询。
- 影响范围：代码审阅抽屉（Ctrl+Alt+B / 头部按钮）显示逐文件语法高亮 diff，替代原始文本；后端与传输层无改动。
- 注意事项：需重新构建 web bundle 后生效。仓库既有状态：当前根安装下 `packages/client` 的 GUI 组件测试因 react 19（hoisted @testing-library/react 的 peer 解析）与包内 react 18 混用而失败；本包测试直接经 react-dom 18 挂载以保持全绿。

### Windows 下失效回退链接替换增加重试

- 修改目标：修复桌面应用在替换指向旧构建目录的 `$DSH_HOME/profiles/node_modules` 回退 junction 时因 EPERM 直接退出、卡在启动页的问题。
- 修改文件：packages/boot/app-boot/src/profile.ts、README.md、README.zh.md。
- 修改内容：`ensureSymlink` 改用 `unlinkWithRetry` 替换指向错误目标的链接；对 EPERM/EBUSY（有进程持有该 reparse point，常见于先前启动的实例）最多重试 5 次、间隔 200ms；ENOENT（并发启动已删除）视为成功；重试耗尽后抛出包含链接路径、期望目标与处理建议的错误，而非裸 EPERM 中止启动。
- 影响范围：短暂占用（启动竞态、杀软扫描）可自愈；持续占用时给出明确诊断。正确链接与非 Windows 平台行为不变。
- 注意事项：需重新构建桌面安装器后生效。

### GUI 插件管理与识图配置修复

- 修改目标：修复桌面 Web GUI 的插件管理链路，并开放 describe-image 视觉端点设置卡片供界面内编辑。
- 修改文件：packages/host/apiproxy/src/api-proxy.ts、README.md、README.zh.md。
- 修改内容：
  - `WEB_SETTINGS_NAMESPACES` 加入 `describe-image`，使第三方 describe-image 插件的设置卡片可被 Web 客户端读取（此前返回 `settings-not-exposed`）。
  - `runPluginCommand` 改为通过 `process.execPath` 直接调用 `@deepseek-ai/dsh` 的 CLI 入口（`lib/bin.js`），不再依赖 `pnpm dsh`（在工作区之外会以 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL 失败）。
  - `profileDir`、`instructionsPath`、`userSkillRoot` 改为 `$DSH_HOME` 优先（回退 `~/.dsh`），与 `resolveDshHome` 一致；此前 Persona 页面写入 `~/.dsh/AGENTS.md`，而 agent-instructions 注入的是 `$DSH_HOME/AGENTS.md`。
  - 移除指向未发布包 `@deepseek-ai/dsh-shell-bash` 的 `dsh-bash` 市场条目；市场安装改用 `next` dist-tag（`<pkg>@next`），因为 registry 的 `latest` tag 仍指向无 bundle 声明的 `0.0.1-rc.1`。
- 影响范围：桌面部署下插件安装/卸载与插件市场可用；图像理解设置卡片可在 GUI 编辑；通过 Persona 页面写入的用户级 AGENTS.md 可被真正注入。
- 注意事项：需重新构建桌面安装器（apps/desktop 的 prepare:bundle + apps/desktop-installer 的 build:setup）后生效。
