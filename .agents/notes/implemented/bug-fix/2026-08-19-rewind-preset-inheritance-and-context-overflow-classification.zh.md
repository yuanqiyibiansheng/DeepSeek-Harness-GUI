Status: implemented

[English](2026-08-19-rewind-preset-inheritance-and-context-overflow-classification.md) | 中文

## 问题

Windows 桌面使用中出现两个相互独立的回归：

1. 执行会话回退（rewind）后，fork 出的子会话**没有任何模型侧工具**——包括 shell/终端命令工具（PowerShell / 命令提示符 / Git Bash / WSL 选择、`bash`/`pwsh` 执行）。根因：`session-rewind` 的 `forkFromPrefix` 用 `ctx.agents.create` 创建子会话时只带 `cwd`/`parentSession`/`seedLength`，没有继承 preset 组合；而网关自身的 `session.fork`（api-proxy）会从日志解析父会话 preset 并挂载到子会话下。宿主平面已禁用模型侧行、全部由 `dsh-agent-presets` 按会话组合时，未组合的子会话看到的是空全局层——正是「回退后内置工具全部失灵，直到新会话」的现象。用户引用的设置行（`ui-terminal`「集成终端 Shell」）只是偏好 UI；真正的故障是缺失的组合。

2. DeepSeek 在对话中途开始返回 HTTP 400 `{"message":"Input token exceed the limit","code":"quota_limit_reached"}`。`isContextWindowExceededError` 匹配不到任何措辞（无 "context length/window"、无 "too large for model"），于是 `httpErrorCode` 将其归类为 `INVALID_REQUEST`，compaction-basic 的 `agent/request-error` 恢复路径永不触发——回合直接死亡、无自动压缩，只有回退或新会话能恢复。提供方的 `code` 值是误导性的 `quota_limit_reached`；消息本身是上下文超限陈述。

## 决策

- `session-rewind` 的回退 fork 现在继承父会话组合：`composeAgentFromSource` 通过 `resolveSessionPreset` 从源会话日志解析 preset（最新的 `agent-preset/selected` 胜出，与所有 resume/fork 路径一致），既写入 `meta.agentPreset` 也作为子会话的 `setup`（有 roster 时挂载到子会话作用域；无则恒等）。`parentSession` 保留父会话自身谱系而非覆盖为孙辈关系。新增 `@deepseek-ai/dsh-agent-presets` peerDependency 与 tsconfig 项目引用。
- `isContextWindowExceededError`（dsh-llm）现在识别完整措辞 `input tokens? exceed`（无歧义短语），并作为严格限定的回退：字符串同时包含 token 界限与容量标签（`/8k`、`k/512`）且出现 `exceed`。`httpErrorCode(400, …)` 于是把该 DeepSeek 详情归类为 `CONTEXT_WINDOW_EXCEEDED`，请求进入 compaction-basic 的自动上下文超限恢复（压缩+重试）而非 `INVALID_REQUEST` 死路。

## 备选方案

**回退保持最小 fork，客户端打开后重新选择 preset。** 否决：重选发生在会话已存在之后，会在与 seed 历史不同的组合下重放，并使日志已携带的工具调用失联——正是网关 `fork` 注释指出的危害。

**仅按提供方 `code`（`quota_limit_reached` → 上下文超限）分类。** 否决：该 code 是提供方自身的误称，其他配额 payload 确实表示余额耗尽；消息措辞才是可靠信号。

**把 "too large" 模式放宽到任何 `exceed`/`limit` 措辞。** 否决：会吞掉无关的输入校验 400（如 "temperature exceeds maximum allowed value"）；token 限定回退保持窄口径。

## 影响

- 回退后的会话重建回退前所运行的同一 preset（因而同一工具集、提示段落与终端能力）。客户端无需改动。
- DeepSeek 对话中途的 400 现在触发自动压缩并重试，而非终止回合；真正配额耗尽的 400（带配额措辞）不受影响。
- `session-rewind` 新增一个对 `@deepseek-ai/dsh-agent-presets` 的 peer 依赖（桌面/Web bundle 均已包含）。两个分类分支与 fork 契约均已补充单测；`llm`、`llm-deepseek`、`session-rewind`、`agent-presets` 全部测试套件通过。
