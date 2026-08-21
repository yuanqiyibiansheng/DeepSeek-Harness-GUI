# @magiczerowxy/dsh-modef

模型选择 + 推理强度滑块 for DeepSeek Harness。模型保持官方下拉菜单，推理强度改为 Claude 风格滑块；最高档带可选动画特效，并在 Harness 通用设置中提供「高级的推理强度选择」开关与动画样式选择器。

A model picker + reasoning-effort slider for the DeepSeek Harness web UI. Keeps the model as the official dropdown, replaces the effort control with a Claude-style slider, and adds selectable max-tier animations controlled from General settings.

## UI效果

| 通用设置开关 | 最高档特效（喷射流光） | 最高档特效（暗流涌动） |
| --- | --- | --- |
| ![settings](screenshots/settings-general.png) | ![slider](screenshots/effort-slider.png) | ![effect](screenshots/max-tier-effect.png) |

## 功能 Features

- **模型下拉菜单**：官方模型目录，分组显示，搜索定位
- **推理强度滑块**：档位来自模型 `reasoning` 配置（如 Off / High / Max），拖拽/点击/键盘均可调节，松手平滑吸附
- **最高档动画样式**（通用设置中切换）：
  - **喷射流光 (spray-flow)**：蓝紫渐变流光 + 火箭喷射粒子，粒子从喷口逐步点火喷出
  - **暗流涌动 (undertow)**：白→紫渐变点阵 + 亮点从右端喷射向左涌动、逐渐消散；进出最高档有对称的揭示/收起动画
- **通用设置集成**：开关「高级的推理强度选择」+ 样式选择器（持久化到 `settings.yaml` 的 `dsh-modef` 命名空间）
- **无缝接管**：开启后以低优先级（-100）遮蔽官方模型选择器，关闭即恢复官方设计

## 安装 Install（这边建议把仓库直接扔给DSH自己安装）

包已发布到 npm（`@magiczerowxy/dsh-modef`），也可直接从 GitHub 安装，统一用官方 `dsh plugin` 命令（二选一）：

### 方式 A：从 npm registry 安装（推荐）

```bash
dsh plugin --profile <profile> add @magiczerowxy/dsh-modef
```

### 方式 B：直接从 GitHub 安装

```bash
dsh plugin --profile <profile> add github:Magiczerowxy/dsh-modef
```

> **`<profile>` 换成你自己的 profile 名**：DSH 桌面版默认用 `desktop`，Web 版用 `web`，其他自定义 profile 写对应名字。不带 `--profile` 时操作默认 profile。
> 命令会自动把包写入 profile 依赖，并因包声明了 `dsh.bundle` 自动加入 layer stack（`dsh.profile.bundles`）。

### ⚠️ 必需：设置白名单补丁

通用设置里的开关依赖 `settings.describe` 的命名空间白名单。需要把 `dsh-modef` 加入部署的 `@deepseek-ai/dsh-host-apiproxy`（官方决策点）：

```
文件：<DSH 安装目录>/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js

const WEB_SETTINGS_NAMESPACES = [
  // ...
  "web-search-deepseek",
  "dsh-modef"   // ← 添加这一行
];
```

> 这是 DSH 官方「新注册命名空间默认不对配置客户端开放」的硬编码白名单（注释明示扩展该列表是官方决策）。**DSH 升级覆盖此文件后需重新添加**。

### 卸载 Uninstall

```bash
dsh plugin --profile <profile> remove @magiczerowxy/dsh-modef
```

同时可移除上面添加的白名单行（可选）。

## 使用 Usage

1. 打开 Harness 通用设置 → 打开「高级的推理强度选择」
2. 在下方选择最高档动画样式（喷射流光 / 暗流涌动）
3. 输入框的模型下拉变为「模型 + 推理强度」组合控件，拖到最高档观看动画
4. 关闭开关即恢复 DSH 官方默认设计（`settings.yaml` 中的配置保留）

## 结构 Structure

```
dsh-modef/
├── lib/
│   ├── index.js    # Host 半区：注册 dsh-modef 设置命名空间（advancedEffort / effortStyle）
│   └── client.js   # Client 半区：模型下拉 + 推理滑块 + 动画特效 + 设置行
├── screenshots/    # 界面截图
├── cordis.patch.yml  # bundle patch：insert dsh-modef entry
└── package.json      # dsh.bundle + dsh.client 声明
```

## License

MIT
