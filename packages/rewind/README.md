# rewind/ — session rewind capability family

English | [中文](README.zh.md)

The conversation-rewind capability: per-user-message file backups recorded
from tool execution, and the preview/execute of rolling a session back to any
direct user message.

| Package | Role | ctx key |
|---|---|---|
| [`file-history/`](file-history/README.md) | Per-message file-backup recording and backup artifact storage. | `ctx.fileHistory` |
| [`session-rewind/`](session-rewind/README.md) | Rewind preview/execute/checkpoints over the session log + snapshot fold. | `ctx.sessionRewind` |

Ported in behavior from the reference implementation (cc-haha
`src/utils/fileHistory.ts` + `src/server/services/sessionRewindService.ts`),
adapted to the event-sourced session log: snapshots are `file/history-snapshot`
session events (log-only, ignorable), and the execute flow replaces the
reference's transcript-file rewrite with a durable session-log trim
(`sessionPersistence.trim`).
