# dsh desktop

Windows desktop shell for the DeepSeek Harness Web UI, built with Tauri 2.

The shell embeds a bundled Node.js runtime and a production `@deepseek-ai/dsh`
install. On launch it starts `dsh web` on a free local port and opens the Web UI
in the Tauri window.

Build from the repository root after `pnpm install && pnpm run build`:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
```

The Tauri shell layout is adapted from
[NexBox](https://github.com/MuLiuSaMa/NexBox) (GPL-3.0); only the Tauri shell
layout; the application icons are the DeepSeek logo from `LOGO/DeepSeek256x256.ico`, not NexBox assets.
