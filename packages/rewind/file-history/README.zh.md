# @deepseek-ai/dsh-file-history

[English](README.md) | 中文

面向会话回滚的逐用户消息文件备份：工具修改的每个文件在修改前备份，每个回合开始时的快照记录被跟踪文件的回合前状态。回滚到某条用户消息时恢复这些文件。

行为移植自参考实现（cc-haha `src/utils/fileHistory.ts`），适配事件源会话日志：参考实现的进程内会话状态即会话日志本身（`file/history-snapshot` 事件的折叠），其两个录制调用分别挂接到 `user/message` 会话事件与 `tools/pre-execute` waterfall。

## 功能

注册 `ctx.fileHistory` 服务（Cordis Service，由 bundle 行经 Loader 挂载）。构造函数挂接两个录制钩子：

- 直接用户消息事件（`source.kind === 'user'`）到来时，为该消息排队一个回合开始快照：早期回合跟踪的每个路径与最新备份比较，发生变化则重新备份。快照事件以消息的事件 seq 为键。
- 每次文件修改工具分发前（`write`、`edit`、`multiedit`、`notebookedit`、`apply_patch`），把每个目标文件的修改前内容作为版本 1 备份进当前回合快照（若已记录则跳过）。

两者都向所属 agent 的会话日志追加 `file/history-snapshot` 事件。该事件仅日志用途（对模型不可见、不参与 surface），并注册进持久化事件目录，因此回滚的日志裁剪会连同被移除回合的快照一起裁掉。

## 备份存储

工件存放在 `{dshHome}/file-history/{sessionId}/` 下，名为 `{sha256(path).slice(0,16)}@v{version}`，写入时拒绝符号链接/硬链接、复查目录身份、采用临时文件加原子重命名发布。`backupFileName: null` 表示"该版本中文件不存在"（删除标记）。备份根目录默认为解析后的 Harness 主目录，可通过 `backupRoot` 配置。

## 配置

- `enabled`（默认 `true`）：总开关；`false` 不录制任何内容。
- `backupRoot`（默认 `$DSH_HOME`）：存放 `file-history/{sessionId}/` 目录的数据根。

## 读取模型

折叠是事件日志的纯函数：`foldFileHistorySnapshots(events)` 返回每个用户消息 seq 一个合并快照（每个路径取最后事件，与参考实现的提交顺序一致）；`collectTrackedPaths`/`latestBackupForPath` 暴露路径集合与某路径的最新备份。回滚服务从该折叠读取快照，并通过备份读取 API 恢复文件。

## 已知限制与待办

- 录制是尽力而为：备份失败仅记录日志并跳过，绝不中断工具管线。备份失败的路径无法被回滚恢复。
- 回合开始快照的备份 IO 与模型的首次工具调用存在竞态窗口（与参考实现相同）；极快模型加极慢磁盘时可能为回合内首次编辑的文件记录到修改后内容。pre-execute 钩子的逐编辑备份覆盖了回合实际触碰的每个文件，因此实际暴露仅限于 shell 命令改动的文件。
- 回滚后不移除被移除回合的孤儿备份工件（参考实现同样如此）；只有快照元数据随日志被裁掉。

## 模型体验

该服务对模型不可见：无工具、无提示词段落、无 token 开销。
