# @deepseek-ai/dsh-file-history

English | [中文](README.zh.md)

Per-user-message file backups for conversation rewind: every file a turn's
tools edit is backed up before the edit, and each turn-start snapshot records
the tracked files' pre-turn state. Rewinding to a user message restores those
files.

Ported in behavior from the reference implementation (cc-haha
`src/utils/fileHistory.ts`), adapted to the event-sourced session log: the
reference's in-memory per-session state is the session log itself (the fold of
`file/history-snapshot` events), and its two recording calls are wired to the
`user/message` session event and the `tools/pre-execute` waterfall.

## What it does

Registers the `ctx.fileHistory` service (a Cordis Service; the Loader mounts it
from the bundle row). Its constructor wires two recording hooks:

- On a direct `user/message` event (`source.kind === 'user'`), a turn-start
  snapshot is queued for that message: every path tracked in earlier turns is
  compared with its latest backup and re-backed up when changed. The snapshot
  event is keyed to the message's event seq.
- Before every file-mutating tool dispatch (`write`, `edit`, `multiedit`,
  `notebookedit`, `apply_patch`), each target file's pre-edit content is backed
  up as version 1 into the current turn's snapshot, unless already recorded
  there.

Both append a `file/history-snapshot` event to the owning agent's session log.
The event is log-only (never model-visible, never surface-eligible) and
registers in the persisted-event catalog, so a rewind's log trim removes the
snapshots of the removed turns together with their conversation events.

## Backup storage

Artifacts live under `{dshHome}/file-history/{sessionId}/` as
`{sha256(path).slice(0,16)}@v{version}` files, written with symlink/hard-link
refusal, directory-identity re-verification, and atomic temp-then-rename
publication. `backupFileName: null` records "file absent in this version" (a
deletion marker). The backup root defaults to the resolved Harness home and is
configurable via `backupRoot`.

## Configuration

- `enabled` (default `true`): master switch; `false` records nothing.
- `backupRoot` (default `$DSH_HOME`): the data root holding the
  `file-history/{sessionId}/` directories.

## Read model

The fold is a pure function of the event log:
`foldFileHistorySnapshots(events)` returns one merged snapshot per user-message
seq (per path, the LAST event wins, mirroring the reference's commit order),
and `collectTrackedPaths`/`latestBackupForPath` expose the path set and the
newest backup of a path. The rewind service reads snapshots from this fold and
restores files through the backup read API.

## Known Limitations and Deferred Work

- Recording is best-effort: a failed backup is logged and skipped, never
  allowed to break the tool pipeline. A path whose backup failed is simply not
  restorable by rewind.
- The turn-start snapshot's backup IO races with the model's first tool call
  in the same window as the reference implementation; a very fast model on a
  very slow disk could record post-edit content for a file first edited in the
  turn. The pre-execute hook's per-edit backup covers every file the turn's
  tools actually touch, so the practical exposure is limited to files changed
  by shell commands.
- Orphaned backup artifacts of removed turns are not garbage-collected after a
  rewind (the reference leaves them too); only the snapshot metadata is
  removed with the log.

## Model Experience

The service is not model-facing: no tools, no prompt sections, no token cost.
