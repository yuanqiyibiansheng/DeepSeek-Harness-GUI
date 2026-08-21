Status: implemented

English | [中文](2026-08-19-rewind-preset-inheritance-and-context-overflow-classification.zh.md)

## Problem

Two independent regressions surfaced in desktop use on Windows:

1. After executing a session rewind (回退), the forked child session came up with **no model-facing tools at all** — including the shell/terminal command tools (PowerShell / Command Prompt / Git Bash / WSL selection, `bash`/`pwsh` execution). Root cause: `session-rewind`'s `forkFromPrefix` created the child via `ctx.agents.create` with only `cwd`/`parentSession`/`seedLength` metadata and no preset composition, while the gateway's own `session.fork` (api-proxy) resolves the parent's preset from the log and mounts it under the child. With model-facing rows disabled in the host plane and composed per-session by `dsh-agent-presets`, an uncomposed child sees the empty global layer — exactly the "all built-in tools dead until a new session" report. The settings row quoted by the user (`ui-terminal` "集成终端 Shell") is only a preference UI; the actual failure is the missing composition.

2. DeepSeek began returning HTTP 400 `{"message":"Input token exceed the limit","code":"quota_limit_reached"}` mid-conversation. `isContextWindowExceededError` matched none of its wording (no "context length/window", no "too large for model"), so `httpErrorCode` classified it `INVALID_REQUEST` and the compaction-basic `agent/request-error` recovery path never fired — the turn died with no automatic compaction, and only a rewind or new session recovered. The provider's `code` value is a misleading `quota_limit_reached`; the message is a context-overflow statement.

## Decision

- `session-rewind` now inherits the parent's composition on rewind fork: `composeAgentFromSource` resolves the preset from the source session log via `resolveSessionPreset` (newest `agent-preset/selected` wins, matching every resume/fork path) and passes it both as `meta.agentPreset` and as the child's `setup` (mounting the preset under the child's scope when a roster exists; identity otherwise). `parentSession` now preserves the parent's own lineage instead of overwriting it with the grandchild relation. Added `@deepseek-ai/dsh-agent-presets` as a peerDependency plus a tsconfig project reference.
- `isContextWindowExceededError` (dsh-llm) now recognizes the full wording `input tokens? exceed` (the unambiguous phrase) and, as a strictly-scoped fallback, a string naming the token bound plus a capacity label (`/8k`, `k/512`) alongside `exceed`. `httpErrorCode(400, …)` then classifies the DeepSeek detail as `CONTEXT_WINDOW_EXCEEDED`, which routes the request into compaction-basic's automatic context-overflow recovery (compact + retry) instead of a dead-end `INVALID_REQUEST`.

## Alternatives considered

**Rewind keeps its fork minimal and the client re-selects the preset after opening.** Rejected: re-selection happens after the session exists, would replay under a different composition than the seeded history, and strands tool calls the log already carries — the same hazard the gateway `fork` comment names.

**Classify solely on the provider `code` (`quota_limit_reached` → context overflow).** Rejected: that code is the provider's own misnomer and other quota payloads legitimately mean exhausted balance; the message wording is the reliable signal.

**Broaden the "too large" pattern to any `exceed`/`limit` phrasing.** Rejected: it would swallow unrelated input-validation 400s (e.g. "temperature exceeds maximum allowed value"); the token-named fallback stays narrow.

## Consequences

- A rewound session rebuilds the same preset (and therefore the same tools, prompt sections, and terminal capabilities) it ran under before the rollback. No client change needed.
- The DeepSeek 400 mid-conversation now triggers automatic compaction and a retry instead of terminating the turn; a genuine exhausted-quota 400 with quota wording is unaffected.
- `session-rewind` gains one peer dependency on `@deepseek-ai/dsh-agent-presets` (already present in the desktop/web bundles). Unit tests extended for both classifier branches and the fork contract; all `llm`, `llm-deepseek`, `session-rewind`, and `agent-presets` suites pass.
