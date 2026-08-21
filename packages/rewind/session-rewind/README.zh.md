# @deepseek-ai/dsh-session-rewind

[English](README.md) | 中文

会话回滚：基于事件源会话日志与 file-history 快照折叠，预览并执行到会话任意直接用户消息的对话+文件回滚。

行为移植自参考实现（cc-haha `src/server/services/sessionRewindService.ts`）；执行流程将参考实现的转录文件重写替换为持久的会话日志裁剪。

## 功能

注册 `ctx.sessionRewind` 服务（Typert Remote 服务），经 API 网关暴露四个操作：

- `sessionRewind/preview` — 回滚到某条用户消息将移除与恢复什么，不改动任何内容。
- `sessionRewind/execute` — 停止并排空所属 agent，恢复目标快照的文件（`mode: 'both'`，默认）或跳过（`mode: 'conversation'`），并从目标回合起持久裁剪会话日志。
- `sessionRewind/listTurnCheckpoints` — 每个已完成且有文件变更记录的回合一个检查点。
- `sessionRewind/getTurnCheckpointDiff` — 某个回合检查点的单文件 diff。

回滚目标由 `targetUserMessageId`（`user/message` 事件 seq 的十进制字符串）或 `userMessageIndex`（在会话直接用户消息中的下标）选择，可选 `expectedContent` 防陈旧保护。

## 工作原理

读取模型（`deriveRewindMessages`）将会话事件日志投影为移植算法所操作的类转录消息列表：直接 `user/message` 事件成为 `user` 条目，`tool/call`/`tool/result` 事件按调用 id 配对，`turn/end` 的错误原因以 `error` 条目收尾。dsh 的子 agent 工作存在于自己的会话，因此参考实现的旁路转录遍历在结构上不存在，转录始终完整。

文件快照来自 `file/history-snapshot` 折叠（[`@deepseek-ai/dsh-file-history`](../file-history/README.md)）。代码预览合并快照捕获内容与转录所述回合工具行为；转录无法描述其文件影响的工具（shell 写入、未识别工具）通过 `unverifiedChangeSources` 将恢复覆盖降级为部分，而不是阻止撤销。参考实现的 2000 行 tree-sitter bash 只读分类器被自包含的保守允许列表（[`read-only.ts`](src/read-only.ts)）替代，契约相同——被判定为非只读的命令只会降级覆盖，绝不夸大。

执行时停止 agent（`agent.cancel` + `agent.whenIdle`）、刷新会话、通过基于计划的恢复恢复文件（预检可写性、逐文件安全复核、部分失败回滚），然后在目标回合的 `turn/start` seq 处裁剪日志，使剩余日志以完整回合平衡结束。**裁剪后拥有该日志的内存 Session 已过期**：客户端必须重新加载会话——桌面壳重启 dsh 服务，从裁剪后的日志重放。

## 配置

无配置。录制侧通过 [`@deepseek-ai/dsh-file-history`](../file-history/README.md) 配置。

## 模型体验

该服务对模型不可见：无工具、无提示词段落、无 token 开销。

## 已知限制与待办

- bash 只读判定是参考实现基于解析器检查的保守子集；允许列表之外的命令按未验证处理（安全方向）。
- [`@deepseek-ai/dsh-file-history`](../file-history/README.md) 中记录的回合开始快照竞态适用于 shell 写入的文件。
- 回滚目标仅限直接用户提示；注入的上下文消息不可回滚。
