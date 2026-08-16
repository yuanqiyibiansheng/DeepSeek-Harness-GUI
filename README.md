# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Desktop build

An optional Tauri 2 shell packages the Web UI as a Windows desktop app:

```sh
build-desktop.bat
```

The script checks Node.js 22.19+ or 24+, installs dependencies, builds the workspace, prepares a self-contained `dsh web` runtime under `apps/desktop/bundle`, and runs `tauri build`. The NSIS installer is written to `apps/desktop/src-tauri/target/release/bundle/nsis/`.

The shell lives in `apps/desktop` and adapts the Tauri shell layout from [NexBox](https://github.com/MuLiuSaMa/NexBox) (GPL-3.0); application icons use the DeepSeek logo from `LOGO/DeepSeek256x256.ico`.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


## Recent changes

### Rollback confirmation without preview

- Goal: the preview step loaded and diffed every potentially restored file, which stayed slow on large sessions; rollback should confirm and execute immediately.
- Files: packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.tsx (removed the `/code-review/rollback/preview` request, checkpoint picker, file list, diff surface, and explanatory sentence; the dialog now confirms the clicked message directly, shows a working state, and restarts the desktop service in place), packages/client/ui-sidebar-toggle/src/client/locales.ts (`review.rollbackWorking` copy), packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx (global rollback draft setter), packages/client/ui-sidebar-toggle/tests/ConversationRollbackAction.client.spec.tsx (no preview request; confirm calls `scope=both`), apps/desktop/src-tauri/src/diff_server.rs (two covering indexes and `snapshot_restore_targets` so the rollback itself only touches files that can differ), README.md, README.zh.md.
- Changes: clicking the undo button opens a simple confirmation dialog with cancel/rollback only; there is no checkpoint picker, no file diff list, and no "并把原消息放回输入框" sentence. While the rollback request runs, the dialog shows "正在回滚...". Confirm calls `/code-review/rollback` with `scope=both` for the clicked message, restores code and conversation, puts the original message back into the composer, then restarts the dsh service in place so the WebView reconnects and replays the session without a full page reload. Browser mode falls back to reload.
- Impact: rollback is fast and predictable; the dialog no longer hangs on "正在读取预览...." and no longer offers unrelated checkpoint choices.
- Notes: the preview endpoint remains available for compatibility but is no longer used by the client.

### Rollback unified: code + conversation with original message restored

- Goal: converge the checkpoint rollback to the dsh-TUI rewind behavior: selecting a saved user-message checkpoint restores code and conversation together, then puts the original message back into the input for editing and resending.
- Files: packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.tsx (removed rollback scope radios; always requests `scope=both`; reads the selected user message from the conversation snapshot and stores it as a pending draft before reload), packages/client/ui-sidebar-toggle/src/client/locales.ts (`review.rollbackBoth` copy), packages/client/ui-sidebar-toggle/tests/ConversationRollbackAction.client.spec.tsx (rollback stores the original draft and calls `scope=both`), packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx (restores the pending draft after reload), README.md, README.zh.md.
- Changes: the rollback dialog no longer shows a checkpoint picker, a file preview, or the original-message explanation. Rolling back always restores the code snapshot and the conversation log up to just before the clicked user message, then refreshes the session with that message back in the composer. The pending draft is carried via `sessionStorage` (`dsh-rollback-draft:<sessionId>`), and the `useSession` read was moved to render time so the hook is not invoked from the async event handler.
- Impact: rollback is precise per turn and matches dsh-TUI rewind semantics: code and conversation move together, and the original prompt can be edited and resent.
- Notes: snapshots remain local and git-free; the desktop exe and installer need to be rebuilt from source.

### DeepSeek balance widget and task-completion notifications

- Goal: add an inline balance/cost widget to the conversation stats bar and show a Windows system notification when an agent turn completes, following the Deepseek-Harness-EAC reference implementation.
- Files: packages/client/ui-desktop-tools (new client plugin: balance dock + turn-end notification listener), packages/client/runtime/src/client/index.ts (new `session/turn-end` event), packages/bundle/web-app (package dependency and loader row), apps/desktop/src-tauri/src/lib.rs (`balance_query` / `notify_task_done` / `open_recharge` commands, notification plugin), apps/desktop/src-tauri/build.rs and apps/desktop/src-tauri/capabilities/default.json (command permissions), apps/desktop/src-tauri/Cargo.toml and apps/desktop/src-tauri/Cargo.lock (`tauri-plugin-notification`, `ureq`), tsconfig.client.json, pnpm-lock.yaml, README.md, README.zh.md.
- Changes: the conversation stats bar now shows 「本轮 ¥X · 余额 ¥Y」, refreshes every 15 minutes, and clicking opens the DeepSeek top-up page in the default browser. Balance comes from `https://api.deepseek.com/user/balance` using `DEEPSEEK_API_KEY` or `$DSH_HOME/.credentials.yaml`; the price tier follows the active model in `settings.yaml`. When a live `turn/end` event arrives, the shell raises a Windows toast (`DeepSeek Harness 任务完成`), rate-limited to once per 30 seconds per session; clicking the installed app's toast returns to the window.
- Impact: users can monitor per-turn cost and account balance without opening the website, and get completion notifications while the client is in the background.
- Notes: the balance widget requires a configured DeepSeek API key; without a key it shows the cost estimate only. The desktop exe and custom installer were rebuilt from source.

### Revert OpenCode agent engine integration

- Goal: remove the experimental Harness/OpenCode engine switch and the bundled OpenCode web runtime; the desktop client stays on the in-app DeepSeek Harness conversation UI.
- Files: packages/client/ui-agent-engine (removed), apps/desktop/src-tauri/src/lib.rs, apps/desktop/src-tauri/build.rs, apps/desktop/src-tauri/capabilities/default.json, apps/desktop/scripts/prepare-bundle.mjs, apps/desktop-installer/scripts/prepare-payload.mjs, packages/bundle/web-app, tsconfig.client.json, pnpm-lock.yaml, README.md, README.zh.md.
- Changes: removed the Agent engine settings row, the OpenCode child-process lifecycle, its command permissions, the OpenCode runtime bundling, and the OpenCode installer payload. Build robustness fixes remain: the desktop bundle keeps a usable dsh entry when pnpm deploys the CLI package under node_modules, and bundled-node copy is skipped when it is already the current runtime.
- Impact: the installer returns to about 233 MB payload without OpenCode; the desktop client starts with the normal DeepSeek Harness web UI.
- Notes: the desktop exe and custom installer were rebuilt from source, and a smoke test started the bundled web backend on a local port and returned HTTP 200.

### Project memory (Memorix) integration

- Goal: give the desktop client a project-memory switch in General settings (enabled by default) and bundle Memorix as the local memory layer, so a new conversation can read project history, progress, and decisions instead of starting blank.
- Files: packages/client/ui-project-memory (new settings-toggle plugin), packages/host/project-memory (new host plugin managing the Memorix MCP row), packages/bundle/web-app (dependencies and loader rows), packages/host/apiproxy/src/api-proxy.ts (settings whitelist), apps/desktop/scripts/prepare-bundle.mjs and apps/desktop-installer/scripts/prepare-payload.mjs (bundle the Memorix runtime), tsconfig.client.json, tsconfig.host.json, README.md, README.zh.md.
- Changes: when the switch is on, the host writes the `memory-memorix` row for `@deepseek-ai/dsh-mcp-client` into `$DSH_HOME/cordis.patch.yml` with the bundled node and Memorix CLI; when it is off, the row is removed. Memorix serves over stdio and its tools appear as `mcp__memorix__*`. The change takes effect after restarting the client.
- Automatic capture: with the switch on, the host also listens to the session event firehose. Every completed turn is written into project memory automatically (`会话 <id> 第 N 回合` with the user prompt, assistant reply, and tool names), and a recent-memory summary is injected into the system prompt at each new turn. No manual MCP tool call is required.
- Impact: General settings shows a Project memory toggle; the installer now ships the Memorix 1.5.0 runtime (the payload grows to about 233 MB).
- Notes: Memorix binds the project through MCP workspace roots or `memorix_session_start`; the `apps/desktop/memorix-runtime` directory is git-ignored and is produced by the desktop build workflow before packaging.

### Restore Agent preset descriptions in settings

- Goal: the Agent preset management page stopped showing each preset's description and id because the dialog edit removed the card body render; the CSS and tests for the description were still present.
- Files: packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx (restored `CardDescription` and the card id row), README.md, README.zh.md.
- Changes: every preset card now renders its localized/custom description (falling back to "No description."), a hover tooltip with the full text when the card clamps it, and the preset id; the newer Creator-mode entry and other dialog edits are kept. The desktop bundle and custom installer were rebuilt from source.
- Impact: Settings shows the full preset descriptions again; the new-session chip still shows names only.
- Notes: reinstall the rebuilt installer to see the restored descriptions.

### WebView boot-manifest cache fix for rebuilt client bundles

- Goal: after the Agent preset dialog and client bundles were rebuilt, the client showed `Failed to load plugins` because the WebView served a cached `index.html` while the bundles had changed; the stale boot manifest missed `@deepseek-ai/dsh-client-runtime`, so `ui-theme` could not resolve `dsh-client-runtime/client`.
- Files: packages/host/frontend-static/src/index.ts (index responses now send `cache-control: no-store`), packages/host/frontend-static/tests/frontend-static.spec.ts, README.md, README.zh.md.
- Changes: every index response now forbids caching so the dynamically injected `__DSH_BOOT__` manifest is always fresh; the desktop bundle and custom installer were rebuilt from source; the user profile's invalid `plaindeck` marketplace entry was removed again.
- Impact: rebuilding client bundles no longer leaves the WebView on a stale boot manifest, preventing `client-modules` module-table misses after upgrades or hot rebuilds.
- Notes: if an already-open client still shows the error, close it and reopen it once so the WebView reloads the uncached index.

### Agent-preset picker shows names only; installer rebuilt

- Goal: the new-session agent-preset chip's menu listed every preset with its description sentence under the name, making the switch list long and wordy; the picker should name the modes (Standard mode, Code mode, Minimal mode, Creator mode) and nothing else.
- Files: packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx (menu rows now render the name alone; the description line is gone), packages/client/ui-agent-preset/src/client/AgentPresetSeat.module.css (removed the now-unused `.itemDesc` rule), packages/client/ui-agent-preset/tests/components.client.spec.tsx (seat menu test now asserts names only and that the description and "no description" fallback are absent), apps/web/tests/agent-preset-selection.e2e.ts (menu scenario now asserts the four names and that the description sentence is absent), apps/web/tests/snapshots/agent-preset-selection/menu.expected.md (golden updated to name-only rows), apps/desktop/bundle, apps/desktop-installer/src-tauri/target/release/dsh-desktop-installer.exe, README.md, README.zh.md.
- Changes: the new-session preset menu shows only the preset name per row. The description copy still lives in the settings Agent-preset section and on the session header tooltip; nothing else moved.
- Impact: the preset switch menu is a short four-item list; settings-page and header surfaces are unchanged.
- Notes: the desktop bundle was regenerated with the rebuilt `dsh-client-ui-agent-preset` artifacts and the installer exe was rebuilt (`dsh-desktop-installer build:setup`).

### User patch layer tolerance (marketplace plugins cannot block launch)

- Goal: installing public marketplace plugins could write a non-Cordis package or a malformed `cordis.patch.yml` into the web profile, making the client stick on "Starting DeepSeek Harness..." because profile preparation or boot rejected the whole tree.
- Files: packages/boot/app-boot/src/profile.ts (loadProfile now warns and skips an unreadable `cordis.patch.yml` instead of failing), apps/cli/src/profile-boot.ts (home/profile user patch reads fall back to an empty layer; boot retries without the user layer when the first boot fails), packages/boot/app-boot/tests/profile.spec.ts (broken user-layer and bundle-less bundle coverage), README.md, README.zh.md.
- Changes: the user patch layer is now best-effort. A malformed, comments-only, or non-array file is skipped with a warning; if the composed user layer still fails during boot, the launcher retries with bundle and overlay layers only. The current web profile was cleaned by removing the invalid `pm-plaindeck` insert and the empty `@microi.net/cli` bundle entry.
- Impact: a broken marketplace-installed plugin no longer blocks the desktop app from opening; official bundle-layer errors still fail loudly.
- Notes: the skipped layer prints a warning to stderr; remove or repair the offending plugin in Settings before restarting to restore it.

### Marketplace install feedback and one-click service restart

- Goal: after clicking install, the result card reverted to the install button (only the installed list below refreshed), so success looked like failure; and newly installed plugins only appear in Settings → Plugins after the service restarts, which had no in-app path.
- Files: packages/client/ui-plugin-marketplace/src/client/MarketplaceTab.tsx (patch search-result cards with the install/uninstall outcome immediately, so the button flips to installed/uninstalled truthfully; success notice gains an "立即重启" button), packages/client/ui-plugin-marketplace/src/client/marketplace.module.css (restart button), apps/desktop/src-tauri/src/lib.rs (restart_service command: kill the backend child, spawn a fresh backend, reload main+pet windows; backend startup extracted into spawn_backend), apps/desktop/src-tauri/build.rs (app manifest commands + restart_service), apps/desktop/src-tauri/capabilities/default.json (allow-restart-service), README.md, README.zh.md.
- Changes: install/uninstall now update the result cards in place; after a successful install the notice offers one-click restart, which reloads the dsh service so the new plugin activates and appears in the plugin list.
- Impact: the marketplace shows truthful button states during/after operations, and activating an installed plugin is one click away.
- Notes: restarting interrupts the running session (history is kept); the button only appears in the desktop shell.

### Source rebuild of desktop bundle and installer

- Goal: prevent the public-plugin startup failure from recurring and ship a fresh installer built from the latest source; also remove stale TypeScript compiler artifacts that had been emitted into `packages/*/*/src`.
- Files: packages/boot/app-boot/src/profile.ts, packages/client/ui-plugin-marketplace/src/index.ts (already carry the broken-bundle tolerance and safer marketplace install flags), apps/desktop/bundle, apps/desktop/src-tauri/target/release/dsh-desktop.exe, apps/desktop-installer/src-tauri/target/release/dsh-desktop-installer.exe, README.md, README.zh.md.
- Changes: the desktop shell and installer were rebuilt from source with the bundled Node 24 and pnpm 11.19 (`pnpm run build`, `dsh-desktop build:no-bundle`, `dsh-desktop-installer build:setup`). The installer payload was regenerated, and 306 stale `.js` / `.d.ts` / `.map` files under package `src` trees were removed so `src` stays pure TypeScript.
- Impact: `dsh-desktop-installer.exe` now contains the marketplace/startup tolerance fix; source trees no longer confuse tsx by shadowing `.ts` files with compiled artifacts.
- Notes: if an existing install still carries a broken web profile, clear `%APPDATA%\ai.deepseek.harness.desktop\dsh\profiles\web` before reinstalling; marketplace installs use `--legacy-peer-deps --install-strategy=hoisted`.

### Public plugin tolerance and startup repair

- Goal: after installing third-party marketplace plugins, the desktop app stuck on "Starting DeepSeek Harness..." and then refused connections to `127.0.0.1`; a broken external bundle in the web profile made the backend exit before the HTTP server bound.
- Files: packages/boot/app-boot/src/profile.ts (loadProfile now logs a warning and skips unresolved profile bundles instead of aborting boot), packages/client/ui-plugin-marketplace/src/index.ts (marketplace installs now use `--legacy-peer-deps --install-strategy=hoisted`), README.md, README.zh.md.
- Changes: the local web profile's broken `@deepseek-ai/dsh-mcp-client` and `@deepseek-ai/dsh-web-search-deepseek` dependencies (the latter required the missing `@deepseek-ai/dsh-environment`) were removed; the desktop bundle and the custom installer were rebuilt with the tolerance fix.
- Impact: one broken plugin bundle no longer blocks startup; the failing bundle is skipped with a warning and the client can reach its local Web UI again. The existing desktop pet, vision enhancement, and terminal features are unchanged.
- Notes: if an old profile still carries broken plugin state, clear `%APPDATA%\ai.deepseek.harness.desktop\dsh\profiles\web` before reinstalling; third-party plugins should still be installed in versions compatible with this client.

### Marketplace auto-loads the catalog on tab open

- Goal: the marketplace tab only showed results after pressing search, so first-time visitors saw just the installed list and thought the market was nearly empty.
- Files: packages/client/ui-plugin-marketplace/src/client/MarketplaceTab.tsx (auto-run the default catalog search — empty query → `keywords:dsh-plugin` — on first mount; empty-state copy now also covers a no-result default search), README.md, README.zh.md.
- Changes: opening Settings → Plugins → Marketplace immediately fetches and renders up to 250 dsh plugins from the npm registry; the search box still filters on demand.
- Impact: the tab is never empty; ~700 dsh-plugin packages are discoverable at once.
- Notes: searching still requires network access to the npm registry.

### Marketplace discovery scale-up: npm registry search + bundled npm CLI

- Goal: the marketplace tab only returned the npm CLI's default 25 search hits and could not install at all on machines without a Node/npm installation, so it looked empty compared with the reference plugin center. Discovery now uses the npm registry search API (250-hit page — the same discovery the studio plugin center uses), and the desktop bundle ships a full npm CLI beside the bundled node so install/uninstall work offline of a system Node.
- Files: packages/client/ui-plugin-marketplace/src/index.ts (search via https://registry.npmjs.org/-/v1/search with 250/page instead of the npm CLI; install/uninstall still drive the bundled npm), apps/desktop/scripts/prepare-bundle.mjs (bundleNpm: `npm install --prefix bundle/npm npm@10` during bundle prep), apps/desktop-installer/scripts/prepare-payload.mjs (copy bundle/npm into the installer payload), apps/desktop/src-tauri/tauri.conf.json (bundle/npm resource), README.md, README.zh.md.
- Changes: the npm public registry reports ~700 packages tagged dsh-plugin; the marketplace now lists up to 250 per search. The bundled npm (10.x, ~11MB) is found by the host half at `<bundle>/npm/node_modules/npm` and executed with the bundled node.
- Impact: the Settings → Plugins "Marketplace" tab shows a rich dsh-plugin catalog and can install/uninstall on the desktop app without any system Node.
- Notes: search still requires network access to the npm registry; install writes into the web profile and activates after a service restart.

### Boot hardening: UTF-8 BOM tolerance for JSON manifest reads

- Goal: the desktop client once hung at startup because the web profile's package.json carried a UTF-8 BOM (Windows editors write one) and referenced removed external plugins; JSON.parse rejects the BOM and the profile boot failed. The runtime state was repaired, and the code now tolerates BOMs so an editor-written manifest cannot stall the boot again.
- Files: packages/boot/app-boot/src/profile.ts (new readJsonFile helper stripping a leading BOM; used by readProfileManifest, healProfilesModuleFallback, and profile-bundle reads), packages/client/modules/src/index.ts (package.json read), packages/client/ui-plugin-marketplace/src/index.ts (profile manifest read), packages/hooks/hooks-claude-code/src/index.ts + packages/hooks/hooks-codex/src/index.ts (hook config reads), packages/boot/app-boot/tests/profile.spec.ts (BOM tolerance test), README.md, README.zh.md.
- Changes: every JSON manifest/config read now strips a UTF-8 BOM before parsing, so a BOM-bearing file parses identically to a clean one.
- Impact: profiles, bundles, and hook configs written by Windows tools with a BOM load normally; startup no longer depends on the file's byte prefix.
- Notes: the user's web profile no longer references @linxin666 plugins (dependencies and node_modules removed); the installer was rebuilt with the fix.

### Vision enhancement (Bailian bridge) ported from deepseek-harness-studio; old image-understanding plugins removed

- Goal: (1) port the studio project's vision enhancement into this project — a Bailian (DashScope) Qwen3.8 vision bridge that turns image blocks into model-visible observations for text-only agents, plus a `vision_analyze` tool, a General-settings row and a composer shortcut; (2) remove the previous image-understanding paths: the `@linxin666/dsh-tool-describe-image` tool and the `@linxin666/dsh-client-ui-web-ui-settings` webui settings card from the user's web profile.
- Files: packages/host/apiproxy/src/vision-enhancement.ts (new — installVisionEnhancement: vision_analyze tool, llm/stream image→observation bridge, vision-enhancement settings namespace, Bailian credential ref), packages/host/apiproxy/src/api/vision.ts + api/vision.schema.ts (new — vision.status/test/enable contract), packages/host/apiproxy/src/api/{index.ts, rpc-map.ts} (vision domain), packages/host/apiproxy/src/index.ts (installVisionEnhancement + api.vision), packages/host/apiproxy/src/api-proxy.ts (vision handlers, WEB_SETTINGS_NAMESPACES + vision-enhancement, selectModel/prompt image-admission exemptions while enabled), packages/host/apiproxy/src/fetch/{client.ts, handler.ts} (vision wire schemas + routes), packages/host/apiproxy/tsconfig.json (fs/scope/system-prompt references), packages/client/ui-vision-enhancement (new — VisionEnhancementRow/Dialog/Shortcut/controller/css + apply registering settings.general.item + conversation.input.left), apps/web/public/dsh-desktop/default-background.webp (new — dialog verification image), packages/client/ui-plugin-marketplace (new — settings plugin marketplace tab, npm-driven host half, ported from EAC), packages/bundle/web-app (ui-vision-enhancement + ui-plugin-marketplace rows), tsconfig.client.json, README.md, README.zh.md.
- Changes:
  - While the vision-enhancement switch is on, the host rewrites image blocks in outgoing messages into `<vision_observation>` text from Bailian (`qwen3.8-max`) and logs them as durable `vision/observation` session events; the model image-admission checks are bypassed. The `vision_analyze` tool reads workspace images. The settings row and composer shortcut share one controller (status/enable/disable) and a guided dialog that verifies a real image with the API key before enabling.
  - The user's web profile no longer depends on `@linxin666/dsh-tool-describe-image` and `@linxin666/dsh-client-ui-web-ui-settings` (dependencies + node_modules removed).
  - The marketplace tab (search/install/uninstall dsh plugins from npm into the web profile) is registered under Settings → Plugins; its host half needs a bundled npm CLI in the desktop bundle (pending packaging).
- Impact: text-only DeepSeek agents can read screenshots, photos, charts, and image text via Bailian; enable it in Settings → General → 视觉能力增强 or the composer shortcut (needs a DASHSCOPE_API_KEY).
- Notes: the vision bridge only activates after a successful image verification; API keys are stored in the local credential store.

### Pet exits with the client (main window close)

- Goal: closing the client left the pet window running on the desktop, because the app stayed alive while any window (the pet) remained open.
- Files: apps/desktop/src-tauri/src/lib.rs (close the pet window when the main window receives CloseRequested).
- Changes: the main window's CloseRequested handler now closes the pet window too, so the app exits with the client.
- Impact: closing the client closes the desktop pet; the pet's last screen position is still persisted on the way out.
- Notes: hiding just the pet (without quitting) stays on the settings switch.

### Pet drag fix (deep drag region)

- Goal: the pet window showed and the switch worked, but the pet could not be dragged. Tauri's drag-region script treats a bare `data-tauri-drag-region` attribute as self-only (a click must land on the element itself); clicks on the fish (a child element) walked up to the region and were rejected.
- Files: apps/web/src/pet/main.tsx (data-tauri-drag-region="deep").
- Changes: the pet window's drag region is now `deep`, so a press anywhere in the window (fish included) starts the window drag; the hide-menu button stays clickable (clickable elements without the attribute still block drag).
- Impact: the desktop pet can be dragged to any screen position again; the position keeps persisting via pet-position.json.
- Notes: right-click still opens the hide menu; the menu button does not start a drag.

### Pet fixes: settings namespace exposure + remote-origin command ACL

- Goal: after installing the transparent-window build, the pet window never appeared and the settings switch was dead. Two independent root causes: (1) the `ui-pet` settings namespace was not in the web configuration client whitelist, so every switch write answered `settings-not-exposed` and the switch stayed stuck; (2) Tauri denied the `pet_control` app command on the remote http://127.0.0.1 origins (main + pet windows) because no app ACL manifest existed and no capability granted the command.
- Files: packages/host/apiproxy/src/api-proxy.ts (add `ui-pet` to WEB_SETTINGS_NAMESPACES), apps/desktop/src-tauri/build.rs (app_manifest commands `pet_control` so tauri-build autogenerates the app ACL), apps/desktop/src-tauri/capabilities/default.json + pet.json (grant `allow-pet-control` alongside the remote URLs), README.md, README.zh.md.
- Changes: switch writes now reach the persisted `ui-pet.enabled` document; the pet window's show/hide/toggle command is granted to both windows' remote origins, so the plugin's settings sync can show the window and the right-click hide works.
- Impact: the pet switch toggles the desktop pet window and the choice persists; the pet appears on the desktop when enabled.
- Notes: verified by local reproduction (switch click → settings.mutate answered `settings-not-exposed` before the fix) and by the generated ACL (`allow-pet-control` present, capabilities validate at build).

### Desktop pet as a separate transparent window; settings switch; right-click menu; message layout fix

- Goal: (1) move the pet out of the main window into its own transparent always-on-top desktop window (a real desktop pet: drag it anywhere, it stays when the main window is minimized), (2) add a General-settings switch for the pet whose state is remembered across restarts, (3) replace the old instant right-click hide with a right-click menu (hide), (4) restore the per-message rollback button to the right-side action strip of user messages (it had been floating on the left of each message).
- Files: apps/desktop/src-tauri/tauri.conf.json (pet window: transparent, decorations off, always on top, skip taskbar, hidden until the switch says show; capability `remote` URLs for main+pet so the http://127.0.0.1 backend pages can reach IPC), apps/desktop/src-tauri/capabilities/pet.json (new — drag-region permission for the pet window), apps/desktop/src-tauri/capabilities/default.json (remote URLs for the main window), apps/desktop/src-tauri/src/lib.rs (navigate the pet window to `pet.html` once the backend is up, persist/restore its screen position in pet-position.json, `pet_control` command: show/hide/toggle), apps/web/pet.html (new — standalone pet page entry), apps/web/src/pet/{main.tsx, pet-page.module.css, vendor/*} (new — pet stage: BroadcastChannel listener, drag region, hover jump / click wave, right-click hide menu; renderer sources vendored from ui-pet), apps/web/src/css-modules.d.ts (new), apps/web/vite.config.ts (multi-entry: main + pet), packages/client/ui-pet/src/index.ts (register the `ui-pet` settings namespace), packages/client/ui-pet/src/pet-settings.ts (new — namespace/schema), packages/client/ui-pet/src/client/index.ts (forward `session/activity` over BroadcastChannel `dsh:pet-activity`; bind the settings scope and drive `pet_control`; register the General-section toggle row), packages/client/ui-pet/src/client/{PetToggleRow.tsx, PetToggleRow.module.css, pet-toggle-store.ts, locales.ts} (new), packages/client/ui-pet/src/client/PetDock.tsx (removed — replaced by the standalone window), packages/client/ui-pet/tests (apply.client.spec.ts, pet-toggle-row.client.spec.tsx replacing pet-dock.client.spec.tsx), packages/client/ui-conversation/src/client/chat/MessageItem.module.css (drop the anchor `position: relative`), packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.module.css (undo button back in the actions strip), tsconfig.base.json (explicit `@deepseek-ai/dsh-client-ui-settings/client` paths entry), README.md, README.zh.md.
- Changes:
  - The pet window loads the same-origin `pet.html` served by the dsh web backend; activity flows from the main window's ui-pet plugin to the pet window over a same-origin BroadcastChannel (no cross-window IPC), the window is draggable anywhere (Tauri drag region), right-click opens a hide menu, and the screen position is persisted in `pet-position.json`.
  - The General settings section now shows a 桌宠 switch (ui-pet namespace). The choice is persisted; on startup the plugin mirrors it to the shell (`pet_control show/hide`), so the last state survives restarts. In a plain browser (no desktop shell) the switch is inert.
  - The rollback button returns to the message actions strip (right side); user message bubbles stay right-aligned.
  - An environment fix along the way: a stale `tsc -b` run had emitted `.js`/`.d.ts` files into `packages/*/src/` (vite prefers `.js` over `.ts`, so tests silently loaded built artifacts and crashed on the browser-module-loader globals); the polluted files were removed and the ui-pet tsconfig references were completed so `tsc -b` emits only under `lib/types` again.
- Impact: the DeepSeek 大肥鱼 lives in its own desktop window, animated by the agent state (修改代码/思考中/空闲), draggable with remembered position; the settings switch controls it with persistence; right-click no longer makes it vanish without a trace.
- Notes: the pet window is created hidden and only becomes visible when the switch is on; the switch is the recovery entry after hiding the pet. Pet window size is fixed at 240x260.

### Desktop pet plugin activation fix (inject: ['runtime'] removed)

- Goal: fix the web boot failure `1 entry did not activate @deepseek-ai/dsh-client-ui-pet: pending (waiting for service: runtime)`. The client plugin declared `inject: ['runtime']`, but dsh-client-runtime provides no `runtime` service (it provides `slots`, `sessions`, `workspaces`); the plugin therefore waited forever and the pet never appeared.
- Files: packages/client/ui-pet/src/client/index.ts.
- Changes: the plugin's `inject` is now `[]`. It only listens on the shared context's `session/activity` event (emitted by dsh-client-runtime per mux envelope), which needs no service injection; activation is no longer gated on a nonexistent service.
- Impact: the DeepSeek 大肥鱼 pet loads on web boot again and animates with the agent state (修改代码/思考中/空闲), draggable with persisted position, right-click hides.
- Notes: `dsh.client.inject` in packages/client/ui-pet/package.json stays as the informational package-dependency edge (`@deepseek-ai/dsh-client-runtime`); it does not sequence activation.

### Desktop pet (DeepSeek fat-fish, in-window floating); old pets removed

- Goal: replace the third-party in-page pet (`@linxin666/dsh-pet`, removed from the web profile) with a free local floating companion inside the main window, using the DeepSeek 大肥鱼 spritesheet (from the deepseek-fat-fish-codex-pet fan project). The pet shows the agent's live state — tool executing (working), step thinking, or idle — with distinct animations, is draggable with persisted position, and hides on right-click for the session. (An earlier separate transparent window approach was abandoned: the pet now lives in the page.)
- Files: packages/client/ui-pet (new — package.json, tsconfig.json, tsdown.config.ts, src/index.ts, src/invariant.ts, src/client/{index.ts, PetDock.tsx, PetRenderer.tsx, petAnimation.ts, petTypes.ts, builtinPets.ts, pet.module.css, css-modules.d.ts}, tests/pet-dock.client.spec.tsx), packages/client/runtime/src/client/index.ts (session/activity event: derives working/thinking/idle from mux session events), packages/bundle/web-app/cordis.patch.yml + package.json (ui-pet row), tsconfig.client.json (ui-pet reference), apps/web/public/pets/deepseek-fat-fish.webp (served by the frontend-static fallback), README.md, README.zh.md.
- Changes:
  - `@deepseek-ai/dsh-client-ui-pet` mounts a global floating pet onto `document.body` (single React root, no session dimension). The dock listens for the runtime's `session/activity` events, mapped to the fat-fish animations: working → running, thinking → waiting, idle → idle; hovering plays jumping, clicking waves, dragging moves the pet and persists the position to localStorage, right-click hides it for the session.
  - The runtime (`packages/client/runtime/src/client/index.ts`) now emits `session/activity` per mux session event: `tool/call` → working, `step/start`/`turn/start`/`assistant/message` → thinking, `tool/result`/`turn/end` → idle. One event, no second connection.
  - The fat-fish spritesheet ships in `apps/web/public/pets/` (vite copies it into dist; the frontend-static fallback serves it verbatim) and is referenced by URL — tsdown cannot bundle image assets.
  - The old `@linxin666/dsh-pet` package, its bundle row, and `pet.json` were removed from the user web profile; the earlier cc-haha built-in pets were dropped in favor of the single fat-fish pet.
- Impact: a free local DeepSeek 大肥鱼 pet floats at the bottom-left of the GUI and animates with the agent's state (修改代码/思考中/空闲); it never leaves the machine and requires no account or payment.
- Notes: pet size is fixed at 140; pet settings are not wired into the GUI settings page yet.

### Chinese permission presets, remembered window size, centered launch, review fetch retry

- Goal: (1) localize the permission preset labels (Read Only / Workspace Write / Full access) into Chinese, (2) remember the main window size across launches, (3) center the window on launch, (4) stop the code-review drawer's first-open "Failed to fetch".
- Files: packages/client/ui-permission-presets/src/client/presentation.ts, packages/client/ui-permission-presets/src/client/locales.ts, packages/client/ui-permission-presets/tests (3 spec files), packages/client/ui-permission-presets/package.json, apps/desktop/src-tauri/src/lib.rs, apps/desktop/src-tauri/src/diff_server.rs, apps/desktop/src-tauri/tauri.conf.json, packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.tsx, README.md, README.zh.md.
- Changes:
  - Preset labels now come from a Chinese map in `presentation.ts`: 只读 / 工作区写入 / 完全访问; the Full-access confirmation copy in the zh dictionaries follows (完全访问). Custom host-configured preset names still pass through unchanged.
  - The desktop shell persists the main window size to `window-size.json` in the app data dir on every resize (`on_window_event(Resized)`), restores it at startup, then centers the window (`center: true` in tauri.conf.json plus an explicit `restore_and_center`).
  - The diff server now retries binding port 3199 (200 ms interval) instead of dying silently when the previous instance's socket is still closing, so the review drawer's first fetch finds the server; the client-side load retry was raised from 3 to 5 rounds (800 ms apart).
  - The PermissionRow component spec was rewritten to mount via `react-dom/client` createRoot (the `@testing-library/react` mount crashes on the repo-wide react 19/18 mix) and now asserts the Chinese labels.
- Impact: the permission dropdown is fully Chinese, the window keeps its size and launches centered, and the code-review drawer no longer errors on first open.
- Notes: rebuild the desktop bundle and installer for the shell changes to ship.

### Bundled user skills seeded by the installer (Chinese descriptions)

- Goal: make the GUI's Skills settings page show a usable built-in skill set. The user had Trae IDE skills at `~/.trae-cn/skills`; the usable subset (Anthropic/Vercel originals and generic dev skills) is now shipped inside the desktop installer and seeded into the user skills root on install, with Chinese single-line descriptions.
- Files: apps/desktop-installer/skills-seed (27 skill directories, SKILL.md frontmatter rewritten), apps/desktop-installer/scripts/prepare-payload.mjs, apps/desktop-installer/scripts/rewrite-skill-frontmatter.mjs (new), apps/desktop-installer/skills-zh-desc.json (new), apps/desktop-installer/src-tauri/src/installer.rs, README.md, README.zh.md.
- Changes:
  - `prepare-payload.mjs` now also copies `skills-seed/` into the payload as `resources/skills/`, so every installer carries the skill set.
  - `installer.rs` gained `seed_user_skills` (plus `copy_dir_all`): after payload extraction the bundled skills are copied to `%APPDATA%\ai.deepseek.harness.desktop\dsh\skills` (the DSH_HOME root the Skills settings page reads). Existing skill directories are never overwritten, so user edits and additions survive reinstalls.
  - `rewrite-skill-frontmatter.mjs` + `skills-zh-desc.json`: each seeded SKILL.md frontmatter gets `name` matching its directory (kebab-case, e.g. `vercel-composition-patterns` → `composition-patterns`) and a single-line Chinese `description` — the web management parser reads only `key: value` lines, so folded multi-line descriptions would render empty.
  - Excluded sources: ByteDance-internal skills (douyin-*, douyinpay, byted-bp, iga-pages, hook/report video tooling), Intel AIPC `local-*` hardware skills, and account-dependent ones (alipay, figma MCP, Notion research, 天眼一下 tyc OAuth).
- Impact: a fresh install shows 27 Chinese-described skills in Settings → Skills, each toggleable (model/user) and removable; the current machine's `%APPDATA%\...\dsh\skills` was seeded immediately too.
- Notes: rebuild the installer for the seeding to ship; the seed directory lives in the installer workspace and is not part of the dsh bundle.

### Terminal shell dropdown: popup width and toggle fixes

- Goal: the "Integrated Terminal Shell" dropdown popup was wider than its trigger (the in-place list kept the 218px card min-width) and could not be closed by clicking the trigger again.
- Files: packages/client/ui-terminal/src/client/TerminalShellRow.tsx, packages/client/ui-terminal/tests/TerminalShellRow.client.spec.tsx, README.md, README.zh.md.
- Changes:
  - `TerminalShellRow`'s `Menu` now opts into `portal` (as the permission-preset and the other settings rows do), so the popup is fixed-positioned and sized to the trigger's width (NexBox-style) instead of the 218px in-place card minimum.
  - The trigger click toggles `open` instead of only opening, so clicking the trigger again closes the menu; outside click and Escape still close it.
  - Added a spec asserting the trigger-toggle close behavior.
- Impact: the shell picker matches the other settings dropdowns in width and interaction.
- Notes: rebuild the desktop bundle/installer for the GUI to pick up the fix.

### Terminal panel removed; shell picker kept; dropdowns match NexBox style

- Goal: remove the user-facing integrated terminal panel (sidebar footer action + xterm panel) — the terminal is for the agent, not the user; keep only the "Integrated Terminal Shell" settings row, and make every dropdown match the NexBox `CustomSelect` look (popup as wide as the trigger, chevron rotate, hover transitions).
- Files: packages/client/ui-terminal (src/client/index.ts, src/client/locales.ts, src/client/terminal-model.ts, src/client/TerminalShellRow.tsx, package.json, tsconfig.json, README.md, README.zh.md; deleted src/client/SidebarTerminalAction.tsx, src/client/TerminalPanel.tsx, src/client/TerminalAction.module.css, src/client/TerminalPanel.module.css, tests/terminal-model.client.spec.ts), packages/client/ui-primitives/src/Menu.tsx + Menu.module.css, packages/bundle/web-app/cordis.patch.yml, README.md, README.zh.md.
- Changes:
  - `ui-terminal` now registers only the `settings.general.item` row (`terminal-shell`); the `sidebar.footer.action` registration, the panel, the xterm dependencies, and the SSE `parseSseFrames` helper are gone. The `terminal` settings namespace (host-owned) still drives `dsh-pwsh-local`'s executing shell, so the agent runs commands in the shell chosen in settings.
  - Locale keys pruned to the two used by the row (`terminal.shellSetting`, `terminal.shellSettingDesc`).
  - `Menu` portal mode now sizes the popup to the anchor trigger's width (`width: r.width`) and the portal list drops its minimum width, matching the NexBox `CustomSelect`; the shell row's chevron rotates 180deg while open with the same transition.
  - Dependency hygiene: `ui-terminal` dropped `@deepseek-ai/dsh-client-ui-sidebar` and the xterm packages and gained explicit `ui-primitives` + `clsx` declarations.
- Impact: the sidebar no longer shows a terminal entry; the settings General section keeps the shell picker; every dropdown built on the shared `Menu` now matches the trigger width.
- Notes: no profile patch change needed — the shipped profile enables both rows; rebuild the desktop bundle/installer so the GUI ships without the panel.

### Integrated terminal shell picker (PowerShell / CMD / Git Bash / WSL)

- Goal: add an integrated terminal to the desktop Web UI, with a settings choice for the startup shell — PowerShell 7, Windows PowerShell, Command Prompt, Git Bash, or WSL.
- Files: packages/subprocess/subprocess/src/types.ts, packages/subprocess/subprocess-local/src/terminal.ts, packages/subprocess/subprocess-e2b/src/terminal.ts, packages/terminal/terminal-host (new), packages/client/ui-terminal (new), packages/host/apiproxy/src/api-proxy.ts, packages/bundle/web-app/cordis.patch.yml + package.json, tsconfig.host.json, tsconfig.client.json, README.md, README.zh.md.
- Changes:
  - `SubprocessTerminalHandle` gains `resize(cols, rows)` (local node-pty implementation; the E2B provider rejects it explicitly).
  - Windows terminal support: `createProcessInspector` returns a null inspector on win32 (node-pty spawn/write/resize work; foreground inspection, descendant tracking, and signal delivery are unavailable, so teardown stops the top-level shell only) — this also makes `dsh-terminal-bash`-style spawning possible on Windows.
  - New `@deepseek-ai/dsh-terminal-host`: shell resolution/probing (pwsh/powershell/cmd/git-bash/wsl), the `terminal` settings namespace, and the HTTP surface — POST `/terminal/spawn`, GET `/terminal/:id/stream` (SSE output + exit), POST write/resize/kill. Sessions are in-memory, terminated on stream close or dispose.
  - New `@deepseek-ai/dsh-client-ui-terminal`: an xterm.js panel opened from a sidebar footer action (shell comes from the setting; no in-panel picker), and a General-settings "Integrated Terminal Shell" preference row (dropdown, the permission-preset row shape) persisting the choice.
  - `dsh-pwsh-local` switches the executing shell per call from the `terminal.shell` preference: `cmd` runs `cmd /d /s /c`, `git-bash` runs Git Bash's `bash -c`, `wsl` runs `wsl bash -c`; everything else keeps the PowerShell dialect. The agent's command tool therefore runs in the terminal mode the user selected in settings.
  - The `terminal` settings namespace joins the web settings allowlist.
- Impact: a user-facing terminal with a selectable shell is available in the GUI; model-facing terminal behavior (dsh-terminal-bash) is unchanged.
- Notes: the panel depends on the local subprocess provider (E2B resize unsupported); rebuild the desktop bundle for the new packages to ship.

### Differential message snapshots (history.db size)

- Goal: history.db ballooned because every message snapshot stored a FULL copy of every workspace text file; unchanged files should never enter the database.
- Files: apps/desktop/src-tauri/src/diff_server.rs, README.md, README.zh.md.
- Changes:
  - Message snapshots are now differential: the FIRST snapshot stores the full session baseline, later ones store only files whose mtime moved plus NULL rows for deleted files; unchanged files never hit the database (a 500-file workspace with 2 changed files stores 502 rows, not 1500).
  - `file_state` (full-content state table) is dropped; `file_meta` tracks path+mtime only; the changes comparison reference falls back to the first snapshot for never-recorded paths; review/rollback/preview read the latest snapshot record per path.
  - One-time migration (user_version-guarded) drops the old full-content table and VACUUMs the database; the migration is best-effort (a concurrent write can hold the exclusive lock the VACUUM needs, in which case it defers to a later open). Write batches use BEGIN IMMEDIATE so concurrent snapshot requests serialize instead of interleaving or both running the full baseline scan.
- Impact: history.db grows with actual changes instead of workspace size; existing rollback data stays valid (the old full snapshots are just the baseline plus per-message full copies, which the latest-record lookup handles).
- Notes: rebuild the desktop installer (Rust shell) for the changes to take effect.

### Code-review drawer performance and concurrency fixes

- Goal: the code-review drawer's first open was tens of seconds slow and a second open could come up empty on large non-git workspaces.
- Files: apps/desktop/src-tauri/src/diff_server.rs, packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.tsx, README.md, README.zh.md.
- Changes:
  - The diff server now handles one thread per connection; a slow request (a full message snapshot) no longer stalls every later review/rollback request, and SQLite connections get a busy timeout for concurrent writes.
  - Batch writes (session initialization, message snapshots, change recording) run inside ONE transaction instead of auto-committing per row — the dominant cost of the slow first open.
  - `snapshot_review` no longer reads every workspace file: baseline-known paths are read individually, and new files come from a stat-only directory walk.
  - The drawer resets a stale file selection between opens so the diff area never stays empty after a payload change.
  - Reopening the drawer keeps the previous payload visible while a background refresh runs (loading only blocks the first fetch), and the snapshot review is cached server-side for 3 seconds, so repeat opens are instant instead of waiting for the next full computation.
- Impact: the non-git review opens in seconds instead of tens of seconds, and repeated opens always show content.
- Notes: rebuild the desktop installer (Rust shell) for the backend changes to take effect.

### Rollback preview and safe restore (cc-haha rewind contract)

- Goal: bring the conversation rollback up to the cc-haha rewind safety contract — preview the files a rollback will restore (with per-file diffs and +/- counts) before confirming, refuse path escapes and symlink writes, and report what cannot be restored.
- Files: apps/desktop/src-tauri/src/diff_server.rs, packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.tsx, packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.module.css, packages/client/ui-sidebar-toggle/src/client/locales.ts, packages/client/ui-sidebar-toggle/tests/ConversationRollbackAction.client.spec.tsx, README.md, README.zh.md.
- Changes:
  - New `/code-review/rollback/preview` endpoint: per-file snapshot-vs-current diffs (states `modified` / `deleted` / `created`), +/- totals, and the skipped/unrestorable list; the frontend dialog now loads this preview and shows the file list with an expandable diff surface before the confirm button is enabled.
  - `restore_files` now resolves every target through `safe_target`: the canonicalized parent must stay inside the canonicalized workspace (blocks `..` escapes and tampered history.db paths), and writes through symbolic links are refused; the rollback response carries the `skipped` list.
  - Unrestorable files are reported in the dialog instead of silently skipped.
- Impact: rollback is preview-then-confirm with per-file diffs and explicit skipped reporting; a malicious or accidental snapshot path can no longer write outside the workspace. Non-git workspaces are unaffected (snapshot review from the previous change).
- Notes: rebuild the desktop installer (Rust shell) for the backend endpoints to take effect.

### Code-review drawer: per-file syntax-highlighted diff review

- Goal: upgrade the desktop code-review drawer from a plain `<pre>` blob into a per-file review surface with line numbers, +/- prefixes, and syntax highlighting (mirroring the workspace-diff review UX of Claude Code Haha).
- Files: packages/client/ui-sidebar-toggle/src/client/diff-model.ts (new), packages/client/ui-sidebar-toggle/src/client/DiffReviewSurface.tsx (new), packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.tsx, packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.module.css, packages/client/ui-sidebar-toggle/src/client/locales.ts, packages/client/ui-sidebar-toggle/tests/diff-model.client.spec.ts, packages/client/ui-sidebar-toggle/tests/DiffReviewSurface.client.spec.tsx, packages/client/ui-primitives/src/index.ts, README.md, README.zh.md.
- Changes:
  - Added `parseWorkspaceDiff` / `parseUntrackedFiles` / `untrackedRows` / `languageFromPath` (pure diff parsing; hunk line numbers, metadata chrome, untracked new-file contents).
  - Added `DiffReviewSurface`, a pure-presentation component: two-column line-number gutter, +/- prefixes, hunk/metadata chrome, per-line shiki highlighting via the shared `highlightLines`, and middle-collapse for long diffs.
  - The code-review drawer's file list is now clickable and selects one file; the diff area renders the selected file (tracked diff or untracked new file).
  - Exported `highlightLines` / `HighlightSpan` from `@deepseek-ai/dsh-client-ui-primitives` (previously internal to the markdown module).
  - The drawer maps the diff server's non-git error to the localized "not a Git repository" hint instead of showing the raw English message.
  - Non-git workspaces now get a session-baseline review: the diff server serves a snapshot diff (file_state/changes history vs current contents) when a session is supplied, and the drawer sends the session id and skips git-based watching for it.
- Impact: the Code Review drawer (Ctrl+Alt+B / header button) shows each changed file with real syntax highlighting instead of a raw text dump; no backend or wire changes.
- Notes: rebuild the web bundle for the change to take effect. Pre-existing repository state: GUI component tests across `packages/client` fail under the current root install because react 19 (pulled by a hoisted @testing-library/react peer resolution) is mixed with package-local react 18; this package's tests mount through react-dom 18 directly to stay green.

### Stale fallback-link replacement retries on Windows

- Goal: stop the desktop app from dying on the launch screen when replacing a stale `$DSH_HOME/profiles/node_modules` fallback junction whose target moved (e.g. a dev build pointed it at its own bundle, then the installed app re-points it).
- Files: packages/boot/app-boot/src/profile.ts, README.md, README.zh.md.
- Changes: `ensureSymlink` now replaces a wrong-target link through `unlinkWithRetry`, which retries EPERM/EBUSY (a live process holding the reparse point — typically a previously launched instance) up to 5 times at 200 ms, treats ENOENT as success, and fails loud with the link path, wanted target, and remedy instead of a bare EPERM aborting boot.
- Impact: transient holders (startup races, antivirus scans) self-heal; a persistent holder produces a clear diagnostic. Existing behavior is unchanged for correct links and non-Windows platforms.
- Notes: rebuild the desktop installer for the change to take effect.

### GUI 插件管理与识图配置修复

- Goal: fix the desktop Web GUI's plugin-management paths and expose the describe-image vision-endpoint settings card for in-GUI editing.
- Files: packages/host/apiproxy/src/api-proxy.ts, README.md, README.zh.md.
- Changes:
  - Added `describe-image` to `WEB_SETTINGS_NAMESPACES` so the third-party describe-image plugin's settings card is served to the Web client (previously `settings-not-exposed`).
  - `runPluginCommand` now invokes the `@deepseek-ai/dsh` CLI entry (`lib/bin.js`) directly through `process.execPath` instead of `pnpm dsh`, which failed outside a harness checkout with ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL.
  - `profileDir`, `instructionsPath`, and `userSkillRoot` now resolve `$DSH_HOME` first (fallback `~/.dsh`), matching `resolveDshHome`; the Persona page previously wrote `~/.dsh/AGENTS.md` while agent-instructions injected `$DSH_HOME/AGENTS.md`.
  - Removed the `dsh-bash` market entry whose source `@deepseek-ai/dsh-shell-bash` is not published; market installs now pin the `next` dist-tag (`<pkg>@next`) because the registry `latest` tag still points at the pre-bundle `0.0.1-rc.1`.
- Impact: plugin install/uninstall and the plugin market work in the desktop deployment; the Image understanding settings card is editable from the GUI; user-global AGENTS.md written through the Persona page is actually injected.
- Notes: rebuild the desktop installer (apps/desktop prepare:bundle + apps/desktop-installer build:setup) for the changes to take effect.

### Right panel pure-white style

- Goal: keep the right panel (Preview + Files/Changes) readable in every shell theme by making it a fixed pure-white palette with high-contrast text and buttons.
- Files: packages/client/dsh-aionui-panel/src/client/styles/tokens.module.css, packages/client/dsh-aionui-panel/src/client/styles/explorer.module.css, packages/client/dsh-aionui-panel/src/client/styles/scm.module.css, packages/client/dsh-aionui-panel/src/client/index.ts, packages/client/dsh-aionui-panel/README.md, packages/client/dsh-aionui-panel/README.zh.md.
- Changes: removed the panel dark-theme token override; all panel surfaces now use white backgrounds; text, toolbar labels, tree arrows and collapse controls use darker high-contrast ink; color-scheme light is asserted on panel roots and floating chrome.
- Impact: the AionUI right panel no longer follows the shell dark theme; existing layout, drag, preview and git behaviors are unchanged.
- Notes: rebuild the web bundle and desktop shell for the change to take effect.

### Rollback confirmation dialog

- Goal: make the rollback confirmation a centered in-page dialog in the NexBox style.
- Files: packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.tsx, packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.module.css, packages/client/ui-sidebar-toggle/src/client/locales.ts.
- Changes: replaced the native window.confirm with the shared Modal primitive; the title, message, and action buttons are centered, and localized Cancel/Rollback labels were added.
- Impact: the confirmation dialog stays inside the desktop WebUI and follows the current theme; snapshot and file restore behavior is unchanged.
- Notes: rebuild the web bundle and desktop shell for the change to take effect.

- Goal: remove the wallpaper/background-image feature from Web settings and fix the transparent right details panel.
- Files: packages/bundle/web-app/package.json, packages/bundle/web-app/cordis.patch.yml, tsconfig.client.json, packages/client/ui-skin-maid-atelier/src/client/maid-atelier.module.css; deleted packages/client/ui-background.
- Changes: removed the ui-background plugin from the Web plugin roster and dependency tree; deleted the plugin package; made the right details panel opaque white in light mode and opaque dark in dark mode.
- Impact: the General settings no longer show the background/wallpaper controls; the desktop bundle must be regenerated for the change to take effect.
- Notes: the skin's own palace/character backdrop was not changed.


### Code Review drawer layer

- Goal: make Code Review render like the left drawer and stay on the top layer.
- Files: packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.tsx.
- Changes: the Code Review drawer is now portaled to document.body so it escapes nested stacking contexts and renders above conversation and sidebar layers.
- Impact: the drawer no longer gets buried inside transformed ancestors; theme and background behavior are unchanged.
- Notes: rebuild the web bundle and desktop shell for the change to take effect.


### Conversation rollback (SQLite history)

- Goal: give every conversation a rollback button that restores files changed by the conversation to their pre-conversation state.
- Files: apps/desktop/src-tauri/src/diff_server.rs, apps/desktop/src-tauri/Cargo.toml, packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.tsx, packages/client/ui-sidebar-toggle/src/client/CodeReviewAction.module.css, packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.tsx, packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.module.css, packages/client/ui-sidebar-toggle/src/client/locales.ts.
- Changes: the desktop diff server now creates and writes a local SQLite history at <workspace>/.recode/history.db, records file diffs while a session is active, and exposes snapshot/status/rollback endpoints. User-sent messages show a small rollback button; clicking it restores files and the conversation log to the snapshot taken before that user message.
- Impact: all history and rollback stays local; no server or network is required. Binary files are skipped.
- Notes: a snapshot is created when each user message mounts in the conversation, and clicking that message rolls back its files and conversation log to the snapshot. The desktop shell no longer copies the live session JSONL directly; offset-based session-log restore is implemented.
