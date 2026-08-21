# rewind/ — 会话回滚能力族

[English](README.md) | 中文

会话回滚能力：从工具执行录制的逐用户消息文件备份，以及回滚到任意直接用户消息的预览与执行。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`file-history/`](file-history/README.md) | 逐消息文件备份录制与备份工件存储。 | `ctx.fileHistory` |
| [`session-rewind/`](session-rewind/README.md) | 基于会话日志+快照折叠的回滚预览/执行/检查点。 | `ctx.sessionRewind` |

行为移植自参考实现（cc-haha `src/utils/fileHistory.ts` + `src/server/services/sessionRewindService.ts`），适配事件源会话日志：快照是 `file/history-snapshot` 会话事件（仅日志、可忽略），执行流程将参考实现的转录文件重写替换为持久的会话日志裁剪（`sessionPersistence.trim`）。
