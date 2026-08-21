# @deepseek-ai/dsh-client-ui-session-rewind

English | [中文](README.zh.md)

Session rewind plugin, browser half: every completed turn ends with the
"N 个文件已更改" checkpoint card (the reference desktop flow), listing the
turn's tracked files with +N/-M statistics and an undo action that rolls the
conversation — and the tracked files when the checkpoint allows — back to
before that turn. The entry registers as `rewind` in the
`conversation.chat.turnTail` chain, and every call goes through
`ctx.remote.sessionRewind`, the Typert Remote face of the `dsh-session-rewind`
host service.

One `RewindController` per Session loads `sessionRewind/listTurnCheckpoints`
once and seeds every turn card, so a rewindable turn is exactly one whose
checkpoint exists in that list. The card matches the reference layout: the
current turn offers "撤销当前轮次", historical turns "回滚到这一轮之前", and
both show the same cautions — an incomplete checkpoint only offers "只回滚对话",
a partial checkpoint names the tools whose changes were not recorded. File
rows open through the chat view's own opener (the same one tool rows use).

Confirming calls `sessionRewind/execute` with the chosen mode; after success
the desktop shell restarts the dsh service on the same port and the client's
event stream reconnects, re-baselining the conversation in place — no page
refresh. The composer stays empty: only what the user types next is sent.

The `/client` exports are the plugin body (`apply`/`inject`), the `RewindCard`
component, the `RewindController`, and the injected face types.
