# @deepseek-ai/dsh-terminal-host

English | [中文](README.zh.md)

The **integrated terminal panel backend** for the desktop Web UI: spawns one
selectable shell — PowerShell 7 (`pwsh`), Windows PowerShell, Command Prompt,
Git Bash, or WSL — through the subprocess PTY primitive, and serves the live
session over plain HTTP: terminal output streams as SSE, input and resize go
through POST. Sessions are keyed by a random id, live only in memory, and are
terminated when their SSE stream closes (the panel closed) or the plugin
disposes.

## Configuration

| key | default | meaning |
|---|---|---|
| `defaultShell` | `pwsh` | The shell kind spawned when a spawn request omits one. |

The `terminal` settings namespace carries the same `shell` field as a
`defaultShell` override; the panel reads it as its default selection.

## Shell resolution

`resolveShell(kind)` probes the ambient PATH and well-known install locations:

- `pwsh` → `pwsh.exe -NoLogo`, falling back to `powershell.exe -NoLogo`
- `powershell` → `powershell.exe -NoLogo`
- `cmd` → `cmd.exe`
- `git-bash` → `bash.exe --login -i` from PATH or the Git for Windows install
- `wsl` → `wsl.exe`

A kind whose program cannot be resolved fails the spawn request loud.

## HTTP surface

| route | method | body | result |
|---|---|---|---|
| `/terminal/spawn` | POST | `{ cols, rows, shell?, cwd? }` | `{ ok, id, shell }` |
| `/terminal/:id/stream` | GET | — | SSE events: `output` (`{type,data}`) then `exit` (`{type,code,signal}`) |
| `/terminal/:id/write` | POST | `{ data }` | `{ ok }` |
| `/terminal/:id/resize` | POST | `{ cols, rows }` | `{ ok }` |
| `/terminal/:id/kill` | POST | — | `{ ok }` (terminates the PTY session) |

## Model Experience

### What the model sees

Nothing: the panel is a user-facing terminal. The backend registers no model
tools and never enters the conversation log.

### Token effect

None.

### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Resize requires the subprocess terminal seam** — `SubprocessTerminalHandle.resize`
  was added for the panel; the E2B provider rejects it explicitly, so the panel
  works with the local provider only.
- **Shell readiness is not detected** — the panel streams raw PTY output and
  forwards input immediately; there is no prompt-marker readiness handshake
  (that stays with `dsh-terminal-bash` for model-facing use).
- **One terminal per panel session** — no session reuse or multiplexing.
