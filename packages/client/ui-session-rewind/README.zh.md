# @deepseek-ai/dsh-client-ui-session-rewind

[English](README.md) | 中文

会话回滚前端插件（浏览器端）：每个完成的回合都会在对话尾部出现
「N 个文件已更改」检查点卡片（与参考桌面端一致），列出该回合被跟踪的文件和
+N/-M 统计，并提供撤销入口——把会话（检查点允许时连同被跟踪的文件）回滚到
该回合之前。入口以 `rewind` 注册进 `conversation.chat.turnTail` 链，所有调用
都走 `ctx.remote.sessionRewind`，即 `dsh-session-rewind` 宿主服务的 Typert
Remote 面。

每个会话一个 `RewindController`，`sessionRewind/listTurnCheckpoints` 只读一次
并喂给所有回合卡片；某回合可回滚，当且仅当该列表中存在它的检查点。卡片与
参考布局一致：当前回合显示「撤销当前轮次」，历史回合显示「回滚到这一轮之前」，
两种卡片展示同样的提示——检查点不完整时只提供「只回滚对话」，部分覆盖时点名
未记录的改动来源。文件行通过聊天视图自带的打开器（与工具行同一个）打开。

确认后按所选模式调用 `sessionRewind/execute`；成功后桌面壳在同一端口重启
dsh 服务，客户端事件流重连并重基线会话（不刷新页面）。输入框保持空白，
只会发送你接下来输入的内容。

`/client` 导出为插件主体（`apply`/`inject`）、`RewindCard` 组件、
`RewindController` 及注入面类型。
