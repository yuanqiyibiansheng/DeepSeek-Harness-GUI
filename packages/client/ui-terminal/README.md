# @deepseek-ai/dsh-client-ui-terminal

English | [中文](README.zh.md)

The **integrated terminal shell preference** for the web GUI: a **Terminal** row
in the General settings section that chooses the shell mode the agent uses to
run commands — PowerShell 7, Windows PowerShell, Command Prompt, Git Bash, or
WSL — persisted through the `terminal` settings namespace. The chosen mode is
consumed by the host `dsh-pwsh-local` provider, which spawns commands through
the selected shell.

## Configuration

The plugin binds the `terminal` settings namespace (owned by
`dsh-terminal-host`) through the shared settings scope. The persisted `shell`
(default `pwsh`) selects the executable the agent's command tool spawns; the
General settings dropdown updates it immediately.

## Model Experience

### What the model sees

Nothing: the row is a user-facing setting. No tools are registered and nothing
enters the conversation log.

### Token effect

None.

### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Shell availability is probed at spawn time** — a selected shell that is not
  installed on the machine falls back to `pwsh`; the setting does not probe
  before persisting.
- **The settings row label is Chinese-only** — localized navigation labels for
  the section are not yet wired to the locale registry.
