# Agent Note: Session rewind — 1:1 port of the reference rewind service over the event-sourced session log

Status: implemented

## Problem

The fork shipped a rollback feature implemented in the Rust desktop shell: a local HTTP diff server (`apps/desktop/src-tauri/src/diff_server.rs`, port 3199) with its own SQLite history plus a per-message undo button in `packages/client/ui-sidebar-toggle`. The user asked to remove it and port the reference rewind implementation (cc-haha `src/server/services/sessionRewindService.ts` + `src/utils/fileHistory.ts`) 1:1 into the dsh backend.

## Decision

Port the reference's semantics into the event-sourced architecture instead of the reference's storage: snapshots become `file/history-snapshot` session-log events, and the execute flow trims the durable log instead of rewriting a transcript file.

### Recording (`packages/rewind/file-history`)

The reference keeps per-session snapshot state in memory and writes `file-history-snapshot` entries into its JSONL transcript; the port folds the same state from the session log. Two hooks replace the reference's call sites: the turn-start snapshot fires on direct `user/message` events (`source.kind === 'user'`), and the first-edit backup fires in the awaited `tools/pre-execute` waterfall before file-mutating tools (`write`/`edit`/`multiedit`/`notebookedit`/`apply_patch`). Backup artifacts keep the reference's storage layout under `{dshHome}/file-history/{sessionId}/` with the same symlink/hard-link refusal and atomic publication. The event is log-only, never surface-eligible, and registers in the persisted-event catalog (`gen-persistence-catalog`), so a rewind's log trim removes removed turns' snapshots together with their conversation events.

Awaited `trackEdit` in `tools/pre-execute` is strictly stronger than the reference's fire-and-forget recording: the backup completes before the tool edits, closing most of the reference's snapshot-IO race.

### Rewind (`packages/rewind/session-rewind`)

`deriveRewindMessages` projects the event log into the transcript-like message list the ported algorithm operates on (direct `user/message` → `user`, `tool/call`/`tool/result` paired by call id, `turn/end` error reason → `error`). dsh subagent work lives in its own session, so the reference's sidecar-transcript traversal is structurally absent and the transcript is always complete — the reference's `transcriptIntact` gate is dropped. The four operations (`preview`/`execute`/`listTurnCheckpoints`/`getTurnCheckpointDiff`) are Typert Remotes on `ctx.sessionRewind`, auto-exposed by the gateway.

Execute stops and drains the owning agent (`agent.cancel` + `agent.whenIdle`), flushes, restores files through the plan-based restore (preflight writability, per-file safety re-verification, rollback on partial failure), then trims at the target turn's `turn/start` seq so the remaining log ends balanced on a completed turn. Trimming at the `turn/start` instead of the user message matters: a cut at the message would leave an open turn that `load()` closes with synthetic closers, polluting the rewound state.

### Durable trim (`sessionPersistence.trim`)

The persistence seam gains `trim(id, cutoffSeq)` (keep `seq < cutoffSeq`) — a coordinator-serialized operation that drains any live write-behind for the id, delegates the physical rewrite to `trimStored` (JSONL: decode → filter → re-encode → atomic replace; SQLite: transactional DELETE + revision bump), and invalidates cached state so the next read re-reads the trimmed log. The in-memory Session that owned the log is stale after trim: continued appends adopt the trimmed cursor and reject on the seq-contiguity check rather than corrupting storage. The desktop flow restarts the dsh service after execute (the existing `restart_service` path), which replays the trimmed log.

### Read-only bash classification

The reference's 2000-line tree-sitter permission stack (`readOnlyValidation.ts` plus ~10 transitive files) is replaced by a conservative self-contained allowlist (`read-only.ts`) with the same contract: a command judged read-only provably cannot have changed files; a command judged NOT read-only merely downgrades restore coverage to partial (safe direction). Only clearly non-mutating commands qualify (no `>` redirects; `git` only with read-only subcommands).

## Consequences

- Rollback no longer depends on the Rust diff server, its SQLite history, or the removed `ui-sidebar-toggle` package; the backend exposes the capability over Typert RPC.
- Rewound sessions replay correctly: trimming at the turn boundary keeps the log balanced, and the trimmed prefix contains no snapshot events of removed turns.
- Recording adds one session event per turn start plus one per first edit of each path; backup IO runs outside the hot path except for the awaited pre-execute backup (bounded by file size).

## Known limitations

- The turn-start snapshot IO still races the model's first tool call for files changed only by shell commands (inherited from the reference; the pre-execute hook covers every file the tools touch).
- Orphaned backup artifacts of removed turns are not garbage-collected (the reference leaves them too).
- No UI consumer yet: the Typert Remotes are wired into the client assembly (`api/remotes`), but a per-message rewind button is follow-up work.
