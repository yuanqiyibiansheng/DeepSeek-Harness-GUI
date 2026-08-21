# @deepseek-ai/dsh-session-rewind

English | [中文](README.zh.md)

Session rewind: preview and execute conversation+file rollback to any direct
user message of a session, over the event-sourced session log and the
file-history snapshot fold.

Ported in behavior from the reference implementation (cc-haha
`src/server/services/sessionRewindService.ts`); the execute flow replaces the
reference's transcript-file rewrite with a durable session-log trim.

## What it does

Registers the `ctx.sessionRewind` service (a Typert Remote service) exposing
four operations over the API gateway:

- `sessionRewind/preview` — what a rewind to one user message would remove and
  restore, without changing anything.
- `sessionRewind/execute` — stop and drain the owning agent, restore the target
  snapshot's files (`mode: 'both'`, the default) or skip them
  (`mode: 'conversation'`), and durably trim the session log from the target
  turn onward.
- `sessionRewind/listTurnCheckpoints` — one checkpoint per turn with completed
  work and recorded file changes.
- `sessionRewind/getTurnCheckpointDiff` — the per-file diff of one turn
  checkpoint.

The rewind target is selected by `targetUserMessageId` (the `user/message`
event seq as a decimal string) or `userMessageIndex` (the index among the
session's direct user messages), with an optional `expectedContent` anti-stale
guard.

## How it works

The read model (`deriveRewindMessages`) projects the session event log into the
transcript-like message list the ported algorithm operates on: direct
`user/message` events become `user` entries, `tool/call`/`tool/result` events
pair by call id, and a `turn/end` error reason closes with an `error` entry.
dsh subagent work lives in its own session, so the reference's sidecar
transcript traversal is structurally absent and the transcript is always
complete.

File snapshots come from the `file/history-snapshot` fold
([`@deepseek-ai/dsh-file-history`](../file-history/README.md)). The code
preview merges what the snapshot captured with what the transcript says the
turn's tools did; tools whose file effects the transcript cannot describe
(shell writes, unrecognized tools) downgrade restore coverage to partial via
`unverifiedChangeSources` instead of blocking the undo. The reference's
2000-line tree-sitter bash read-only classifier is replaced by a conservative
self-contained allowlist ([`read-only.ts`](src/read-only.ts)) with the same
contract — a command judged NOT read-only merely downgrades coverage, never
overstates it.

Execute stops the agent (`agent.cancel` + `agent.whenIdle`), flushes the
session, restores files through the plan-based restore (preflight writability,
per-file safety re-verification, rollback on partial failure), then trims the
log at the target turn's `turn/start` seq so the remaining log ends balanced on
a completed turn. **The in-memory Session that owned the log is stale after the
trim**: the client must reload the session — the desktop shell restarts the dsh
service, which replays the trimmed log.

## Configuration

No configuration. The recording side is configured through
[`@deepseek-ai/dsh-file-history`](../file-history/README.md).

## Model Experience

The service is not model-facing: no tools, no prompt sections, no token cost.

## Known Limitations and Deferred Work

- The bash read-only classification is a conservative subset of the
  reference's parser-based check; commands outside the allowlist are treated
  as unverified (safe direction).
- The turn-start snapshot race documented in
  [`@deepseek-ai/dsh-file-history`](../file-history/README.md) applies to
  shell-written files.
- Rewind targets are the direct user prompts only; injected context messages
  are not rewindable.
