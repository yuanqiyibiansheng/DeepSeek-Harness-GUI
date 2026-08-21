# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

> **Local change record (2026-08-21): removed the custom theme and restored the official default theme.**
> - Goal: remove the bespoke visual theme added to the Web client ("Abyssal Maid Atelier" skin and the "Angelina" theme) and restore the official DeepSeek Harness default theme.
> - Files changed:
>   - `packages/bundle/web-app/cordis.patch.yml` — removed the `ui-angelina` and `ui-skin-maid-atelier` rows.
>   - `packages/bundle/web-app/package.json` — removed the two theme dependencies.
>   - `tsconfig.client.json` — removed the two project references.
>   - `packages/client/ui-theme/src/client/index.ts` — removed the "安洁莉娜亮色/暗色" options from the Appearance settings.
>   - Deleted the `packages/client/ui-angelina` and `packages/client/ui-skin-maid-atelier` package directories.
> - Effect: the Web client theme registry and Appearance settings no longer register the Angelina theme or the maid-atelier skin; the default light/dark official theme is active.
> - Scope: affects only the Web client (`dsh web`) appearance/theme settings; default behavior returns to the official state.
> - Note: run `pnpm install` to clear the dangling `node_modules` symlinks pointing at the removed packages, then rebuild the frontend bundle for the change to take effect.

> **Local change record (2026-08-21): transplanted a standalone plugin marketplace.**
> - Goal: port the `dsh-market` project (`dshmarket`) into this checkout as a standalone "设置 → 插件市场" (Settings → Plugin Market), replacing the old minimal Settings → Plugins "Marketplace" npm-search tab.
> - Files changed:
>   - Added `packages/bundle/dsh-market/*` — the `dshmarket` package (host half + client half + `cordis.patch.yml`), adapted to the workspace build (`package.json`, `tsconfig.json`, `tsdown.config.ts`, `src/invariant.ts`; external test suite dropped).
>   - `packages/bundle/web-app/cordis.patch.yml` — replaced the `ui-plugin-marketplace` row with the `dsh-market` row (`dshmarket`).
>   - `packages/bundle/web-app/package.json` — replaced the `@deepseek-ai/dsh-client-ui-plugin-marketplace` dependency with `dshmarket`.
>   - `tsconfig.client.json` — replaced the `ui-plugin-marketplace` project reference with `packages/bundle/dsh-market`.
>   - Deleted `packages/client/ui-plugin-marketplace/*`.
> - Effect: the Web client now shows the standalone dshmarket under Settings → 插件市场 (browse/search/install themes and plugins, backup/restore, updates, diagnostics, hot-disable/enable); the old minimal marketplace tab is gone.
> - Scope: Web client only. Version caveat — `dshmarket` targets `dsh web` rc.6/rc.7 while this checkout is ~rc.5, so some rc.7-only market self-management/card features may disable themselves rather than render.
> - Note: run `pnpm install` and `pnpm run build` (or `pnpm --filter dshmarket run bundle` plus a web-frontend rebuild) so the market bundle and composition take effect.

> **Local change record (2026-08-21): baked in the default Firefly theme plugin.**
> - Goal: ship `dsh-theme-firefly` as a default bundled theme plugin so a fresh `web` profile enables it and the plugin market reports it as installed.
> - Files changed:
>   - Added `packages/bundle/dsh-theme-firefly/*` — the prebuilt `dsh-theme-firefly` bundle (client theme + `cordis.patch.yml`; no source, `lib/` shipped as-is; `tsdown.config.ts` returns an empty `entry` so the workspace build skips it).
>   - `packages/boot/app-boot/src/profile.ts` — `PROFILE_TEMPLATES.web` now bundles `dsh-theme-firefly`; new `PROFILE_TEMPLATE_DEPENDENCIES` seeds it into the profile manifest `dependencies`; `initProfile` gained an optional `defaultDependencies` parameter.
>   - `packages/boot/app-boot/src/index.ts` — exports `PROFILE_TEMPLATE_DEPENDENCIES`.
>   - `apps/cli/src/plugin.ts` — passes `PROFILE_TEMPLATE_DEPENDENCIES[profile]` to `initProfile`.
>   - `packages/bundle/web-app/package.json` — added `dsh-theme-firefly` dependency.
>   - `tsconfig.base.json` — added a `dsh-theme-firefly` source path mapping.
> - Effect: a freshly initialized `web` profile enables the Firefly theme and lists it in `dependencies`, so the plugin market shows it installed.
> - Scope: default web profile template + profile-init boot path only; existing profiles are not touched.
> - Note: firefly ships prebuilt (`lib/`, no `src/`); its `tsdown.config.ts` returns an empty `entry` so the workspace build skips it (without that, `pnpm run build` fails because there is no tsc-emitted `lib/types/*` entry). Run `pnpm install` and rebuild (`pnpm run build`) for the change to take effect.

> **Local change record (2026-08-21): added a volume slider to the baked-in Firefly theme's music player.**
> - Goal: expose a volume slider in the firefly theme's background-music widget and wire it to the audio volume (previously fixed at 0.9).
> - Files changed:
>   - `packages/bundle/dsh-theme-firefly/lib/client.js` — rebuilt bundle: the music card now has a volume row (slider + live percentage) bound to `audio.volume`, persisted in `localStorage` as `ff_music_volume` (default 0.9).
>   - `packages/bundle/dsh-theme-firefly/lib/client.template.js` — template source updated (slider CSS, card volume row, volume wiring) and re-embedded.
> - Effect: with the firefly theme active, the music card shows a volume slider and a live percentage; the chosen level is remembered across reloads.
> - Scope: theme client bundle only.
> - Note: the bundle was rebuilt in the source theme repo via `node build.cjs` (the `assets/`, `music/`, `GIF/` sources live there), so the fork ships the prebuilt `lib/`.

> **Local change record (2026-08-21): added `dspk.png` as a fourth static wallpaper in the Firefly theme.**
> - Goal: add `apps/desktop/src-tauri/icons/img/dspk.png` to the firefly theme's wallpaper resources (previously 3 static images).
> - Files changed:
>   - `packages/bundle/dsh-theme-firefly/assets/dspk.png` — the image copied into the theme asset set.
>   - `packages/bundle/dsh-theme-firefly/lib/client.js` — rebuilt bundle (dspk.png embedded as a 4th static wallpaper; the earlier volume slider is preserved).
>   - `packages/bundle/dsh-theme-firefly/lib/client.template.js` — template source re-embedded.
> - Effect: the firefly theme now offers 4 static wallpapers (firefly-bg.jpg, firefly2.png, firefly3.png, dspk.png) plus the default video.
> - Scope: theme client bundle + assets only.
> - Note: the rebuild happened in the source theme repo (`node build.cjs`); the bundle grew from ~70 MB to ~88 MB because the ~14 MB image is embedded as base64.

> **Local change record (2026-08-21): baked in the `dsh-modef` plugin (model picker + reasoning-effort slider).**
> - Goal: ship `@magiczerowxy/dsh-modef` (a model dropdown + Claude-style reasoning-effort slider with max-tier animations) as a default web-profile plugin so it is enabled and shown as installed in the plugin market, and its General-settings switch is exposed.
> - Files changed:
>   - Added `packages/bundle/dsh-modef/*` — the prebuilt `@magiczerowxy/dsh-modef` bundle (host `lib/index.js` + client `lib/client.js` + `cordis.patch.yml`; the host half's hardcoded debug-log write was removed; `tsdown.config.ts` returns an empty `entry` so the workspace build skips it).
>   - `packages/boot/app-boot/src/profile.ts` — `PROFILE_TEMPLATES.web` now bundles `@magiczerowxy/dsh-modef`; `PROFILE_TEMPLATE_DEPENDENCIES.web` seeds it (`^0.1.0`).
>   - `packages/host/apiproxy/src/api-proxy.ts` — added `dsh-modef` to `WEB_SETTINGS_NAMESPACES` (the Web settings-card whitelist) so the General-settings switch is editable (the official decision point the plugin's README calls out).
>   - `packages/bundle/web-app/package.json` — added `@magiczerowxy/dsh-modef` dependency.
>   - `tsconfig.base.json` — added a `@magiczerowxy/dsh-modef` source path mapping.
> - Effect: a fresh `web` profile enables the model/effort selector and lists `@magiczerowxy/dsh-modef` in `dependencies`, so the plugin market shows it installed; the "高级的推理强度选择" switch is ON by default (`advancedEffort` defaults to `true`), so the slider shows without manual toggling. The settings schema default lives in the prebuilt host half (`packages/bundle/dsh-modef/lib/index.js`), which ships as-is (tsdown skips it).
> - Scope: default web profile template + profile-init boot path + apiproxy settings whitelist; existing profiles are untouched (they would still need the plugin installed, or the profile reseeded).
> - Note: dsh-modef ships prebuilt (`lib/`, no `src/`); its `tsdown.config.ts` skips the workspace build. The apiproxy whitelist change is in source (`src/api-proxy.ts`) and is recompiled by `pnpm run build`.

> **Local change record (2026-08-21): replaced the Firefly theme's native tooltips with built-in-style UI tooltips.**
> - Goal: the firefly theme's controls (music player, wallpaper, ambience, typing-sound, etc.) showed OS/native `title` tooltips; switch them to the built-in UI tooltip look (dark plate, light text, rounded, fade-in) so the whole app is consistent.
> - Files changed:
>   - `packages/bundle/dsh-theme-firefly/lib/client.template.js` — removed all native `title=`/`.title` tooltips; controls now carry `data-tt` (styled tooltip) + `aria-label` (accessibility); added a `[data-tt]::after` tooltip CSS matching the dsh `Tooltip` visual spec.
>   - `packages/bundle/dsh-theme-firefly/lib/client.js` — rebuilt bundle (88.1 MB); same changes embedded.
> - Effect: hovering/focusing any firefly theme control now shows the built-in-style tooltip bubble instead of the system tooltip.
> - Scope: firefly theme client bundle only (dsh-market/dsh-modef already use the built-in React `Tooltip`).
> - Note: rebuilt in the source theme repo via `node build.cjs`; the build.sizes stay ~88 MB (no asset change).

> **Local change record (2026-08-21): fixed the Firefly tooltip position and added click-outside-to-close.**
> - Goal: (a) the built-in-style tooltips I added earlier were overriding the theme's fixed-position toggle buttons (`乐/景/萤/声`), putting them in the wrong place; (b) the music (`乐`) and wallpaper (`景`) panels only closed via their close button — clicking elsewhere didn't dismiss them.
> - Files changed (same bundle as the tooltip record):
>   - `packages/bundle/dsh-theme-firefly/lib/client.template.js` — added a higher-specificity rule restoring `position: fixed` on the four firefly toggles (so the `[data-tt]` tooltip anchor rule no longer breaks their layout); added a document click-outside handler that closes all firefly floating panels (music card, wallpaper panel, ambience menu) when clicking outside them; `client.js` rebuilt (88.1 MB).
> - Effect: tooltips appear anchored to each control correctly; `乐`/`景`/`萤` popovers now dismiss on outside click (in addition to Esc and their close buttons).
> - Scope: firefly theme client bundle; synced to the fork source and the running profile.

> **Local change record (2026-08-21): removed the desktop pet feature.**
> - Goal: drop the desktop pet plugin entirely (no longer wanted), which also resolves a pre-existing workspace reference mismatch that broke `pnpm install` (web-app referenced `@deepseek-ai/dsh-client-ui-pet` while the package is named `dsh-pet`).
> - Files changed:
>   - Deleted `packages/bundle/dsh-pet/*`.
>   - `packages/bundle/web-app/cordis.patch.yml` — removed the `ui-pet` row.
>   - `packages/bundle/web-app/package.json` — removed the pet dependency.
>   - `tsconfig.client.json` — removed the pet project reference.
>   - `packages/host/apiproxy/src/api-proxy.ts` — removed `ui-pet` from `WEB_SETTINGS_NAMESPACES`.
>   - `apps/web/src/pet/*`, `apps/web/pet.html`, and the `pet` Vite build entry (`apps/web/vite.config.ts`) — removed the standalone desktop pet-window page.
> - Effect: the desktop pet no longer ships in the web composition / default profile (its plugin, its settings namespace, and its pet-window page are all gone); `pnpm install` and the build resolve cleanly.
> - Scope: web client composition + defaults + the web frontend pet page.

> **Local change record (2026-08-21): re-implemented the desktop pet (`ui-pet`) and gated the "files changed" card.**
> - Goal: bring back the `ui-pet` desktop pet (with the "桌宠" settings toggle + agent working/thinking/idle state animations) from the `DeepSeek-Harness-GUI` source; also make the per-turn "N 个文件已更改" rewind card appear only when a turn actually changed files.
> - Files changed:
>   - Restored `packages/client/ui-pet/*` (host `src/index.ts` registers the `ui-pet` settings namespace; client `src/client/index.ts` forwards `session/activity` to the pet window over BroadcastChannel, binds the settings scope and drives `pet_control` to show/hide the window, and registers the General-section "桌宠" toggle row).
>   - `packages/bundle/web-app/cordis.patch.yml` — added the `ui-pet` row.
>   - `packages/bundle/web-app/package.json` — added the `@deepseek-ai/dsh-client-ui-pet` dependency.
>   - `tsconfig.client.json` — added the `ui-pet` project reference.
>   - `packages/host/apiproxy/src/api-proxy.ts` — re-added `ui-pet` to `WEB_SETTINGS_NAMESPACES` (so the settings switch is writable).
>   - `apps/web/pet.html`, `apps/web/src/pet/*`, `apps/web/public/pets/deepseek-fat-fish.webp`, and the `pet` Vite build entry (`apps/web/vite.config.ts`) — restored the standalone pet-window page.
>   - `packages/client/ui-session-rewind/src/client/RewindCard.tsx` — early-return also when `checkpoint.code.filesChanged.length === 0`.
> - Effect: the desktop pet (deepseek fat-fish, agent working/thinking/idle) is back with its "桌宠" switch; the "N 个文件已更改" card no longer appears for turns with no file changes.
> - Scope: web client composition, web frontend pet page, and apiproxy settings whitelist.

> **Local change record (2026-08-21): whitelisted the agent-presets settings namespace (default preset picker).**
> - Goal: new sessions were defaulting to "极简模式" instead of following the default agent preset chosen in Settings → Agent Preset. The `agent-presets` settings namespace was not in the web settings client whitelist, so the browser settings UI could not persist the chosen default.
> - Files changed: `packages/host/apiproxy/src/api-proxy.ts` — added `agent-presets` to `WEB_SETTINGS_NAMESPACES`.
> - Effect: the default-agent-preset setting is now writable from the web settings UI, so a new session uses the chosen default preset.
> - Scope: host apiproxy settings whitelist.

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

### DeepSeek/pi-ai adapters default to text + image (all models accept images)

- Goal: let any model accept image content by default so `read_image` and the image-upload preflight pass without per-model configuration; a genuinely text-only model fails at the API with its own 400 rather than being refused by the harness.
- Files: packages/llm/llm-deepseek/src/adapter.ts, packages/llm/llm-deepseek/src/serialize.ts, packages/llm/llm-deepseek/src/index.ts, packages/llm/llm-deepseek/src/types.ts, packages/llm/llm-pi-ai/src/config.ts, packages/llm/llm-deepseek/tests/serialize.spec.ts, packages/llm/llm-deepseek/tests/adapter.spec.ts, packages/llm/llm-deepseek/tests/dynamic-config.spec.ts, packages/llm/llm-pi-ai/tests/catalog.spec.ts, packages/llm/llm-pi-ai/tests/config.spec.ts, README.md, README.zh.md, packages/llm/llm-deepseek/README.md, packages/llm/llm-deepseek/README.zh.md, packages/llm/llm-pi-ai/README.md.
- Changes: `DeepSeekCatalogModel` gains an optional `inputModalities` field, and an undeclared model (a catalog entry or an unlisted pass-through id) now defaults to `[text, image]`; the serializer encodes a user-message image as an OpenAI-compatible `image_url` base64 data URL through the durable attachment store, and refuses images on wire roles that cannot carry them (system/assistant/tool) or when no store is mounted. pi-ai's `defaultInput` default becomes `[text, image]`. `resolveModelInfo`/`listModels` report the resolved modalities, which is what the `read_image` gate and the host upload preflight check.
- Impact: any DeepSeek-official or pi-ai model without an explicit modality declaration is treated as image-capable, so `read_image` and image uploads work out of the box; a truly text-only model that receives an image fails at the provider with its own 400 after the image is sent.
- Notes: this shifts image-capability enforcement from the harness preflight to the provider. An explicit declaration still wins: an entry declaring `[text]` (or a route's `defaultInput: [text]`) restores the conservative refusal-before-attach behavior. Images are supported only on user messages.

### Automatic compaction no longer fails when a local model's output cap outgrows its context window

- Goal: fix automatic pressure compaction silently failing when a pi-ai local model leaves `maxTokens` unset; pi-ai fills the gap with `32_768`, which can exceed a smaller hand-configured `contextWindow` and turn `promptBudget` negative, throwing an error the step listener swallows.
- Files: packages/compaction/compaction-basic/src/config.ts, packages/compaction/compaction-basic/tests/compaction-basic.spec.ts, README.md, README.zh.md.
- Changes: `resolveCompactSpec` now uses the whole context window as `promptBudget` when `maxTokens` is unset or already at least the context window, instead of throwing `TargetPressureConfigError`; added a unit test for the oversized-output fallback.
- Impact: a local model whose reported output capability equals or exceeds its configured `contextWindow` now compacts at the normal 80% threshold rather than never compressing.
- Notes: the threshold itself is unchanged; the pressure listener still only warns once per target before falling silent, which is a separate observability gap.

### Web default composition now keeps automatic compaction on

- Goal: make the shipped Web composition load `compaction-basic` by default instead of disabling it in the web-app patch.
- Files: packages/bundle/web-app/cordis.patch.yml, apps/cli/tests/web-compaction-default.spec.ts, README.md.
- Changes: changed the web-app bundle patch so `compaction-basic` is mounted with `auto: true`; added a config regression that checks the shipped web patch keeps `compaction-basic` enabled with automatic compaction on.
- Impact: shipped Web/desktop sessions now keep automatic context compaction enabled by default, so the 80% pressure threshold can trigger compaction without an extra preset override.
- Notes: this does not change the compaction threshold itself; it only restores the default shipped activation path that the web-app bundle had been disabling.

### Blank sessions now drop stale context-meter projections

- Goal: stop a brand-new session from inheriting stale context meter values and opening at 100% when the host still proves it is blank.
- Files: packages/client/runtime/src/client/sessions/projection-store.ts, packages/client/runtime/src/client/sessions/session.ts, packages/client/runtime/tests/projection-store.client.spec.ts, packages/client/runtime/tests/session.client.spec.ts, README.md.
- Changes: added an immediate `ProjectionValueStore.clear()` path and taught blank-session handling to clear stale `contextPressure`, `contextBreakdown`, `tokenUsage`, and `sessionStats` rows whenever the host-authoritative blank bit is still true, including the case where the blank bit does not change but the store still holds old values.
- Impact: new sessions no longer keep a carried-over full context meter from a previous session state, so the UI can start from an empty/blank projection baseline instead of showing 100% by default.
- Notes: this is a defensive client-side cleanup for blank sessions; it does not change the host compaction algorithm itself.

### Rewind drains the live agent without blocking on full handle teardown

- Goal: fix two rewind regressions together: pre-rewind queued messages could survive into the next prompt, and `撤销当前轮次` could stall indefinitely at `正在撤销...` while waiting for whole-runtime teardown.
- Files: packages/rewind/session-rewind/src/index.ts, packages/host/apiproxy/src/api-proxy.ts, packages/host/apiproxy/tests/api-proxy-cold.spec.ts, README.md.
- Changes: rewind now prefers the live agent path: clear `agent.inbox`, cancel the current activity with `keepInbox: true`, and wait only for `whenIdle()` before validation, restore, and trim; it falls back to `sessionRuntime.stopSessionAndWait()` only when no live agent is attached. The host stop helper still clears queued inbox work before full teardown, and the host regression test remains in place for queue removal.
- Impact: rewind no longer carries forward stale queued or steering messages into the next prompt, and the confirm dialog no longer waits on full handle disposal before the rewind can complete.
- Notes: this change is scoped to rewind/session-stop behavior and does not change ordinary queue ordering while a session keeps running.

### Rewind also clears the session's local draft state before reopening

- Goal: keep a rewound session from resending the pre-rewind draft text or draft images with the next message.
- Files: packages/client/ui-conversation/src/client/input/contract.ts, packages/client/ui-conversation/src/client/input/facade.ts, packages/client/ui-session-rewind/src/client/index.ts, README.md.
- Changes: added a small rewind-only `resetForRewind()` input action that clears the current draft text, resets browser-owned draft image ids, and clears the notice slot; the rewind reopen path now calls it before `sessions.reopen(sessionId)`. Added a client scenario test that proves the rewind reset clears local draft text, draft images, and stale notices before the session view is rebuilt.
- Impact: after a rewind, the composer starts from an empty local draft state instead of restoring old queued text or images into the next send.
- Notes: this only affects the rewind reopen path and does not alter ordinary send, undo, or queue-steer behavior.

### Angelina theme enters the client as an optional plugin

- Goal: bring the Angelina visual style into the current DSH client as an opt-in theme plugin instead of replacing the default theme.
- Files: packages/client/ui-angelina/package.json, packages/client/ui-angelina/tsconfig.json, packages/client/ui-angelina/tsdown.config.ts, packages/client/ui-angelina/src/index.ts, packages/client/ui-angelina/src/invariant.ts, packages/client/ui-angelina/src/client/index.ts, packages/client/ui-angelina/src/client/style.ts, packages/client/ui-angelina/src/client/locales.ts, packages/client/ui-angelina/src/client/AngelinaRow.tsx, packages/client/ui-angelina/tests/apply.client.spec.ts, packages/bundle/web-app/package.json, packages/bundle/web-app/cordis.patch.yml, README.md.
- Changes: added a new client-only `ui-angelina` plugin package that registers Angelina light/dark theme ids, injects a locally owned Angelina stylesheet at runtime, and contributes a General settings row for selecting Angelina light, Angelina dark, or restoring the system theme; added the plugin to the web-app bundle roster and dependency manifest.
- Impact: the current client can load Angelina as an optional built-in plugin without changing the default theme path or requiring an external plugin checkout.
- Notes: this first pass ports the Angelina theme as a lightweight local stylesheet and theme selector row; it does not yet import the full external plugin's artwork and parallax asset pipeline.

### Rewind reset no longer recreates an input shell on a dead session scope

- Goal: fix the rollback runtime error `cannot create effect on inactive context` that could surface while reopening a rewound session.
- Files: packages/client/ui-conversation/src/client/input/hub.ts, packages/client/ui-conversation/src/client/apply.ts, README.md.
- Changes: added an `existingShell(sessionId)` read path on `InputHub` and changed the rewind-only `conversationInput.resetForRewind(sessionId)` service to clear only an already resident shell instead of calling `shell(sessionId)`, which could otherwise try to mint a fresh shell and attach `actx.effect(...)` listeners onto a scope already being torn down by `sessions.reopen()`.
- Impact: rewinding a session no longer tries to create input-side effects on an inactive session context during the reopen transition, so the rollback flow can clear browser-owned draft state without throwing that runtime error.
- Notes: this is intentionally rewind-specific; ordinary session navigation still lazily creates shells through the existing `shell(sessionId)` path when a live binding is needed.

### Desktop rebuild now produces both the desktop shell and installer

- Goal: make `build-desktop.bat` refresh both desktop delivery targets so a manual build updates `apps/desktop/src-tauri/target/release/dsh-desktop.exe` as well as the custom installer executable.
- Files: build-desktop.bat, README.md.
- Changes: after preparing the embedded `apps/desktop/bundle`, the script now explicitly runs `apps/desktop`'s `build:no-bundle` to refresh the desktop shell executable before running `apps/desktop-installer`'s `build:setup`; the final summary now prints both output paths.
- Impact: running `build-desktop.bat` now updates the desktop shell under `apps/desktop/src-tauri/target/release/` and the installer under `apps/desktop-installer/src-tauri/target/release/`, so the manual build output matches both expected delivery locations.
- Notes: `build:no-bundle` still rebuilds the desktop shell against the freshly prepared embedded bundle; the installer step remains responsible for packaging the payload zip and setup executable.

### Rewind now stops the live session runtime before trimming

- Goal: move the rewind execution path closer to `cc-dsh` so rollback kills the active session runtime before transcript trimming, instead of trying to keep the old live session limping through an in-place cancel path.
- Files: packages/rewind/session-rewind/src/index.ts, README.md.
- Changes: the rewind host service now prefers `sessionRuntime.stopSessionAndWait(sessionId)` whenever that runtime stop contract is available, and only falls back to a direct agent cancel path when the host composition has no session-runtime service.
- Impact: queued work is more likely to die with the rewound runtime instead of surviving into the next send, which is the first step toward `cc-dsh` parity for rollback semantics.
- Notes: this is a host-path correction only; the client rewind UI and session-window parity work is still being aligned separately.

### Rewind now forces a fresh mux subscribed generation

- Goal: make rollback establish the same kind of fresh mux baseline a reconnect produces, because stale queued prompts clear only when the client receives a new `session/subscribed` generation.
- Files: packages/client/connection/src/client/index.ts, packages/client/connection/tests/client-apply.client.spec.ts, packages/client/runtime/src/client/contract/sessions.ts, packages/client/runtime/src/client/sessions/service.ts, packages/client/runtime/tests/sessions-service.client.spec.ts, packages/client/ui-session-rewind/src/client/index.ts, packages/client/ui-session-rewind/src/client/RewindCard.tsx, packages/client/ui-session-rewind/tests/RewindCard.client.spec.tsx, README.md.
- Changes: `ctx.connection` now owns a narrow `restart()` operation that restarts the already-owned stream loop with the same sinks and config; rewind success resets its checkpoint controller, clears the resident input shell through `ctx.conversationInput.resetForRewind(sessionId)`, reopens the selected session scope, and then calls `ctx.connection.restart()` so the runtime receives a fresh mux handshake and `session/subscribed` replay.
- Impact: rollback now has a real path to clear stale queue mirrors, stale draft state, and half-restored input notices before re-baselining the chat window from the host-trimmed session.
- Notes: the session-runtime `resync(sessionId)` operation remains available for explicit session-local rebuilds, but rewind needs the wider connection-generation reset plus the input-shell reset and session reopen to recover a usable composer.

### Client GUI tests now use the full fake API client

- Goal: restore `pnpm run build:lib:client` after the stricter connection typing made several GUI assembly tests' partial `{ settings: ... }` connection handles invalid.
- Files: packages/client/ui-conversation/tests/apply-inject.client.spec.tsx, packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx, packages/client/ui-conversation/tests/chat-apply.client.spec.tsx, packages/client/ui-tool/tests/assembly-surfaces.client.spec.tsx, packages/client/ui-tool/tests/toolview-slot.client.spec.tsx, packages/client/runtime/tests/fake-api.client.ts, README.md.
- Changes: the affected GUI tests now use `FakeApiClient`, the repo's full `IApiClient` test double, instead of hand-writing partial `connection.api` objects; where a test still cares about settings behavior, it overrides only the needed `api.settings.*` methods on the fake. This round also restored the `SlotTestRuntime`, `usePinnedBrowserLanguages`, and `stubSettingsScope` imports after the temporary refactor left those tests with unresolved names.
- Impact: client build typechecking now sees a complete `IApiClient` on the fake connection service, so tightening the connection contract no longer breaks these GUI tests.
- Notes: `conversation.chat.steering` now uses its dedicated `SteeringMessageNodeView` again; the user-action child slot stays owned by the user node only, which avoids the duplicate child declaration that the slot registry rejects.

### Rewind checkpoint cards refetch immediately when a turn completes

- Goal: fix the regression where the `当前轮次检查点 / 撤销当前轮次` card could appear only after restarting the client instead of showing up as soon as the turn finished.
- Files: packages/client/ui-session-rewind/src/client/rewind-controller.ts, packages/client/ui-session-rewind/tests/rewind-controller.client.spec.ts, README.md.
- Changes: tightened the per-session checkpoint controller's cache gate so a changed completed-turn count always triggers a fresh `listTurnCheckpoints` read unless the exact same turn count is already loaded outside the cold state; added a focused controller test that proves a ready controller refetches when the completed-turn count advances.
- Impact: the rewind checkpoint card now appears live at the end of a turn instead of waiting for a full client restart to repopulate the checkpoint list.
- Notes: this change only affects the checkpoint-list refresh path; the per-turn card still renders only for closed turns and still depends on the host returning a checkpoint for that target message.

### Desktop rebuild clears locked bundled Node and builds the custom installer

- Goal: make `build-desktop.bat` recover automatically when Windows leaves `apps/desktop/bundle/node/node.exe` locked by a stale process during the desktop build, and route the final output to the custom installer at `apps/desktop-installer/src-tauri/target/release/dsh-desktop-installer.exe` instead of the NSIS setup bundle.
- Files: build-desktop.bat, README.md.
- Changes: the desktop build now probes for processes that are actively using the bundled Node binary and force-stops them before invoking `apps/desktop-installer`'s `build:setup` path; the script now ends by reporting the custom installer executable.
- Impact: rerunning the desktop build no longer fails immediately on a stale `node.exe` file lock from the previous bundle, and the build output is the custom installer executable instead of `DeepSeek Harness_0.1.0_x64-setup.exe`.
- Notes: the cleanup is scoped to the bundled Node path only; it does not touch unrelated Node processes.

### Rewind rewritten around session teardown (cc-haha parity): dispose live agent, trim log, reopen view in place

- Goal: the previous rewind fixes were still unstable — a rollback could leave pre-rewind queued prompts that were re-sent with the next message, turns without file changes showed no rollback card, and the client fell back to a full page refresh. The reference (`cc-haha`) stops the session runtime entirely before trimming, then reloads history in place; this change ports that flow end to end.
- Files: packages/host/apiproxy/src/api-proxy.ts (gateway keeps every resumed/created AgentHandle and exposes `sessionRuntime.stopSessionAndWait`, the production equivalent of the reference `stopSessionAndWait` that kills the CLI subprocess), packages/host/apiproxy/src/index.ts (registers `ctx.sessionRuntime`), packages/rewind/session-rewind/src/index.ts (execute now disposes the live agent/Session via `sessionRuntime` before trimming; falls back to cancel+drain when the host service is absent), packages/rewind/session-rewind/src/rewind.ts (every completed turn is listed, even with zero file changes, so the card always appears after a turn), packages/client/runtime/src/client/sessions/service.ts + contract/sessions.ts (new public `reopen(id)` that tears down the resident scope/Session and reselects the same id), packages/client/ui-session-rewind (injects the sessions runtime; after a successful execute it resets the checkpoint cache and calls `reopen`, replacing the backend-restart/page-reload path), packages/test-support/client-runtime/src/sessions.ts (test double implements `reopen`), packages/rewind/session-rewind/tests/rewind.spec.ts (checkpoint-list expectations updated), README.md.
- Changes: executing a rewind now disposes the live agent and its Session (loop quiescence, registry unregistration, live Session removal, scope unwind), so the inbox cannot outlive the rollback and queued prompts die with the runtime exactly like killing the reference CLI process; the durable log trim then rewrites the session from the target turn onward; the client rebuilds the current session view in place via `reopen`, backfilling the trimmed history from the host without restarting the backend or refreshing the page; every completed turn now yields a rewind card even when the turn changed no files.
- Impact: pre-rewind queued messages are no longer re-sent after a rollback; the rollback card appears for every completed turn (including aborted turns and zero-file-change turns); rolling back reloads only the conversation view in place, matching the reference behavior instead of a full refresh.
- Notes: rebuilding the desktop installer requires the full `build:lib`, `apps/desktop` bundle, and `apps/desktop-installer` pipeline; the generated artifact is `apps/desktop-installer/src-tauri/target/release/dsh-desktop-installer.exe`.

### Session rewind reliability fixes: live card refresh, queue clearing, in-place session reload

- Goal: the rewind card only appeared after restarting the client, a rollback left pre-rewind queued prompts in the agent inbox (they were re-sent with the next message), and executing a rollback forced a full page refresh instead of reloading the conversation in place like the reference desktop flow.
- Files: packages/rewind/session-rewind/src/index.ts (execute clears the agent inbox), packages/client/ui-session-rewind (controller refetches checkpoints when the completed-turn count moves; card restarts the backend in place instead of reloading the page), apps/desktop/src-tauri/src/lib.rs + build.rs + capabilities/default.json + permissions/autogenerated/restart_backend_in_place.toml (new `restart_backend_in_place` command: restarts the dsh backend on the same port without navigating the windows), README.md, README.zh.md.
- Changes: each completed turn now refetches `sessionRewind/listTurnCheckpoints` when the turn count moves, so the card appears as soon as the turn finishes; `execute` clears queued and steering inbox items (durable splice) so nothing queued before the rollback can leak into the next send; after a successful rewind the desktop shell restarts the backend on the same port and the web client's event stream reconnects, re-baselining the session in place — no page reload, matching the reference reload-history behavior.
- Impact: the rollback card is live per turn, rollback no longer re-sends pre-rewind queued prompts, and the conversation view rewinds in place instead of flashing a full reload.
- Notes: the plain-browser fallback still reloads the page when no desktop shell is present; rebuild the client bundles and the desktop app for the fixes to ship.

### Session rewind UI restored: per-turn checkpoint card wired to the sessionRewind Remote

- Goal: the cc-haha rewind port shipped the host service but removed the old frontend, so no undo surface was visible; restore the reference turn-tail flow — every completed turn ends with the "N 个文件已更改" card and "撤销当前轮次 / 回滚到这一轮之前" — now driven by the new backend.
- Files: packages/client/ui-session-rewind (new; `rewind` entry of the `conversation.chat.turnTail` chain + cc-haha copy + RewindCard/RewindController + tests), packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx (restored the rollback-draft composer hook), packages/bundle/web-app/{package.json,cordis.patch.yml}, tsconfig.client.json, README.md, README.zh.md.
- Changes: each completed turn renders the checkpoint card from `sessionRewind/listTurnCheckpoints` (one list read per session): changed-file count, +N/-M badges, per-file rows opened through the chat opener, the reference cautions (an incomplete checkpoint only offers "只回滚对话"; a partial checkpoint names the unrecorded tools), and the reference confirm dialog. Confirming calls `sessionRewind/execute` with the chosen mode; the desktop shell restarts the dsh service in place and the conversation view re-baselines without a page reload, and the composer stays empty so only the next message the user types is sent.
- Impact: the rollback feature is visible again, matches the reference desktop layout, and runs entirely on the ported `dsh-session-rewind` host service; the Rust diff server remains removed.
- Notes: requires the zod dependency fix in `dsh-session-rewind` (previous entry) to boot; rebuild the client bundles and the desktop app for the card to ship.

### Session rewind startup fix: declare the zod dependency the generated remote needs

- Goal: the desktop app failed to boot with `client-modules: require("zod") missed the module table` after the rewind port, because `@deepseek-ai/dsh-session-rewind`'s generated Typert remote imports zod while the package did not declare it.
- Files: packages/rewind/session-rewind/package.json, README.md, README.zh.md.
- Changes: added `"zod": "^4.4.3"` to the package's dependencies, matching every other package that ships a generated Typert remote. With zod resolvable from the package's own node_modules, tsdown inlines it into the api-remotes client bundle instead of emitting `require("zod")`.
- Impact: startup no longer fails on the loader module table; the rewind remotes load like the other generated remotes.
- Notes: rerun pnpm install, rebuild the client bundles, and rebuild the desktop app for the fix to ship.

### Sidebar toggle no longer re-renders the workbench every frame

- Goal: remove the dropped-frame displacement of conversation content while
  the right sidebar expands or collapses.
- Files: third_party/dsh-better-sidebar/src/client/Sidebar.tsx,
  third_party/dsh-better-sidebar/lib/client.js, README.md, README.zh.md.
- Changes: the measured center-column edges now update CSS custom properties
  directly instead of calling `setState` from every `ResizeObserver`
  callback; React no longer re-renders the whole Sidebar on each animation
  frame.
- Impact: the panel slide and conversation reflow animation are unchanged,
  but the workbench state updates no longer compete with the CSS layout
  transition, so expanding and collapsing the sidebar is smoother.
- Notes: rebuild the web bundle and desktop installer for the change to take
  effect.

### Installer runs file extraction off the UI thread

- Goal: keep the setup window responsive and draggable while the Installing
  step extracts the payload and writes installed files.
- Files: apps/desktop-installer/src-tauri/src/installer.rs, README.md,
  README.zh.md.
- Changes: `install` is now an async Tauri command and runs its blocking work
  through `tauri::async_runtime::spawn_blocking`.
- Impact: extraction, shortcut creation, and registry writes no longer stall
  the installer UI thread; the frontend still awaits the command before
  advancing to the next step.
- Notes: the installer exe was rebuilt from source after this fix.

### Installer no longer flashes a console window while stopping the running app

- Goal: remove the black command window that appears during the Installing
  step when the setup shell runs `taskkill` to stop a previous DeepSeek Harness
  instance.
- Files: apps/desktop-installer/src-tauri/src/installer.rs, README.md,
  README.zh.md.
- Changes: `kill_running_app` starts `taskkill` with `CREATE_NO_WINDOW`; the
  force tree kill and wait behavior are unchanged.
- Impact: the fourth installer step no longer briefly opens a black console
  window.
- Notes: the installer exe was rebuilt from source after this fix.

### Installer Rust build compiles with the Tauri window manager import

- Goal: restore the missing `Manager` trait import so the installer's
  `get_webview_window` call compiles when rebuilding the Rust shell.
- Files: apps/desktop-installer/src-tauri/src/lib.rs, README.md, README.zh.md.
- Changes: added `use tauri::Manager;` to `lib.rs`; the window setup logic is
  otherwise unchanged.
- Impact: `npm run build:setup` can complete the Cargo release build and
  produce `dsh-desktop-installer.exe`; installer startup and the window-show
  fallback behavior are unchanged.
- Notes: the installer exe was rebuilt from source after this fix.

### Installer window visibility fix

- Goal: the hidden-start installer stayed invisible after double-click because
  the frontend `show()` call was rejected by the capability policy and no
  native fallback showed the window.
- Files: apps/desktop-installer/src-tauri/capabilities/default.json
  (`core:window:allow-show`), apps/desktop-installer/src-tauri/src/lib.rs
  (setup thread shows the main window after 1.5s as a fallback), README.md,
  README.zh.md.
- Changes: the frontend is allowed to reveal the window once React mounts; if
  that call fails for any reason, the native shell shows the window after 1.5
  seconds so the installer always appears.
- Impact: double-clicking the installer always opens the setup page; the
  no-black-flash behavior is retained because the window starts hidden.
- Notes: the installer exe was rebuilt from source.

### White terminal text and hidden installer startup

- Goal: the sidebar terminal followed the theme label token, so normal output
  was not pure white; the frameless installer still flashed black before the
  WebView painted.
- Files: third_party/dsh-better-sidebar/src/client/TerminalView.tsx and
  third_party/dsh-better-sidebar/lib/client-terminal.js (terminal background
  fixed to `#111114`, foreground fixed to `#ffffff`),
  apps/desktop-installer/src-tauri/tauri.conf.json (`visible: false`),
  apps/desktop-installer/src/App.tsx (shows the window after React mounts),
  README.md, README.zh.md.
- Changes: the sidebar terminal now always renders white text on a dark
  surface, independent of the active theme. The installer starts hidden and
  only becomes visible after the first React commit, so no black frame can
  appear during WebView startup.
- Impact: terminal output is readable pure white; installer launch is seamless.
- Notes: the desktop exe and custom installer were rebuilt from source.

### Installer startup no longer flashes a black window

- Goal: the frameless custom installer showed a black window for a moment
  before the WebView painted its dark-blue setup UI.
- Files: apps/desktop-installer/src-tauri/tauri.conf.json (window
  `backgroundColor: #0f172a`), apps/desktop-installer/index.html (inline body
  background), README.md, README.zh.md.
- Changes: the native window starts with the same `#0f172a` surface the setup
  UI uses, and the entry HTML paints the same color before CSS loads, so the
  startup flash matches the installer instead of showing black.
- Impact: launching the installer no longer flashes a black window.
- Notes: the installer exe was rebuilt from source.

### Right sidebar white surface and complete new-tab menu

- Goal: the dsh-better-sidebar workbench inherited the active theme tokens, so
  on the desktop client the panel background became transparent and its labels
  were unreadable; the + menu also inherited the 22px trigger width and
  ellipsized every option.
- Files: packages/client/web/src/base.css (fixed white `--dsw-alias-*` tokens
  scoped to `[data-dsh-better-sidebar]`), packages/client/ui-primitives/src/Menu.tsx
  (portal menus keep a 218px minimum width for icon-only triggers and resolve
  alignment from the computed width), README.md, README.zh.md.
- Changes: the right sidebar now uses a solid white panel with dark readable
  text and borders regardless of the active theme; the new-tab dropdown keeps
  the standard menu width (218px) instead of collapsing to the width of the
  small + button, so every option is fully visible.
- Impact: sidebar content and the new-tab menu are readable in both light and
  dark themes.
- Notes: the desktop exe and custom installer were rebuilt from source with the
  updated web bundle.

### Replace code review with the dsh-better-sidebar workbench

- Goal: remove the old header code-review drawer and bring in the right-side
  workbench from the dsh_desktop reference, following its bundled-plugin
  approach.
- Files: third_party/dsh-better-sidebar (vendored `dsh-better-sidebar` 0.12.2
  plugin: source, prebuilt lib, LICENSE, README), apps/cli/package.json and
  packages/bundle/web-app/package.json (file: dependency), packages/bundle/web-app/cordis.patch.yml
  (`better-sidebar` loader row), packages/client/ui-sidebar-toggle (removed
  `CodeReviewAction`, `DiffReviewSurface`, and `diff-model`; kept the per-message
  rollback action), README.md, README.zh.md.
- Changes: the desktop bundle now ships the VSCode-style right sidebar workbench
  (explorer / editor / terminal / Git / browser) from
  [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
  (MIT). The session-header Code Review button, Ctrl+Alt+B shortcut, and their
  drawer UI are removed; the conversation rollback button on user messages is
  unchanged.
- Impact: opening a project conversation shows the sidebar workbench on the
  right, with per-session layout and tabs; the old code-review drawer no longer
  appears.
- Notes: the plugin is vendored under `third_party/` as a non-workspace file
  dependency so pnpm bundles its runtime dependencies without publishing it as
  a dsh workspace member. The desktop exe and custom installer must be rebuilt.

### Installer defaults to local Program Files

- Goal: installing to a cloud-synced drive (e.g. H:) could leave plugin directories as empty placeholders, making the backend fail to mount `/api` and every feature return "Failed to fetch".
- Files: apps/desktop-installer/src-tauri/src/installer.rs (`get_default_install_path` now always returns `%ProgramFiles%\DeepSeek Harness`), README.md, README.zh.md.
- Changes: the custom installer no longer reuses a previous cloud-drive install path as the default; fresh installs land on the local system drive by default.
- Impact: reinstall to a local drive materializes all bundle files, so the API gateway, sessions, workspaces, and plugins load normally.
- Notes: if an old cloud-drive install is still registered, run the new installer and choose the default local path; close all DeepSeek Harness processes first.

### Installer closes the running app before updating files

- Goal: installing over a running DeepSeek Harness instance replaced resources while the old process still served them, causing "Failed to load plugins" after the next launch.
- Files: apps/desktop-installer/src-tauri/src/installer.rs (`kill_running_app` before `extract_payload`), README.md, README.zh.md.
- Changes: the custom installer now runs `taskkill /IM "DeepSeek Harness.exe" /T /F` before extracting the payload, then waits briefly so the old WebView and backend cannot serve stale or half-replaced bundle files.
- Impact: update/reinstall no longer leaves a stale plugin manifest or missing bundle script error after launch.
- Notes: the installer now stops the running client automatically; a manual close is still safe.

### Rollback conversation log fix (zstd + exact turn boundary)

- Goal: rollback was truncating the zstd-compressed session log at the compressed file length, so the conversation stayed visible after rollback; it also used a snapshot-time offset that could point after the assistant reply.
- Files: apps/desktop/src-tauri/Cargo.toml (zstd dependency), apps/desktop/src-tauri/src/diff_server.rs (`restore_session_log_to_message`: decompress zstd logs, locate the user/message seq, rewind to just before its turn/start, re-encode one checksummed zstd frame per JSONL line), README.md, README.zh.md.
- Changes: message rollback now rewinds the session log to the exact turn boundary before the clicked question, works with both plain JSONL and `.zstd` logs, and re-encodes the log in the same concatenated-frame format the session store expects, so the API gateway and workspace plugin no longer fail with "corrupt Zstandard session log".
- Impact: after rollback, later turns and processing info disappear and the conversation returns to the state before the question.
- Notes: existing logs written by the earlier single-frame encoder were repaired by re-encoding each JSONL line as its own checksummed zstd frame; one unrecoverable session log was quarantined to the temp directory. The desktop exe and installer need to be rebuilt.

### Rollback confirmation without preview

- Goal: the preview step loaded and diffed every potentially restored file, which stayed slow on large sessions; rollback should confirm and execute immediately.
- Files: packages/client/ui-sidebar-toggle/src/client/ConversationRollbackAction.tsx (removed the `/code-review/rollback/preview` request, checkpoint picker, file list, diff surface, and explanatory sentence; the dialog now confirms the clicked message directly, shows a working state, and restarts the desktop service in place), packages/client/ui-sidebar-toggle/src/client/locales.ts (`review.rollbackWorking` copy), packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx (global rollback draft setter), packages/client/ui-sidebar-toggle/tests/ConversationRollbackAction.client.spec.tsx (no preview request; confirm calls `scope=both`), apps/desktop/src-tauri/src/diff_server.rs (two covering indexes and `snapshot_restore_targets` so the rollback itself only touches files that can differ), README.md, README.zh.md.
- Changes: clicking the undo button opens a simple confirmation dialog with cancel/rollback only; there is no checkpoint picker, no file diff list, and no "并把原消息放回输入框" sentence. While the rollback request runs, the dialog shows "正在回滚...". Confirm calls `/code-review/rollback` with `scope=both` for the clicked message, restores code and conversation, puts the original message back into the composer, then restarts the dsh service in place so the WebView reconnects and replays the session without a full page reload. Browser mode falls back to reload.
- Impact: rollback is fast and predictable; the session rewinds to just before the clicked question, the conversation history up to that point stays visible, the original question returns to the input, and the dialog no longer hangs on "正在读取预览...." or offers unrelated checkpoint choices.
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


### Conversation rewind (cc-haha port, replaces SQLite-history rollback)

- Goal: replace the desktop diff-server rollback with a 1:1 port of the reference rewind service (cc-haha `src/server/services/sessionRewindService.ts` + `src/utils/fileHistory.ts`), operating on the event-sourced session log.
- Files: packages/rewind/file-history (new; service + recording hooks + backup artifacts under `{dshHome}/file-history/{sessionId}/`), packages/rewind/session-rewind (new; Typert Remotes `sessionRewind/preview|execute|listTurnCheckpoints|getTurnCheckpointDiff`), packages/session/session-persistence, session-persistence-jsonl, session-persistence-sqlite (`trim`), packages/core/session (event catalog), tsconfig.base.json, tsconfig.host.json, packages/bundle/base, packages/bundle/web-app, packages/api/remotes; removed apps/desktop/src-tauri/src/diff_server.rs, packages/client/ui-sidebar-toggle, and the rollback-draft hook in packages/client/ui-conversation.
- Changes: file-history records a turn-start snapshot per direct user message and a first-edit backup per file-mutating tool call, both appended to the session log as `file/history-snapshot` events; the rewind service previews/executes rollback to any direct user message, restoring files from the snapshot fold and trimming the log at the target turn's `turn/start`. The 2000-line tree-sitter bash read-only classifier is replaced by a conservative self-contained allowlist with the same contract.
- Impact: rollback now lives in the dsh backend (Typert RPC) instead of the Rust diff server; the desktop flow restarts the dsh service after execute so the trimmed log replays.
