import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { EnvHttpProxyAgent, fetch as fetch$1 } from "undici";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSON_SCHEMA, Type, load } from "js-yaml";
import { Script } from "node:vm";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region lib/types/log.js
/**
* In-memory event log for issue reports: what the market did and how it
* failed, exportable as plain text from `/dsh-market/logs`.
*
* Privacy: entries are sanitized on write — the home directory collapses to
* `~`, and common credential shapes (API keys, GitHub/npm tokens, bearer
* headers) are masked. Nothing is persisted to disk; the buffer dies with the
* process and holds at most {@link MAX_ENTRIES} entries.
*/
const MAX_ENTRIES = 200;
const DETAIL_MAX = 600;
const entries = [];
function sanitize(text) {
	return text.replaceAll(homedir(), "~").replace(/[\u0000-\u001f\u007f]/g, "").replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, "gh*_***").replace(/npm_[A-Za-z0-9]{16,}/g, "npm_***").replace(/bearer\s+\S+/gi, "Bearer ***").replace(/(authorization|token|apikey|api-key|password)(["':=\s]+)\S+/gi, "$1$2***");
}
/**
* Append one event, sanitized and truncated.
* @param level - severity for the export listing.
* @param event - short machine-ish event name (e.g. `install`, `hot-mount`).
* @param detail - free-form context; credentials and home paths are masked.
*/
function logEvent(level, event, detail) {
	entries.push({
		at: (/* @__PURE__ */ new Date()).toISOString(),
		level,
		event,
		detail: sanitize(detail).slice(0, DETAIL_MAX)
	});
	if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}
/**
* The export document for bug reports.
* @param header - environment lines to prepend (version, platform — no paths).
* @returns plain text, newest entry last.
*/
function exportLogs(header) {
	const head = Object.entries(header).map(([key, value]) => `${key}: ${sanitize(value)}`);
	const lines = entries.map((e) => `${e.at} [${e.level}] ${e.event}: ${e.detail}`);
	return [
		"# dsh-market log export",
		...head,
		"",
		...lines.length > 0 ? lines : ["(no events this session)"],
		""
	].join("\n");
}
//#endregion
//#region lib/types/ndjson.js
/**
* pnpm `--reporter=ndjson` progress parser (P1-6).
*
* pnpm's ndjson reporter is a bole stream on stdout: one JSON object per
* line, e.g.
*
*   {"time":...,"level":"debug","name":"pnpm:stage","prefix":"...","stage":"resolution_started"}
*   {"time":...,"level":"debug","name":"pnpm:progress","packageId":"...","status":"resolved"}
*   {"time":...,"level":"debug","name":"pnpm:fetching-progress","packageId":"...","status":"started","size":123}
*   {"time":...,"level":"debug","name":"pnpm:ignored-scripts","packageNames":["esbuild"]}
*   {"time":...,"level":"error","name":"pnpm","err":{"message":"..."}}
*
* Verified against real pnpm 11.16.0 output (2026-08). Older pnpm majors
* emit a different shape or nothing at all — callers fall back to human
* line parsing when `seen` stays false.
*
* The reducer is pure and unit-testable: `feed` mutates the tracker's
* internal snapshot, `snapshot` returns a serializable copy.
*/
function emptyProgress() {
	return {
		phase: null,
		done: 0,
		total: null,
		currentPackage: null,
		downloaded: null,
		size: null,
		seen: false,
		error: null,
		errorCode: null,
		ignoredBuilds: []
	};
}
function createProgressTracker() {
	const snap = emptyProgress();
	const seenPackages = /* @__PURE__ */ new Set();
	function dedupe(packageId) {
		if (typeof packageId !== "string" || packageId === "") return;
		if (!seenPackages.has(packageId)) {
			seenPackages.add(packageId);
			snap.done += 1;
		}
	}
	function feed(line) {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (typeof event !== "object" || event === null) return;
		const msg = event;
		const name = msg.name;
		if (typeof name !== "string") return;
		if (name === "pnpm:stage") {
			const stage = msg.stage;
			if (stage === "resolution_started") snap.phase = "resolving";
			else if (stage === "resolution_done") snap.phase = "downloading";
			else if (stage === "importing_started" || stage === "importing_done") snap.phase = "linking";
			snap.seen = true;
			return;
		}
		if (name === "pnpm:progress") {
			snap.seen = true;
			const status = msg.status;
			if (status === "resolved") {
				if (snap.phase === null) snap.phase = "resolving";
				dedupe(msg.packageId);
			} else if (status === "fetched" || status === "found_in_store") {
				snap.phase = "downloading";
				snap.currentPackage = typeof msg.packageId === "string" ? msg.packageId : snap.currentPackage;
				dedupe(msg.packageId);
			}
			return;
		}
		if (name === "pnpm:fetching-progress") {
			snap.seen = true;
			snap.phase = "downloading";
			if (typeof msg.packageId === "string") snap.currentPackage = msg.packageId;
			if (typeof msg.size === "number") snap.size = msg.size;
			if (typeof msg.downloaded === "number") snap.downloaded = msg.downloaded;
			dedupe(msg.packageId);
			return;
		}
		if (name === "pnpm:lifecycle") {
			snap.seen = true;
			snap.phase = "building";
			const wd = typeof msg.wd === "string" ? msg.wd : "";
			const dep = typeof msg.depPath === "string" ? msg.depPath : "";
			snap.currentPackage = wd.split(/[\\/]/).filter(Boolean).pop() ?? (dep !== "" ? dep : snap.currentPackage);
			return;
		}
		if (name === "pnpm:stats") {
			if (msg.added !== void 0 || msg.removed !== void 0) snap.phase = "linking";
			snap.seen = true;
			return;
		}
		if (name === "pnpm:ignored-scripts") {
			snap.seen = true;
			if (Array.isArray(msg.packageNames)) for (const pkg of msg.packageNames) {
				const at = typeof pkg === "string" ? pkg.lastIndexOf("@") : -1;
				const bare = at > 0 ? pkg.slice(0, at) : pkg;
				if (typeof bare === "string" && bare !== "" && !snap.ignoredBuilds.includes(bare)) snap.ignoredBuilds.push(bare);
			}
			return;
		}
		if (name === "pnpm" && msg.level === "error") {
			const err = msg.err ?? {};
			const message = typeof err.message === "string" ? err.message : "";
			if (message !== "") snap.error = message.slice(0, 2e3);
			if (typeof err.code === "string" && err.code !== "") snap.errorCode = err.code;
			return;
		}
	}
	function reset() {
		seenPackages.clear();
		const fresh = emptyProgress();
		Object.assign(snap, fresh);
	}
	return {
		get snapshot() {
			return {
				...snap,
				ignoredBuilds: [...snap.ignoredBuilds]
			};
		},
		feed,
		reset
	};
}
//#endregion
//#region lib/types/pnpm-compat.js
/**
* pnpm compatibility layer — everything the market needs to know about how
* different pnpm majors behave inside a dsh profile directory, kept pure and
* separately testable (test/unit + test/integration exercise this module
* against real pnpm 9/10/11).
*
* Verified behavior matrix (2026-08, pnpm 9.15.9 / 10.28.2 / 11.21.0):
* - workspace root, `add` without -w:  pnpm 9 fails ERR_PNPM_ADDING_TO_ROOT;
*   pnpm 10/11 succeed.
* - `add -w` where NO pnpm-workspace.yaml exists: ALL majors fail with
*   "--workspace-root may only be used inside a workspace".
* - modules dir built by pnpm 9, then pnpm 10/11 mutate it:
*   ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF (defaults drifted between majors).
*/
/**
* Decide the argv for a `dsh plugin <add|remove> …` call in the given profile.
*
* pnpm 9 refuses to add at a workspace root without -w (#17, #20); every
* pnpm major refuses -w when the directory is NOT a workspace. So the flag
* is injected exactly when the profile has a pnpm-workspace.yaml.
* @param profileDir - resolved profile directory (owns pnpm-workspace.yaml, or not).
* @param pluginArgs - the raw args, e.g. ['add', 'dshmarket@latest'].
* @returns args with -w injected when — and only when — the profile is a workspace root.
*/
function pluginArgsFor(profileDir, pluginArgs) {
	if (pluginArgs[0] !== "add" && pluginArgs[0] !== "remove") return pluginArgs;
	if (!existsSync(join(profileDir, "pnpm-workspace.yaml"))) return pluginArgs;
	return [
		pluginArgs[0],
		"-w",
		...pluginArgs.slice(1)
	];
}
/**
* Momentary network failures — worth exactly one automatic retry (#83).
* pnpm 5xx fetch codes, its meta-fetch give-up, and the raw socket errors
* that surface through dsh's wrapper. Permanent shapes (404, auth) are
* deliberately absent: retrying those just doubles the wait for bad news.
*/
function isTransientPnpmFailure(output) {
	return /ERR_PNPM_FETCH_5\d\d|ERR_PNPM_META_FETCH_FAIL|FetchError|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|network timeout/i.test(output);
}
/**
* pnpm's per-request fetch timeout: the abort surfaces as a DOMException
* ("The operation was aborted due to timeout", code 23) through undici —
* pnpm logs it as `GET … error (23)` before giving up. This is the failure
* shape for large tarballs (github: sources download the WHOLE repo, even
* for a `#path:` subdirectory plugin) on slow networks: pnpm's default
* 60-second limit is simply not enough, so a plain retry fails again at the
* same limit. The market's recovery re-runs once with a longer
* fetchTimeout (see withHoistRecovery).
*/
function isFetchTimeoutFailure(output) {
	return /operation was aborted due to timeout|TimeoutError|error \(23\)/i.test(output);
}
/**
* Map a failed pnpm run's combined output to a known failure mode.
*
* dsh's own wrapper line ("dsh: pnpm failed in profile directory …") names no
* cause, so the market must recognize pnpm's real diagnostics itself (#20).
* @param output - stdout+stderr of the failed run.
* @returns the classified failure, or null when unrecognized (raw output is then shown as-is).
*/
function classifyPnpmFailure(output) {
	if (output.includes("ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF")) return {
		code: "hoist-pattern-diff",
		recoverable: true,
		message: "profile 的 node_modules 是旧版 pnpm 创建的，与当前 pnpm 的默认配置不兼容，需要重建后重试 / this profile's node_modules was created by a different pnpm major; it must be rebuilt (pnpm install) before changes can be applied"
	};
	if (output.includes("ERR_PNPM_UNEXPECTED_STORE")) {
		const linked = /currently linked from the store at "([^"]+)"/.exec(output)?.[1];
		const wanted = /wants to use the store at "([^"]+)"/.exec(output)?.[1];
		const detail = linked !== void 0 && wanted !== void 0 ? `\n  node_modules → ${linked}\n  pnpm 现在想用 / pnpm now wants → ${wanted}` : "";
		return {
			code: "unexpected-store",
			recoverable: false,
			message: `这个 profile 的 node_modules 链接到的 pnpm store，和当前 pnpm 默认使用的 store 不是同一个，pnpm 因此拒绝所有安装与卸载。${detail}\n在 profile 目录里执行一次 \`pnpm install --store-dir <上面第一个路径>\` 重新链接即可（dsh 运行时可能占用文件，必要时先退出 dsh）/ this profile's node_modules is linked to a different pnpm store than the one pnpm now resolves, so pnpm refuses every install and uninstall.${detail}\nRelink by running \`pnpm install --store-dir <the first path above>\` once in the profile directory (stop dsh first if files are locked)`
		};
	}
	if (output.includes("ERR_PNPM_ADDING_TO_ROOT")) return {
		code: "adding-to-root",
		recoverable: false,
		message: "pnpm 拒绝在 workspace 根目录安装（缺少 -w）。这是市场的 bug，请升级 dshmarket 到最新版 / pnpm refused to add at a workspace root (missing -w); this is a market bug — please update dshmarket"
	};
	if (/--workspace-root may only be used inside a workspace/i.test(output)) return {
		code: "not-a-workspace",
		recoverable: false,
		message: "profile 目录不是 pnpm workspace，却传入了 -w。这是市场的 bug，请升级 dshmarket 到最新版 / -w was passed but the profile is not a pnpm workspace; this is a market bug — please update dshmarket"
	};
	if (output.includes("ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION") || output.includes("ERR_PNPM_NO_MATURE_MATCHING_VERSION")) return {
		code: "release-age-violation",
		recoverable: false,
		message: "这个 profile 里有一个刚发布不久的插件版本，pnpm 的安全等待期检查因此拒绝了本次改动（即使改的是别的插件）。市场已自动放行重试一次；若仍看到本条，请导出日志反馈 / a recently-published plugin version in this profile trips pnpm's fresh-release safety check, blocking any change (even to other plugins); the market retries once with a one-shot bypass — if you still see this, export the log and report it"
	};
	if (output.includes("ERR_PNPM_IGNORED_BUILDS")) return {
		code: "ignored-builds",
		recoverable: false,
		message: "有依赖需要执行构建脚本，被 pnpm 默认拦截。点击「允许构建脚本并重试」放行后重试即可 / a dependency needs to run build scripts, which pnpm blocks by default — click \"Allow build scripts and retry\" to approve and retry"
	};
	if (output.includes("ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED")) return {
		code: "git-prepare-not-allowed",
		recoverable: false,
		message: "这个 git 插件需要在安装时执行构建脚本，被 pnpm 默认拦截。点击「允许构建脚本并重试」放行后重试即可 / this git-hosted plugin needs to run its build script at install time, which pnpm blocks by default — click \"Allow build scripts and retry\" to approve and retry"
	};
	if (output.includes("ERR_PNPM_FETCH_404")) {
		const pkg = /GET\s+\S*\/([^/\s]+):/.exec(output)?.[1].replace(/%2[Ff]/g, "/");
		return {
			code: "fetch-404",
			recoverable: false,
			message: `有一个依赖在 registry 上不存在${pkg === void 0 ? "" : `（${pkg}）`}，pnpm 因此拒绝任何安装操作。它可能是之前失败操作残留在 profile package.json 里的幽灵依赖（可手动删除该行），也可能是需要登录的私有包 / a dependency cannot be resolved from the registry${pkg === void 0 ? "" : ` (${pkg})`}; pnpm refuses every install while it is present. It may be a ghost entry left in the profile's package.json by an earlier failed operation (remove that line by hand), or a private package needing registry credentials`
		};
	}
	if (isTransientPnpmFailure(output)) return {
		code: "transient-network",
		recoverable: false,
		message: "拉取依赖时网络临时失败（不一定是你正在装的插件——安装会重放整个依赖树，任何一个既有依赖抖动都会中断）。已自动重试一次仍失败，请稍后再试 / a transient network failure while fetching dependencies (not necessarily the plugin you are installing — installs replay the whole dependency tree, so any existing dependency can hiccup); one automatic retry failed too — please try again shortly"
	};
	if (isFetchTimeoutFailure(output)) return {
		code: "fetch-timeout",
		recoverable: false,
		message: "下载超时：这个插件的安装包较大（github 源会下载整个仓库）或网络较慢，pnpm 默认的单次请求 60 秒限制不够用。市场已用更长的超时自动重试一次；若仍失败，请稍后再试或检查网络 / download timed out: this plugin ships a large tarball (github sources download the whole repository) or your network is slow, and pnpm's default 60-second per-request limit was not enough; the market retries once with a longer timeout — if it still fails, try again later or check the network"
	};
	if (output.includes("pnpm not found on PATH")) return {
		code: "pnpm-missing",
		recoverable: false,
		message: "找不到 pnpm，请先在市场页顶部一键安装组件 / pnpm is not on PATH — use the one-click setup at the top of the market page"
	};
	return null;
}
//#endregion
//#region lib/types/sources.js
/**
* Registry-source knowledge: how a curated registry entry's URL maps to an
* installable pnpm target. Pure string logic, no I/O.
*/
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function validSubpath(subpath) {
	if (!/^[A-Za-z0-9_./-]+$/.test(subpath)) return false;
	return !subpath.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}
/** Registry tarball names must be plain npm package names, nothing fancier. */
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
/**
* Parse a registry source url: a github repo, optionally with a
* `/tree/<branch>/<subpath>` suffix (how the curated list links monorepo
* subpackages, e.g. dsh-plugins#theme-gallery).
*/
function parseSourceUrl(url) {
	const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\/tree\/[^/]+\/(.+?))?\/?$/.exec(url);
	if (m === null || !REPO_RE.test(m[1])) return null;
	const subpath = m[2] ?? null;
	if (subpath !== null) {
		if (!validSubpath(subpath)) return null;
	}
	return {
		repo: m[1],
		subpath
	};
}
function repoFromParts(owner, name) {
	const repo = `${owner}/${name.replace(/\.git$/i, "")}`;
	return REPO_RE.test(repo) ? { repo } : null;
}
/** Parse repository forms accepted by package.json.repository. */
function parseGitHubRepository(value) {
	const input = value.trim();
	const shortcut = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/i.exec(input);
	if (shortcut !== null) return repoFromParts(shortcut[1], shortcut[2]);
	const remote = input.replace(/^git\+/i, "");
	const web = /^(?:https?|git|ssh):\/\/(?:git@)?github\.com[/:]([^/]+)\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(remote);
	const scp = /^git@github\.com:([^/]+)\/([^/?#]+)$/i.exec(remote);
	const match = web ?? scp;
	return match === null ? null : repoFromParts(match[1], match[2]);
}
/**
* Parse a Git remote. Unlike package metadata, a local origin may contain a
* proxy prefix (for example `https://proxy/https://github.com/o/r.git`). In
* that case only the last GitHub occurrence is considered.
*/
function parseGitHubRemote(url) {
	const exact = parseGitHubRepository(url);
	if (exact !== null) return exact;
	const match = [...url.matchAll(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?=$|[/?#])/gi)].at(-1);
	return match === void 0 ? null : repoFromParts(match[1], match[2]);
}
/** Normalized repo identity shared by server discovery and client matching. */
function githubRepoIdentity(url, directory) {
	const source = parseGitHubRepository(url);
	if (source === null) return null;
	const repo = source.repo.toLowerCase();
	if (directory === void 0 || directory === null || directory.trim() === "") return repo;
	const subpath = directory.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
	return validSubpath(subpath) ? `${repo}#path:/${subpath.toLowerCase()}` : null;
}
/**
* Repository evidence used for installed-source matching. A monorepo package
* contributes both its collection root and exact subpath, mirroring the
* identities extracted from `github:owner/repo#path:/package` specs.
*/
function githubRepoIdentities(url, directory) {
	const identity = githubRepoIdentity(url, directory);
	if (identity === null) return [];
	const pathAt = identity.indexOf("#path:/");
	return pathAt === -1 ? [identity] : [identity.slice(0, pathAt), identity];
}
/** Weak identity hints from a local Git origin; never used to reject a unique match. */
function githubRemoteIdentities(url, directory) {
	const source = parseGitHubRemote(url);
	if (source === null) return [];
	return githubRepoIdentities(`https://github.com/${source.repo}`, directory);
}
/** GitHub `owner/repo` for a registry URL, or null when it is not a GitHub repo URL. */
function repoOf(url) {
	return parseSourceUrl(url)?.repo ?? null;
}
/**
* The allowBuilds key that actually authorizes a git-hosted dependency's
* build scripts. Verified against pnpm 11.21 (#68 by @yzr278892): for a
* `github:owner/repo` install, a bare `name: true` entry does NOT match —
* pnpm's own hint names a commit-pinned codeload URL that changes on every
* push; the stable form that matches is `name@git+https://github.com/owner/repo.git`.
* @param name - installed package name.
* @param spec - the dependency spec from package.json, or the install target.
* @returns the stable key, or null when the spec is not github-hosted.
*/
function gitAllowBuildsKey(name, spec) {
	const m = /^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/.exec(spec);
	if (m === null) return null;
	return `${name}@git+https://github.com/${m[1]}.git`;
}
/**
* The pnpm install target for a registry entry. Registry tarballs beat
* full-repo GitHub downloads: smaller, prebuilt, and CDN/mirror served. The
* npm name comes from our curated registry, which only maps repo-verified
* packages (name-squatting protection).
* @returns the target spec, or null when the source url is unsupported.
*/
function installTargetFor(entry) {
	const source = parseSourceUrl(entry.url);
	if (source === null) return null;
	if (typeof entry.npm === "string" && NPM_NAME_RE.test(entry.npm)) return entry.npm;
	return source.subpath !== null ? `github:${source.repo}#path:/${source.subpath}` : `github:${source.repo}`;
}
/**
* The name an entry is ALREADY installed under, or null — the server-side
* duplicate guard (#27): the same plugin listed under an alias entry must
* never install twice (two loader entries with one id brick the next boot).
*
* Identity is subpath-aware so monorepo siblings stay independent: an entry
* with a /tree/ subpath identifies as repo#path:/sub (never the bare repo),
* while an installed dependency contributes its bare repo AND its #path:
* form — so a collection root still matches the pieces it was retargeted
* into, but two different subpackages of one repo never cross-match.
*/
function findInstalledAlias(entry, installed) {
	const source = parseSourceUrl(entry.url);
	const entryRepoId = source === null ? null : source.subpath === null ? source.repo.toLowerCase() : `${source.repo.toLowerCase()}#path:/${source.subpath.toLowerCase()}`;
	const ids = new Set([entry.name.toLowerCase()]);
	if (typeof entry.npm === "string" && entry.npm !== "") ids.add(entry.npm.toLowerCase());
	if (entryRepoId !== null) ids.add(entryRepoId);
	for (const [name, spec] of Object.entries(installed)) {
		const dep = new Set([name.toLowerCase()]);
		const scoped = /^@([^/]+)\/(.+)$/.exec(name);
		if (scoped !== null) dep.add(`${scoped[1]}/${scoped[2]}`.toLowerCase());
		const m = /github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:#path:\/([A-Za-z0-9_./-]+))?/i.exec(spec);
		if (m !== null) {
			dep.add(m[1].toLowerCase());
			if (m[2] !== void 0) dep.add(`${m[1].toLowerCase()}#path:/${m[2].toLowerCase()}`);
			if (entryRepoId !== null) {
				if (dep.has(entryRepoId)) return name;
				continue;
			}
		}
		for (const id of dep) if (ids.has(id)) return name;
	}
	return null;
}
//#endregion
//#region lib/types/profile.js
/**
* Profile filesystem reads — everything the market learns from a dsh
* profile directory (manifest, lockfile, installed package trees). Pure
* functions of the directory contents; no processes, no network.
*/
/**
* Resolve a profile name to its directory under DSH_HOME (default ~/.dsh).
* An explicit directory is used by hosts, such as DSH Desktop, that own the
* active profile location rather than deriving it from process environment.
*/
function profileDir(profile, explicitDir) {
	if (explicitDir !== void 0) return explicitDir;
	return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "profiles", profile);
}
/**
* The in-box bundles dsh's profile templates install themselves — the ONLY
* names the market hides from the installed list. Community plugins may
* legitimately publish under the official scope (#28), so a whole-scope
* filter would make them invisible and fail install validation.
* (Diagnosis and fix proposed in #28 by @Lograthmic.)
*/
const INBOX_BUNDLES$1 = new Set([
	"@deepseek-ai/dsh-base",
	"@deepseek-ai/dsh-web-app",
	"@deepseek-ai/dsh-headless"
]);
/** Community dependencies of the profile (in-box bundles filtered out). */
function readInstalled(profile, explicitDir) {
	try {
		const manifest = JSON.parse(readFileSync(join(profileDir(profile, explicitDir), "package.json"), "utf8"));
		const installed = {};
		for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) if (!INBOX_BUNDLES$1.has(name)) installed[name] = spec;
		return installed;
	} catch {
		return {};
	}
}
/**
* RAW dependency map of the profile manifest — including the in-box bundles
* readInstalled() filters out. This is the rollback snapshot (#65): restoring
* a filtered view would delete @deepseek-ai/dsh-base and friends.
*/
function readManifestDeps(profile, explicitDir) {
	try {
		return { ...JSON.parse(readFileSync(join(profileDir(profile, explicitDir), "package.json"), "utf8")).dependencies };
	} catch {
		return {};
	}
}
/**
* Restore the profile manifest's dependency map to a pre-operation snapshot,
* leaving every other manifest field untouched. pnpm writes package.json
* BEFORE it finishes installing (#65, #69: a 404/blocked-build failure lands
* after the write), so a failed add leaves ghost dependencies that break
* every later pnpm run — and pnpm itself can no longer remove them (the same
* failure re-fires on any mutation). Direct manifest surgery is the only
* reliable rollback; the lockfile is left as-is (pnpm reconciles it from the
* manifest on the next run).
* @returns names whose entries were dropped or reverted, empty when nothing changed.
*/
function restoreManifestDeps(profile, snapshot, explicitDir) {
	const file = join(profileDir(profile, explicitDir), "package.json");
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return [];
	}
	const current = manifest.dependencies ?? {};
	const touched = /* @__PURE__ */ new Set();
	for (const name of Object.keys(current)) if (current[name] !== snapshot[name]) touched.add(name);
	for (const name of Object.keys(snapshot)) if (current[name] !== snapshot[name]) touched.add(name);
	if (touched.size === 0) return [];
	manifest.dependencies = { ...snapshot };
	writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
	return [...touched];
}
/** The version actually present in the profile's node_modules, or null. */
function readInstalledVersion(profile, name, explicitDir) {
	try {
		return JSON.parse(readFileSync(join(profileDir(profile, explicitDir), "node_modules", name, "package.json"), "utf8")).version ?? null;
	} catch {
		return null;
	}
}
/** The installed package manifest, or null when absent or malformed. */
function readInstalledManifest(profile, name, explicitDir) {
	try {
		return JSON.parse(readFileSync(join(profileDir(profile, explicitDir), "node_modules", name, "package.json"), "utf8"));
	} catch {
		return null;
	}
}
const PACKAGE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
function localSpecDirectory(root, spec) {
	const match = /^(?:link|file):(.+)$/i.exec(spec);
	if (match === null) return null;
	let path = match[1];
	try {
		path = decodeURIComponent(path);
	} catch {}
	if (path.startsWith("//")) return null;
	const candidate = isAbsolute(path) ? path : resolve(root, path);
	try {
		return statSync(candidate).isDirectory() ? realpathSync(candidate) : null;
	} catch {
		return null;
	}
}
function installedPackageDirectory(root, name) {
	try {
		const candidate = join(root, "node_modules", name);
		return statSync(candidate).isDirectory() ? realpathSync(candidate) : null;
	} catch {
		return null;
	}
}
function manifestAt(dir) {
	try {
		const value = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		return typeof value === "object" && value !== null ? value : null;
	} catch {
		return null;
	}
}
function manifestRepository(manifest) {
	const repository = manifest?.repository;
	if (typeof repository === "string") return {
		url: repository,
		directory: null
	};
	if (typeof repository !== "object" || repository === null) return null;
	const value = repository;
	if (typeof value.url !== "string") return null;
	return {
		url: value.url,
		directory: typeof value.directory === "string" ? value.directory : null
	};
}
function gitConfigPath(marker, worktreeRoot) {
	try {
		if (statSync(marker).isDirectory()) {
			const direct = join(marker, "config");
			return existsSync(direct) ? direct : null;
		}
		const pointer = /^gitdir:\s*(.+)$/im.exec(readFileSync(marker, "utf8"));
		if (pointer === null) return null;
		const gitDir = resolve(worktreeRoot, pointer[1].trim());
		const direct = join(gitDir, "config");
		if (existsSync(direct)) return direct;
		const common = join(resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim()), "config");
		return existsSync(common) ? common : null;
	} catch {
		return null;
	}
}
function originFromConfig(file) {
	try {
		let origin = false;
		for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
			const section = /^\s*\[remote\s+"([^"]+)"\]\s*$/.exec(line);
			if (section !== null) {
				origin = section[1] === "origin";
				continue;
			}
			if (!origin) continue;
			const url = /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
			if (url !== null) return url[1];
		}
	} catch {}
	return null;
}
function gitCheckout(start) {
	let current = start;
	while (true) {
		const marker = join(current, ".git");
		if (existsSync(marker)) {
			const config = gitConfigPath(marker, current);
			const origin = config === null ? null : originFromConfig(config);
			return origin === null ? null : {
				root: current,
				origin
			};
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
function checkoutSubpath(root, packageDir) {
	const value = relative(root, packageDir).replaceAll("\\", "/");
	return value === "" || value === "." || value.startsWith("../") ? null : value;
}
/**
* Discover declared repository identities and weaker local-origin hints. A
* package.json repository declaration is authoritative; Git origin is only a
* disambiguation hint because a checkout may legitimately point at a fork.
*/
function readInstalledRepoEvidence(profile, name, spec, explicitDir) {
	if (!PACKAGE_NAME_RE.test(name) || !/^(?:link|file):/i.test(spec)) return {
		identities: [],
		hints: []
	};
	const root = profileDir(profile, explicitDir);
	const sourceDir = localSpecDirectory(root, spec);
	const installedDir = installedPackageDirectory(root, name);
	const manifestDir = installedDir ?? sourceDir;
	const manifest = manifestDir === null ? readInstalledManifest(profile, name, explicitDir) : manifestAt(manifestDir);
	const repository = manifestRepository(typeof manifest === "object" && manifest !== null ? manifest : null);
	const checkoutDir = sourceDir ?? (installedDir !== null && /^(?:link):/i.test(spec) ? installedDir : null);
	const checkout = checkoutDir === null ? null : gitCheckout(checkoutDir);
	if (repository !== null) {
		const identities = githubRepoIdentities(repository.url, repository.directory);
		if (identities.length > 0) return {
			identities,
			hints: []
		};
	}
	if (checkout !== null) return {
		identities: [],
		hints: githubRemoteIdentities(checkout.origin, checkoutSubpath(checkout.root, checkoutDir))
	};
	return {
		identities: [],
		hints: []
	};
}
/** Pinned commit per `owner/repo` from the profile lockfile's codeload tarball URLs. */
function readLockCommits(profile, explicitDir) {
	const commits = /* @__PURE__ */ new Map();
	try {
		const lock = readFileSync(join(profileDir(profile, explicitDir), "pnpm-lock.yaml"), "utf8");
		for (const m of lock.matchAll(/codeload\.github\.com\/([^/\s]+\/[^/\s]+)\/tar\.gz\/([0-9a-f]{40})/g)) commits.set(m[1].toLowerCase(), m[2]);
	} catch {}
	return commits;
}
/** True when the installed package's manifest declares a dsh plugin surface. */
function hasDshManifest(dir) {
	try {
		return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dsh !== void 0;
	} catch {
		return false;
	}
}
/**
* True when the package's declared entry artifact actually exists — github
* source checkouts of build-required plugins ship no lib/, and promoting one
* into the bundle layer bricks the next boot (ERR_MODULE_NOT_FOUND kills the
* whole profile, #18).
*/
function entryArtifactExists(dir) {
	try {
		const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		const candidates = [];
		if (typeof manifest.main === "string") candidates.push(manifest.main);
		const rootExport = typeof manifest.exports === "string" ? manifest.exports : manifest.exports?.["."];
		if (typeof rootExport === "string") candidates.push(rootExport);
		else if (rootExport !== null && typeof rootExport === "object") {
			for (const value of Object.values(rootExport)) if (typeof value === "string") candidates.push(value);
		}
		if (candidates.length === 0) candidates.push("index.js");
		return candidates.some((rel) => existsSync(join(dir, rel)));
	} catch {
		return false;
	}
}
/**
* Package names a bundle patch mounts — the `name:` rows of the package's
* declared `dsh.bundle.patch` file. Line-wise on purpose: the strict
* hot-mount parser rejects config/expression rows, but for "what does this
* bundle bring in" any name row counts.
*/
function bundlePatchTargets(dir) {
	return readBundlePatchRows(dir).names;
}
/**
* Loader entry ids the patch INSERTS — the rows the package owns, as opposed
* to rows of OTHER plugins it merely configures (#147).
*
* A bundle patch has two kinds of entry:
*
*     - insert:                     ← rows this package brings into the tree
*         - id: vision-router
*           name: dsh-vision-router
*     - id: attachment-local        ← someone else's row, only reconfigured
*       config: { maxImageBytes: … }
*
* Treating both as "this package's rows" made disabling one plugin write
* `disabled: true` onto the official rows it tuned — killing attachments and
* the DeepSeek model with it.
*/
function bundlePatchInsertedIds(dir) {
	return readBundlePatchRows(dir).insertedIds;
}
/**
* `name:` and `id:` rows of the package's declared bundle patch. Line-wise
* on purpose: the strict hot-mount parser rejects config/expression rows,
* but for "what does this bundle bring in" any row counts. `insertedIds` is
* the subset nested under an `insert:` key (#147).
*/
/**
* Rows of one patch file. Exported because a package may ship its patch at
* the conventional path INSTEAD of declaring `dsh.bundle.patch`, and the
* patch layer has to read that one by the same rules — a second hand-rolled
* scan drifted from this one and re-introduced #147 on that path (it closed
* the insert block only on `id:` lines, so `- disable:` followed by nested
* ids claimed the neighbour's rows).
*/
function parsePatchRows(text) {
	const names = [];
	const ids = [];
	const insertedIds = [];
	{
		let insertIndent = null;
		for (const raw of text.split(/\r?\n/)) {
			const line = raw.replace(/#.*$/, "");
			if (line.trim() === "") continue;
			const indent = line.length - line.trimStart().length;
			if (insertIndent !== null && indent <= insertIndent && !/^\s*-?\s*(id|name|config):/u.test(line)) insertIndent = null;
			if (/^\s*-?\s*insert:\s*$/u.test(line)) {
				insertIndent = indent;
				continue;
			}
			const name = /^\s*-?\s*name:\s*['"]?([^'"\s]+)/.exec(line);
			if (name !== null && !names.includes(name[1])) names.push(name[1]);
			const id = /^\s*-?\s*id:\s*['"]?([^'"\s]+)/.exec(line);
			if (id !== null) {
				if (!ids.includes(id[1])) ids.push(id[1]);
				if (insertIndent !== null && indent > insertIndent) {
					if (!insertedIds.includes(id[1])) insertedIds.push(id[1]);
				} else if (indent <= (insertIndent ?? -1)) insertIndent = null;
			}
		}
	}
	return {
		names,
		ids,
		insertedIds
	};
}
/** Rows of the patch a package DECLARES through `dsh.bundle.patch`. */
function readBundlePatchRows(dir) {
	const empty = {
		names: [],
		ids: [],
		insertedIds: []
	};
	try {
		const declared = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dsh?.bundle?.patch;
		if (typeof declared !== "string" || declared === "") return empty;
		return parsePatchRows(readFileSync(join(dir, declared), "utf8"));
	} catch {
		return empty;
	}
}
/** The profile manifest's `dsh.profile.bundles` — what the CLI reconciled. */
function readProfileBundles(profileDirectory) {
	try {
		const bundles = JSON.parse(readFileSync(join(profileDirectory, "package.json"), "utf8")).dsh?.profile?.bundles;
		return Array.isArray(bundles) ? bundles.filter((name) => typeof name === "string") : [];
	} catch {
		return [];
	}
}
/**
* Write the profile manifest atomically: a temp file in the same directory is
* written first, then renamed over package.json, so a crash mid-toggle never
* leaves a half-written manifest (the same guarantee order.ts's writer gives
* the reorder path). The trailing newline + 2-space indent match how every
* other writer in this repo serializes the manifest.
*/
function writeManifestAtomic(manifestPath, manifest) {
	const temp = `${manifestPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
	renameSync(temp, manifestPath);
}
/**
* Drop one bundle from the profile manifest's `dsh.profile.bundles`, leaving
* the package installed as a dependency. This is the carrier-bundle half of a
* toggle-off (#224): a bundle whose patch reconfigures plugins it does NOT own
* (dsh-postgres-backends disables session-persistence-jsonl and reroutes
* storage-domain) keeps applying those side-effect rows on every boot while it
* stays in the stack, and the #147 ownership rule deliberately never writes
* them — so removing the bundle from the stack is the only thing that stops
* them all at once. The package itself stays installed; enabling re-adds it.
* @returns true when the bundle was present and removed.
*/
function removeProfileBundle(profileDirectory, name) {
	const manifestPath = join(profileDirectory, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const bundles = manifest.dsh?.profile?.bundles;
	if (!Array.isArray(bundles)) return false;
	const next = bundles.filter((entry) => typeof entry !== "string" || entry !== name);
	if (next.length === bundles.length) return false;
	manifest.dsh ??= {};
	manifest.dsh.profile ??= {};
	manifest.dsh.profile.bundles = next;
	writeManifestAtomic(manifestPath, manifest);
	return true;
}
/**
* Re-add a bundle to `dsh.profile.bundles` after a carrier toggle-off (#224).
* Idempotent: a bundle already present is left untouched. The name is appended
* (the install flow appends too); the loader re-validates ordering on the next
* composition, so a declared before/after rule surfaces there rather than here.
* @returns true when the bundle was added, false when it was already present.
*/
function addProfileBundle(profileDirectory, name) {
	const manifestPath = join(profileDirectory, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.dsh ??= {};
	manifest.dsh.profile ??= {};
	const existing = manifest.dsh.profile.bundles;
	const bundles = Array.isArray(existing) ? existing.filter((entry) => typeof entry === "string") : [];
	if (bundles.includes(name)) return false;
	bundles.push(name);
	manifest.dsh.profile.bundles = bundles;
	writeManifestAtomic(manifestPath, manifest);
	return true;
}
/**
* Loader entry ids a newly added package would collide on with bundles the
* profile ALREADY loads (#122).
*
* Cordis hard-fails the whole tree on a duplicate id, so this is not a
* cosmetic conflict: installing a TUI bundle into a web profile (both
* declare `id: storage`) leaves DSH unable to start at all, with an error
* naming neither plugin. Checked against the profile's own bundle list so a
* package is never compared with itself.
* @returns colliding ids mapped to the already-installed bundle that owns them.
*/
function conflictingEntryIds(profileDirectory, candidate, installedBundles) {
	const mine = bundlePatchInsertedIds(join(profileDirectory, "node_modules", candidate));
	if (mine.length === 0) return [];
	const conflicts = [];
	for (const bundle of installedBundles) {
		if (bundle === candidate) continue;
		const theirs = new Set(bundlePatchInsertedIds(join(profileDirectory, "node_modules", bundle)));
		for (const id of mine) if (theirs.has(id) && !conflicts.some((hit) => hit.id === id)) conflicts.push({
			id,
			owner: bundle
		});
	}
	return conflicts;
}
/**
* Whether the loader has anything to load for this package: its own entry
* artifact, or — for CARRIER bundles — patch rows naming other packages that
* do have one.
*
* Carriers are why `entryArtifactExists` alone is the wrong test (#103):
* `@linxin666/dsh-skins` ships skin assets plus a patch mounting
* `@linxin666/dsh-client-ui-skin-center`, and declares no main/exports/
* index.js of its own. Judged by its own entry it looks like the
* source-only checkout the #18 guard removes — so the market both flagged it
* broken AND uninstalled it right after installing.
* @param profileDirectory - resolved profile directory (host-authoritative under Desktop).
* @param name - installed package name.
*/
function hasLoadableEntry(profileDirectory, name) {
	const dir = join(profileDirectory, "node_modules", name);
	if (entryArtifactExists(dir)) return true;
	const workspaceRoot = dirname(profileDirectory);
	return bundlePatchTargets(dir).filter((target) => target !== name).some((target) => entryArtifactExists(join(profileDirectory, "node_modules", target)) || entryArtifactExists(join(dir, "node_modules", target)) || entryArtifactExists(join(workspaceRoot, "node_modules", target)));
}
/** Plugin subdirectories (depth 2) of a collection checkout, as relative paths. */
function pluginSubdirs(root) {
	const found = [];
	let level1 = [];
	try {
		level1 = readdirSync(root, { withFileTypes: true }).filter((dirent) => dirent.isDirectory() && /^[A-Za-z0-9_.-]+$/.test(dirent.name) && dirent.name !== "node_modules").map((dirent) => dirent.name);
	} catch {
		return found;
	}
	for (const sub of level1) {
		if (hasDshManifest(join(root, sub))) {
			found.push(sub);
			continue;
		}
		try {
			for (const inner of readdirSync(join(root, sub), { withFileTypes: true })) {
				if (!inner.isDirectory() || !/^[A-Za-z0-9_.-]+$/.test(inner.name) || inner.name === "node_modules") continue;
				if (hasDshManifest(join(root, sub, inner.name))) found.push(`${sub}/${inner.name}`);
			}
		} catch {}
		if (found.length >= 8) break;
	}
	return found.slice(0, 8);
}
/**
* Allow the given packages' build scripts in the profile's
* pnpm-workspace.yaml `allowBuilds` block (the key dsh profiles use),
* merging with existing entries and leaving the rest of the yaml intact.
* (#6 by @qichuang321.)
* @returns every package now allowed.
*/
/**
* Quote a YAML block-mapping key when a plain scalar would be invalid.
* Scoped npm names start with `@` — a reserved YAML indicator — so an
* unquoted `@scope/pkg: true` entry breaks the whole pnpm-workspace.yaml
* for every later pnpm run in the profile (and for the market itself).
* Keys containing `: ` or ending with `:` are quoted for the same reason;
* git keys like `name@git+https://…` keep their existing plain form.
*/
function quoteYamlKey(key) {
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(key) || /:(\s|$)/.test(key)) return `'${key.replace(/'/g, "''")}'`;
	return key;
}
/**
* Allow the given packages' build scripts in the profile's
* pnpm-workspace.yaml `allowBuilds` block (the key dsh profiles use),
* merging with existing entries and leaving the rest of the yaml intact.
* (#6 by @qichuang321.)
* @returns every package now allowed.
*/
function setAllowBuilds(profile, packages, explicitDir) {
	const file = join(profileDir(profile, explicitDir), "pnpm-workspace.yaml");
	let yaml = "";
	try {
		yaml = readFileSync(file, "utf8");
	} catch {}
	const blockRe = /allowBuilds:[ \t]*\r?\n((?:[ \t]+[^\r\n]*\r?\n?)*)/g;
	const map = {};
	const blockMatches = [...yaml.matchAll(blockRe)];
	const blockMatch = blockMatches[0] ?? null;
	for (const match of blockMatches) for (const line of match[1].split(/\r?\n/)) {
		const m = /^[ \t]+(\S.*?)\s*:\s*(true|false)?\s*$/.exec(line);
		if (m === null || m[1] === "") continue;
		let key = m[1];
		if (key.length >= 2 && (key[0] === "'" && key[key.length - 1] === "'" || key[0] === "\"" && key[key.length - 1] === "\"")) key = key.slice(1, -1);
		map[key] = m[2] ?? "true";
	}
	const GIT_KEY_RE = /^[A-Za-z0-9@/_.-]+@git\+https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
	for (const pkg of packages) if (/^[A-Za-z0-9@/_.-]+$/.test(pkg) || GIT_KEY_RE.test(pkg)) map[pkg] = "true";
	const eol = /\r\n/.test(yaml) ? "\r\n" : "\n";
	const blockText = `allowBuilds:${eol}${Object.entries(map).map(([k, v]) => `  ${quoteYamlKey(k)}: ${v}`).join(eol)}${eol}`;
	let next;
	if (blockMatch === null) next = `${yaml.replace(/\r?\n?$/, eol)}${blockText}`;
	else {
		let seen = 0;
		next = yaml.replace(blockRe, () => seen++ === 0 ? blockText : "");
	}
	writeFileSync(file, next);
	return Object.keys(map);
}
//#endregion
//#region lib/types/dsh-cli.js
/**
* Process layer: re-invoking the dsh CLI that launched this host, spawning
* `dsh plugin` commands with timeouts and live progress, and provisioning
* pnpm. This is the only module that starts child processes.
*
* Installs run through node:child_process, not ctx.shell: the shell service is
* the agent's sandboxed executor and denies writes to the profile directory.
*/
/**
* macOS apps launched from Finder/Dock inherit a minimal PATH without the
* shell profile — Homebrew/npm/corepack all vanish and every install dies
* with ENOENT/127 (#32, #38). Append the well-known bin directories so the
* market's children find their tools regardless of how dsh was started.
*/
/**
* Directories discovered at runtime that hold a usable pnpm — currently
* npm's global bin, learned after a successful one-click setup (#149).
* Every later spawn sees them, so the market does not have to be restarted
* for the pnpm it just installed to become visible.
*/
const extraPathDirs = [];
/**
* The real Node executable for spawning children. On Android the kernel runs
* node through the dynamic linker, so `process.execPath` is
* `/apex/.../linker64` — spawning IT with `--expose-internals` makes the
* linker treat the flag as the program path and die with
* `error: expected absolute path: "--expose-internals"`. `process.argv0`
* carries the real node binary; prefer it whenever it is an existing
* absolute path, and fall back to execPath everywhere else.
* @param argv0 - `process.argv0`, injectable for tests.
* @param execPath - `process.execPath`, injectable for tests.
*/
function nodeExecutable(argv0 = process.argv0, execPath = process.execPath) {
	if (argv0 !== void 0 && argv0 !== "" && isAbsolute(argv0) && existsSync(argv0)) return argv0;
	return execPath;
}
/**
* The directory holding the Node binary running this process. `npm`,
* `npm.cmd` and `corepack` are installed alongside it by every official Node
* distribution, so it is the one place the toolchain can be looked for
* without guessing — and unlike a PATH entry it cannot be absent, because
* this process is executing out of it.
*
* #167: a Windows desktop host spawned dsh without the Node install
* directory on PATH. Node itself was running (v24.18.1 in the log) while
* both `corepack` and `npm` came back "not recognized as an internal or
* external command", so the one-click setup had no way to succeed.
*/
const nodeBinDir = dirname(nodeExecutable());
/**
* Translate the machine's proxy environment into the ONE form pnpm reads.
*
* `HTTPS_PROXY` / `http_proxy` are what every other tool honours, and what
* `net.ts` already routes the market's own catalog fetches through — but
* pnpm ignores them completely. It reads npm config, so a proxy reaches it
* only as `npm_config_https_proxy` / `npm_config_proxy` (or an .npmrc entry,
* which is the user's file and not ours to rewrite).
*
* That gap is why the market could load its catalog through a proxy and
* then hang installing anything at all — reported four separate times
* (#148, #161, #188, #232), always from a network that needs one.
*
* An `npm_config_*` value the caller already set always wins: it is the more
* specific statement of intent, and on Windows env keys are case-insensitive
* so the check has to be too. NO_PROXY is forwarded verbatim because pnpm
* reads `npm_config_noproxy` and a host excluding its own registry mirror
* must keep excluding it.
*/
function proxyEnvForPnpm(env = process.env) {
	const has = (name) => {
		const wanted = name.toLowerCase();
		return Object.keys(env).some((key) => key.toLowerCase() === wanted && (env[key] ?? "").trim() !== "");
	};
	const pick = (...names) => {
		for (const name of names) {
			const raw = env[name];
			if (raw !== void 0 && raw.trim() !== "") return raw.trim();
		}
		return null;
	};
	const out = {};
	const https = pick("https_proxy", "HTTPS_PROXY") ?? pick("http_proxy", "HTTP_PROXY");
	const http = pick("http_proxy", "HTTP_PROXY") ?? https;
	if (https !== null && !has("npm_config_https_proxy")) out.npm_config_https_proxy = https;
	if (http !== null && !has("npm_config_proxy")) out.npm_config_proxy = http;
	const noProxy = pick("no_proxy", "NO_PROXY");
	if (noProxy !== null && !has("npm_config_noproxy")) out.npm_config_noproxy = noProxy;
	return out;
}
function spawnEnv() {
	const separator = process.platform === "win32" ? ";" : ":";
	const parts = (process.env.PATH ?? "").split(separator).filter((part) => part !== "");
	const candidates = process.platform === "win32" ? [nodeBinDir, ...extraPathDirs] : [
		"/opt/homebrew/bin",
		"/usr/local/bin",
		join(homedir(), ".local", "bin"),
		nodeBinDir,
		...extraPathDirs
	];
	for (const bin of candidates) if (!parts.includes(bin)) parts.push(bin);
	return {
		...process.env,
		...proxyEnvForPnpm(),
		CI: "true",
		PATH: parts.join(separator)
	};
}
const INSTALL_TIMEOUT_MS = Number(process.env.DSH_MARKET_INSTALL_TIMEOUT_MS) || 900 * 1e3;
/**
* Windows npm/corepack/pnpm are `.cmd` shims. Node's `spawn` without a shell
* cannot start them (ENOENT / EINVAL). Same pattern as dsh's `plugin` forwarder.
*/
const winCmdShim = process.platform === "win32";
/** Characters cmd.exe treats as syntax even inside a token. */
const CMD_METACHARS = /[\s"&|<>^()%!]/;
/**
* Quote one argv token for a cmd.exe `/c` command line. cmd only groups with
* double quotes, so a token that needs quoting gets wrapped and embedded
* quotes are doubled.
*/
function quoteCmdArg(arg) {
	if (!CMD_METACHARS.test(arg)) return arg;
	return `"${arg.replace(/"/g, "\"\"")}"`;
}
/**
* Build a cmd.exe command line from argv. Only the Windows shim path uses
* this: cmd re-parses the joined string, so every token is quoted before
* joining.
*/
function cmdCommandLine(argv) {
	return argv.map(quoteCmdArg).join(" ");
}
/** cmd.exe resolved once; the Windows shim path only. */
const COMSPEC = process.env.ComSpec ?? "cmd.exe";
/**
* Spawn a command, avoiding Node's deprecated `shell: true` + argv
* combination (DEP0190). Windows `.cmd` shims cannot start without a shell,
* so the shim path routes through `cmd.exe /d /s /c` with an explicitly
* built, quoted command line; every other invocation spawns directly with
* `shell: false`.
*/
function spawnShim(file, args, options) {
	const { viaShell = false, ...spawnOptions } = options;
	if (!viaShell) return spawn(file, [...args], {
		...spawnOptions,
		shell: false
	});
	if (process.platform !== "win32") return spawn(file, [...args], {
		...spawnOptions,
		shell: false
	});
	return spawn(COMSPEC, [
		"/d",
		"/s",
		"/c",
		`"${cmdCommandLine([file, ...args])}"`
	], {
		...spawnOptions,
		shell: false,
		windowsVerbatimArguments: true
	});
}
/**
* Argv re-invoking the CLI that launched this host process, so installs work
* whether dsh runs from a global bin, a local install, or repo source
* (`node --import tsx/esm .../bin.ts`). Falls back to a PATH `dsh`.
*/
function dshArgv() {
	const entry = process.argv[1];
	if (entry !== void 0 && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
		const abs = resolve(entry);
		return {
			file: nodeExecutable(),
			args: [...process.execArgv, abs],
			cwd: dirname(abs),
			viaShell: false
		};
	}
	return {
		file: "dsh",
		args: [],
		cwd: void 0,
		viaShell: winCmdShim
	};
}
/**
* Kill a spawned child and, on Windows, its whole process tree — `kill()`
* there only terminates the wrapper, leaving pnpm children running.
* (Contributed in #7 by @mraing.)
*/
function killChild(child) {
	if (process.platform === "win32" && child.pid !== void 0) try {
		spawn("taskkill", [
			"/pid",
			String(child.pid),
			"/t",
			"/f"
		], { stdio: "ignore" });
		return;
	} catch {}
	child.kill("SIGKILL");
}
/** The child of the operation currently running, for /dsh-market/cancel. */
let activeChild = null;
let cancelRequested = false;
let activeDesktopOperation = null;
/**
* Kill a child and its whole tree, gracefully where the platform allows:
* taskkill /T /F on Windows (plain kill() leaves pnpm children running),
* SIGTERM with a 5s SIGKILL escalation elsewhere so pnpm can clean up.
* (Cancel flow contributed in #6 by @qichuang321.)
*/
function killTree(child) {
	if (process.platform === "win32" && child.pid !== void 0) try {
		spawn("taskkill", [
			"/pid",
			String(child.pid),
			"/t",
			"/f"
		], { stdio: "ignore" });
		return;
	} catch {}
	const signalTree = (signal) => {
		if (child.pid === void 0) return;
		try {
			process.kill(-child.pid, signal);
		} catch {
			try {
				child.kill(signal);
			} catch {}
		}
	};
	signalTree("SIGTERM");
	setTimeout(() => signalTree("SIGKILL"), 5e3).unref?.();
}
/**
* Cancel the plugin command currently running.
* @returns true when there was one to cancel.
*/
function cancelActive() {
	if (activeDesktopOperation !== null) {
		activeDesktopOperation.userCancelled = true;
		progress.cancelling = true;
		activeDesktopOperation.cancel();
		return true;
	}
	if (activeChild === null) return false;
	cancelRequested = true;
	progress.cancelling = true;
	killTree(activeChild);
	return true;
}
/** Whether `pnpm` resolves on PATH; success is cached, absence is re-probed. */
let pnpmReady = false;
/** Probe `pnpm --version` on PATH. */
function probePnpm() {
	if (pnpmReady) return Promise.resolve(true);
	return new Promise((resolvePromise) => {
		const child = spawnShim("pnpm", ["--version"], {
			stdio: "ignore",
			viaShell: winCmdShim,
			env: spawnEnv()
		});
		child.on("error", () => resolvePromise(false));
		child.on("close", (code) => {
			pnpmReady = code === 0;
			resolvePromise(pnpmReady);
		});
	});
}
function runQuiet(file, args, timeoutMs) {
	return new Promise((resolvePromise) => {
		const child = spawnShim(file, args, {
			env: spawnEnv(),
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			viaShell: winCmdShim
		});
		let output = "";
		const timer = setTimeout(() => killChild(child), timeoutMs);
		const collect = (chunk) => {
			output = (output + chunk.toString()).slice(-8 * 1024);
		};
		child.stdout?.on("data", collect);
		child.stderr?.on("data", collect);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolvePromise({
				code: 127,
				output: error.message
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolvePromise({
				code,
				output
			});
		});
	});
}
/**
* Provision pnpm without user involvement: corepack (ships with Node) first,
* a global npm install as fallback.
* @returns true when `pnpm --version` succeeds afterwards.
*/
async function provisionPnpm() {
	const corepack = await runQuiet("corepack", ["enable", "pnpm"], 60 * 1e3);
	logEvent(corepack.code === 0 ? "info" : "warn", "setup-pnpm", `corepack enable: exit=${String(corepack.code)} ${corepack.output.slice(-200)}`);
	if (await probePnpm()) return { ok: true };
	const npm = await runQuiet("npm", [
		"install",
		"-g",
		"pnpm"
	], 180 * 1e3);
	logEvent(npm.code === 0 ? "info" : "error", "setup-pnpm", `npm -g: exit=${String(npm.code)} ${npm.output.slice(-200)}`);
	if (await probePnpm()) return { ok: true };
	if (npm.code === 0 || corepack.code === 0) {
		const prefix = await runQuiet("npm", ["prefix", "-g"], 30 * 1e3);
		const bin = prefix.code === 0 ? join(prefix.output.trim().split("\n").pop() ?? "", "bin") : "";
		if (bin !== "" && isAbsolute(bin) && !extraPathDirs.includes(bin)) {
			extraPathDirs.push(bin);
			logEvent("info", "setup-pnpm", `added npm's global bin to the probe path: ${bin}`);
			if (await probePnpm()) return { ok: true };
			extraPathDirs.pop();
		}
	}
	const npmFound = toolOnPath("npm");
	if (!npmFound) logEvent("warn", "setup-pnpm", `npm is not on any searched path (node lives in ${nodeBinDir})`);
	return {
		ok: false,
		hint: provisionHint(corepack.output, npm.output, npmFound)
	};
}
/** Executable suffixes a bare command name can carry on this platform. */
const EXECUTABLE_SUFFIXES = process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((part) => part !== "") : [""];
/**
* Whether a bare command name resolves to a file on the PATH the market
* hands its children.
*
* The market cannot read the reason a spawn failed out of the child's
* message: cmd.exe reports a missing command in the console's ANSI codepage
* ("'npm' 不是内部或外部命令" on a Chinese Windows), which is neither the
* string `ENOENT` nor even valid UTF-8 — so the #32 hint, written against
* Node's own ENOENT wording, could never fire on Windows and the user was
* left with no guidance at all (#167). Looking on disk answers the same
* question in every locale.
*/
function toolOnPath(name) {
	const separator = process.platform === "win32" ? ";" : ":";
	for (const dir of (spawnEnv().PATH ?? "").split(separator)) {
		if (dir === "") continue;
		for (const suffix of EXECUTABLE_SUFFIXES) if (existsSync(join(dir, name + suffix))) return true;
	}
	return false;
}
/**
* Why the one-click pnpm setup failed, in terms the user can act on.
*
* Every one of these was a real report where the market said only "自动准备
* 没成功" while the log held the actual cause: EEXIST (#142 — corepack had
* already placed a pnpm shim, so `npm -g` refused to overwrite it), EPERM
* (#108 — Node installed somewhere the user cannot write), ENOENT (#32 —
* a GUI launch with no Node on PATH at all).
* @returns a bilingual, actionable hint, or undefined when unrecognized.
*/
function provisionHint(corepackOutput, npmOutput, npmFound = true) {
	if (!npmFound || /ENOENT/.test(corepackOutput) && /ENOENT/.test(npmOutput)) return `这台机器的 dsh 进程找不到 npm/corepack（图形界面或桌面端启动时不继承终端 PATH）。已在 Node 自己的目录里找过（${nodeBinDir}）也没有——多半是宿主内置的 Node 运行时不带 npm。请改从终端启动 dsh，或单独装一个 pnpm：Windows 用 iwr https://get.pnpm.io/install.ps1 -useb | iex，macOS/Linux 用 brew install pnpm / This dsh process cannot find npm/corepack (GUI and desktop launches skip your shell PATH). The directory Node itself runs from (${nodeBinDir}) was searched too — a bundled Node runtime without npm is the usual cause. Start dsh from a terminal, or install pnpm on its own: \`iwr https://get.pnpm.io/install.ps1 -useb | iex\` (Windows) or \`brew install pnpm\` (macOS/Linux)`;
	if (/EEXIST|already exists|--force to overwrite/i.test(npmOutput)) return "pnpm 的可执行文件已存在（通常是 corepack 先放好了同名 shim），npm 拒绝覆盖。在终端里执行其一即可：corepack prepare pnpm@latest --activate（推荐，直接激活已有 shim）或 npm i -g pnpm --force / A pnpm executable already exists (usually a corepack shim), so npm refused to overwrite it. Run one of these in a terminal: `corepack prepare pnpm@latest --activate` (preferred — activates the shim already there) or `npm i -g pnpm --force`";
	if (/EPERM|EACCES|permission denied|as root\/Administrator/i.test(`${corepackOutput}\n${npmOutput}`)) return "没有权限写入 Node 的安装目录。请用管理员/sudo 执行一次 npm i -g pnpm，或改用无需写系统目录的安装方式：macOS/Linux 用 brew install pnpm，Windows 用 iwr https://get.pnpm.io/install.ps1 -useb | iex / No permission to write into the Node install directory. Run `npm i -g pnpm` once as Administrator/sudo, or install pnpm without touching system dirs: `brew install pnpm` (macOS/Linux) or `iwr https://get.pnpm.io/install.ps1 -useb | iex` (Windows)";
	if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|proxy|certificate/i.test(`${corepackOutput}\n${npmOutput}`)) return "装 pnpm 时网络失败。若你在受限网络下，corepack 的 shim 也下载不到 pnpm 本体——请改用完整安装或指定镜像：brew install pnpm（macOS/Linux），或 npm i -g pnpm --registry <你的镜像> / Network failure while installing pnpm. On a restricted network the corepack shim cannot download pnpm either — install it fully or point at a mirror: `brew install pnpm`, or `npm i -g pnpm --registry <your mirror>`";
}
/** Singleton progress state; the status route reads it, runDshPlugin writes it. */
const progress = {
	active: false,
	target: "",
	startedAt: 0,
	lastLine: "",
	phase: null,
	done: 0,
	total: null,
	currentPackage: null,
	downloaded: null,
	size: null,
	ndjson: false,
	error: null,
	cancelling: false
};
/** Identifies this host process; the client scopes its pending-restart flags to it. */
const BOOT_ID = `${String(process.pid)}-${String(Date.now())}`;
/**
* Central allowlist for every spawn target, regardless of which route built
* it (defense in depth on top of per-route validation — the win32 bare-dsh
* fallback runs through a shell). Suggested in #16 by @anupamme.
*
* `^`, `~` and `=` are intentionally allowed: restore/install flows turn
* manifest specs such as "dsh-better-sidebar": "^0.14.0" into targets like
* `dsh-better-sidebar@^0.14.0`, and regex-valid semver ranges must not be
* mistaken for shell injection (whitespace and shell metacharacters remain
* rejected — the win32 bare-dsh fallback is the reason to keep them out).
*/
const TARGET_RE = /^[A-Za-z0-9@:./_#+~^=-]+$/;
/** Mutating pnpm commands get the structured reporter appended. */
const NDJSON_COMMANDS = new Set([
	"add",
	"remove",
	"install"
]);
/** Apply profile-specific pnpm compatibility and the structured reporter. */
function preparePluginArgs(profileDirectory, pluginArgs) {
	let args = pluginArgsFor(profileDirectory, [...pluginArgs]);
	const target = args[args.length - 1] ?? "";
	if (!TARGET_RE.test(target)) return { error: `unsafe plugin target rejected: ${JSON.stringify(target)}` };
	if (NDJSON_COMMANDS.has(args[0])) args = [...args, "--reporter=ndjson"];
	return {
		args,
		target
	};
}
/** Reset the singleton status snapshot before one operation starts. */
function beginProgress(target) {
	progress.active = true;
	progress.target = target;
	progress.startedAt = Date.now();
	progress.lastLine = "";
	progress.phase = null;
	progress.done = 0;
	progress.total = null;
	progress.currentPackage = null;
	progress.downloaded = null;
	progress.size = null;
	progress.ndjson = false;
	progress.error = null;
	progress.cancelling = false;
	return createProgressTracker();
}
/**
* Line-buffered progress feed: pnpm's ndjson reporter emits one JSON object
* per line on stdout, and chunk boundaries can split a line. Human fallback
* lines (older pnpm without structured events) still update `lastLine`.
*/
function makeProgressFeeder(tracker) {
	let lineBuffer = "";
	return (chunk) => {
		lineBuffer += chunk;
		let nl;
		while ((nl = lineBuffer.indexOf("\n")) !== -1) {
			const line = lineBuffer.slice(0, nl);
			lineBuffer = lineBuffer.slice(nl + 1);
			const trimmed = line.trim();
			if (trimmed === "") continue;
			tracker.feed(trimmed);
			if (!trimmed.startsWith("{")) progress.lastLine = trimmed.slice(0, 200);
		}
	};
}
/** Run one `dsh plugin --profile <p> …` command with timeout and progress tracking. */
function runDshPlugin(profile, pluginArgs) {
	const { file, args, cwd, viaShell } = dshArgv();
	const prepared = preparePluginArgs(profileDir(profile), pluginArgs);
	if ("error" in prepared) {
		logEvent("error", "install", prepared.error);
		return Promise.resolve({
			exitCode: 1,
			timedOut: false,
			stdout: "",
			stderr: prepared.error,
			cancelled: false
		});
	}
	pluginArgs = prepared.args;
	const tracker = beginProgress(prepared.target);
	const feed = makeProgressFeeder(tracker);
	return new Promise((resolvePromise) => {
		const child = spawnShim(file, [
			...args,
			"plugin",
			"--profile",
			profile,
			...pluginArgs
		], {
			cwd,
			env: spawnEnv(),
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			viaShell,
			detached: process.platform !== "win32"
		});
		activeChild = child;
		cancelRequested = false;
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, INSTALL_TIMEOUT_MS);
		child.stdout?.on("data", (chunk) => {
			const text = chunk.toString();
			stdout = (stdout + text).slice(-256 * 1024);
			feed(text);
			syncProgress(tracker);
		});
		child.stderr?.on("data", (chunk) => {
			const text = chunk.toString();
			stderr = (stderr + text).slice(-64 * 1024);
			feed(text);
			syncProgress(tracker);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			progress.active = false;
			progress.cancelling = false;
			if (activeChild === child) activeChild = null;
			resolvePromise({
				exitCode: 127,
				timedOut: false,
				stdout,
				stderr: `${stderr}\n${error.message}`,
				cancelled: false
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			progress.active = false;
			progress.cancelling = false;
			if (activeChild === child) activeChild = null;
			if (code !== 0 || timedOut) progress.error = tracker.snapshot.error;
			const ignoredBuilds = tracker.snapshot.ignoredBuilds;
			const { error: pnpmError, errorCode: pnpmErrorCode } = tracker.snapshot;
			resolvePromise({
				exitCode: code,
				timedOut,
				stdout,
				stderr,
				cancelled: cancelRequested,
				...pnpmError !== null ? { pnpmError } : {},
				...pnpmErrorCode !== null ? { pnpmErrorCode } : {},
				...ignoredBuilds.length > 0 ? { ignoredBuilds } : {}
			});
		});
	});
}
/**
* Adapt DSH Desktop's generation-scoped package manager to the existing
* market runner. There is no runtime import or dependency on Desktop: the
* Host supplies this public service only when the package is mounted there.
*/
function createDesktopPluginRuntime(service, activeProfileDir, invokingDir = process.cwd(), timeoutMs = INSTALL_TIMEOUT_MS) {
	if (!isAbsolute(activeProfileDir) || activeProfileDir.includes("\0")) throw new Error("dsh-market: Desktop profile directory must be an absolute path without NUL");
	if (!isAbsolute(invokingDir) || invokingDir.includes("\0")) throw new Error("dsh-market: Desktop invoking directory must be an absolute path without NUL");
	const owner = Symbol("dsh-market desktop runtime");
	let closed = false;
	const runPlugin = async (_profile, pluginArgs) => {
		if (closed) return {
			exitCode: 127,
			timedOut: false,
			stdout: "",
			stderr: "dsh-market: Desktop package runtime is disposed",
			cancelled: false
		};
		const prepared = preparePluginArgs(activeProfileDir, pluginArgs);
		if ("error" in prepared) {
			logEvent("error", "install", prepared.error);
			return {
				exitCode: 1,
				timedOut: false,
				stdout: "",
				stderr: prepared.error,
				cancelled: false
			};
		}
		const abort = new AbortController();
		let handle;
		try {
			handle = service.runPlugin(prepared.args, invokingDir, abort.signal);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				exitCode: 127,
				timedOut: false,
				stdout: "",
				stderr: message,
				cancelled: false,
				.../another desktop pnpm operation is already running/i.test(message) ? { busy: true } : {}
			};
		}
		const tracker = beginProgress(prepared.target);
		const feed = makeProgressFeeder(tracker);
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const collectStdout = (chunk) => {
			const text = chunk.toString();
			stdout = (stdout + text).slice(-256 * 1024);
			feed(text);
			syncProgress(tracker);
		};
		const collectStderr = (chunk) => {
			const text = chunk.toString();
			stderr = (stderr + text).slice(-64 * 1024);
			feed(text);
			syncProgress(tracker);
		};
		handle.stdout.on("data", collectStdout);
		handle.stderr.on("data", collectStderr);
		let active;
		let timer;
		const done = (async () => {
			try {
				const outcome = await handle.done;
				if (outcome.exitCode !== 0 || outcome.signal !== null || timedOut) progress.error = tracker.snapshot.error;
				const ignoredBuilds = tracker.snapshot.ignoredBuilds;
				const { error: pnpmError, errorCode: pnpmErrorCode } = tracker.snapshot;
				return {
					exitCode: outcome.exitCode,
					timedOut,
					stdout,
					stderr,
					cancelled: active.userCancelled,
					...ignoredBuilds.length > 0 ? { ignoredBuilds } : {},
					...pnpmError !== null ? { pnpmError } : {},
					...pnpmErrorCode !== null ? { pnpmErrorCode } : {}
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				progress.error = tracker.snapshot.error;
				return {
					exitCode: 127,
					timedOut,
					stdout,
					stderr: `${stderr}${stderr === "" ? "" : "\n"}${message}`,
					cancelled: active.userCancelled
				};
			} finally {
				if (timer !== void 0) clearTimeout(timer);
				progress.active = false;
				progress.cancelling = false;
				handle.stdout.off("data", collectStdout);
				handle.stderr.off("data", collectStderr);
				if (activeDesktopOperation === active) activeDesktopOperation = null;
			}
		})();
		active = {
			owner,
			cancel: () => {
				handle.cancel();
			},
			done,
			userCancelled: false
		};
		activeDesktopOperation = active;
		timer = setTimeout(() => {
			timedOut = true;
			abort.abort(/* @__PURE__ */ new Error("dsh-market: Desktop package operation timed out"));
			handle.cancel();
		}, timeoutMs);
		timer.unref?.();
		return done;
	};
	const cancelOwned = (userCancelled) => {
		const active = activeDesktopOperation;
		if (active?.owner !== owner) return false;
		if (userCancelled) active.userCancelled = true;
		progress.cancelling = true;
		active.cancel();
		return true;
	};
	return {
		runPlugin,
		probePnpm: () => Promise.resolve(true),
		provisionPnpm: () => Promise.resolve({ ok: true }),
		cancelActive: () => cancelOwned(true),
		dispose: async () => {
			closed = true;
			const active = activeDesktopOperation;
			if (active?.owner !== owner) return;
			cancelOwned(false);
			await active.done.catch(() => {});
		}
	};
}
/** Copy the tracker's snapshot into the singleton the status route reads. */
function syncProgress(tracker) {
	const snap = tracker.snapshot;
	progress.phase = snap.phase;
	progress.done = snap.done;
	progress.total = snap.total;
	progress.currentPackage = snap.currentPackage;
	progress.downloaded = snap.downloaded;
	progress.size = snap.size;
	progress.ndjson = snap.seen;
	if (snap.error !== null) progress.error = snap.error;
}
//#endregion
//#region lib/types/net.js
/**
* Outbound HTTP for the market's own server-side calls.
*
* Node's global `fetch` ignores `HTTP_PROXY` / `HTTPS_PROXY` entirely
* (measured on Node 25: a request with an unreachable proxy configured still
* succeeds directly, and setting `NODE_USE_ENV_PROXY` at runtime changes
* nothing — it is read at startup). On a machine whose route out is a local
* proxy, that is not a slowdown but a different network: the catalog fetch
* took 9.9s direct on a reporter's machine, seconds from the 15s timeout,
* while their proxy sat unused a millisecond away.
*
* `setGlobalDispatcher` from the `undici` PACKAGE cannot fix this, because
* `globalThis.fetch` runs on Node's INTERNAL copy of undici — a different
* instance. Verified: with a dispatcher installed, a global fetch still
* produced no CONNECT at a local proxy, while undici's own fetch produced
* `CONNECT awesome-dsh-plugin.com:443`.
*
* So the market calls undici's fetch with an explicit dispatcher. The scope
* is deliberate: only requests made by this module change, and the host's
* own networking is left exactly as the host configured it.
*/
/**
* The proxy this process would use for the catalog, if any.
*
* This mirrors `EnvHttpProxyAgent`'s own resolution deliberately, rather
* than picking the order that reads best, because the same answer does two
* jobs: it decides whether to route through undici at all, and it is what
* the failure message CLAIMS was tried. A helper that named a proxy undici
* would not have used would put a false statement in every bug report.
*
* Three details are undici's, not ours (env-http-proxy-agent.js):
*   - lowercase wins over uppercase (`https_proxy ?? HTTPS_PROXY`)
*   - an https request falls back to the http proxy when no https one is set
*   - the value is tested for truthiness, so `HTTPS_PROXY=` — which is how
*     people turn a proxy off — falls through instead of masking HTTP_PROXY
*
* Blank-is-unset is ours, and only widens that last one: undici would hand a
* whitespace-only value to `new URL()` and throw out of the constructor.
*/
function configuredProxy() {
	const pick = (raw) => raw === void 0 || raw.trim() === "" ? null : raw.trim();
	return pick(process.env.https_proxy ?? process.env.HTTPS_PROXY) ?? pick(process.env.http_proxy ?? process.env.HTTP_PROXY);
}
/**
* Built once and reused: an agent per request would drop connection reuse,
* and this one reads NO_PROXY as well, so a host that excludes its own
* registry mirror keeps being excluded.
*/
let agent = null;
/**
* Fetch through the proxy this machine is configured to use.
*
* Falls back to the global fetch when no proxy is set, which keeps the
* ordinary case on the runtime's own path rather than routing it through a
* second HTTP stack for no reason.
*/
async function marketFetch(url, init) {
	if (configuredProxy() === null) return await fetch(url, init);
	agent ??= new EnvHttpProxyAgent();
	return await fetch$1(url, {
		...init,
		dispatcher: agent
	});
}
//#endregion
//#region lib/types/registry.js
/**
* Registry access: the curated list from awesome-dsh-plugin.com, fetched
* fresh on every request. See `loadRegistry` for why there is nothing
* behind it any more.
*/
/**
* Where the curated list comes from. Overridable through the process
* environment ONLY — the layer-3 e2e points it at a local fixture catalog so
* the install route can be driven end to end without publishing anything.
*
* This does not weaken the install route's registry check. That check exists
* to stop a malicious PAGE from POSTing an arbitrary source at the local
* server; a page cannot set environment variables, and anyone who can set
* this process's environment already controls the process. What the override
* changes is WHICH list is curated, never WHETHER the check runs.
*/
const REGISTRY_URL = process.env.DSHM_REGISTRY_URL ?? "https://awesome-dsh-plugin.com/plugins.json";
/**
* How long to wait for the catalog.
*
* Generous on purpose. It used to be 4s with a bundled snapshot behind it,
* so a slow link quietly became a 39%-smaller catalog. Now that a failure is
* reported rather than papered over, cutting off a link that WOULD have
* answered is the expensive mistake — 282KB over TLS from a far-away network
* is not a 4-second job.
*/
const FETCH_TIMEOUT_MS = 15e3;
/**
* The catalog we were last served, with the validator identifying it.
*
* This is NOT the cache that was removed, and the difference is the whole
* point. That cache SKIPPED the request for an hour and answered from
* memory — it asserted freshness without ever asking. This asks the origin
* every single time; the validator only lets the origin answer "still the
* same" (304) instead of resending a megabyte. Freshness is verified on
* every call either way, so `data` below is only ever returned when the
* server has just confirmed it is current.
*
* In memory rather than on disk: a restart is rare enough that paying one
* full download for it costs nothing, and a file would be one more thing
* that can be found on a machine and mistaken for the catalog itself.
*
* Measured against the live origin (GitHub Pages behind Fastly, which
* serves both `etag` and `last-modified`): 295 KB and 1.3s unconditional,
* 0 bytes and 0.5s for a 304. The reporter whose fetch took 9.9s was
* downloading the full 1.07 MB every time they opened the market.
*/
let served = null;
/**
* The catalog, revalidated every time it is asked for.
*
* There used to be three answers here — live, a one-hour in-memory cache,
* and a snapshot bundled into the npm package — and only the first was
* correct. The other two were indistinguishable from it on screen, so a
* machine that could not reach the registry browsed the publish-time file
* (839 entries against 1367 live, and frozen forever for anyone on an older
* release), while a machine that COULD reach it still saw an hour-old
* listing of a catalog that grows by ~250 entries a day.
*
* For a catalog, stale is not a degraded answer, it is a wrong one: a plugin
* published this morning reads as "does not exist". So there is one source
* now, and a failure is a failure — the caller reports it and offers a
* retry, which is a state the user can act on. In particular a network
* failure is NEVER answered from `served`: an origin that cannot be reached
* has not confirmed anything, and quietly handing back the last catalog
* would rebuild exactly the fallback this replaced.
* @throws when the catalog cannot be fetched or does not look like one.
*/
async function loadRegistry() {
	const started = Date.now();
	let last;
	for (let attempt = 0; attempt < 2; attempt++) try {
		const headers = {};
		if (served?.etag != null) headers["if-none-match"] = served.etag;
		else if (served?.modified != null) headers["if-modified-since"] = served.modified;
		const res = await marketFetch(REGISTRY_URL, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers
		});
		if (res.status === 304) {
			if (served === null) throw new Error("the catalog answered \"not modified\" with nothing to revalidate");
			return served.data;
		}
		if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
		const data = await res.json();
		if (!Array.isArray(data.plugins) || data.plugins.length === 0) throw new Error("the catalog came back empty");
		served = {
			etag: res.headers.get("etag"),
			modified: res.headers.get("last-modified"),
			data
		};
		return data;
	} catch (error) {
		last = error;
	}
	throw new Error(describeFetchFailure(last, Date.now() - started));
}
/**
* A catalog failure with the facts needed to classify it, in the message
* itself.
*
* The market shows this string and the log export carries it, so it is the
* whole of what a bug report will contain. "The operation was aborted due to
* timeout" alone cannot distinguish a slow link from a blocked one from a
* proxy this process cannot use — and Node's `fetch` ignores HTTP_PROXY
* entirely (measured on Node 25), so a machine whose only route out is a
* proxy fails here every time while every other tool on it works.
*/
function describeFetchFailure(error, elapsedMs) {
	const reason = error instanceof Error ? error.message : String(error);
	const proxy = configuredProxy();
	const parts = [`${reason} (${String(Math.round(elapsedMs / 1e3))}s, 2 attempts)`];
	if (proxy !== null) parts.push(`tried through the configured proxy ${proxy.replace(/\/\/[^@]*@/u, "//***@")}`);
	return parts.join(" · ");
}
//#endregion
//#region lib/types/channels.js
/**
* The market's release channels: which build of ITSELF it offers.
*
* Only the market follows this. Other plugins are never pulled from a
* prerelease on the strength of a setting the user made about the market —
* opting into early builds is volunteering to try THIS plugin early, not to
* be handed every other author's unreleased work.
*
* The model lives in its own module because it is the part with rules
* rather than plumbing: three channels, one of them hidden, a mapping to
* npm dist-tags, and a resolution order that has already been got wrong
* once (see `resolveChannel`).
*/
/**
* The npm dist-tag each channel installs from.
*
* `dev` is published straight from a branch with no git tag behind it, so a
* version carries a timestamp and a short SHA (`1.15.0-dev.20260818-3f1432e`)
* and is never reused. That is what makes a dev build disposable: nothing in
* the repository's history refers to it.
*/
const DIST_TAG = {
	stable: "latest",
	beta: "beta",
	dev: "dev"
};
/**
* Every channel a user may pick. All three, always.
*
* `dev` was behind a developer-mode switch for one version, on the reasoning
* that a build published straight off a branch should not sit beside
* "stable" looking like a third degree of caution. The switch cost more than
* it bought: a stored mode, a route to change it, a rule for what happens to
* a dev choice when it is turned off, and a control whose own purpose needed
* explaining. A plainly labelled option a user can read is simpler than a
* hidden one plus the machinery that hides it — the label does the work the
* gate was doing.
*/
const CHANNELS = [
	"stable",
	"beta",
	"dev"
];
/** Narrow an untrusted value to a Channel, or null. */
function asChannel(value) {
	return value === "stable" || value === "beta" || value === "dev" ? value : null;
}
/**
* Which channel applies right now.
*
* A choice on record always wins — including "stable" while a prerelease is
* running, which is the only way back off a channel. Only the ABSENCE of a
* choice is derived, and then from what is actually running: installing
* `dshmarket@beta` by hand IS the subscription, and treating that as
* "stable" costs updates rather than just clarity — on the stable channel
* `latest` (1.13.1) is not newer than an installed 1.14.0-beta.1, so the
* market answers "up to date" and the next beta is never offered.
*
* Which makes `undefined` load-bearing: it has to survive both the settings
* schema (no `.default`) and state.json (field omitted) or "never chose"
* silently becomes "chose stable".
*
*/
function resolveChannel(setting, version) {
	if (setting !== void 0) return setting;
	return version.includes("-") ? "beta" : "stable";
}
//#endregion
//#region lib/types/hot.js
/**
* Restart-free installs: mount a freshly installed plugin into the running
* composition through a market-owned Include subtree.
*
* Durable state stays with the profile's `dsh.profile.bundles` (reconciled by
* the dsh CLI at install time), so the next boot loads the plugin through the
* normal bundle layer. The subtree here exists only for the current process:
* its input files live under `<profile>/.dsh-market/` and are wiped on every
* boot, so a crash can never leave a file that collides with the bundle layer
* (inserting an id the bundle layer also inserts is a hard boot failure).
* `state.json` in the same directory is the market's own durable state
* (disable list + custom groups) and deliberately survives the wipe.
*
* The Include subclass suppresses `write()` — the loader otherwise persists
* tree changes back to the file it read (see dsh's agent-presets PresetTree
* for the in-tree precedent).
*/
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
const HOT_DIR = ".dsh-market";
/**
* Ceiling for one hot-mount activation, env-overridable like the install
* timeout in dsh-cli.ts. An activation that exceeds it is treated as wedged
* (typically a plugin pending on a service nothing provides) and falls back
* to restart activation.
*/
const HOT_MOUNT_TIMEOUT_MS = Number(process.env.DSH_MARKET_HOT_MOUNT_TIMEOUT_MS) || 1e4;
let hotTreeClass;
/**
* The Include subclass, built once per process; null when the loader's include
* plugin is not importable (older harness) — callers fall back to restart.
*/
/**
* Packages whose host import is replaced by a no-op shim. Client-only plugins
* (`dsh.client` without `dsh.bundle`) have no importable host half, but
* client-modules only serves bundles for packages with a live loader entry —
* the shim fiber exists purely to satisfy that registration.
*/
const shimNames = /* @__PURE__ */ new Set();
async function loadHotTreeClass() {
	if (hotTreeClass !== void 0) return hotTreeClass;
	try {
		const Include = (await import(__rewriteRelativeImportExtension("@deepseek-ai/cordis-plugin-include"))).Include;
		if (Include === void 0) throw new Error("no Include export");
		class MarketHotTree extends Include {
			/** Runtime-only mount list; the bundle layer owns persistence. */
			write() {}
			import(name, getOuterStack) {
				if (shimNames.has(name)) return {
					name,
					apply: () => {}
				};
				return super.import(name, getOuterStack);
			}
		}
		hotTreeClass = MarketHotTree;
	} catch {
		hotTreeClass = null;
	}
	return hotTreeClass;
}
/** The `dsh` declaration block of an installed package, or null when unreadable. */
function readPkgDsh$1(profileDir, packageName) {
	try {
		return JSON.parse(readFileSync(join(profileDir, "node_modules", packageName, "package.json"), "utf8")).dsh ?? {};
	} catch {
		return null;
	}
}
/**
* Insert rows of a plugin's bundle patch, or null when the patch contains
* anything beyond plain `id`/`name` insert rows (config blocks, disables,
* expressions) — those compositions fall back to restart activation.
*/
function parseSimplePatch(patchText) {
	const rows = [];
	let pending = null;
	for (const raw of patchText.split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, "").trimEnd();
		if (line.trim() === "") continue;
		if (/^-\s+insert:\s*$/.test(line)) continue;
		const id = /^\s+-\s+id:\s*(\S+)\s*$/.exec(line);
		if (id !== null) {
			if (pending !== null) return null;
			pending = id[1];
			continue;
		}
		const name = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
		if (name !== null && pending !== null) {
			rows.push({
				id: pending,
				name: name[1]
			});
			pending = null;
			continue;
		}
		return null;
	}
	if (pending !== null || rows.length === 0) return null;
	return rows;
}
/**
* Wipe leftover hot-mount inputs; call once when the market host starts.
* `state.json` (disable choices + groups) deliberately survives.
*/
function cleanHotDir(profileDir) {
	const dir = join(profileDir, HOT_DIR);
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) if (/^hot-\d+\.yml$/.test(name)) rmSync(join(dir, name), { force: true });
}
function stateFile(profileDir) {
	return join(profileDir, HOT_DIR, "state.json");
}
/** Unique non-empty strings in `value`, order preserved. */
function uniqueStrings(value) {
	if (!Array.isArray(value)) return [];
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const item of value) {
		if (typeof item !== "string" || item === "" || seen.has(item)) continue;
		seen.add(item);
		out.push(item);
	}
	return out;
}
/**
* Read the whole market state. Legacy `disabledSkins` (the pre-#60
* theme-only key) still loads; every new write uses the generic `disabled`
* key (#60).
*/
function readMarketState(profileDir) {
	try {
		const state = JSON.parse(readFileSync(stateFile(profileDir), "utf8"));
		const disabled = uniqueStrings(state.disabled !== void 0 ? state.disabled : state.disabledSkins);
		const groups = {};
		if (state.groups !== null && typeof state.groups === "object" && !Array.isArray(state.groups)) for (const [name, members] of Object.entries(state.groups)) groups[name] = uniqueStrings(members);
		return {
			disabled: new Set(disabled),
			groups,
			groupOrder: uniqueStrings(state.groupOrder),
			channel: asChannel(state.channel) ?? void 0
		};
	} catch {
		return {
			disabled: /* @__PURE__ */ new Set(),
			groups: {},
			groupOrder: []
		};
	}
}
/** Persist the whole market state; `disabled` is the single written key. */
function writeMarketState(profileDir, state) {
	mkdirSync(join(profileDir, HOT_DIR), {
		recursive: true,
		mode: 448
	});
	writeFileSync(stateFile(profileDir), JSON.stringify({
		disabled: [...state.disabled],
		groups: state.groups,
		groupOrder: state.groupOrder,
		...state.channel === void 0 ? {} : { channel: state.channel }
	}));
}
/** Plugins the user switched off; skipped by the boot re-mount. */
function readDisabled(profileDir) {
	return readMarketState(profileDir).disabled;
}
/** Persist just the disable list, preserving groups and order. */
function writeDisabled(profileDir, disabled) {
	const state = readMarketState(profileDir);
	state.disabled = new Set(disabled);
	writeMarketState(profileDir, state);
}
/** Package names currently live through a market hot mount (patch or shim). */
function listHotMounts() {
	return [...hotHandles.keys()];
}
let hotSequence = 0;
const hotHandles = /* @__PURE__ */ new Map();
/** Activation did not settle within HOT_MOUNT_TIMEOUT_MS. */
var ActivationTimeout = class extends Error {};
/**
* Race an activation awaitable against the hot-mount ceiling. The handlers
* stay attached to the original promise, so a late rejection after a timeout
* can never surface as an unhandled rejection.
*/
function raceActivationTimeout(awaitable) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new ActivationTimeout(`activation did not settle within ${HOT_MOUNT_TIMEOUT_MS / 1e3}s — the plugin may be waiting on a service that never arrives`));
		}, HOT_MOUNT_TIMEOUT_MS);
		Promise.resolve(awaitable).then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}
/**
* Dispose a plugin hot-mounted earlier in this session, removing it from the
* running composition immediately.
* @param packageName - package to unmount.
* @returns true when a live hot mount was found and disposed.
*/
async function hotUnmount(packageName) {
	const handle = hotHandles.get(packageName);
	if (handle === void 0) return false;
	hotHandles.delete(packageName);
	shimNames.delete(packageName);
	try {
		await handle.dispose();
		logEvent("info", "hot-unmount", `${packageName}: removed live`);
		return true;
	} catch (error) {
		logEvent("warn", "hot-unmount", `${packageName}: dispose failed — ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}
/**
* Mount `packageName` (just installed into the profile) into the running
* composition.
* @param ctx - market host context; the subtree unwinds with the market's fiber.
* @param profileDir - profile the package was installed into.
* @param packageName - installed package to activate.
* @returns whether the plugin is live without a restart, plus the reason
* when it is not (P0-2: the UI must distinguish "restart will fix it" from
* "this package can never hot-mount").
*/
async function hotMount(ctx, profileDir, packageName) {
	try {
		const HotTree = await loadHotTreeClass();
		if (HotTree === null) return {
			ok: false,
			reason: "宿主不支持热挂载(include 插件不可导入),需重启 / the host cannot hot-mount (include plugin unavailable); restart required"
		};
		let patchText;
		try {
			patchText = readFileSync(join(profileDir, "node_modules", packageName, "cordis.patch.yml"), "utf8");
		} catch {
			patchText = null;
		}
		let rows;
		if (patchText !== null) {
			rows = parseSimplePatch(patchText);
			if (rows === null) return {
				ok: false,
				reason: "bundle patch 含配置行/表达式,热挂载仅支持纯 insert,重启后生效 / the bundle patch contains config/expression rows; hot-mount only supports plain inserts — it activates on restart"
			};
		} else {
			const dsh = readPkgDsh$1(profileDir, packageName);
			if (dsh === null || dsh.client === void 0 || dsh.bundle !== void 0) return {
				ok: false,
				reason: "该包无 bundle patch 且未声明 dsh.client,没有可热挂载的内容 / no bundle patch and no dsh.client surface — nothing to hot-mount"
			};
			shimNames.add(packageName);
			rows = [{
				id: `client-${packageName.replace(/[^A-Za-z0-9_.-]/g, "-")}`,
				name: packageName
			}];
		}
		const dir = join(profileDir, HOT_DIR);
		mkdirSync(dir, {
			recursive: true,
			mode: 448
		});
		hotSequence += 1;
		const file = join(dir, `hot-${String(hotSequence)}.yml`);
		writeFileSync(file, rows.map((row) => `- id: 'mkt-${row.id}'\n  name: '${row.name}'\n`).join(""));
		const handle = ctx.plugin(HotTree, { path: pathToFileURL(file).href });
		try {
			await raceActivationTimeout(handle.await());
		} catch (error) {
			if (error instanceof ActivationTimeout) try {
				Promise.resolve(handle.dispose()).catch(() => {});
			} catch {}
			throw error;
		}
		hotHandles.set(packageName, handle);
		ctx.logger?.info?.(`[dsh-market] hot-mounted ${packageName}`);
		logEvent("info", "hot-mount", `${packageName}: live${shimNames.has(packageName) ? " (client-only shim)" : ""}`);
		return {
			ok: true,
			reason: null
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.logger?.warn(`[dsh-market] hot mount of ${packageName} failed, restart required: ${message}`);
		logEvent("warn", "hot-mount", `${packageName}: fell back to restart — ${message}`);
		return {
			ok: false,
			reason: `热挂载失败,重启后生效 — ${message} / hot-mount failed — restart required: ${message}`
		};
	}
}
/**
* Mount every installed client-only package (`dsh.client` without
* `dsh.bundle`) at market startup. The bundle reconcile skips these packages
* entirely, so without the market's shim their client bundles are unreachable
* in every boot — this is what makes them behave like normal plugins.
* @returns names that were mounted.
*/
async function mountClientOnlyDeps(ctx, profileDir) {
	let deps;
	try {
		const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
		const bundles = new Set(manifest.dsh?.profile?.bundles ?? []);
		deps = Object.keys(manifest.dependencies ?? {}).filter((name) => !bundles.has(name));
	} catch {
		return [];
	}
	const disabled = readDisabled(profileDir);
	const userManaged = readUserPatchControls(profileDir);
	const mounted = [];
	for (const name of deps) {
		if (hotHandles.has(name) || disabled.has(name)) continue;
		if (patchLayerManages(userManaged, name)) continue;
		const dsh = readPkgDsh$1(profileDir, name);
		if (dsh === null || dsh.client === void 0 || dsh.bundle !== void 0) continue;
		if ((await hotMount(ctx, profileDir, name)).ok) mounted.push(name);
	}
	return mounted;
}
/**
* Row ids and package names the user's own patch layer (cordis.patch.yml)
* already contains. Line-wise scan on purpose: the file may hold structures
* the market's strict patch parser rejects, but any mention of a row id or
* package name is enough to know the user manages it (#58).
*/
function readUserPatchControls(profileDir) {
	const ids = /* @__PURE__ */ new Set();
	const names = /* @__PURE__ */ new Set();
	try {
		const text = readFileSync(join(profileDir, "cordis.patch.yml"), "utf8");
		for (const line of text.split(/\r?\n/)) {
			const id = /^\s*-?\s*id:\s*['"]?([A-Za-z0-9._/@-]+)/.exec(line);
			if (id !== null) ids.add(id[1]);
			const name = /^\s*name:\s*['"]?([^'"\s]+)/.exec(line);
			if (name !== null) names.add(name[1]);
		}
	} catch {}
	return {
		ids,
		names
	};
}
/**
* Whether the user patch layer manages `name` — matched by exact package
* name or by the plugin-manager row-id convention (strip the leading @,
* non-alphanumerics to '-', lowercase).
*/
function patchLayerManages(controls, name) {
	const rowId = name.replace(/^@/, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
	return controls.ids.has(rowId) || controls.names.has(name);
}
/**
* Delete the market's own state directory.
*
* `cleanHotDir` wipes the ephemeral hot-mount inputs on every boot but
* deliberately preserves `state.json` — the disable list and custom groups
* are the user's durable choices. Uninstalling the market is the one moment
* where removing them is the right thing, and only when the user asked.
* @returns true when a directory was there to remove.
*/
function purgeMarketState(profileDir) {
	const dir = join(profileDir, HOT_DIR);
	try {
		rmSync(dir, {
			recursive: true,
			force: true
		});
		return true;
	} catch {
		return false;
	}
}
//#endregion
//#region lib/types/groups.js
/**
* Custom plugin groups (Roadmap #60): user-defined named collections of
* installed plugins whose enable/disable state can be switched as a unit —
* borrowing the "group by capability, toggle as one" idea from Claude
* Desktop's skill management. Membership lives in state.json and is the
* only durable truth: a group's switch state is always derived from its
* members and never persisted itself.
*
* Pure CRUD over the caller-owned state objects; routes.ts persists after
* each mutation and applies the live toggles for the batch action.
*/
/** Group names: letters/digits (incl. CJK), spaces, underscores, hyphens. */
const GROUP_NAME_RE = /^[\p{L}\p{N}_ -]{1,40}$/u;
function isGroupName(value) {
	return typeof value === "string" && GROUP_NAME_RE.test(value);
}
function createGroup(state, name) {
	if (!isGroupName(name)) return {
		ok: false,
		error: "invalid group name / 分组名称无效"
	};
	if (state.groups[name] !== void 0) return {
		ok: false,
		error: "group already exists / 分组已存在"
	};
	state.groups[name] = [];
	state.groupOrder.push(name);
	return { ok: true };
}
function renameGroup(state, name, newName) {
	if (typeof name !== "string" || state.groups[name] === void 0) return {
		ok: false,
		error: "group not found / 分组不存在"
	};
	if (!isGroupName(newName)) return {
		ok: false,
		error: "invalid group name / 分组名称无效"
	};
	if (newName !== name && state.groups[newName] !== void 0) return {
		ok: false,
		error: "group already exists / 分组已存在"
	};
	const members = state.groups[name];
	delete state.groups[name];
	state.groups[newName] = members;
	const index = state.groupOrder.indexOf(name);
	if (index !== -1) state.groupOrder[index] = newName;
	return { ok: true };
}
function deleteGroup(state, name) {
	if (typeof name !== "string" || state.groups[name] === void 0) return {
		ok: false,
		error: "group not found / 分组不存在"
	};
	delete state.groups[name];
	const index = state.groupOrder.indexOf(name);
	if (index !== -1) state.groupOrder.splice(index, 1);
	return { ok: true };
}
/**
* Replace a group's membership. Only currently installed plugins can be
* members — ghost names (uninstalled meanwhile) are dropped and duplicates
* collapse, so the persisted list stays clean. Themes are exclusive: a group
* may hold at most one theme plugin, mirroring the global one-active-theme
* rule (only one theme can be enabled at a time).
*/
function setGroupMembers(state, name, members, installed, themes) {
	if (typeof name !== "string" || state.groups[name] === void 0) return {
		ok: false,
		error: "group not found / 分组不存在"
	};
	if (!Array.isArray(members)) return {
		ok: false,
		error: "members must be an array / 成员必须是数组"
	};
	const kept = [];
	const seen = /* @__PURE__ */ new Set();
	for (const member of members) {
		if (typeof member !== "string" || member === "" || seen.has(member)) continue;
		if (member === "dsh-market" || member === "dshmarket") continue;
		seen.add(member);
		if (installed.has(member)) kept.push(member);
	}
	let themeCount = 0;
	for (const member of kept) if (themes.has(member)) themeCount += 1;
	if (themeCount > 1) return {
		ok: false,
		error: "a group can contain at most one theme / 每组最多一个主题"
	};
	state.groups[name] = kept;
	return { ok: true };
}
/** Drop `name` from every group (called after a successful uninstall). */
function removeFromGroups(state, name) {
	for (const group of Object.keys(state.groups)) {
		const members = state.groups[group];
		if (members.includes(name)) state.groups[group] = members.filter((member) => member !== name);
	}
}
//#endregion
//#region lib/types/diagnostics.js
/** Versioned, read-only diagnostics shared by the host route and client. */
const DIAGNOSTIC_SCHEMA = "dsh-market/diagnostics/v1";
const knownSharedHostPackages = new Set([
	"@deepseek-ai/cordis",
	"@deepseek-ai/dsh-attachment",
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/dsh-system-prompt",
	"@deepseek-ai/dsh-tools"
]);
function isRecord$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Report exact manifest declarations; the resolved dependency tree is not inspected. */
function inspectKnownHostDependencyDeclarations(packageName, manifest) {
	if (!isRecord$1(manifest) || !isRecord$1(manifest.dependencies)) return [];
	const findings = [];
	for (const dependency of Object.keys(manifest.dependencies).sort()) {
		const declaredRange = manifest.dependencies[dependency];
		if (!knownSharedHostPackages.has(dependency) || typeof declaredRange !== "string") continue;
		findings.push({
			code: "shared-host-package-dependency",
			severity: "warning",
			subject: {
				kind: "package",
				name: packageName
			},
			evidence: {
				basis: "manifest-declaration",
				dependency,
				declaredRange,
				declaredIn: "dependencies"
			}
		});
	}
	return findings;
}
/** Build a stable diagnostic envelope from installed package manifests. */
function diagnosePackageManifests(packages) {
	return {
		schema: DIAGNOSTIC_SCHEMA,
		findings: [...packages].sort((a, b) => a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0).flatMap(({ packageName, manifest }) => {
			if (!isRecord$1(manifest) || manifest.dsh === void 0) return [];
			return inspectKnownHostDependencyDeclarations(packageName, manifest);
		})
	};
}
//#endregion
//#region lib/types/order.js
/**
* Community bundle ordering — issue #98 (phase 2): let the user reorder the
* community bundles of the profile's layer stack, with author-declared
* before/after rules enforced before anything is written.
*
* Official in-box bundles (@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app,
* @deepseek-ai/dsh-headless) are fixed: they keep their exact positions in
* the stack, are never part of a user-supplied order, and are never added,
* removed or duplicated by a reorder (#98 boundary). The profile's own
* cordis.patch.yml and --patch overlays are not part of the bundle stack and
* are never touched here.
*
* Pure functions plus one manifest write-back; no processes, no network.
*/
/** Profile bundles that ship with the dsh host and must stay put (#98). */
const INBOX_BUNDLES = new Set([
	"@deepseek-ai/dsh-base",
	"@deepseek-ai/dsh-web-app",
	"@deepseek-ai/dsh-headless"
]);
/**
* Atomic same-directory replace (write temp + rename): a crash mid-write can
* never leave the profile manifest truncated, which would break every later
* pnpm run. Used for every package.json write this module makes.
*/
function writeFileAtomic(file, content) {
	const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	writeFileSync(temp, content);
	renameSync(temp, file);
}
/** Read the profile's bundle stack (empty when the manifest is unreadable). */
function readBundleStack(profileDir) {
	try {
		const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
		const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles.filter((name) => typeof name === "string") : [];
		return {
			bundles,
			community: bundles.filter((name) => !INBOX_BUNDLES.has(name))
		};
	} catch {
		return {
			bundles: [],
			community: []
		};
	}
}
/**
* Locate the dsh host installation from the process entry (same source as
* dsh-cli.ts / check.ts): walk up from dirname(argv[1]) until a package.json
* named @deepseek-ai/dsh is found.
*/
function findDshInstallDir$1(entry = process.argv[1]) {
	if (entry === void 0) return null;
	let dir = resolve(dirname(entry));
	for (let depth = 0; depth < 10; depth += 1) {
		try {
			if (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "@deepseek-ai/dsh") return dir;
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}
/**
* The bundle package.json, resolved the way the dsh boot resolves bundles
* (dsh-app-boot's resolveBundleDir, mirrored by check.ts): the dsh
* installation anchor first — official in-box bundles live in the install's
* node_modules, never the profile's — then the profile directory, whose
* createRequire search paths also cover pnpm workspace-root hoisting
* (`<profiles>/node_modules` when the profile lives under `<profiles>/<name>`).
*/
function resolveBundlePackageJson(profileDir, name) {
	const dshInstall = findDshInstallDir$1();
	const anchors = [dshInstall !== null ? join(dshInstall, "package.json") : null, join(profileDir, "package.json")];
	for (const anchor of anchors) {
		if (anchor === null) continue;
		let paths = [];
		try {
			paths = createRequire(anchor).resolve.paths(name) ?? [];
		} catch {
			continue;
		}
		for (const searchPath of paths) {
			const candidate = join(searchPath, name);
			if (existsSync(join(candidate, "package.json"))) return join(candidate, "package.json");
		}
	}
	return null;
}
/**
* Read each bundle's declared ordering rules from its package manifest
* (`dsh.bundle.order.{before,after}` — a list of bundle package names).
* Unresolvable packages and missing declarations contribute nothing.
*/
function readBundleRules(profileDir) {
	const { bundles } = readBundleStack(profileDir);
	const rules = [];
	for (const name of bundles) {
		const packageJson = resolveBundlePackageJson(profileDir, name);
		if (packageJson === null) continue;
		try {
			const order = JSON.parse(readFileSync(packageJson, "utf8")).dsh?.bundle?.order;
			if (order === null || typeof order !== "object" || Array.isArray(order)) continue;
			const listOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
			const rule = {
				name,
				after: listOf(order.after),
				before: listOf(order.before)
			};
			if (rule.after.length > 0 || rule.before.length > 0) rules.push(rule);
		} catch {}
	}
	return rules;
}
/**
* Check a bundle order against the declared before/after rules. Rules naming
* bundles outside `order` are ignored (a rule for a not-yet-installed bundle
* must not block the current stack).
* @returns every violated rule with a readable reason; [] when all hold.
*/
function validateOrder(bundleNames, rules) {
	const position = new Map(bundleNames.map((name, index) => [name, index]));
	const conflicts = [];
	for (const rule of rules) {
		const pos = position.get(rule.name);
		if (pos === void 0) continue;
		for (const other of rule.after) {
			const otherPos = position.get(other);
			if (otherPos === void 0) continue;
			if (otherPos >= pos) conflicts.push({
				name: rule.name,
				reason: `must load after ${other}, but ${other} is currently before/equal (position ${otherPos} vs ${pos})`
			});
		}
		for (const other of rule.before) {
			const otherPos = position.get(other);
			if (otherPos === void 0) continue;
			if (otherPos <= pos) conflicts.push({
				name: rule.name,
				reason: `must load before ${other}, but ${other} is currently after/equal (position ${otherPos} vs ${pos})`
			});
		}
	}
	return conflicts;
}
/**
* Merge a community-bundle permutation into the full stack. Official in-box
* bundles keep their EXACT positions (never moved); community bundles are
* replaced by `newOrder` in order of appearance. Pure — nothing is written.
* @returns the merged full stack, or the rejection reason when `newOrder` is
* not a permutation of the community bundles (duplicates, additions,
* omissions, official names).
*/
function mergeOrder(bundles, newOrder) {
	const communitySet = new Set(bundles.filter((name) => !INBOX_BUNDLES.has(name)));
	if (new Set(newOrder).size !== newOrder.length) return {
		ok: false,
		error: "duplicate bundle names in the new order / 新顺序包含重复的 bundle"
	};
	if (newOrder.length !== communitySet.size) return {
		ok: false,
		error: "the new order must contain exactly the current community bundles / 新顺序必须恰好包含全部社区 bundle"
	};
	for (const name of newOrder) if (!communitySet.has(name)) return {
		ok: false,
		error: `${name} is not a reorderable community bundle / ${name} 不是可排序的社区 bundle`
	};
	const merged = [...bundles];
	let cursor = 0;
	for (let index = 0; index < merged.length; index += 1) {
		const name = merged[index];
		if (name === void 0 || INBOX_BUNDLES.has(name)) continue;
		merged[index] = newOrder[cursor];
		cursor += 1;
	}
	return {
		ok: true,
		bundles: merged
	};
}
/**
* Topologically sort the community bundles by their before/after rules — the
* "auto-fix" counterpart to validateOrder. Returns null when no declared rule
* applies to the current stack (nothing to suggest). With rules, Kahn's
* algorithm breaks ties by the CURRENT order: unconstrained bundles keep
* their current relative order and constrained bundles move only as far as
* the rules require — the suggestion is the minimal change that satisfies
* every rule, never an arbitrary canonical rewrite of a hand-picked order
* (issue #125 review).
* @returns the suggested community order, null when there are no rules, or a
* cycle report when the constraints cannot be satisfied (references to
* unlisted bundles ignored).
*/
function suggestOrder(bundleNames, rules) {
	const names = bundleNames.filter((name) => !INBOX_BUNDLES.has(name));
	const inOrder = new Set(names);
	const active = rules.filter((rule) => inOrder.has(rule.name));
	if (active.length === 0) return null;
	const position = new Map(names.map((name, index) => [name, index]));
	const beforeOf = /* @__PURE__ */ new Map();
	const deps = /* @__PURE__ */ new Map();
	for (const name of names) {
		beforeOf.set(name, /* @__PURE__ */ new Set());
		deps.set(name, /* @__PURE__ */ new Set());
	}
	const addEdge = (a, b) => {
		if (!inOrder.has(a) || !inOrder.has(b) || a === b) return;
		beforeOf.get(a)?.add(b);
		deps.get(b)?.add(a);
	};
	for (const rule of active) {
		for (const other of rule.before) addEdge(rule.name, other);
		for (const other of rule.after) addEdge(other, rule.name);
	}
	const remaining = /* @__PURE__ */ new Map();
	for (const [name, depsOf] of deps) remaining.set(name, new Set(depsOf));
	const ready = names.filter((name) => (remaining.get(name)?.size ?? 0) === 0);
	const ordered = [];
	while (ready.length > 0) {
		let best = 0;
		for (let i = 1; i < ready.length; i += 1) {
			const a = ready[i];
			const b = ready[best];
			if (a !== void 0 && b !== void 0 && (position.get(a) ?? 0) < (position.get(b) ?? 0)) best = i;
		}
		const name = ready.splice(best, 1)[0];
		if (name === void 0) break;
		ordered.push(name);
		for (const dependent of beforeOf.get(name) ?? []) {
			const depsOf = remaining.get(dependent);
			if (depsOf === void 0) continue;
			depsOf.delete(name);
			if (depsOf.size === 0 && !ordered.includes(dependent) && !ready.includes(dependent)) ready.push(dependent);
		}
	}
	if (ordered.length < names.length) return {
		ok: false,
		cycle: names.filter((name) => !ordered.includes(name))
	};
	return {
		ok: true,
		order: ordered
	};
}
/**
* Apply a new community-bundle order to the profile manifest. The official
* in-box bundles keep their exact positions; `newOrder` must be a permutation
* of the current community bundles (no duplicates, no additions, no
* omissions). On any failure the manifest is left untouched.
* @returns the new full stack on success, or an error description.
*/
function applyBundleOrder(profileDir, newOrder) {
	const { bundles } = readBundleStack(profileDir);
	const merged = mergeOrder(bundles, newOrder);
	if (!merged.ok) return merged;
	try {
		const manifestPath = join(profileDir, "package.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		manifest.dsh ??= {};
		manifest.dsh.profile ??= {};
		manifest.dsh.profile.bundles = merged.bundles;
		writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		return merged;
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
//#endregion
//#region lib/types/check.js
/**
* Profile composition diagnostics — issue #98 (phase 1): the check-only
* "plugin loading layer and conflict view".
*
* Pure filesystem analysis of one dsh profile directory; no processes, no
* network, no writes. It answers, for the profile the market is serving:
*
*  1. What is the actual bundle stack (dsh.profile.bundles order) and where
*     does each layer come from (official in-box bundle vs community, the
*     dependency spec, the resolved directory)?
*  2. Which loader entry ids does the composed tree contain, and are any
*     duplicated across layers (the "duplicate loader entry id" boot failure
*     from #98)? Which rows does a later layer override?
*  3. Does any installed plugin pull a DSH host core package
*     (@deepseek-ai/dsh, @deepseek-ai/dsh-tools, @deepseek-ai/cordis, …) in
*     as an ordinary dependency — the dsh-excel-chat failure mode where the
*     plugin's copy gets hoisted to the profile root and shadows the host's
*     version (tool calls die, minimal preset fails to mount)?
*  4. Are there multiple versions of one core package in the lockfile, and
*     do plugin peerDependencies ranges match the resolved core version?
*
* The composition step mirrors @deepseek-ai/dsh-app-boot's applyEntryPatches
* (same js-yaml dialect incl. `!!js` scalars), so the rows reported here are
* what actually mounts at boot.
*/
/** js-yaml dialect for `!!js` scalars — identical to dsh-app-boot's entryListSchema. */
const jsExpr = new Type("tag:yaml.org,2002:js", {
	kind: "scalar",
	resolve: (data) => typeof data === "string",
	construct: (data) => ({ __jsExpr: String(data) })
});
const entrySchema = JSON_SCHEMA.extend(jsExpr);
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Parse one entry-list patch file with the dsh dialect; null when unreadable. */
function parsePatchFile(path) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return null;
	}
	try {
		const value = load(text, { schema: entrySchema });
		return Array.isArray(value) ? value : null;
	} catch {
		return null;
	}
}
/** Every id in one patch row's insert list, recursively (group configs included). */
function collectInsertIds(rows) {
	const ids = [];
	const walk = (value) => {
		if (!Array.isArray(value)) return;
		for (const entry of value) {
			if (!isRecord(entry) || typeof entry.id !== "string") continue;
			ids.push(entry.id);
			if (Array.isArray(entry.config)) walk(entry.config);
		}
	};
	for (const patch of rows) {
		if (!isRecord(patch) || !Array.isArray(patch.insert)) continue;
		walk(patch.insert);
	}
	return ids;
}
/** DSH host core packages: what the dsh installation ships under @deepseek-ai. */
function corePackageNames(dshInstallDir) {
	const names = new Set([
		"@deepseek-ai/dsh",
		"@deepseek-ai/dsh-base",
		"@deepseek-ai/dsh-web-app",
		"@deepseek-ai/dsh-headless",
		"@deepseek-ai/dsh-app-boot",
		"@deepseek-ai/dsh-home-paths",
		"@deepseek-ai/dsh-launch-environment",
		"@deepseek-ai/dsh-cmdline",
		"@deepseek-ai/dsh-tools",
		"@deepseek-ai/dsh-llm",
		"@deepseek-ai/dsh-system-prompt",
		"@deepseek-ai/dsh-attachment",
		"@deepseek-ai/dsh-agent",
		"@deepseek-ai/dsh-agent-loop",
		"@deepseek-ai/dsh-session",
		"@deepseek-ai/dsh-subagent",
		"@deepseek-ai/cordis",
		"@deepseek-ai/cordis-plugin-loader",
		"@deepseek-ai/cordis-plugin-include",
		"@deepseek-ai/cordis-plugin-hmr",
		"@deepseek-ai/cordis-plugin-timer",
		"@deepseek-ai/cordis-plugin-group"
	]);
	if (dshInstallDir === null) return names;
	try {
		for (const entry of readdirSync(join(dshInstallDir, "node_modules", "@deepseek-ai"), { withFileTypes: true })) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
			if (/^(?:dsh|cordis)/.test(entry.name)) names.add(`@deepseek-ai/${entry.name}`);
		}
	} catch {}
	try {
		const manifest = JSON.parse(readFileSync(join(dshInstallDir, "package.json"), "utf8"));
		if (typeof manifest.name === "string") names.add(manifest.name);
	} catch {}
	return names;
}
/**
* Locate the dsh host installation from the process entry (the same source
* dsh-cli.ts uses to re-invoke the CLI): walk up from dirname(argv[1]) until
* a package.json named @deepseek-ai/dsh is found.
*/
function findDshInstallDir(entry = process.argv[1]) {
	if (entry === void 0) return null;
	let dir = resolve(dirname(entry));
	for (let depth = 0; depth < 10; depth += 1) {
		try {
			if (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "@deepseek-ai/dsh") return dir;
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}
/** Version of `name` as physically resolved at `base`/node_modules, or null. */
function readNodeModulesVersion(base, name) {
	try {
		const manifest = JSON.parse(readFileSync(join(base, "node_modules", name, "package.json"), "utf8"));
		return typeof manifest.version === "string" ? manifest.version : null;
	} catch {
		return null;
	}
}
/**
* Resolve one bundle package's directory the way the dsh boot does
* (dsh-app-boot's resolveBundleDir): probe Node's own node_modules search
* paths from the installation anchor first, then the profile directory.
* Node resolution walks upward, so this also finds pnpm's workspace-root
* hoisting (`<profiles>/node_modules/…` when the profile lives under
* `<profiles>/<name>`) and matches exactly what the Loader would import.
*/
function resolveBundleDir(anchorPackageJson, name) {
	let paths = [];
	try {
		paths = createRequire(anchorPackageJson).resolve.paths(name) ?? [];
	} catch {
		return null;
	}
	for (const searchPath of paths) {
		const candidate = join(searchPath, name);
		if (existsSync(join(candidate, "package.json"))) return candidate;
	}
	return null;
}
/**
* Version of `name` visible to the profile's dependency tree: the profile's
* own node_modules first, then the workspace root (pnpm hoists shared deps
* there when the profile is a workspace member — the dsh layout keeps
* `<profiles>/node_modules` as the shared store for all profiles).
*/
function readProfileVisibleVersion(profileDirectory, name) {
	const direct = readNodeModulesVersion(profileDirectory, name);
	if (direct !== null) return direct;
	const workspaceRoot = dirname(profileDirectory);
	if (workspaceRoot === profileDirectory) return null;
	return readNodeModulesVersion(workspaceRoot, name);
}
/** Top-level installed package names (incl. scoped), excluding pnpm internals. */
function installedPackageNames(profileDir) {
	const names = [];
	const isPkgDir = (entry) => entry.isDirectory() || entry.isSymbolicLink();
	let root;
	try {
		root = readdirSync(join(profileDir, "node_modules"), { withFileTypes: true }).filter((entry) => isPkgDir(entry) && entry.name !== ".bin" && entry.name !== ".pnpm" && entry.name !== ".dsh-plugin-backups").map((entry) => entry.name);
	} catch {
		return names;
	}
	for (const name of root) {
		if (!name.startsWith("@")) {
			names.push(name);
			continue;
		}
		try {
			for (const scoped of readdirSync(join(profileDir, "node_modules", name), { withFileTypes: true })) if (isPkgDir(scoped)) names.push(`${name}/${scoped.name}`);
		} catch {}
	}
	return names;
}
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseSemver$1(value) {
	const m = SEMVER_RE.exec(value.trim());
	if (m === null) return null;
	return {
		major: Number(m[1]),
		minor: Number(m[2]),
		patch: Number(m[3]),
		pre: m[4] === void 0 ? [] : m[4].split(".")
	};
}
function comparePre(a, b) {
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i += 1) {
		const x = a[i];
		const y = b[i];
		if (x === void 0) return y === void 0 ? 0 : -1;
		if (y === void 0) return 1;
		if (x === y) continue;
		const xn = /^\d+$/.test(x);
		const yn = /^\d+$/.test(y);
		if (xn && yn) return Number(x) - Number(y) || 0;
		if (xn) return -1;
		if (yn) return 1;
		return x < y ? -1 : 1;
	}
	return 0;
}
/** Compare two semver strings: negative | zero | positive (prerelease < release of same base). */
function compareSemver(a, b) {
	const av = parseSemver$1(a);
	const bv = parseSemver$1(b);
	if (av === null || bv === null) return a < b ? -1 : a > b ? 1 : 0;
	if (av.major !== bv.major) return av.major - bv.major || 0;
	if (av.minor !== bv.minor) return av.minor - bv.minor || 0;
	if (av.patch !== bv.patch) return av.patch - bv.patch || 0;
	if (av.pre.length === 0 && bv.pre.length === 0) return 0;
	if (av.pre.length === 0) return 1;
	if (bv.pre.length === 0) return -1;
	return comparePre(av.pre, bv.pre);
}
function gte(a, b) {
	return compareSemver(`${a.major}.${a.minor}.${a.patch}${a.pre.length > 0 ? `-${a.pre.join(".")}` : ""}`, `${b.major}.${b.minor}.${b.patch}${b.pre.length > 0 ? `-${b.pre.join(".")}` : ""}`) >= 0;
}
/** String form of a parsed Semver (the boundary objects carry no prerelease). */
function semverStr(v) {
	return `${v.major}.${v.minor}.${v.patch}${v.pre.length > 0 ? `-${v.pre.join(".")}` : ""}`;
}
/**
* Minimal range matcher for the peer-range check: `*`, exact, ^, ~, >=, >,
* <=, <, whitespace-separated pairs, and `||` alternatives. Anything else
* returns null (unknown — reported, not asserted).
*
* Prerelease handling follows npm's semver rule, evaluated at the comparator
* SET level (one `||` alternative is one set): a version carrying a
* prerelease tag only satisfies a set when at least one comparator in that
* set shares the version's [major, minor, patch] tuple AND carries a
* prerelease of its own; then every comparator is checked normally. So
* `^0.1.0` never matches `0.2.0-rc.1` (nor `0.1.0-rc.5`), while
* `>=1.2.3-rc.1 <2.0.0` does match `1.2.3-rc.2` (issue #98 analysis).
*/
function satisfiesRange(version, range) {
	const v = parseSemver$1(version);
	if (v === null) return null;
	const versionHasPre = v.pre.length > 0;
	const single = (part) => {
		const p = part.trim();
		if (p === "" || p === "*" || p === "x" || p === "X") return true;
		const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(p);
		const op = m?.[1] ?? "";
		const target = (m?.[2] ?? "").trim();
		const tv = parseSemver$1(target);
		if (tv === null) return null;
		const major = tv.major;
		const minor = tv.minor;
		const patch = tv.patch;
		switch (op) {
			case "": return compareSemver(version, target) === 0;
			case ">=": return gte(v, tv);
			case "<=": return gte(tv, v);
			case ">": return compareSemver(version, target) > 0;
			case "<": return compareSemver(version, target) < 0;
			case "^": {
				const upper = major > 0 ? {
					major: major + 1,
					minor: 0,
					patch: 0,
					pre: []
				} : minor > 0 ? {
					major: 0,
					minor: minor + 1,
					patch: 0,
					pre: []
				} : {
					major: 0,
					minor: 0,
					patch: patch + 1,
					pre: []
				};
				return gte(v, tv) && compareSemver(semverStr(upper), version) > 0;
			}
			case "~": {
				const upper = {
					major,
					minor: minor + 1,
					patch: 0,
					pre: []
				};
				return gte(v, tv) && compareSemver(semverStr(upper), version) > 0;
			}
			default: return null;
		}
	};
	/** Parse one comparator part into op + target; null when unknown. */
	const comparator = (part) => {
		const p = part.trim();
		if (p === "" || p === "*" || p === "x" || p === "X") return {
			op: "",
			target: ""
		};
		const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(p);
		if (m === null) return null;
		return {
			op: m[1] ?? "",
			target: (m[2] ?? "").trim()
		};
	};
	/** Evaluate ONE comparator set (a `||` alternative) as a conjunction. */
	const evaluateSet = (set) => {
		const parts = set.trim().split(/\s+/).filter((part) => part !== "");
		if (parts.length === 0) return true;
		const parsed = parts.map((part) => comparator(part));
		if (parsed.some((part) => part === null)) return null;
		if (versionHasPre) {
			if (!parsed.some((part) => {
				if (part?.target === "") return false;
				const tv = parseSemver$1(part?.target ?? "");
				return tv !== null && tv.pre.length > 0 && v.major === tv.major && v.minor === tv.minor && v.patch === tv.patch;
			})) return false;
		}
		const results = parsed.map((part) => single(part?.op !== void 0 ? `${part.op}${part.target}` : ""));
		if (results.some((r) => r === null)) return null;
		return results.every((r) => r === true);
	};
	if (range.includes("||")) {
		const outcomes = range.split("||").map((part) => evaluateSet(part));
		if (outcomes.some((out) => out === true)) return true;
		return outcomes.every((out) => out === null) ? null : false;
	}
	return evaluateSet(range);
}
/** Flatten a tree of entries (group configs included) into row records. */
function flattenEntries(nodes) {
	const rows = [];
	const walk = (list) => {
		for (const node of list) {
			rows.push({
				id: node.id,
				layer: node.layer,
				kind: "insert",
				name: node.name
			});
			if (node.group === true && Array.isArray(node.config)) walk(node.config);
		}
	};
	walk(nodes);
	return rows;
}
/**
* Apply the layer stack over an empty root exactly like the dsh boot include.
* Exported so the trial-start validation (src/trial.ts) can replay the
* composition with a candidate bundle order BEFORE anything is written.
*/
function composeLayers(layers) {
	const tree = [];
	const orphans = [];
	const overrides = [];
	/**
	* The boot's entryMap, mirrored incrementally: the LAST row registered for
	* an id (top-level or nested group member) is the patch target, and later
	* inserts overwrite the map entry — exactly dsh-app-boot's applyEntryPatches
	* buildMap. Keeping the map instead of re-walking the tree pins the
	* duplicate-id resolution to the boot's behavior (issue #98 analysis:
	* explicit composition boundaries).
	*/
	const entryMap = /* @__PURE__ */ new Map();
	const buildMap = (nodes) => {
		for (const node of nodes) {
			if (node.id !== "") entryMap.set(node.id, node);
			if (node.group === true && Array.isArray(node.config)) buildMap(node.config);
		}
	};
	for (const layer of layers) for (const patch of layer.patches) {
		if (!isRecord(patch)) continue;
		const { id, insert, name, ...overridesOf } = patch;
		const hasId = typeof id === "string" ? id !== "" : Boolean(id);
		const lookupKey = hasId ? String(id) : "";
		if (insert) {
			if (!Array.isArray(insert)) {
				orphans.push({
					id: lookupKey === "" ? "(anonymous)" : lookupKey,
					layer: layer.label,
					reason: "insert is not an array"
				});
				continue;
			}
			const nodes = insert.filter(isRecord).map((entry) => {
				if (typeof entry.id !== "string") return null;
				return {
					id: entry.id,
					name: typeof entry.name === "string" ? entry.name : void 0,
					layer: layer.label,
					group: entry.group === true,
					config: Array.isArray(entry.config) ? entry.config : void 0
				};
			}).filter((n) => n !== null);
			if (hasId) {
				const target = entryMap.get(lookupKey);
				if (target === void 0) {
					orphans.push({
						id: lookupKey,
						layer: layer.label,
						reason: "insert target not found"
					});
					continue;
				}
				if (target.group !== true) {
					orphans.push({
						id: lookupKey,
						layer: layer.label,
						reason: "insert target is not a group"
					});
					continue;
				}
				if (!Array.isArray(target.config)) target.config = [];
				target.config = [...target.config, ...nodes];
			} else tree.push(...nodes);
			buildMap(nodes);
			continue;
		}
		if (!hasId) {
			orphans.push({
				id: "(anonymous)",
				layer: layer.label,
				reason: "id required for non-insert patch"
			});
			continue;
		}
		const target = entryMap.get(lookupKey);
		if (target === void 0) {
			orphans.push({
				id: lookupKey,
				layer: layer.label,
				reason: "patch target not found"
			});
			continue;
		}
		if (name && name !== target.name) {
			orphans.push({
				id: lookupKey,
				layer: layer.label,
				reason: `name mismatch (expected ${String(target.name)}, got ${String(name)})`
			});
			continue;
		}
		const priorLayers = [];
		for (const node of flattenEntries(tree)) if (node.id === lookupKey && !priorLayers.includes(node.layer)) priorLayers.push(node.layer);
		if (priorLayers.some((prior) => prior !== layer.label)) overrides.push({
			id: lookupKey,
			layer: layer.label,
			overriddenLayers: priorLayers.filter((prior) => prior !== layer.label)
		});
		for (const [key, value] of Object.entries(overridesOf)) {
			if (key === "id") continue;
			target[key] = value;
		}
	}
	const rows = flattenEntries(tree);
	const byId = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const layers = byId.get(row.id) ?? [];
		if (!layers.includes(row.layer)) layers.push(row.layer);
		byId.set(row.id, layers);
	}
	const duplicates = [];
	const counts = /* @__PURE__ */ new Map();
	for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
	for (const [id, count] of counts) {
		if (count < 2) continue;
		duplicates.push({
			id,
			layers: byId.get(id) ?? [],
			count
		});
	}
	duplicates.sort((a, b) => a.id.localeCompare(b.id));
	return {
		rows,
		duplicates,
		overrides,
		orphans
	};
}
/** Distinct versions of `@deepseek-ai/{dsh,cordis}*` packages in the lockfile. */
function lockfileCoreVersions(profileDir) {
	const found = /* @__PURE__ */ new Map();
	let text;
	try {
		text = readFileSync(join(profileDir, "pnpm-lock.yaml"), "utf8");
	} catch {
		return /* @__PURE__ */ new Map();
	}
	for (const m of text.matchAll(/(@deepseek-ai\/(?:dsh|cordis)[^@\s'"]*?)@([0-9][^\s:'"()]*)/g)) {
		const name = m[1] ?? "";
		const version = m[2] ?? "";
		if (parseSemver$1(version) === null) continue;
		const versions = found.get(name) ?? /* @__PURE__ */ new Set();
		versions.add(version);
		found.set(name, versions);
	}
	const out = /* @__PURE__ */ new Map();
	for (const [name, versions] of found) out.set(name, [...versions].sort(compareSemver));
	return out;
}
/**
* Build the bundle layer stack for a profile under a GIVEN bundle order —
* the manifest order for analyzeProfile, or a candidate order for trial
* validation (src/trial.ts). Bundle resolution mirrors the boot exactly:
* the dsh installation anchor first (in-box bundles always come from the
* running dsh, never a profile-local copy), then Node's module search from
* the profile directory (covers community bundles and pnpm workspace-root
* hoisting). A single code path keeps the check report and the trial
* validation from ever disagreeing about what a bundle is or where it lives.
*/
function buildBundleLayers(profileDirectory, bundleNames, specs, dshInstallDir) {
	const bundles = bundleNames.map((name) => {
		const anchors = [dshInstallDir !== null ? join(dshInstallDir, "package.json") : null, join(profileDirectory, "package.json")];
		let directory = null;
		for (const anchor of anchors) {
			if (anchor === null) continue;
			directory = resolveBundleDir(anchor, name);
			if (directory !== null) break;
		}
		const layer = {
			name,
			source: specs[name] ?? "(not a direct dependency)",
			kind: INBOX_BUNDLES.has(name) ? "official" : "community",
			directory,
			patchPath: null,
			error: null,
			entries: [],
			parseError: null
		};
		if (directory === null) {
			layer.error = "bundle package is not installed — the profile will fail to boot";
			return layer;
		}
		let bundleManifest;
		try {
			bundleManifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
		} catch {
			layer.error = "bundle package.json is unreadable";
			return layer;
		}
		const declared = bundleManifest.dsh?.bundle?.patch;
		if (typeof declared !== "string") {
			layer.error = "bundle declares no dsh.bundle.patch — the profile will fail to boot";
			return layer;
		}
		const patchPath = join(directory, declared);
		if (!existsSync(patchPath)) {
			layer.error = `declared patch ${declared} is missing — the profile will fail to boot`;
			return layer;
		}
		layer.patchPath = patchPath;
		const patches = parsePatchFile(patchPath);
		if (patches === null) {
			layer.parseError = "patch file is not a valid entry list";
			return layer;
		}
		layer.entries = collectInsertIds(patches);
		const order = bundleManifest.dsh?.bundle?.order;
		if (order !== null && typeof order === "object" && !Array.isArray(order)) {
			const listOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : void 0;
			const after = listOf(order.after);
			const before = listOf(order.before);
			if (after !== void 0 || before !== void 0) layer.order = {
				...before !== void 0 ? { before } : {},
				...after !== void 0 ? { after } : {}
			};
		}
		return layer;
	});
	return {
		bundles,
		layers: bundles.map((bundle) => ({
			label: bundle.name,
			kind: "bundle",
			patches: bundle.patchPath !== null && bundle.parseError === null ? parsePatchFile(bundle.patchPath) ?? [] : [],
			parseError: bundle.parseError
		}))
	};
}
/**
* Analyze one profile directory (issue #98, phase 1). Pure function of the
* directory contents — safe to call on every market open.
*/
function analyzeProfile(profileDirectory, options = {}) {
	const dshInstall = options.dshInstallDir ?? findDshInstallDir();
	const home = options.homeDir ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
	const core = corePackageNames(dshInstall);
	const manifest = (() => {
		try {
			return JSON.parse(readFileSync(join(profileDirectory, "package.json"), "utf8"));
		} catch {
			return null;
		}
	})();
	const bundleNames = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles.filter((name) => typeof name === "string") : [];
	const built = buildBundleLayers(profileDirectory, bundleNames, manifest?.dependencies ?? {}, dshInstall);
	const bundles = built.bundles;
	const layers = [...built.layers];
	const userPatchPath = join(profileDirectory, "cordis.patch.yml");
	if (existsSync(userPatchPath)) {
		const patches = parsePatchFile(userPatchPath);
		layers.push({
			label: "user-patch",
			kind: "user",
			patches: patches ?? [],
			parseError: patches === null ? "patch file is not a valid entry list" : null
		});
	}
	const homePatchPath = join(home, "cordis.patch.yml");
	if (existsSync(homePatchPath)) {
		const patches = parsePatchFile(homePatchPath);
		layers.push({
			label: "home-patch",
			kind: "home",
			patches: patches ?? [],
			parseError: patches === null ? "patch file is not a valid entry list" : null
		});
	}
	const composed = composeLayers(layers);
	const peerMismatches = [];
	const seenDeps = /* @__PURE__ */ new Set();
	for (const plugin of installedPackageNames(profileDirectory)) {
		let pkg;
		try {
			pkg = JSON.parse(readFileSync(join(profileDirectory, "node_modules", plugin, "package.json"), "utf8"));
		} catch {
			continue;
		}
		const pluginDir = join(profileDirectory, "node_modules", plugin);
		const map = pkg.peerDependencies;
		if (map === null || typeof map !== "object") continue;
		for (const [name, spec] of Object.entries(map)) {
			if (typeof spec !== "string") continue;
			const key = `${plugin}\u0000${name}\u0000peer`;
			if (seenDeps.has(key)) continue;
			seenDeps.add(key);
			const hoisted = readProfileVisibleVersion(profileDirectory, name);
			const nested = readNodeModulesVersion(pluginDir, name);
			const host = dshInstall !== null ? readNodeModulesVersion(dshInstall, name) : null;
			const resolved = nested ?? hoisted ?? host;
			const satisfied = resolved !== null ? satisfiesRange(resolved, spec) : null;
			peerMismatches.push({
				plugin,
				name,
				range: spec,
				resolved,
				satisfied: satisfied === null ? null : satisfied
			});
		}
	}
	const multiVersion = [];
	for (const [name, versions] of lockfileCoreVersions(profileDirectory)) {
		if (versions.length < 2) continue;
		multiVersion.push({
			name,
			versions,
			hoisted: readProfileVisibleVersion(profileDirectory, name)
		});
	}
	multiVersion.sort((a, b) => a.name.localeCompare(b.name));
	const errors = [];
	const warnings = [];
	for (const bundle of bundles) {
		if (bundle.error !== null) errors.push(`bundle ${bundle.name}: ${bundle.error}`);
		if (bundle.parseError !== null) errors.push(`bundle ${bundle.name}: ${bundle.parseError}`);
	}
	for (const layer of layers) if (layer.parseError !== null && layer.kind !== "bundle") errors.push(`${layer.label}: ${layer.parseError}`);
	for (const dup of composed.duplicates) errors.push(`duplicate loader entry id ${JSON.stringify(dup.id)} (${dup.count} rows: ${dup.layers.join(", ")})`);
	for (const orphan of composed.orphans) warnings.push(`${orphan.layer}: ${orphan.id} — ${orphan.reason}`);
	for (const mismatch of peerMismatches) if (mismatch.satisfied === false) warnings.push(`${mismatch.plugin} peer range ${mismatch.name}@${mismatch.range} does not match resolved ${String(mismatch.resolved)}`);
	for (const mv of multiVersion) {
		const line = `${mv.name}: ${mv.versions.join(" / ")}${mv.hoisted !== null ? ` (hoisted ${mv.hoisted})` : ""}`;
		if (core.has(mv.name)) errors.push(`multiple versions of core package — ${line}`);
		else warnings.push(`multiple versions of ${line}`);
	}
	const orderConflicts = validateOrder(bundleNames, readBundleRules(profileDirectory));
	for (const conflict of orderConflicts) warnings.push(`${conflict.name}: ${conflict.reason}`);
	for (const bundle of bundles) {
		const own = orderConflicts.filter((conflict) => conflict.name === bundle.name);
		if (own.length > 0) bundle.order = {
			...bundle.order,
			conflicts: own
		};
	}
	const suggestedOrder = suggestOrder(bundleNames, readBundleRules(profileDirectory));
	if (suggestedOrder === null) {} else if (!suggestedOrder.ok) warnings.push(`ordering constraints contain a cycle: ${suggestedOrder.cycle.join(" -> ")} — no compliant order exists / 排序约束存在循环依赖，无法得出合规顺序`);
	else if (orderConflicts.length > 0) warnings.push("current bundle order violates declared rules — a better order is suggested / 当前 bundle 顺序违反声明规则，已给出更优顺序");
	const nameCounts = /* @__PURE__ */ new Map();
	for (const row of composed.rows) {
		if (row.name === void 0) continue;
		const layers = nameCounts.get(row.name) ?? [];
		if (!layers.includes(row.layer)) layers.push(row.layer);
		nameCounts.set(row.name, layers);
	}
	const duplicateNames = [];
	for (const [name, layers] of nameCounts) {
		if (layers.length < 2) continue;
		const count = composed.rows.filter((row) => row.name === name).length;
		duplicateNames.push({
			name,
			layers,
			count
		});
	}
	duplicateNames.sort((a, b) => a.name.localeCompare(b.name));
	return {
		profile: profileDirectory,
		scannedAt: Date.now(),
		bundles,
		rows: composed.rows,
		duplicates: composed.duplicates,
		duplicateNames,
		overrides: composed.overrides,
		orphans: composed.orphans,
		peerMismatches,
		multiVersion,
		orderConflicts,
		suggestedOrder,
		summary: {
			ok: errors.length === 0,
			errors,
			warnings
		}
	};
}
//#endregion
//#region lib/types/compatibility.js
/**
* Host-contract compatibility preflight for #195.
*
* Pure evaluation of what `analyzeProfile()` already reports: a confirmed
* peer mismatch (`satisfied === false`) is translated into a directional
* verdict:
*
* - `belowMin`: the resolved version is older than every alternative's lower
*   bound — the environment is too old for the plugin's declared contract.
* - `aboveMax`: the resolved version is newer than every alternative's upper
*   bound (or the exact pin). This is only a risk when the author expressed
*   an explicit upper bound or exact pin; otherwise it is a warning, because
*   the ecosystem currently has many sloppy `^0.0.1`-style declarations that
*   work in practice.
*
* Everything else stays informational: `*`, prerelease-vs-`*` artifacts,
* unparseable ranges, and optional peers never produce a risk here.
*/
const SEMVER$1 = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function parseComparator(part) {
	const p = part.trim();
	const m = /^(\^|~|>=|<=|>|<)?(.*)$/.exec(p);
	if (m === null) return null;
	const target = (m[2] ?? "").trim();
	if (!SEMVER$1.test(target)) return null;
	const raw = m[1] ?? "";
	return {
		op: raw === "" ? "exact" : raw,
		target
	};
}
/** Next breaking bump for `^` / `~`, using `-0` so prereleases compare consistently. */
function nextBound(target, kind) {
	const m = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(target);
	if (m === null) return null;
	const major = Number(m[1]);
	const minor = Number(m[2]);
	const patch = Number(m[3]);
	if (kind === "^") {
		if (major > 0) return `${major + 1}.0.0-0`;
		if (minor > 0) return `0.${minor + 1}.0-0`;
		return `0.0.${patch + 1}-0`;
	}
	return `${major}.${minor + 1}.0-0`;
}
function boundsFor(range) {
	const alternatives = [];
	for (const rawAlternative of range.split("||")) {
		const parsed = rawAlternative.trim().split(/\s+/).filter(Boolean).map(parseComparator);
		if (parsed.some((part) => part === null)) return null;
		let lower = null;
		let upper = null;
		let explicitUpper = false;
		let exact = null;
		for (const part of parsed) {
			const p = part;
			if (p.op === "exact") {
				exact = p.target;
				continue;
			}
			if (p.op === "^" || p.op === "~") {
				const bound = nextBound(p.target, p.op);
				if (bound === null) return null;
				if (lower === null || compareSemver(p.target, lower.target) > 0) lower = p;
				if (upper === null || compareSemver(bound, upper.target) < 0) upper = {
					op: "<=",
					target: bound
				};
				continue;
			}
			if (p.op === ">=" || p.op === ">") {
				if (lower === null || compareSemver(p.target, lower.target) > 0) lower = p;
			} else {
				if (upper === null || compareSemver(p.target, upper.target) < 0) upper = p;
				explicitUpper = true;
			}
		}
		alternatives.push({
			lower,
			upper,
			explicitUpper,
			exact
		});
	}
	return alternatives;
}
function belowAllMins(resolved, bounds) {
	return bounds.every((alternative) => {
		if (alternative.exact !== null) return compareSemver(resolved, alternative.exact) < 0;
		if (alternative.lower === null) return false;
		const lower = alternative.lower;
		return lower.op === ">" ? compareSemver(resolved, lower.target) <= 0 : compareSemver(resolved, lower.target) < 0;
	});
}
function aboveAllMaxes(resolved, bounds) {
	return bounds.every((alternative) => {
		if (alternative.exact !== null) return compareSemver(resolved, alternative.exact) > 0;
		if (alternative.upper === null) return false;
		const upper = alternative.upper;
		return upper.op === "<" ? compareSemver(resolved, upper.target) >= 0 : compareSemver(resolved, upper.target) > 0;
	});
}
function hasExplicitUpperOrExact(bounds) {
	return bounds.every((alternative) => alternative.exact !== null || alternative.explicitUpper);
}
/** Translate one confirmed peer mismatch into a directional verdict. */
function classifyPeer(plugin, peer, range, resolved, optional) {
	if (resolved === null) return { kind: "none" };
	if (optional) return {
		kind: "warning",
		warning: {
			plugin,
			peer,
			range,
			resolved,
			reason: "optional"
		}
	};
	const bounds = boundsFor(range);
	if (bounds === null) return { kind: "none" };
	if (belowAllMins(resolved, bounds)) return {
		kind: "risk",
		risk: {
			plugin,
			peer,
			range,
			resolved,
			direction: "belowMin"
		}
	};
	if (aboveAllMaxes(resolved, bounds)) return hasExplicitUpperOrExact(bounds) ? {
		kind: "risk",
		risk: {
			plugin,
			peer,
			range,
			resolved,
			direction: "aboveMax"
		}
	} : {
		kind: "warning",
		warning: {
			plugin,
			peer,
			range,
			resolved,
			reason: "aboveMax"
		}
	};
	return { kind: "none" };
}
/** Whether a peer is declared optional in the installed plugin manifest. */
function isOptionalPeer(profileDirectory, plugin, peer) {
	return readInstalledManifest("web", plugin, profileDirectory)?.peerDependenciesMeta?.[peer]?.optional === true;
}
/** Evaluate the current profile with the same machinery `/dsh-market/check` uses. */
function assessCompatibility(profileDirectory, options) {
	const report = analyzeProfile(profileDirectory, options);
	const risks = [];
	const warnings = [];
	for (const mismatch of report.peerMismatches) {
		if (mismatch.satisfied !== false) continue;
		const optional = isOptionalPeer(profileDirectory, mismatch.plugin, mismatch.name);
		const verdict = classifyPeer(mismatch.plugin, mismatch.name, mismatch.range, mismatch.resolved, optional);
		if (verdict.kind === "risk") risks.push(verdict.risk);
		else if (verdict.kind === "warning") warnings.push(verdict.warning);
	}
	return {
		risks,
		warnings,
		duplicateNames: report.duplicateNames
	};
}
function riskId(risk) {
	return `${risk.plugin}\u0000${risk.peer}\u0000${risk.direction}`;
}
/** Risks present after a mutation but absent before it. */
function introducedRisks(before, after) {
	const seen = new Set(before.risks.map(riskId));
	return after.risks.filter((risk) => !seen.has(riskId(risk)));
}
/**
* Cross-layer name collisions present after a mutation but absent before it
* (#230 by @dxc-dxc).
*
* Keyed by NAME alone, not by the layer set: a collision the operation made
* worse — same name, now shadowing across one more layer — is still the same
* collision the profile already had, and re-reporting it would put the
* operator back in front of a problem they did not just cause.
*
* This is what makes surfacing these safe at all. The underlying
* `duplicateNames` is informational precisely because a healthy-but-messy
* profile can carry collisions indefinitely; only the newly introduced ones
* are attributable to the install that just ran, and therefore undoable by
* rolling it back.
*/
function introducedDuplicateNames(before, after) {
	const seen = new Set(before.duplicateNames.map((entry) => entry.name));
	return after.duplicateNames.filter((entry) => !seen.has(entry.name));
}
/** Convenience wrapper matching the profile helper signature. */
function assessProfile(profile, explicitDir) {
	return assessCompatibility(profileDir(profile, explicitDir));
}
//#endregion
//#region lib/types/agents.js
/**
* Optional host-provided agent inventory: lets the market refuse plugin
* mutations while a live agent is mid-turn. Mutating `node_modules` under a
* running agent replaces files the running plugin modules may still read or
* lazily import — the update "succeeds" while old code and new files mix.
*/
/**
* Ids of the host's currently running agents, or [] when the host has no
* agents service. Only a positive `status === 'running'` blocks an update —
* unknown statuses are treated as not running, so a future agent
* implementation with different wording fails open (the market stays
* usable) instead of wedging the plugin page.
*/
function runningAgentIds(agents) {
	if (agents === void 0) return [];
	let listed;
	try {
		listed = agents.list();
	} catch {
		return [];
	}
	if (!Array.isArray(listed)) return [];
	const ids = [];
	for (const agent of listed) {
		if (agent === null || typeof agent !== "object" || agent.status !== "running") continue;
		const id = typeof agent.id === "string" && agent.id !== "" ? agent.id : "agent";
		if (!ids.includes(id)) ids.push(id);
	}
	return ids;
}
//#endregion
//#region lib/types/trial.js
/**
* Trial validation for composition changes — issue #98 (phase 3), the
* "trial boot" half of #19 reduced to what is safe and offline: before any
* bundle-order or preset change is written to the profile, replay the
* composition with the CANDIDATE order using the same entry-list machinery
* the real boot uses (src/check.ts's buildBundleLayers + composeLayers), and
* refuse the change when the composed tree would fail to boot (duplicate
* loader entry ids, unresolvable bundle layers, unparseable patches).
*
* No process, no network, no writes to the profile: the real profile is only
* read; if the candidate is bad, the failure is reported and nothing is
* applied (the caller then skips the write-back entirely).
*
* Issue #125 review: the CURRENT composition is replayed alongside the
* candidate, so the response also carries a current-vs-candidate diff
* (overrides / orphans / duplicates the reorder introduces) — not just
* whether it boots.
*
* Bundle resolution is deliberately SHARED with the check report
* (check.ts's buildBundleLayers): the dsh installation anchor first, then
* Node's module search from the profile (workspace-root hoisting) — so the
* trial can never disagree with the diagnostics about what a bundle is or
* where it lives, and official bundles resolve even when they are only
* hoisted to the workspace root.
*/
/**
* Replay the profile composition with `newCommunityOrder` (the candidate
* community-bundle order; official bundles keep their exact positions) and
* report anything that would break the boot. Pure read.
*/
function trialValidate(profileDir, newCommunityOrder, options = {}) {
	const errors = [];
	const warnings = [];
	const current = readBundleStack(profileDir);
	const merged = mergeOrder(current.bundles, newCommunityOrder);
	if (!merged.ok) return {
		ok: false,
		errors: [{
			layer: "(order)",
			message: merged.error
		}],
		warnings,
		duplicates: [],
		rows: [],
		diff: {
			overrides: [],
			orphans: [],
			duplicates: []
		}
	};
	const candidate = merged.bundles;
	let specs = {};
	try {
		specs = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8")).dependencies ?? {};
	} catch {}
	const dshInstall = options.dshInstallDir !== void 0 ? options.dshInstallDir : findDshInstallDir();
	const patchLayers = [];
	const userPatchPath = join(profileDir, "cordis.patch.yml");
	if (existsSync(userPatchPath)) {
		const patches = parsePatchFile(userPatchPath);
		patchLayers.push({
			label: "user-patch",
			kind: "user",
			patches: patches ?? [],
			parseError: null
		});
		if (patches === null) errors.push({
			layer: "user-patch",
			message: "cordis.patch.yml is not a valid entry list / cordis.patch.yml 不是合法的条目列表"
		});
	}
	const homePatchPath = join(options.homeDir ?? process.env.DSH_HOME ?? join(homedir(), ".dsh"), "cordis.patch.yml");
	if (existsSync(homePatchPath)) {
		const patches = parsePatchFile(homePatchPath);
		patchLayers.push({
			label: "home-patch",
			kind: "home",
			patches: patches ?? [],
			parseError: null
		});
		if (patches === null) errors.push({
			layer: "home-patch",
			message: "home cordis.patch.yml is not a valid entry list / 全局 cordis.patch.yml 不是合法的条目列表"
		});
	}
	/** Compose the loader tree for one bundle order (current or candidate). */
	const compose = (bundleOrder) => {
		const built = buildBundleLayers(profileDir, bundleOrder, specs, dshInstall);
		return {
			built,
			composed: composeLayers([...built.layers, ...patchLayers])
		};
	};
	const currentState = compose(current.bundles);
	const candidateState = compose(candidate);
	const composed = candidateState.composed;
	for (const bundle of candidateState.built.bundles) {
		if (bundle.error !== null) errors.push({
			layer: bundle.name,
			message: bundle.error
		});
		if (bundle.parseError !== null) errors.push({
			layer: bundle.name,
			message: bundle.parseError
		});
	}
	for (const dup of composed.duplicates) errors.push({
		layer: dup.layers.join(" / "),
		message: `duplicate loader entry id ${JSON.stringify(dup.id)} (${dup.count} rows) / 重复的 loader 条目 id ${JSON.stringify(dup.id)}`
	});
	for (const orphan of composed.orphans) warnings.push({
		layer: orphan.layer,
		message: `${orphan.id}: ${orphan.reason}`
	});
	const currentDupIds = new Set(currentState.composed.duplicates.map((d) => d.id));
	const sameOverride = (a, b) => a.id === b.id && a.layer === b.layer && a.overriddenLayers.join("\0") === b.overriddenLayers.join("\0");
	const diff = {
		overrides: composed.overrides.filter((o) => !currentState.composed.overrides.some((c) => sameOverride(o, c))),
		orphans: composed.orphans.filter((o) => !currentState.composed.orphans.some((c) => c.id === o.id && c.layer === o.layer)),
		duplicates: composed.duplicates.filter((d) => !currentDupIds.has(d.id))
	};
	return {
		ok: errors.length === 0,
		errors,
		warnings,
		duplicates: composed.duplicates,
		rows: composed.rows.map((row) => ({
			id: row.id,
			layer: row.layer
		})),
		diff
	};
}
//#endregion
//#region lib/types/store.js
/**
* pnpm store hygiene: reclaim staging directories orphaned by aborted runs.
*
* pnpm extracts every fetched tarball under the store's `tmp/` directory as
* `tmp/_tmp_<pid>_<hex>/`. A run that is killed, cancelled, or timed out —
* or one that hard-fails mid-fetch — never finishes that staging step, so
* the directory survives. For `github:` sources the staged payload is the
* WHOLE repository tarball, so a single aborted install can leave hundreds
* of megabytes behind (e.g. an OpenViking monorepo install killed at ~88MB).
*
* The directory name carries the owning pnpm process id, which makes
* reclamation safe by construction: when that pid is gone, no live download
* can be using the directory. Live pnpm tmp dirs are never touched.
*/
/** pnpm store tmp staging prefix: `_tmp_<pid>_<random-hex>/`. */
const ORPHAN_TMP_RE = /^_tmp_(\d+)_/;
/** True when the process with this pid is still running (EPERM = exists). */
function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}
/**
* Remove every orphaned staging directory under a pnpm store's `tmp/` whose
* owning pid is no longer alive. Directories that do not match the pnpm
* staging shape, and any that are locked or in use, are left alone.
* @param storePath - the pnpm store root (as printed by `pnpm store path`).
* @returns the removed directory names.
*/
function cleanOrphanedStoreTmp(storePath) {
	const tmp = join(storePath, "tmp");
	let entries;
	try {
		entries = readdirSync(tmp, { withFileTypes: true });
	} catch {
		return [];
	}
	const removed = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const m = ORPHAN_TMP_RE.exec(entry.name);
		if (m === null) continue;
		const pid = Number(m[1]);
		if (pid > 0 && pidAlive(pid)) continue;
		try {
			rmSync(join(tmp, entry.name), {
				recursive: true,
				force: true
			});
			removed.push(entry.name);
		} catch {}
	}
	return removed;
}
/**
* Resolve the active profile's pnpm store root through the same runner the
* market uses for installs (so both the web and Desktop pnpm paths agree)
* and reclaim its orphaned staging directories.
* @returns the removed directory names, empty when the store cannot be resolved.
*/
async function cleanOrphanedStore(run, profile) {
	let result;
	try {
		result = await run(profile, ["store", "path"]);
	} catch {
		return [];
	}
	if (result.exitCode !== 0 || result.cancelled) return [];
	const lines = result.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
	const storePath = lines[lines.length - 1] ?? "";
	if (storePath === "" || !isAbsolute(storePath)) return [];
	const removed = cleanOrphanedStoreTmp(storePath);
	if (removed.length > 0) logEvent("info", "install", `removed ${removed.length} orphaned pnpm store tmp dir(s) under ${storePath}: ${removed.slice(0, 3).join(", ")}${removed.length > 3 ? ", …" : ""}`);
	return removed;
}
//#endregion
//#region lib/types/install.js
/**
* Install orchestration: collection-repo retargeting, post-install
* validation that keeps broken pieces from bricking the next boot, and
* update staleness detection. Every function takes the plugin runner as a
* parameter so tests can substitute a recording fake.
*/
/** One-shot bypass for pnpm's fresh-release hold; scoped to a single command. */
const RELEASE_AGE_OVERRIDE = "--config.minimumReleaseAge=0";
/**
* Longer per-request fetch timeout for one retried command. pnpm's default
* 60-second limit aborts large tarball downloads (github: sources fetch the
* WHOLE repo even for a `#path:` subdirectory plugin) on slow networks; a
* plain retry fails again at the same limit, so the recovery re-runs with
* this override once. Scoped to a single command like RELEASE_AGE_OVERRIDE.
*/
const FETCH_TIMEOUT_OVERRIDE = "--config.fetchTimeout=600000";
/**
* Run one plugin command with automatic recovery from three known pnpm traps:
*
* - pnpm-major drift (#20 bug 2): a modules directory built by a different
*   pnpm major fails mutation; pnpm's documented remedy is one `install` to
*   recreate it — do that silently and retry the original command once.
* - release-age lockfile lock (#39): once a too-young release is in the
*   lockfile, pnpm 11 rejects EVERY later add/remove during verification —
*   retry once with the one-shot minimumReleaseAge bypass (safe: the young
*   package is already installed; the bypass only lets pnpm touch the
*   lockfile again).
* - per-request fetch timeout: large tarballs (github: sources fetch the
*   whole repo even for a `#path:` subdirectory) on slow networks blow
*   pnpm's default 60-second limit; a plain retry fails again at the same
*   limit, so retry once with a longer fetchTimeout.
*
* Any recognized failure that survives gets its bilingual explanation
* appended to stderr so the UI shows an actionable message instead of a
* wall of text (#20 bug 3). Cancelled runs are never recovered.
*/
async function withHoistRecovery(run, profile, pluginArgs) {
	let result = await run(profile, pluginArgs);
	const ok = (r) => r.exitCode === 0 && !r.timedOut && !r.cancelled;
	if (!ok(result) && !result.cancelled) {
		const failure = classifyPnpmFailure(`${result.stderr}\n${result.stdout}`);
		if (failure?.code === "hoist-pattern-diff") {
			logEvent("warn", "install", `modules dir was built by a different pnpm major — rebuilding (pnpm install) and retrying once`);
			if (ok(await run(profile, ["install", "--no-frozen-lockfile"]))) result = await run(profile, pluginArgs);
		} else if (failure?.code === "release-age-violation" && (pluginArgs[0] === "add" || pluginArgs[0] === "remove") && !pluginArgs.includes("--config.minimumReleaseAge=0")) {
			logEvent("warn", "install", `a too-young release blocks pnpm's lockfile verification (#39) — retrying once with ${RELEASE_AGE_OVERRIDE}`);
			result = await run(profile, [
				pluginArgs[0],
				RELEASE_AGE_OVERRIDE,
				...pluginArgs.slice(1)
			]);
		} else if (failure?.code === "transient-network" && (pluginArgs[0] === "add" || pluginArgs[0] === "remove")) {
			logEvent("warn", "install", `transient network failure while pnpm replayed the dependency tree (#83) — retrying once`);
			result = await run(profile, pluginArgs);
		} else if (failure?.code === "fetch-timeout" && (pluginArgs[0] === "add" || pluginArgs[0] === "remove") && !pluginArgs.includes("--config.fetchTimeout=600000")) {
			logEvent("warn", "install", `pnpm's per-request fetch timeout aborted a large download — retrying once with ${FETCH_TIMEOUT_OVERRIDE}`);
			result = await run(profile, [
				pluginArgs[0],
				FETCH_TIMEOUT_OVERRIDE,
				...pluginArgs.slice(1)
			]);
		}
	}
	if (!ok(result) && !result.cancelled) {
		await cleanOrphanedStore(run, profile);
		const failure = classifyPnpmFailure(`${result.stderr}\n${result.stdout}`);
		if (failure !== null) result = {
			...result,
			stderr: `${result.stderr}\n\n${failure.message}`
		};
		else if (result.pnpmError !== void 0 && result.pnpmError !== "") {
			const code = result.pnpmErrorCode === void 0 ? "" : `${result.pnpmErrorCode}: `;
			result = {
				...result,
				stderr: `${result.stderr}\n\n${code}${result.pnpmError}`
			};
		}
	}
	return result;
}
/**
* The most specific description of a failed run available, for logs.
*
* pnpm's structured error beats the stderr tail whenever there is one — see
* withHoistRecovery above for why the tail is nearly worthless here.
*/
function failureDetail(result, limit = 300) {
	if (result.pnpmError !== void 0 && result.pnpmError !== "") return `${result.pnpmErrorCode === void 0 ? "" : `${result.pnpmErrorCode}: `}${result.pnpmError}`.slice(0, limit);
	return (result.stderr || result.stdout).slice(-limit);
}
/**
* Some registry entries point at collection repos whose actual plugin lives
* in a subdirectory — the root has no package.json (or a workspace root with
* no dsh surface), and pnpm installs the bare fileset with exit 0. Detect
* that junk install, drop it, and re-add each plugin subdirectory through
* pnpm's `#path:` selector (#18).
* @returns overall success (true when nothing needed retargeting).
*/
async function retargetCollections(run, profile, before, target, explicitDir) {
	if (!target.startsWith("github:")) return true;
	const dir = profileDir(profile, explicitDir);
	const junk = Object.keys(readInstalled(profile, dir)).filter((name) => {
		if (before.has(name)) return false;
		const root = join(dir, "node_modules", name);
		if (!existsSync(join(root, "package.json"))) return true;
		return !hasDshManifest(root);
	});
	let allOk = true;
	for (const name of junk) {
		const candidates = pluginSubdirs(join(dir, "node_modules", name));
		logEvent("info", "install", `${name}: collection repo (root declares no dsh manifest); plugins inside: ${candidates.join(", ") || "none"}`);
		await run(profile, ["remove", name]);
		if (candidates.length === 0) {
			allOk = false;
			continue;
		}
		for (const sub of candidates) {
			const result = await run(profile, ["add", `${target}#path:/${sub}`]);
			if (result.exitCode !== 0 || result.timedOut) {
				allOk = false;
				logEvent("error", "install", `${target}#path:/${sub}: exit=${String(result.exitCode)}${result.timedOut ? " TIMEOUT" : ""} — ${(result.stderr || result.stdout).slice(-220)}`);
			}
		}
	}
	return allOk;
}
/**
* Fake-success guard (#18): validate every package the install added. A
* piece without a dsh manifest or without its declared entry artifact
* (source-only checkout, build blocked by pnpm allowBuilds) would brick the
* next boot, so it is removed on the spot.
*
* Since #122 this also covers duplicate loader entry ids: cordis refuses to
* load a tree containing two entries with one id, so a TUI bundle landing in
* a web profile (both declare `id: storage`) leaves DSH unable to START —
* an error naming neither plugin, from which the market's own page is
* unreachable. Such a package is removed like any other bricking piece.
* @returns names kept, names removed as broken, and the id conflicts found.
*/
async function validateAddedPlugins(run, profile, before, explicitDir) {
	const dir = profileDir(profile, explicitDir);
	const addedNow = Object.keys(readInstalled(profile, dir)).filter((n) => !before.has(n));
	const keep = [];
	const removedBroken = [];
	const conflicts = [];
	const existingBundles = readProfileBundles(dir).filter((name) => !addedNow.includes(name));
	for (const n of addedNow) {
		if (!hasDshManifest(join(dir, "node_modules", n)) || !hasLoadableEntry(dir, n)) {
			removedBroken.push(n);
			await run(profile, ["remove", n]);
			continue;
		}
		const clash = conflictingEntryIds(dir, n, existingBundles);
		if (clash.length > 0) {
			conflicts.push(...clash.map((hit) => ({
				name: n,
				...hit
			})));
			removedBroken.push(n);
			logEvent("error", "install", `${n}: loader entry id conflict with ${clash[0].owner} (${clash.map((hit) => hit.id).join(", ")}) — removing, it would break the next boot`);
			await run(profile, ["remove", n]);
			continue;
		}
		keep.push(n);
	}
	return {
		keep,
		removedBroken,
		conflicts
	};
}
/**
* Group flat `{id, owner}` conflict hits by the installed plugin that owns
* them. What the user has to decide is which PLUGINS to uninstall, not which
* ids to resolve, so one row per owner is the unit the market renders and
* acts on. Flattening the other way (one row per id) also misattributes when
* a candidate clashes with several installed plugins at once.
* @param conflicts flat hits as returned by {@link validateAddedPlugins}.
* @returns one entry per owner, owners and ids both in first-seen order.
*/
function groupConflictsByOwner(conflicts) {
	const byOwner = /* @__PURE__ */ new Map();
	for (const hit of conflicts) {
		const ids = byOwner.get(hit.owner);
		if (ids === void 0) byOwner.set(hit.owner, [hit.id]);
		else if (!ids.includes(hit.id)) ids.push(hit.id);
	}
	return [...byOwner].map(([owner, ids]) => ({
		owner,
		ids
	}));
}
/**
* Whether a clean-exit update actually changed nothing — pnpm's
* minimumReleaseAge silently keeps the old version and exits 0 when the new
* release is "too young" (#13, #22), so a clean exit alone does not mean the
* update happened.
*/
function isStaleUpdate(check) {
	return check.isGit ? check.beforeCommit !== null && check.afterCommit === check.beforeCommit : check.beforeVersion !== null && check.afterVersion === check.beforeVersion;
}
/**
* The package pnpm's fetcher refused to prepare because its build script is
* not allowlisted — `The git-hosted package "name@2.8.0" needs to execute
* build scripts but is not in the "allowBuilds" allowlist.` Null when the
* output is not this failure. Unlike ignored-builds, the package is NOT in
* node_modules yet (the fetcher rejects before materialization, #68).
*/
function parsePrepareNotAllowed(stdout, stderr) {
	const text = `${stdout}\n${stderr}`.replace(/\\"/g, "\"");
	const m = /git-hosted package "([^"]+)" needs to execute build scripts/.exec(text);
	if (m === null) return null;
	const raw = m[1].trim();
	const at = raw.lastIndexOf("@");
	return at > 0 ? raw.slice(0, at) : raw;
}
/**
* Package names pnpm reported as having their build scripts ignored
* ("Ignored build scripts: esbuild, koffi."). Empty when none.
* (#6 by @qichuang321.)
*/
function parseIgnoredBuilds(stdout, stderr) {
	const m = /Ignored build scripts:?\s*([^\n]+)/i.exec(`${stdout}\n${stderr}`);
	if (m === null) return [];
	const found = [];
	for (const chunk of m[1].split(",")) {
		const trimmed = chunk.trim().replace(/\.$/, "");
		if (trimmed === "") continue;
		const at = trimmed.lastIndexOf("@");
		const name = at > 0 ? trimmed.slice(0, at) : trimmed;
		if (name !== "" && !found.includes(name)) found.push(name);
	}
	return found;
}
//#endregion
//#region lib/types/updates.js
/**
* Update detection: per-plugin comparison of what the profile has against
* the source of truth — git HEAD for github installs, the npm latest
* dist-tag for registry installs — with a TTL cache.
*/
const UPDATES_TTL_MS = 1800 * 1e3;
let updatesCache = null;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseSemver(v) {
	const m = SEMVER.exec(v.trim());
	if (m === null) return null;
	return {
		core: [
			Number(m[1]),
			Number(m[2]),
			Number(m[3])
		],
		pre: m[4] === void 0 ? [] : m[4].split(".")
	};
}
/**
* Semver precedence: negative / 0 / positive like a comparator, or null when
* either side isn't a plain semver version. Build metadata is ignored, a
* release outranks any prerelease of the same core, and prerelease
* identifiers compare numerically when both are numeric (so `rc.10` > `rc.9`).
*/
function compareVersions(a, b) {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (pa === null || pb === null) return null;
	for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
	if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;
	for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
		const x = pa.pre[i];
		const y = pb.pre[i];
		if (x === void 0) return -1;
		if (y === void 0) return 1;
		if (x === y) continue;
		const nx = /^\d+$/.test(x);
		const ny = /^\d+$/.test(y);
		if (nx && ny) return Number(x) - Number(y);
		if (nx !== ny) return nx ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}
/**
* True only when the registry's `latest` is semantically HIGHER than what the
* profile has (#64 by @ZeroOrigin64). A plain `!==` also fires when a
* package's `latest` dist-tag is left pointing at an OLDER release than the
* pinned install — clicking "update" then rewrote the exact pin to `@latest`
* and downgraded the profile until it no longer booted.
*
* Undecidable inputs (missing or non-semver versions) report no update:
* without a direction we cannot promise the "update" isn't a downgrade.
*/
function isUpgrade(installed, latest) {
	if (installed === null || latest === null) return false;
	const cmp = compareVersions(latest, installed);
	return cmp !== null && cmp > 0;
}
/** Drop the cached listing (after a successful install/update/uninstall). */
function invalidateUpdates() {
	updatesCache = null;
}
async function fetchJson(url) {
	const res = await marketFetch(url, {
		headers: {
			accept: "application/json",
			"user-agent": "dsh-market"
		},
		signal: AbortSignal.timeout(1e4)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}
/**
* Evidence check behind the "wait a day" stale diagnosis (#45): whether the
* package's CURRENT latest release was published recently enough to sit
* inside pnpm's default fresh-release window. pnpm's silent hold leaves no
* trace in its output, so the publish time is the only verifiable signal.
* @returns true/false when the npm time metadata answers, null when it
*   can't be determined (offline, unpublished, non-npm) — callers must NOT
*   claim the safety wait on null.
*/
async function latestPublishedRecently(name, windowMs = 1560 * 60 * 1e3) {
	try {
		const doc = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
		const latest = doc["dist-tags"]?.latest;
		const published = latest !== void 0 ? doc.time?.[latest] : void 0;
		if (published === void 0) return null;
		const age = Date.now() - Date.parse(published);
		return Number.isFinite(age) ? age < windowMs : null;
	} catch {
		return null;
	}
}
/** The registry's current `latest` version for a package, or null when it can't be read. */
/**
* The version a channel subscriber should be offered: the newest build in
* the set that channel is willing to receive.
*
* A channel is a SET, not a tag. Someone on beta has not stopped accepting
* releases — they accept releases and prereleases — so beta means
* {latest, beta} and dev means {latest, beta, dev}. Reading it as one tag
* gets a real case wrong: once 1.14.0 ships, `beta` still points at
* 1.14.0-beta.1 until the next prerelease is cut, and following that tag
* literally would walk a subscriber BACKWARDS onto a build their channel
* has already moved past.
*
* The nesting is also what makes a channel leavable. Going backwards is
* only ever offered when the user narrows the set — picking stable while a
* prerelease is installed drops `beta` out of it, so the answer becomes
* `latest` and the market can finally offer the way back. That case used to
* be unreachable: comparing 1.13.1 against an installed 1.14.0-beta.1 found
* nothing newer and answered "up to date", so the control the user had just
* used appeared to do nothing.
*
* @param stable - the `latest` version, already fetched by the caller.
*/
async function versionOnChannel(name, channel, stable) {
	let best = stable;
	for (const tag of EXTRA_TAGS[channel]) {
		const candidate = await tagVersion(name, tag);
		if (candidate !== null && (best === null || isUpgrade(best, candidate))) best = candidate;
	}
	return best;
}
/** Tags a channel adds on top of `latest`, widest channel last. */
const EXTRA_TAGS = {
	stable: [],
	beta: [DIST_TAG.beta],
	dev: [DIST_TAG.beta, DIST_TAG.dev]
};
/** One dist-tag's version, or null when it isn't published or can't be read. */
async function tagVersion(name, tag) {
	try {
		const meta = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/${tag}`);
		return typeof meta.version === "string" ? meta.version : null;
	} catch {
		return null;
	}
}
async function fetchNpmLatest(name) {
	try {
		const meta = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
		return typeof meta.version === "string" ? meta.version : null;
	} catch {
		return null;
	}
}
/** Per-plugin update checks; a failed check reports no update rather than failing the listing. */
async function checkUpdates(profile, force = false, explicitDir, channelFor = /* @__PURE__ */ new Map()) {
	const activeProfileDir = profileDir(profile, explicitDir);
	const cacheKey = `${activeProfileDir}\u0000${[...channelFor].map(([n, c]) => `${n}:${c}`).sort().join(",")}`;
	if (!force && updatesCache?.key === cacheKey && Date.now() - updatesCache.at < UPDATES_TTL_MS) return updatesCache.data;
	const installed = readInstalled(profile, activeProfileDir);
	const lockCommits = readLockCommits(profile, activeProfileDir);
	const result = {};
	await Promise.all(Object.entries(installed).map(async ([name, spec]) => {
		const version = readInstalledVersion(profile, name, activeProfileDir);
		if (spec.startsWith("link:") || spec.startsWith("file:")) {
			result[name] = {
				kind: "linked",
				version,
				current: null,
				latest: null,
				updateAvailable: false
			};
			return;
		}
		const gh = /^(?:github:)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:#.*)?$/.exec(spec);
		try {
			if (spec.startsWith("github:") && gh !== null) {
				const current = lockCommits.get(gh[1].toLowerCase()) ?? null;
				const head = await fetchJson(`https://api.github.com/repos/${gh[1]}/commits/HEAD`);
				const latest = typeof head.sha === "string" ? head.sha : null;
				result[name] = {
					kind: "github",
					version,
					current,
					latest,
					updateAvailable: current !== null && latest !== null && current !== latest
				};
			} else {
				const meta = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
				const stable = typeof meta.version === "string" ? meta.version : null;
				const channel = channelFor.get(name);
				const latest = channel === void 0 ? stable : await versionOnChannel(name, channel, stable);
				const upgrade = isUpgrade(version, latest);
				result[name] = {
					kind: "npm",
					version,
					current: version,
					latest,
					updateAvailable: upgrade,
					...channel !== void 0 && !upgrade && version !== null && latest !== null && version !== latest ? { channelSwitch: latest } : {}
				};
			}
		} catch {
			result[name] = {
				kind: spec.startsWith("github:") ? "github" : "npm",
				version,
				current: null,
				latest: null,
				updateAvailable: false
			};
		}
	}));
	updatesCache = {
		key: cacheKey,
		at: Date.now(),
		data: result
	};
	return result;
}
//#endregion
//#region lib/types/themes.js
/**
* Theme lifecycle: classifying installed packages as themes (by the
* registry's theme category), live-toggling bundle-layer entries through
* the loader, and keeping exactly one theme active with the choice
* persisted across restarts.
*/
/**
* Create the theme manager. `disabledThemes` is the live, shared set of
* themes the user switched off — the caller owns reading it at boot and
* replaying it; the manager mutates and persists it on switches.
*/
function createThemeManager(host, profile, disabledThemes, explicitDir) {
	const activeProfileDir = profileDir(profile, explicitDir);
	/** Installed package names classified as themes by the registry's theme category. */
	async function installedThemeNames() {
		const names = /* @__PURE__ */ new Set();
		try {
			const themeEntries = (await loadRegistry()).plugins.filter((p) => p.category === "theme");
			const themeNames = new Set(themeEntries.map((p) => p.name));
			const themeRepos = new Set(themeEntries.map((p) => repoOf(p.url)).filter((r) => r !== null).map((r) => r.toLowerCase()));
			for (const [name, spec] of Object.entries(readInstalled(profile, activeProfileDir))) {
				if (themeNames.has(name)) {
					names.add(name);
					continue;
				}
				const match = /github:([^#\s]+)/.exec(String(spec).toLowerCase());
				if (match !== null && themeRepos.has(match[1])) names.add(name);
			}
		} catch {}
		return names;
	}
	/**
	* Live-toggle a bundle-layer plugin through its loader entry. Bundle trees
	* are in-memory (write is a no-op), so this never touches any file — the
	* market persists the choice itself and replays it at boot.
	* @returns true when a matching live entry was found and updated.
	*/
	async function setEntryDisabled(name, disabledFlag) {
		let found = false;
		for (const entry of host.loader.entries()) {
			if (entry.options.name !== name) continue;
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					await entry.update({ disabled: disabledFlag ? true : null }, false, true);
					found = true;
				} catch (error) {
					logEvent("warn", "toggle", `${name}: entry update failed — ${error instanceof Error ? error.message : String(error)}`);
					break;
				}
				if (entry.fiber !== void 0 !== disabledFlag) break;
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
			}
			logEvent("info", "toggle", `${name} -> ${disabledFlag ? "off" : "on"}: fiber=${String(entry.fiber !== void 0)}`);
		}
		if (!found) logEvent("info", "toggle", `${name}: no loader entry matched`);
		return found;
	}
	/**
	* Make `name` the one active theme: deactivate every other installed theme
	* (market hot mounts unmount; bundle-layer entries live-disable) and bring
	* it up. The choice persists in state.json and is replayed at boot.
	*/
	async function activateTheme(name) {
		const themes = await installedThemeNames();
		for (const other of themes) {
			if (other === name) continue;
			if (listHotMounts().includes(other)) {
				await hotUnmount(other);
				disabledThemes.add(other);
			} else if (await setEntryDisabled(other, true)) disabledThemes.add(other);
		}
		disabledThemes.delete(name);
		writeDisabled(activeProfileDir, disabledThemes);
		if (listHotMounts().includes(name)) return true;
		if (await setEntryDisabled(name, false)) return true;
		return (await hotMount(host, activeProfileDir, name)).ok;
	}
	return {
		installedThemeNames,
		setEntryDisabled,
		activateTheme
	};
}
//#endregion
//#region lib/types/http.js
/**
* Minimal HTTP helpers shared by every market route: JSON serialization,
* same-origin enforcement for mutating endpoints, and a size-capped JSON
* body reader.
*/
/** Write a JSON payload with no-store caching. */
function sendJson(response, status, payload) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8"
	});
	response.end(JSON.stringify(payload));
}
/** True when the request's Origin matches its Host — required on every POST route. */
function sameOrigin(request) {
	const origin = request.headers.origin;
	const host = request.headers.host;
	if (origin === void 0 || host === void 0) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
/** Read and parse a JSON request body, rejecting anything over 4 KiB. */
async function readJsonBody(request, maxBytes = 4096) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > maxBytes) throw new Error("request body too large");
		chunks.push(buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
//#endregion
//#region lib/types/restart.js
/**
* Self-restart: relaunch the exact DSH invocation that booted this host so
* pending (non-hot) plugin changes take effect without the user leaving the
* UI. Contributed in #14 by @ysyyhhh; ported onto the layered architecture.
*
* Safety model: the endpoint accepts only direct same-origin loopback
* requests (no forwarding headers), refuses while a plugin operation runs,
* and deployments under a supervisor (systemd/launchd/pm2) can disable the
* whole feature with `allowRestart: false` — the supervisor owns restarts.
*/
/**
* The process supervisor running this host, when one can be identified —
* `null` when nothing says so.
*
* This exists because the failure it prevents is the worst one the market
* can cause. Under systemd's default `KillMode=control-group`, everything in
* the unit's cgroup dies with the main process — including the detached
* helper that was supposed to bring the replacement up. So "restart" killed
* a production service and nothing came back (#229 by @SkillBase-Al: "杀死了
* 服务但是无法重复启动服务"). `allowRestart: false` was always the documented
* answer, but it is opt-in, and nothing told the operator to opt in until
* after they had already lost the service.
*
* TWO signals are required, and the second is the whole reason this function
* is not a one-line env check. `INVOCATION_ID` is INHERITED: every
* descendant of a systemd unit carries it, which on Linux includes an
* ordinary desktop terminal (its shell descends from a user-session unit)
* and a CI runner (the agent is a unit — this repo's own smoke test caught
* that). Treating inheritance as ownership would disable the button for a
* large population of hosts where it works fine, which is a worse bug than
* the one being fixed.
*
* `ppid === 1` is what distinguishes being the unit's own main process from
* merely descending from one: systemd forks its services from PID 1, while a
* terminal's node has the shell as its parent and a runner's has the agent.
*
* Scoped to systemd on purpose. pm2 sets `pm_id`, but it is inherited the
* same way and pm2's God daemon — not PID 1 — is the parent, so there is no
* equivalent second signal; a guess there would reintroduce exactly the
* false positive this pair exists to avoid. launchd has no marker at all.
* Both still need the explicit setting: detection is a safety net over the
* documented option, never a replacement for it.
*/
function detectedSupervisor(env = process.env, ppid = process.ppid) {
	const set = (name) => (env[name] ?? "") !== "";
	if ((set("INVOCATION_ID") || set("JOURNAL_STREAM")) && ppid === 1) return "systemd";
	return null;
}
/**
* Self-restart is enabled by default, disabled by an explicit false — and
* disabled by DEFAULT under a detected supervisor, which owns restarts and
* whose process group would take the replacement helper down with it.
*
* An explicit `true` still wins: an operator who has configured their unit
* for it (`KillMode=process`, or a wrapper that survives) is making a
* statement about their own deployment, and this should not overrule it.
*/
function restartAllowed(config, env = process.env, ppid = process.ppid) {
	if (config.allowRestart !== void 0) return config.allowRestart;
	return detectedSupervisor(env, ppid) === null;
}
/**
* The port this process is serving on, read off the request that asked for
* the restart.
*
* The alternative is to parse it out of the launch argv, which is wrong for
* every host that binds from config or an env var. The Host header is what
* the browser actually reached us on, so it is the port the replacement has
* to take over — and it is already validated against Origin by the guard
* below before any of this runs.
* @returns the port, or null when the header carries none (a default port).
*/
function servingPort(request) {
	const host = request.headers.host;
	if (host === void 0) return null;
	const match = /:(\d{1,5})$/u.exec(host);
	if (match === null) return null;
	const port = Number(match[1]);
	return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}
/** Whether a process-control request came from this Web host on loopback. */
function trustedRestartRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	if (request.headers.forwarded !== void 0 || request.headers["x-forwarded-for"] !== void 0 || request.headers["x-real-ip"] !== void 0) return false;
	const origin = request.headers.origin;
	const host = request.headers.host;
	if (origin === void 0 || host === void 0) return false;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
/**
* Whether a download navigation may fetch a sensitive GET export.
* Browsers do NOT send an Origin header on same-origin GET navigations
* (`<a href="/..." download>`), so unlike process-control requests a missing
* Origin is the NORMAL shape of a user-initiated download and must pass.
* Keep the rest of the posture: loopback peer only, no proxy forwarding
* headers, and — when an Origin IS present (fetch/CORS attempts) — it must
* still match Host so a cross-origin page cannot read the export.
*/
function trustedDownloadRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	if (request.headers.forwarded !== void 0 || request.headers["x-forwarded-for"] !== void 0 || request.headers["x-real-ip"] !== void 0) return false;
	const origin = request.headers.origin;
	const host = request.headers.host;
	if (host === void 0) return false;
	if (origin === void 0) return true;
	try {
		const parsed = new URL(origin);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host === host;
	} catch {
		return false;
	}
}
/** The exact boot invocation the detached restart helper replays. */
function restartLaunch() {
	const launch = dshArgv();
	return {
		...launch,
		args: [...launch.args, ...process.argv.slice(2)],
		cwd: launch.cwd ?? process.cwd()
	};
}
/**
* Platform-correct spawn invocation for the replacement host (#40 by
* @1123762794): on Windows a `detached` spawn maps to DETACHED_PROCESS — the
* new host gets NO console, and every console child it later spawns (e.g.
* DSH sandbox tool runners) pops a visible node window. Wrapping the launch
* in `powershell -WindowStyle Hidden` gives the host a HIDDEN console that
* children inherit instead. POSIX keeps the plain detached spawn.
*/
function respawnInvocation(launch, platform = process.platform) {
	if (platform !== "win32") return {
		file: launch.file,
		args: launch.args,
		viaShell: launch.viaShell,
		detached: true
	};
	const quote = (part) => `'${part.replace(/'/g, "''")}'`;
	return {
		file: "powershell.exe",
		args: [
			"-NoProfile",
			"-WindowStyle",
			"Hidden",
			"-Command",
			[`& ${quote(launch.file)}`, ...launch.args.map(quote)].join(" ")
		],
		viaShell: false,
		detached: false
	};
}
/**
* Source for the detached helper that outlives this process and brings the
* replacement up.
*
* Extracted so the waiting can be tested by RUNNING it, which is the only
* way this class of bug shows itself: every part of the old helper looked
* right in isolation.
*
* What it fixes (#177, reported on Windows 11, reproducible every time): the
* helper slept a flat 1500ms and spawned. The old process had exited, but
* the listening socket had not been released yet, so the replacement died
* instantly with EADDRINUSE — and the spawn was wrapped in `catch {}`, so
* nothing was written anywhere. The user saw a restart button that did
* nothing. The docstring above it even claimed the helper "waits for our
* port to free up"; it never did.
*
* So: wait for the port to actually go quiet, then start, then CHECK that
* something came up, and write a diagnosis when it did not. A restart that
* fails must leave evidence — this one is invisible by construction, since
* the process that would have logged it is the one that just exited.
* @param port - the port the replacement must bind; when unknown, the helper
*   falls back to the old fixed delay, which is better than nothing.
*/
function restartHelperSource(spawned, launch, logs, port) {
	return [
		"const { spawn } = require('node:child_process')",
		"const fs = require('node:fs')",
		"const net = require('node:net')",
		`const file = ${JSON.stringify(spawned.file)}`,
		`const args = ${JSON.stringify(spawned.args)}`,
		`const cwd = ${JSON.stringify(launch.cwd)}`,
		`const viaShell = ${JSON.stringify(spawned.viaShell)}`,
		`const detached = ${JSON.stringify(spawned.detached)}`,
		`const logOut = ${JSON.stringify(logs.out)}`,
		`const logErr = ${JSON.stringify(logs.err)}`,
		`const port = ${JSON.stringify(port)}`,
		"const sleep = (ms) => new Promise(r => setTimeout(r, ms))",
		"const note = (line) => { try { fs.appendFileSync(logErr, `[dsh-market] ${line}\n`) } catch {} }",
		"const listening = () => new Promise((resolve) => {",
		"  const probe = net.connect({ host: \"127.0.0.1\", port })",
		"  const done = (value) => { probe.destroy(); resolve(value) }",
		"  probe.on(\"connect\", () => done(true))",
		"  probe.on(\"error\", () => done(false))",
		"  setTimeout(() => done(false), 500)",
		"})",
		"const main = async () => {",
		"  if (port) {",
		"    const until = Date.now() + 30000",
		"    while (Date.now() < until && await listening()) await sleep(250)",
		"    if (await listening()) note(`port ${port} was still in use after 30s; starting anyway`)",
		"    await sleep(300)",
		"  } else {",
		"    await sleep(1500)",
		"  }",
		"  let child",
		"  try {",
		"    const out = fs.openSync(logOut, \"a\")",
		"    const err = fs.openSync(logErr, \"a\")",
		"    child = spawn(file, args, { cwd, detached, stdio: [\"ignore\", out, err], env: process.env, shell: viaShell })",
		"    child.on(\"error\", (error) => note(`could not start the replacement: ${error && error.message ? error.message : error}`))",
		"    child.unref()",
		"  } catch (error) {",
		"    note(`could not start the replacement: ${error && error.message ? error.message : error}`)",
		"    return",
		"  }",
		"  if (!port) { await sleep(3000); return }",
		"  const upBy = Date.now() + 20000",
		"  while (Date.now() < upBy && !(await listening())) await sleep(500)",
		"  if (!(await listening())) note(`the replacement did not bind port ${port} within 20s — see the output log beside this one`)",
		"}",
		"main()"
	].join("\n");
}
/**
* Relaunch this exact DSH entry after a detached handoff, then stop this
* process. The helper outlives us (detached + unref), waits for our port to
* be released before starting the replacement, and logs under tmpdir.
* @param port - the port this process is serving on, so the helper can wait
*   for it rather than guessing at a delay.
*/
function scheduleRestart(port = null) {
	const launch = restartLaunch();
	const spawned = respawnInvocation(launch);
	const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const logOut = join(tmpdir(), `dsh-market-restart-${stamp}.out.log`);
	const logErr = join(tmpdir(), `dsh-market-restart-${stamp}.err.log`);
	const helper = spawn(nodeExecutable(), ["-e", restartHelperSource(spawned, launch, {
		out: logOut,
		err: logErr
	}, port)], {
		detached: true,
		stdio: "ignore",
		env: process.env
	});
	helper.unref();
	setTimeout(() => process.kill(process.pid, "SIGTERM"), 500);
	return {
		pid: process.pid,
		helperPid: helper.pid,
		logOut,
		logErr
	};
}
//#endregion
//#region lib/types/verify.js
/**
* Post-install activation verification (P0-2): what "installed" actually
* means for a package in a dsh profile.
*
* Two sources of truth, in strict order of authority:
*
* 1. The LOADER INVENTORY (observed): whatever the loader is running right
*    now is live, full stop. A plain library with no `dsh` field can be
*    loaded by name from someone else's bundle patch — the official
*    dsh-base patch loads `@deepseek-ai/dsh-tools`, which has no `dsh`
*    field at all — so no manifest check may overrule it (#135).
* 2. The profile manifest (inferred): `<profile>/package.json` →
*    `dsh.profile.bundles`, what the dsh CLI reconciled. This predicts what
*    the NEXT boot will load, and is the only evidence available for a
*    package that is not currently running.
*
* State taxonomy (IMPROVEMENT-PLAN P0-2):
*   live    – running in the current composition (hot mount or loader entry)
*   restart – installed and will activate on the next boot, but not live now
*   inert   – installed but not a profile-layer plugin (plain dependency, or
*             client-only — the market shim-mounts those at boot)
*   broken  – would fail to load: listed as a bundle without a dsh surface,
*             or a declared entry artifact that is missing
*   missing – not present in node_modules
*/
/** The profile manifest's `dsh.profile.bundles` — what the CLI reconciled. */
function readBundles(profile, explicitDir) {
	try {
		const bundles = JSON.parse(readFileSync(join(profileDir(profile, explicitDir), "package.json"), "utf8")).dsh?.profile?.bundles;
		return new Set(Array.isArray(bundles) ? bundles.filter((n) => typeof n === "string") : []);
	} catch {
		return /* @__PURE__ */ new Set();
	}
}
/**
* True when `live` contains the package itself or a subpath entry of it.
*
* The live set (see `liveNames` in routes.ts) holds loader entry names — the
* `name:` field of each bundle patch row. Bundles usually name the bare
* package (`dshmarket`, `@scope/pkg`), but may point at a subpath entry
* (`@vectorize-io/hindsight-coding-agents/dsh`, `aegis/extensions/dsh/index.js`).
* Either form means the package's fiber is up and it must read as live;
* a different package sharing a name prefix (`@scope/pkg2` vs `@scope/pkg`)
* must not — the `/` bound keeps the match a real subpath.
*/
function liveIncludes(live, packageName) {
	if (live.has(packageName)) return true;
	const prefix = `${packageName}/`;
	for (const name of live) if (name.startsWith(prefix)) return true;
	return false;
}
/**
* True when a loader entry this package's OWN bundle patch inserts is up.
*
* A carrier bundle (#103) ships no plugin of its own: its patch mounts
* ANOTHER package with configuration, so the live entry carries that other
* package's name and `liveIncludes` can never match. The entry ID is the
* part that belongs to this package — its patch created it — which is why
* matching on it is both sufficient and precise: a neighbour that happens
* to mount the same package does so under a different id.
*
* Without this the market kept telling users to restart for a plugin that
* had been running since the restart (#156).
*/
function carriedRowLive(live, profileDirectory, packageName) {
	try {
		return bundlePatchInsertedIds(join(profileDirectory, "node_modules", packageName)).some((id) => live.has(`#${id}`));
	} catch {
		return false;
	}
}
function readPkgDsh(profile, name, explicitDir) {
	try {
		return JSON.parse(readFileSync(join(profileDir(profile, explicitDir), "node_modules", name, "package.json"), "utf8")).dsh ?? {};
	} catch {
		return null;
	}
}
function patchTextOf(profile, name, explicitDir) {
	try {
		return readFileSync(join(profileDir(profile, explicitDir), "node_modules", name, "cordis.patch.yml"), "utf8");
	} catch {
		return null;
	}
}
/**
* Verify the activation state of one installed package.
* @param live - names live in the current composition; defaults to the
* market's hot-mount table (injectable for tests).
*/
function verifyActivation(profile, name, live = new Set(listHotMounts()), explicitDir, isDisabled = false) {
	const activeProfileDir = profileDir(profile, explicitDir);
	const inBundles = readBundles(profile, activeProfileDir).has(name);
	const dsh = readPkgDsh(profile, name, activeProfileDir);
	if (dsh === null) return {
		state: "missing",
		reasons: ["未安装 / not installed"],
		bundle: inBundles,
		hot: false
	};
	if (isDisabled) return {
		state: "disabled",
		reasons: ["已停用(市场开关或补丁层),重启后保持关闭 / disabled (market toggle or the patch layer) — stays off across restarts"],
		bundle: inBundles,
		hot: false
	};
	const dir = join(activeProfileDir, "node_modules", name);
	const loaderLive = liveIncludes(live, name) || carriedRowLive(live, activeProfileDir, name);
	if (!hasDshManifest(dir)) {
		if (loaderLive) return {
			state: "live",
			reasons: ["已由 Loader 加载(该包未声明 dsh 元数据,由某个 bundle patch 按名加载)/ loaded by the loader (no dsh metadata of its own — a bundle patch loads it by name)"],
			bundle: inBundles,
			hot: true
		};
		return inBundles ? {
			state: "broken",
			reasons: ["已列入 profile bundle 层但未声明 dsh 元数据,加载会失败 / listed in the profile bundle layer but declares no dsh metadata — loading it fails"],
			bundle: true,
			hot: false
		} : {
			state: "inert",
			reasons: ["普通依赖(未声明 dsh 元数据),不是 profile 层插件;若它由某个 bundle patch 按名加载,启动后会显示为已加载 / a plain dependency with no dsh metadata — not a profile-layer plugin; if some bundle patch loads it by name it will read as live once running"],
			bundle: false,
			hot: false
		};
	}
	if (!loaderLive && !hasLoadableEntry(activeProfileDir, name)) return {
		state: "broken",
		reasons: ["声明的入口产物缺失(源码检出或构建被拦),下次启动会失败 / the declared entry artifact is missing (source-only checkout or blocked build) — the next boot would fail"],
		bundle: inBundles,
		hot: false
	};
	if (loaderLive) return {
		state: "live",
		reasons: [dsh.bundle === void 0 && dsh.client !== void 0 ? "已热加载(纯客户端插件 shim)/ live via the client-only shim" : "已热加载(bundle patch)/ live via its bundle patch"],
		bundle: inBundles,
		hot: true
	};
	if (inBundles) {
		const patch = patchTextOf(profile, name, activeProfileDir);
		return {
			state: "restart",
			reasons: [patch !== null && parseSimplePatch(patch) === null ? "bundle patch 含配置/表达式,热挂载仅支持纯 insert;重启后由 bundle 层生效 / the bundle patch contains config/expression rows; hot-mount only supports plain inserts — it activates on restart" : "已进入 profile bundle 层但本次未能热挂载;重启后生效 / in the bundle layer but not hot-mounted this session — it activates on restart"],
			bundle: true,
			hot: false
		};
	}
	if (dsh.client !== void 0) return {
		state: "inert",
		reasons: ["未声明 dsh.bundle,不会进入 profile bundle 层(纯客户端插件);重启后由市场自动挂载生效 / no dsh.bundle — client-only plugins never enter the bundle layer; the market shim-mounts them at the next boot"],
		bundle: false,
		hot: false
	};
	return {
		state: "inert",
		reasons: ["未声明 dsh.bundle,已作为普通依赖安装,不会成为 profile 层 / no dsh.bundle — installed as a plain dependency, never a profile-layer plugin"],
		bundle: false,
		hot: false
	};
}
/**
* Correct a post-UPDATE verdict for a plugin that was already running.
*
* `verifyActivation` answers "is this name in the live loader inventory".
* That is the right question after an install and the wrong one after an
* update: the plugin was already live, so the answer stays "live" while the
* process keeps serving the module it imported at boot. Replacing files under
* a running composition does not re-import anything.
*
* Measured on a real host rather than reasoned about — updating the market
* from 1.11.3 to 1.12.2 left `/dsh-market/status` reporting 1.11.3 with an
* unchanged boot id, while the update route called it hot-loaded in the same
* response. The browser half genuinely does refresh (the host re-serves the
* client bundle from disk), which is what makes the wrong verdict credible:
* the UI visibly becomes the new version while the server half does not.
*
* Only a plugin that was ALREADY live is affected. One that was missing,
* broken or disabled beforehand has nothing loaded to shadow the new build,
* so its fresh mount really does run the new code.
*
* Client-only packages are excluded for the same reason from the other end:
* they have no host half to go stale, and the browser fetches their bundle
* from disk on the next page load. Telling their users to restart would be
* #156 again, in a narrower place — see `hasHostHalf`.
* @param result the verdict computed from the loader inventory
* @param hostHalfWasLive whether a HOST half was live BEFORE the replacement
*/
function activationAfterReplace(result, hostHalfWasLive) {
	if (!hostHalfWasLive || result.state !== "live") return result;
	return {
		...result,
		state: "restart",
		hot: false,
		reasons: ["新版本已就位,但运行中的进程仍在使用启动时加载的旧模块——重启后生效(页面本身会立即变成新版,服务端不会) / the new build is in place, but the running process still serves the module it imported at boot — restart to apply (the page itself updates immediately; the server half does not)"]
	};
}
/**
* Whether a package has a host (Node) half at all.
*
* A `dsh.client`-only package — themes, skins, most pure-UI plugins — runs
* no server code: the market shim-mounts it so the loader has a live row,
* and the browser re-fetches its bundle from disk on the next page load. An
* update to one takes effect on refresh, with no restart to ask for.
*/
function hasHostHalf(profile, name, explicitDir) {
	const dsh = readPkgDsh(profile, name, explicitDir);
	if (dsh === null) return false;
	return !(dsh.bundle === void 0 && dsh.client !== void 0);
}
/**
* The client bundle path a package's `exports["./client"]` names, relative
* to the package root — or `null` when it cannot be resolved CONFIDENTLY.
*
* Returning null is the important half. This feeds a post-install check
* whose only job is to catch a corrupt bundle, and a resolver that guessed
* wrong would report a healthy plugin as broken — worse than the silence it
* replaces. So every shape this does not fully understand resolves to null
* and the check simply does not run: unresolvable is not evidence of damage.
*
* Handles the two shapes real plugins ship: a plain string, and a
* conditional object. For the object, only `browser` and `default` are
* consulted — those are the conditions the host's client loader actually
* activates; `import`/`require` describe a Node resolution this file is not
* modelling, and picking one of those could name a different artifact.
* Nested conditions recurse; anything else (arrays, non-relative targets)
* gives up.
*/
function clientBundlePath(exportsField, depth = 0) {
	if (depth > 4) return null;
	if (typeof exportsField === "string") return exportsField.startsWith("./") ? exportsField : null;
	if (exportsField === null || typeof exportsField !== "object" || Array.isArray(exportsField)) return null;
	const conditions = exportsField;
	for (const key of ["browser", "default"]) {
		if (conditions[key] === void 0) continue;
		const resolved = clientBundlePath(conditions[key], depth + 1);
		if (resolved !== null) return resolved;
	}
	return null;
}
/**
* Whether a package's client bundle still parses as JavaScript (#222).
*
* pnpm can leave a half-written or patch-mangled bundle behind — the report
* describes a profile whose client bundle was broken after an update. The
* browser is where that surfaces today, as a blank settings page long after
* the operation reported success, with nothing connecting the two.
*
* `vm.Script` COMPILES without executing: it catches the syntax damage this
* is looking for and never runs plugin code, so a hostile bundle gains
* nothing. A missing `dsh.client`, an unresolvable exports field, or a file
* that is simply absent all return ok — this check only ever fires on a file
* it actually read and actually failed to parse. Everything ambiguous stays
* silent, because a false "your plugin is corrupt" is the one outcome worse
* than not checking.
*/
function checkClientBundle(profile, name, explicitDir) {
	const root = join(profileDir(profile, explicitDir), "node_modules", name);
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	} catch {
		return {
			ok: true,
			reason: null
		};
	}
	if (manifest.dsh?.client === void 0) return {
		ok: true,
		reason: null
	};
	const exportsField = manifest.exports;
	const relative = exportsField !== null && typeof exportsField === "object" && !Array.isArray(exportsField) ? clientBundlePath(exportsField["./client"]) : null;
	if (relative === null) return {
		ok: true,
		reason: null
	};
	let source;
	try {
		source = readFileSync(join(root, relative), "utf8");
	} catch {
		return {
			ok: true,
			reason: null
		};
	}
	try {
		new Script(source, { filename: relative });
		return {
			ok: true,
			reason: null
		};
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
//#endregion
//#region lib/types/patch.js
/**
* Patch-layer plugin toggles — hot disable/enable through the profile's
* user patch layer (cordis.patch.yml), the mechanism ported from
* Noob-stupid/dsh-plugin-hub's plugin console.
*
* DSH composes a web profile from the bundle layers + the user patch layer
* (`$DSH_HOME/profiles/<name>/cordis.patch.yml`), with per-key override
* semantics: a patch row `- id: X` + `disabled: true` stops that loader
* entry, and `disabled: false` force-enables one a lower layer disabled.
* The profile's config-file watcher (HMR) re-composes within ~1s of the
* save — no restart — and the loader re-applies the same file on every
* boot, so the choice survives restarts through the official mechanism.
*
* The market ALSO keeps its own in-memory/state.json bookkeeping (hot-mount
* shims have no bundle row to patch, and the client's disable list drives
* the switches); this module is the durable, HMR-driven layer on top.
*
* Safety (borrowed from the plugin-hub implementation):
* - writes are serialized so concurrent toggles cannot interleave a
*   read-modify-write;
* - an append is REFUSED when the patch file is not a valid entry list —
*   a malformed file (e.g. a stray `[]` followed by items) is never made
*   worse, the market reports it instead;
* - host infrastructure rows (transport / hot-reload / storage / settings
*   chains) are protected and refuse to toggle.
*/
/**
* Host infrastructure rows: disabling any of these breaks the very chain
* the patch layer runs on (e.g. timer → HMR, webserver → the page itself),
* so they refuse to toggle. Same list the plugin-hub console uses — the
* target host is the same DSH.
*/
const PROTECTED_MODULE_PATTERNS = [
	/^cordis:/u,
	/^@deepseek-ai\/cordis-plugin-/u,
	/^@deepseek-ai\/dsh-host-/u,
	/^@deepseek-ai\/dsh-client-modules$/u,
	/^@deepseek-ai\/dsh-client-connection$/u,
	/^@deepseek-ai\/dsh-client-hmr$/u,
	/^@deepseek-ai\/dsh-client-runtime$/u,
	/^@deepseek-ai\/dsh-client-locale$/u,
	/^@deepseek-ai\/dsh-client-web/u,
	/^@deepseek-ai\/dsh-web-frontend$/u,
	/^@deepseek-ai\/dsh-web-app$/u,
	/^@deepseek-ai\/dsh-settings/u,
	/^@deepseek-ai\/dsh-credentials/u,
	/^@deepseek-ai\/dsh-session/u,
	/^@deepseek-ai\/dsh-storage/u,
	/^@deepseek-ai\/dsh-typert/u,
	/^@deepseek-ai\/dsh-api-remotes$/u,
	/^@deepseek-ai\/dsh-tools$/u,
	/^@deepseek-ai\/dsh-system-prompt$/u,
	/^@deepseek-ai\/dsh-agent/u,
	/^@deepseek-ai\/dsh-llm/u,
	/^@deepseek-ai\/dsh-persona$/u,
	/^@deepseek-ai\/dsh-scope$/u,
	/^@deepseek-ai\/dsh-launch-environment$/u,
	/^@deepseek-ai\/dsh-shell$/u,
	/^@deepseek-ai\/dsh-subprocess/u,
	/^@deepseek-ai\/dsh-fs/u,
	/^@deepseek-ai\/dsh-sandbox/u,
	/^@deepseek-ai\/dsh-jobs/u,
	/^@deepseek-ai\/dsh-skill/u,
	/^@deepseek-ai\/dsh-goal/u,
	/^@deepseek-ai\/dsh-workflow/u,
	/^@deepseek-ai\/dsh-subagent/u,
	/^@deepseek-ai\/dsh-web$/u,
	/^@deepseek-ai\/dsh-workspace/u,
	/^@deepseek-ai\/dsh-user-approval$/u,
	/^@deepseek-ai\/dsh-user-questions$/u,
	/^@deepseek-ai\/dsh-commands$/u,
	/^@deepseek-ai\/dsh-hook/u,
	/^@deepseek-ai\/dsh-spill/u,
	/^@deepseek-ai\/dsh-guard/u,
	/^@deepseek-ai\/dsh-tool-call-timeout-policy$/u,
	/^@deepseek-ai\/dsh-repeat-tool-reminder$/u
];
/** True when the module name sits on the host infrastructure chain. */
function isProtectedModule(moduleName) {
	return typeof moduleName === "string" && PROTECTED_MODULE_PATTERNS.some((pattern) => pattern.test(moduleName));
}
/**
* Resolve the profile's user patch layer. Prefers the path the loader's
* cordis:include entry actually read (authoritative under hosts that own
* the profile directory, like DSH Desktop); falls back to the conventional
* `<profile>/cordis.patch.yml`.
*/
function findUserPatchPath(host, profileDir) {
	for (const entry of host.loader.entries()) {
		const cfg = entry.options?.config;
		if (entry.options?.name !== "cordis:include" || cfg == null || typeof cfg.path !== "string") continue;
		if (!cfg.path.includes("cordis.yml")) continue;
		let includePath = cfg.path;
		if (includePath.startsWith("file://")) try {
			includePath = fileURLToPath(includePath);
		} catch {
			includePath = includePath.replace(/^file:\/\//u, "");
		}
		return includePath.replace(/cordis\.yml$/u, "cordis.patch.yml");
	}
	return join(profileDir, "cordis.patch.yml");
}
/** Row ids the market is allowed to write: plain unquoted YAML scalars. */
const ROW_ID_RE = /^[A-Za-z0-9_.-]+$/u;
/**
* Line-wise scan of one patch file — the plugin-hub shapes. Deliberately
* not a YAML parse: the file may hold structures the market's dialect
* rejects, but a plain `- id: X` + `disabled: true|false` pair is enough
* to know what the user patch layer says.
*/
function readUserPatchState(patchPath) {
	const disables = [];
	const forced = [];
	const inserts = [];
	let text = "";
	try {
		text = readFileSync(patchPath, "utf8");
	} catch {}
	const lines = text.split(/\r?\n/u);
	let inInsert = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/^- insert:\s*$/u.test(line)) {
			inInsert = true;
			continue;
		}
		if (/^- /u.test(line)) inInsert = false;
		if (inInsert) {
			const insertRow = /^ {4}- id: ([A-Za-z0-9_.-]+)/u.exec(line);
			if (insertRow !== null) inserts.push(insertRow[1]);
			continue;
		}
		const disableRow = /^- id: ([A-Za-z0-9_.-]+)\s*$/u.exec(line);
		if (disableRow === null) continue;
		const next = lines[index + 1] ?? "";
		if (/^ {2}disabled: true\s*$/u.test(next)) disables.push(disableRow[1]);
		else if (/^ {2}disabled: false\s*$/u.test(next)) forced.push(disableRow[1]);
	}
	return {
		disables,
		forced,
		inserts
	};
}
/** The include entry's id prefix (loader entry ids look like `include:X`). */
function includePrefix(host) {
	for (const entry of host.loader.entries()) if (entry.options?.name === "cordis:include" && typeof entry.options.id === "string") return `${entry.options.id}:`;
	return "";
}
/**
* The user-patch row ids one installed package owns: its bundle patch's
* insert rows, plus the loader entries currently carrying its name.
* Empty for client-only packages (no bundle rows) — the market's own
* state.json mechanism covers those, and there is nothing to patch.
* Market-owned namespaces (hot-mount `mkt-*`, shim `client-*`) are
* excluded: their rows live in the market's own include subtree, and a
* permanent patch row targeting them would be a boot-time orphan.
*/
function rowIdsForPackage(host, profileDirectory, packageName) {
	const ids = /* @__PURE__ */ new Set();
	const packageDir = join(profileDirectory, "node_modules", packageName);
	try {
		for (const id of bundlePatchInsertedIds(packageDir)) ids.add(id);
	} catch {}
	try {
		for (const id of parsePatchRows(readFileSync(join(packageDir, "cordis.patch.yml"), "utf8")).insertedIds) ids.add(id);
	} catch {}
	const prefix = includePrefix(host);
	for (const entry of host.loader.entries()) {
		if (entry.options?.name !== packageName) continue;
		let id = entry.options.id ?? "";
		if (id === "") continue;
		if (prefix !== "" && id.startsWith(prefix)) id = id.slice(prefix.length);
		if (/^(?:mkt-|client-)/u.test(id)) continue;
		ids.add(id);
	}
	return [...ids];
}
/**
* Top-level patch rows that DISABLE another plugin: a row carrying both an
* `id` and `disabled: true`. Rows nested under an `insert:` block are separate
* array elements shaped `{ insert: [...] }`, so anything here is by definition
* a sibling row targeting a plugin this package does not own.
*/
function foreignDisableIds(rows) {
	const ids = [];
	for (const row of rows) {
		if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
		const record = row;
		const id = record.id;
		if (typeof id === "string" && record.disabled === true && !ids.includes(id)) ids.push(id);
	}
	return ids;
}
/**
* The ids of OTHER plugins a package's bundle patch DISABLES — top-level
* `- id: X` + `disabled: true` rows targeting plugins it does not own. This is
* the precise marker of a bundle whose toggle-off can brick the boot (#224):
* dsh-postgres-backends disables session-persistence-jsonl, so once the market
* also disables the postgres backends nothing provides sessionPersistence.
*
* A bundle that merely RECONFIGURES a neighbour is deliberately NOT counted:
* the e2e fixture-cross tweaks dshm-fixture-b's config, and #147 requires
* disabling it to leave that neighbour live — dropping such a bundle from the
* stack broke its re-enable. Config-only side effects stay on the normal #147
* path; only a foreign `disabled: true` triggers the bundle removal. Removing
* the bundle still neutralizes any config side effects it carries, since its
* whole patch stops applying.
*
* Reads both patch sources like rowIdsForPackage — the declared dsh.bundle.patch
* and the conventional root cordis.patch.yml — so either form is detected.
*/
function carrierDisableIds(profileDirectory, packageName) {
	const packageDir = join(profileDirectory, "node_modules", packageName);
	const disabled = /* @__PURE__ */ new Set();
	const collectFromFile = (patchPath) => {
		const rows = parsePatchFile(patchPath);
		if (rows === null) return;
		for (const id of foreignDisableIds(rows)) disabled.add(id);
	};
	try {
		const declared = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).dsh?.bundle?.patch;
		if (typeof declared === "string" && declared !== "") collectFromFile(join(packageDir, declared));
	} catch {}
	collectFromFile(join(packageDir, "cordis.patch.yml"));
	return [...disabled];
}
/**
* Per-package patch-layer flags for the installed list: names whose rows the
* user patch layer disables / force-enables. These cover toggles made
* OUTSIDE the market (hand-edited cordis.patch.yml, dsh-web-plugin-manager,
* the dsh CLI), which the market's own state.json never sees.
*/
function packagePatchFlags(host, profileDirectory, names, state) {
	const disabled = [];
	const forced = [];
	for (const name of names) {
		const rows = rowIdsForPackage(host, profileDirectory, name);
		if (rows.some((id) => state.disables.includes(id))) disabled.push(name);
		if (rows.some((id) => state.forced.includes(id))) forced.push(name);
	}
	return {
		disabled,
		forced
	};
}
/** Serialize patch-file writes: concurrent toggles must not interleave. */
let writeQueue = Promise.resolve();
function queuedWrite(fn) {
	const run = writeQueue.then(fn, fn);
	writeQueue = run.then(() => void 0, () => void 0);
	return run;
}
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function rowBlock(rowId, disabled) {
	return `- id: ${rowId}\n  disabled: ${disabled ? "true" : "false"}\n`;
}
/**
* Append one top-level patch entry, refusing when the file is not a valid
* entry list. The refusal is the point: a malformed patch layer (the
* `[]` + items mistake, or any broken YAML) must never be made worse —
* the market reports it and keeps its own live/state.json toggle instead.
*/
function appendPatchEntry(patchPath, block) {
	let text = "";
	try {
		text = readFileSync(patchPath, "utf8");
	} catch {}
	if (text.trim() === "") {
		writeFileSync(patchPath, block);
		return {
			ok: true,
			reason: null
		};
	}
	const withoutComments = text.replace(/^[ \t]*#.*$/gmu, "").trim();
	if (withoutComments === "") {
		writeFileSync(patchPath, `${text.endsWith("\n") ? text : `${text}\n`}${block}`);
		return {
			ok: true,
			reason: null
		};
	}
	if (withoutComments === "[]" || withoutComments === "[ ]") {
		const commented = text.replace(/^[ \t]*\[[ \t]*\][ \t]*(?:#.*)?(?:\r?\n|$)/mu, "# []\n");
		writeFileSync(patchPath, `${commented.endsWith("\n") ? commented : `${commented}\n`}${block}`);
		return {
			ok: true,
			reason: null
		};
	}
	const lastContentLine = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")).pop() ?? "";
	if (/^[[{]/u.test(lastContentLine)) return {
		ok: false,
		reason: "补丁层以顶层流式结构结尾,不支持自动追加;请先整理为条目列表 / the patch layer ends in a top-level flow structure; refusing to append — tidy the file into an entry list first"
	};
	if (parsePatchFile(patchPath) === null) return {
		ok: false,
		reason: "补丁层不是合法的条目数组,已拒绝追加以免破坏;请先修正 YAML / the patch layer is not a valid entry list; refused to append — fix the YAML first"
	};
	writeFileSync(patchPath, `${text.endsWith("\n") ? text : `${text}\n`}${block}`);
	return {
		ok: true,
		reason: null
	};
}
/** Disable one row: append `- id: X` + `disabled: true` (idempotent). */
function disableRow(patchPath, rowId) {
	return queuedWrite(async () => {
		if (!ROW_ID_RE.test(rowId)) return {
			ok: false,
			reason: `行 id 含特殊字符,不支持写入补丁层 / row id ${rowId} cannot be written to the patch layer`
		};
		if (readUserPatchState(patchPath).disables.includes(rowId)) return {
			ok: true,
			reason: null
		};
		const result = appendPatchEntry(patchPath, rowBlock(rowId, true));
		if (result.ok) logEvent("info", "patch", `disabled row ${rowId} in ${patchPath}`);
		return result;
	});
}
/** Enable one row: remove the `disabled: true` block; force-enable with
* `disabled: false` when a lower layer (bundle/home patch) holds it down. */
function enableRow(patchPath, rowId) {
	return queuedWrite(async () => {
		if (!ROW_ID_RE.test(rowId)) return {
			ok: false,
			reason: `行 id 含特殊字符,不支持写入补丁层 / row id ${rowId} cannot be written to the patch layer`
		};
		const state = readUserPatchState(patchPath);
		const blockRe = new RegExp(`^- id: ['\"]?${escapeRegExp(rowId)}['\"]?\\r?\\n  disabled: true\\r?\\n`, "mu");
		const text = (() => {
			try {
				return readFileSync(patchPath, "utf8");
			} catch {
				return "";
			}
		})();
		if (blockRe.test(text)) {
			writeFileSync(patchPath, withPlaceholderRestored(text.replace(blockRe, "")));
			logEvent("info", "patch", `enabled row ${rowId} in ${patchPath}`);
			return {
				ok: true,
				reason: null
			};
		}
		if (state.forced.includes(rowId)) return {
			ok: true,
			reason: null
		};
		const result = appendPatchEntry(patchPath, rowBlock(rowId, false));
		if (result.ok) logEvent("info", "patch", `force-enabled row ${rowId} in ${patchPath}`);
		return result;
	});
}
/**
* Put the empty-list placeholder back when nothing else is left.
*
* Appending the first row comments the template's `[]` out (see
* appendPatchEntry), so removing the LAST row leaves a file of pure
* comments. That is not a top-level array, and dsh refuses to boot the
* profile at all — "must be a top-level YAML array of loader patch
* entries". Disable a plugin, enable it again, and the profile is bricked.
*/
function withPlaceholderRestored(text) {
	if (text.replace(/^[ \t]*#.*$/gmu, "").trim() !== "") return text;
	const uncommented = text.replace(/^[ \t]*#[ \t]*\[[ \t]*\][ \t]*(?:\r?\n|$)/mu, "[]\n");
	if (uncommented !== text) return uncommented;
	return text === "" || text.endsWith("\n") ? `${text}[]\n` : `${text}\n[]\n`;
}
/** Remove every disable/force block the market (or the user) wrote for a
* row — the uninstall cleanup, so a removed plugin leaves no orphan rows. */
function removeRowBlocks(patchPath, rowIds) {
	let text = "";
	try {
		text = readFileSync(patchPath, "utf8");
	} catch {
		return;
	}
	let next = text;
	for (const rowId of rowIds) {
		const blockRe = new RegExp(`^- id: ['\"]?${escapeRegExp(rowId)}['\"]?\\r?\\n  disabled: (?:true|false)\\r?\\n`, "mu");
		next = next.replace(blockRe, "");
	}
	if (next !== text) {
		writeFileSync(patchPath, withPlaceholderRestored(next));
		logEvent("info", "patch", `removed patch rows for ${rowIds.join(", ")}`);
	}
}
//#endregion
//#region lib/types/backup.js
/**
* Portable profile backups: configuration only, never installed packages.
*
* The profile directory is plain user data — aside from package.json it can
* hold API keys (config.toml), tokens, or the WebDAV password when stored
* server-side. Backups therefore behave like `dsh export` and carry the same
* credential-warning disclaimer in the UI (review #63).
*/
const BACKUP_FORMAT = "dsh-profile-backup";
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 256;
const SKIP_NAMES = new Set([
	"node_modules",
	".dsh-market",
	".git",
	"pnpm-lock.yaml"
]);
function profileFiles(root, dir = root) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_NAMES.has(entry.name) || /\.bak\b/.test(entry.name)) continue;
		const path = resolve(dir, entry.name);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) files.push(...profileFiles(root, path));
		else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
		if (files.length > MAX_FILES) throw new Error(`profile has more than ${MAX_FILES} configuration files`);
	}
	return files;
}
/**
* Serialize every profile file except dependencies, lock state, and market
* cache — or, with {@link BackupOptions.includeDeps}, only the manifest with
* the selected plugins (plus, optionally, the other config files).
*/
function createProfileBackup(profile, explicitDir, opts) {
	const root = resolve(explicitDir ?? profileDir(profile));
	const manifestFile = resolve(root, "package.json");
	if (!existsSync(manifestFile)) throw new Error("profile package.json is missing");
	const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
	if (opts?.includeDeps !== void 0) {
		const include = new Set(opts.includeDeps);
		if (include.size === 0) throw new Error("no plugins selected");
		const dependencies = manifest.dependencies === null || typeof manifest.dependencies !== "object" || Array.isArray(manifest.dependencies) ? {} : manifest.dependencies;
		const filteredDeps = {};
		for (const [name, spec] of Object.entries(dependencies)) if (include.has(name)) filteredDeps[name] = spec;
		const dsh = manifest.dsh === null || typeof manifest.dsh !== "object" || Array.isArray(manifest.dsh) ? void 0 : manifest.dsh;
		const profileBlock = dsh?.profile === null || typeof dsh?.profile !== "object" || Array.isArray(dsh?.profile) ? void 0 : dsh.profile;
		const filteredBundles = (Array.isArray(profileBlock?.bundles) ? profileBlock.bundles : []).filter((name) => typeof name === "string" && include.has(name));
		if (Object.keys(filteredDeps).length === 0 && filteredBundles.length === 0) throw new Error("none of the selected plugins are in this profile");
		const filteredManifest = { ...manifest };
		filteredManifest.dependencies = filteredDeps;
		if (dsh !== void 0) filteredManifest.dsh = {
			...dsh,
			profile: {
				...profileBlock ?? {},
				bundles: filteredBundles
			}
		};
		const files = [{
			path: "package.json",
			json: filteredManifest
		}];
		if (opts.includeConfig === true) for (const path of profileFiles(root).sort()) {
			if (path === "package.json") continue;
			files.push({
				path,
				lines: readFileSync(resolve(root, path), "utf8").split(/\r?\n/)
			});
		}
		const partial = {
			format: BACKUP_FORMAT,
			version: .2,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			profile,
			files
		};
		if (Buffer.byteLength(JSON.stringify(partial)) > 2097152) throw new Error("profile configuration is too large to back up");
		return partial;
	}
	const files = profileFiles(root).sort().map((path) => {
		const content = readFileSync(resolve(root, path), "utf8");
		return path === "package.json" ? {
			path,
			json: JSON.parse(content)
		} : {
			path,
			lines: content.split(/\r?\n/)
		};
	});
	if (!files.some((file) => file.path === "package.json")) throw new Error("profile package.json is missing");
	const backup = {
		format: BACKUP_FORMAT,
		version: .2,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		profile,
		files
	};
	if (Buffer.byteLength(JSON.stringify(backup)) > 2097152) throw new Error("profile configuration is too large to back up");
	return backup;
}
function validatedBackup(value) {
	if (value === null || typeof value !== "object") throw new Error("invalid backup");
	const backup = value;
	if (backup.format !== "dsh-profile-backup" || backup.version !== .2 || !Array.isArray(backup.files)) throw new Error("unsupported backup format");
	if (backup.files.length > MAX_FILES) throw new Error("invalid backup contents");
	const files = [];
	const paths = /* @__PURE__ */ new Set();
	for (const value of backup.files) {
		if (value === null || typeof value !== "object") throw new Error("invalid backup contents");
		const file = value;
		const path = file.path;
		if (typeof path !== "string") throw new Error("invalid backup contents");
		if (path === "" || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`unsafe backup path: ${path}`);
		const normalized = path.replaceAll("\\", "/");
		if (normalized.split("/").some((part) => SKIP_NAMES.has(part))) throw new Error(`excluded backup path: ${path}`);
		if (paths.has(normalized)) throw new Error(`duplicate backup path: ${path}`);
		paths.add(normalized);
		if (path === "package.json") {
			if (file.json === null || typeof file.json !== "object" || Array.isArray(file.json)) throw new Error("backup package.json is invalid");
			files.push({
				path,
				json: file.json
			});
		} else {
			if (!Array.isArray(file.lines) || !file.lines.every((line) => typeof line === "string")) throw new Error(`invalid file content: ${path}`);
			files.push({
				path,
				lines: file.lines
			});
		}
	}
	if (!files.some((file) => file.path === "package.json")) throw new Error("invalid backup contents");
	if (Buffer.byteLength(JSON.stringify(backup)) > 2097152) throw new Error("backup is too large");
	return {
		...backup,
		files
	};
}
/** Atomically overwrite backed-up files and return a rollback for install failure. */
function restoreProfileBackup(profile, value, explicitDir) {
	const backup = validatedBackup(value);
	const root = resolve(explicitDir ?? profileDir(profile));
	const previous = /* @__PURE__ */ new Map();
	mkdirSync(root, { recursive: true });
	const rollback = () => {
		for (const [target, content] of previous) if (content === null) rmSync(target, { force: true });
		else writeFileSync(target, content);
	};
	try {
		for (const file of backup.files) {
			const { path } = file;
			const target = resolve(root, path);
			if (!target.startsWith(root + sep)) throw new Error(`unsafe backup path: ${path}`);
			ensureSafeParent(root, dirname(target), path);
			if (existsSync(target) && !lstatSync(target).isFile()) throw new Error(`backup path is not a file: ${path}`);
			previous.set(target, existsSync(target) ? readFileSync(target) : null);
			const temp = `${target}.dsh-restore-${String(process.pid)}`;
			writeFileSync(temp, "json" in file ? `${JSON.stringify(file.json, null, 2)}\n` : file.lines.join("\n"), "utf8");
			renameSync(temp, target);
		}
	} catch (error) {
		rollback();
		throw error;
	}
	return {
		files: previous.size,
		rollback
	};
}
/** Create missing parents one level at a time and refuse existing symlinks. */
function ensureSafeParent(root, parent, backupPath) {
	const relativeParent = relative(root, parent);
	if (relativeParent === "") return;
	let current = root;
	for (const part of relativeParent.split(sep)) {
		current = resolve(current, part);
		if (!existsSync(current)) {
			mkdirSync(current);
			continue;
		}
		const stat = lstatSync(current);
		if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe backup path: ${backupPath}`);
	}
}
async function webdavRequest(url, username, password, method, body) {
	const parsed = new URL(url);
	if (parsed.protocol === "http:") throw new Error("WebDAV requires an https:// URL");
	if (parsed.protocol !== "https:") throw new Error("invalid WebDAV URL");
	if (parsed.username !== "" || parsed.password !== "") throw new Error("invalid WebDAV URL");
	const address = await resolvePublicAddress(parsed.hostname);
	const headers = { host: parsed.host };
	if (body !== void 0) {
		headers["content-type"] = "application/json";
		headers["content-length"] = String(Buffer.byteLength(body));
	}
	if (username !== "") headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
	return await new Promise((resolveRequest, reject) => {
		const originalHostname = unbracketedHostname(parsed.hostname);
		const request$2 = request({
			protocol: "https:",
			hostname: address.address,
			family: address.family,
			port: parsed.port === "" ? 443 : Number(parsed.port),
			path: `${parsed.pathname}${parsed.search}`,
			method,
			headers,
			servername: isIP(originalHostname) === 0 ? originalHostname : void 0,
			signal: AbortSignal.timeout(3e4)
		}, (response) => {
			const chunks = [];
			let size = 0;
			const maxBytes = method === "GET" ? MAX_BACKUP_BYTES : 64 * 1024;
			response.once("error", reject);
			const declared = Number(response.headers["content-length"]);
			if (Number.isFinite(declared) && declared > maxBytes) {
				response.destroy(/* @__PURE__ */ new Error("WebDAV response is too large"));
				return;
			}
			response.on("data", (chunk) => {
				const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				size += value.byteLength;
				if (size > maxBytes) {
					response.destroy(/* @__PURE__ */ new Error("WebDAV response is too large"));
					return;
				}
				chunks.push(value);
			});
			response.once("end", () => resolveRequest({
				status: response.statusCode ?? 0,
				body: Buffer.concat(chunks)
			}));
		});
		request$2.once("error", reject);
		request$2.end(body);
	});
}
/**
* Ancestor collection URLs of a WebDAV file, outermost first.
* `https://dav.example/a/b/x.json` → [`https://dav.example/a/`, `https://dav.example/a/b/`].
* The server root itself is never included — it always exists, and some
* providers reject MKCOL on it.
*/
function webdavParentCollections(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return [];
	}
	const parts = parsed.pathname.split("/").filter((part) => part !== "");
	parts.pop();
	const collections = [];
	let path = "";
	for (const part of parts) {
		path += `/${part}`;
		collections.push(`${parsed.origin}${path}/`);
	}
	return collections;
}
/**
* Upload the backup, creating missing parent collections first (#102).
*
* WebDAV servers do not create intermediate collections implicitly, so a PUT
* into a folder that does not exist yet fails — Jianguoyun answers 404, which
* read as "sync is broken" rather than "make the folder first". MKCOL on an
* existing collection answers 405, which is success for our purposes; any
* other failure is left to the PUT to report, since some providers restrict
* MKCOL while still accepting the upload.
*/
async function uploadWebdav(url, username, password, backup) {
	for (const collection of webdavParentCollections(url)) try {
		await webdavRequest(collection, username, password, "MKCOL");
	} catch {}
	const response = await webdavRequest(url, username, password, "PUT", JSON.stringify(backup));
	if (response.status < 200 || response.status >= 300) throw new Error(response.status === 404 ? `WebDAV upload failed: HTTP 404 — the target folder does not exist and could not be created. Some providers (e.g. Jianguoyun) refuse files at the root: use a path inside a folder, e.g. https://dav.example.com/dsh/backup.json / 目标目录不存在且无法自动创建；部分服务商（如坚果云）不允许在根目录放文件，请使用形如 https://dav.example.com/dsh/backup.json 的子目录路径` : `WebDAV upload failed: HTTP ${response.status}`);
}
/** Refuse non-global IPv4 targets, including metadata and carrier NAT ranges. */
function isPublicIpv4(ip) {
	const octets = ip.split(".").map(Number);
	if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
	const [a, b] = octets;
	if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
	if (a === 100 && b >= 64 && b <= 127) return false;
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && (b === 0 || b === 168)) return false;
	if (a === 198 && (b === 18 || b === 19)) return false;
	return true;
}
/** Only public internet target hostnames are reachable for WebDAV. */
function isPublicHostname(hostname) {
	const lower = unbracketedHostname(hostname).toLowerCase();
	const bare = lower.endsWith(".") ? lower.slice(0, -1) : lower;
	return bare !== "" && bare !== "localhost" && bare !== "metadata.google.internal" && !bare.endsWith(".localhost") && !bare.endsWith(".internal") && !bare.endsWith(".local");
}
/**
* Whether a WebDAV hostname may be fetched: public https targets only.
* Exported for tests.
*/
function isPublicTarget(hostname) {
	const bare = unbracketedHostname(hostname);
	const family = isIP(bare);
	if (family === 4) return isPublicIpv4(bare);
	if (family === 6) return isPublicIpv6(bare);
	return isPublicHostname(bare);
}
/** Only global-unicast IPv6 is usable for a server-side WebDAV connection. */
function isPublicIpv6(ip) {
	const bare = unbracketedHostname(ip);
	if (isIP(bare) !== 6) return false;
	const first = Number.parseInt(bare.split(":", 1)[0] || "0", 16);
	return Number.isFinite(first) && first >= 8192 && first <= 16383;
}
function unbracketedHostname(hostname) {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
/** Resolve once, reject every unsafe answer, and return the address to pin. */
async function resolvePublicAddress(hostname) {
	const bare = unbracketedHostname(hostname);
	const family = isIP(bare);
	if (family === 4 || family === 6) {
		if (!isPublicTarget(bare)) throw new Error("invalid WebDAV URL");
		return {
			address: bare,
			family
		};
	}
	if (!isPublicHostname(bare)) throw new Error("invalid WebDAV URL");
	const addresses = await lookup(bare, {
		all: true,
		verbatim: true
	});
	if (addresses.length === 0 || addresses.some(({ address }) => !isPublicTarget(address))) throw new Error("invalid WebDAV URL");
	const selected = addresses[0];
	if (selected.family !== 4 && selected.family !== 6) throw new Error("invalid WebDAV URL");
	return {
		address: selected.address,
		family: selected.family
	};
}
async function downloadWebdav(url, username, password) {
	const response = await webdavRequest(url, username, password, "GET");
	if (response.status < 200 || response.status >= 300) throw new Error(response.status === 404 ? "WebDAV download failed: HTTP 404 — no backup at that path yet. Upload one first, and check the URL points at the backup FILE (…/dsh/backup.json), not its folder / 该路径下还没有备份文件。请先执行一次上传，并确认地址指向备份文件本身（…/dsh/backup.json）而不是目录" : `WebDAV download failed: HTTP ${response.status}`);
	const body = JSON.parse(response.body.toString("utf8"));
	validatedBackup(body);
	return body;
}
/**
* Merge a backup's manifest into the profile's current manifest so a restore
* never deletes plugins the target machine already has: current deps stay,
* backup specs win on name conflicts; bundle lists are unioned. When
* `selection` is given, only the selected plugins are merged in.
*/
/**
* Dependencies whose spec points at an absolute local path — `link:/Users/…`
* or `file:/home/…` (#205 by @Rudyy898).
*
* These are perfectly valid on the machine that wrote them and meaningless
* anywhere else, so a backup carrying one restores a manifest that `pnpm
* install` cannot satisfy: the path does not exist on the new machine and
* the whole restore fails on it.
*
* Reported, NOT rewritten. Turning `link:/Users/me/dev/plugin` into
* something portable means deciding where those files should live and
* whether to carry them at all, which is a design question and not
* something a restore should answer on the user's behalf. Naming them lets
* the operator decide before the install runs — which is the part that was
* missing.
*
* Relative `file:./vendor/x` specs are left alone: they resolve against the
* profile directory, which the restore recreates, so they travel fine.
*/
function unportableDeps(dependencies) {
	if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) return [];
	const found = [];
	for (const [name, raw] of Object.entries(dependencies)) {
		if (typeof raw !== "string") continue;
		const match = /^(?:link|file):(.+)$/i.exec(raw);
		if (match === null) continue;
		let path = match[1];
		try {
			path = decodeURIComponent(path);
		} catch {}
		if (/^\//.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path)) found.push({
			name,
			spec: raw
		});
	}
	return found;
}
function mergeRestoreManifest(backupManifest, current, selection) {
	const merged = { ...backupManifest };
	const backupDeps = backupManifest.dependencies === null || typeof backupManifest.dependencies !== "object" || Array.isArray(backupManifest.dependencies) ? {} : backupManifest.dependencies;
	const backupBundles = Array.isArray(backupManifest.dsh?.profile?.bundles) ? backupManifest.dsh.profile.bundles : [];
	const currentDeps = current.dependencies === null || typeof current.dependencies !== "object" || Array.isArray(current.dependencies) ? {} : current.dependencies;
	const currentBundles = Array.isArray(current.dsh?.profile?.bundles) ? current.dsh.profile.bundles : [];
	const deps = { ...currentDeps };
	const sourceDeps = selection !== void 0 ? selection.deps : backupDeps;
	for (const [name, spec] of Object.entries(sourceDeps)) deps[name] = spec;
	merged.dependencies = deps;
	const bundles = /* @__PURE__ */ new Set();
	for (const name of currentBundles) if (typeof name === "string") bundles.add(name);
	const sourceBundles = selection !== void 0 ? selection.bundles : backupBundles;
	for (const name of sourceBundles) if (typeof name === "string") bundles.add(name);
	const currentDsh = current.dsh === null || typeof current.dsh !== "object" || Array.isArray(current.dsh) ? void 0 : current.dsh;
	const currentProfile = currentDsh?.profile === null || typeof currentDsh?.profile !== "object" || Array.isArray(currentDsh?.profile) ? void 0 : currentDsh.profile;
	const backupDsh = merged.dsh === null || typeof merged.dsh !== "object" || Array.isArray(merged.dsh) ? void 0 : merged.dsh;
	const profileMerged = {
		...(backupDsh?.profile === null || typeof backupDsh?.profile !== "object" || Array.isArray(backupDsh?.profile) ? void 0 : backupDsh.profile) ?? {},
		...currentProfile ?? {},
		bundles: [...bundles]
	};
	merged.dsh = {
		...backupDsh ?? {},
		...currentDsh ?? {},
		profile: profileMerged
	};
	return merged;
}
//#endregion
//#region lib/types/gist.js
/**
* GitHub Gist transport for profile backups — the third backup channel next
* to the local download and WebDAV (issue #89).
*
* Security posture:
* - The API host is hard-coded to api.github.com, so there is no SSRF surface
*   (unlike WebDAV, which accepts arbitrary user URLs).
* - The Gist id is validated against a strict character allowlist before it
*   is interpolated into the request path.
* - Tokens are never persisted: the client sends one per request (session
*   memory only) or the operator sets DSH_GITHUB_TOKEN on the host; nothing
*   is written to disk by this module.
* - Downloaded content goes through `validatedBackup` before it is returned,
*   mirroring downloadWebdav's strict restore-side validation.
*
* Timeouts and errors:
* - Every request carries an AbortSignal: the caller's (route-level timeout,
*   so a wedged gh CLI or slow network yields a definite answer) merged with
*   a 30 s hard ceiling. Errors are classified into machine-readable codes
*   (`GistError`) so the UI can show friendly localized messages instead of
*   raw DOMException/network noise like "TimeoutError: signal timed out".
*/
/** The single file every dshmarket backup Gist carries. */
const GIST_FILENAME = "dsh-profile-backup.json";
/** GitHub hard limit for one Gist file (1 MB); enforced before upload. */
const GIST_MAX_BYTES = 1024 * 1024;
/** Environment variable for a host-configured token (never read from disk). */
const GIST_TOKEN_ENV = "DSH_GITHUB_TOKEN";
const GIST_API_HOST = "api.github.com";
const GIST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_TIMEOUT_MS = 3e4;
/** Node network error codes that mean "GitHub is unreachable". */
const NETWORK_ERROR_CODES = new Set([
	"ENOTFOUND",
	"EAI_AGAIN",
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
	"EPIPE",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ECONNABORTED"
]);
/** Error with a code for the UI; the message stays human-readable. */
var GistError = class extends Error {
	code;
	constructor(message, code = "other") {
		super(message);
		this.name = "GistError";
		this.code = code;
	}
};
/** Classify any thrown value into a stable GistErrorCode. */
function gistErrorCode(error) {
	if (error instanceof GistError) return error.code;
	if (error instanceof Error) {
		if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
		const raw = error.code ?? error.cause?.code;
		if (typeof raw === "string" && NETWORK_ERROR_CODES.has(raw)) return "network";
	}
	return "other";
}
/**
* Normalize a Gist id or a gist.github.com URL to a bare id.
* Anything else (paths, embedded slashes, oversize input) is rejected.
*/
function parseGistId(input) {
	const trimmed = input.trim();
	if (trimmed === "") throw new Error("gist id is required");
	let candidate = trimmed;
	try {
		const url = new URL(trimmed);
		if (url.protocol === "https:" && (url.hostname === "gist.github.com" || url.hostname.endsWith(".gist.github.com"))) {
			const parts = url.pathname.split("/").filter(Boolean);
			candidate = parts[parts.length - 1] ?? "";
		}
	} catch {}
	if (!GIST_ID_RE.test(candidate)) throw new Error("invalid gist id");
	return candidate;
}
/**
* Resolve the token for one request, in order of preference:
* 1. an explicitly supplied token (session memory only);
* 2. the host-configured DSH_GITHUB_TOKEN environment variable;
* 3. an already-logged-in GitHub CLI (`gh auth token`) — the token is used
*    for this request only and never written to disk.
*/
async function resolveGistTokenSource(bodyToken) {
	if (typeof bodyToken === "string" && bodyToken.trim() !== "") return {
		token: bodyToken.trim(),
		source: "token"
	};
	const configured = process.env[GIST_TOKEN_ENV];
	if (typeof configured === "string" && configured.trim() !== "") return {
		token: configured.trim(),
		source: "env"
	};
	const ghToken = await ghAuthToken();
	if (ghToken !== null) return {
		token: ghToken,
		source: "gh"
	};
	throw new GistError("GitHub token is required (enter it in the Backup tab, set DSH_GITHUB_TOKEN, or log in with the gh CLI)", "auth");
}
/** Short-lived in-memory cache for the gh-derived token (no disk, no browser). */
let ghTokenCache = null;
/** Ask an already-authenticated GitHub CLI for its token, if available. */
async function ghAuthToken() {
	if (ghTokenCache !== null && Date.now() < ghTokenCache.expires) return ghTokenCache.token;
	const token = await fetchGhToken();
	ghTokenCache = {
		token,
		expires: Date.now() + (token !== null ? 10 * 6e4 : 3e4)
	};
	return token;
}
/**
* Run `gh auth token` in a DETACHED child and give up after 8 s no matter
* what. The parent never waits on the child (unref), so even if gh.exe
* wedges under WSL interop the host event loop stays free and the request
* returns a definite answer. 8 s because a Windows gh.exe cold start through
* WSL interop is routinely slower than a native binary.
*/
function fetchGhToken() {
	return new Promise((resolve) => {
		const candidates = ["gh", join(homedir(), ".local", "bin", "gh")];
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const tryNext = (index) => {
			if (index >= candidates.length) {
				finish(null);
				return;
			}
			const command = candidates[index];
			let child = null;
			try {
				child = spawn(command, ["auth", "token"], {
					stdio: [
						"ignore",
						"pipe",
						"ignore"
					],
					detached: true,
					windowsHide: true
				});
			} catch {
				tryNext(index + 1);
				return;
			}
			if (child == null) {
				tryNext(index + 1);
				return;
			}
			let out = "";
			child.stdout?.on("data", (chunk) => {
				out += chunk.toString();
			});
			const timer = setTimeout(() => {
				try {
					child?.kill("SIGKILL");
				} catch {}
				finish(out.trim() !== "" ? out.trim() : null);
			}, 8e3);
			let errored = false;
			child.on("error", () => {
				if (errored) return;
				errored = true;
				clearTimeout(timer);
				if (!settled) tryNext(index + 1);
			});
			child.on("close", () => {
				if (errored) return;
				clearTimeout(timer);
				finish(out.trim() !== "" ? out.trim() : null);
			});
			child.unref();
		};
		tryNext(0);
	});
}
/** Map a request-level failure (abort or network error) to a GistError. */
function classifyRequestError(error) {
	if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return new GistError("GitHub request timed out", "timeout");
	const raw = error?.code ?? error?.cause?.code;
	if (typeof raw === "string" && NETWORK_ERROR_CODES.has(raw)) return new GistError(`GitHub is unreachable (${raw})`, "network");
	return error instanceof Error ? error : new GistError(String(error), "other");
}
function gistRequest(token, method, path, body, signal) {
	return new Promise((resolve, reject) => {
		const headers = {
			authorization: `Bearer ${token}`,
			"user-agent": "dshmarket",
			accept: "application/vnd.github+json"
		};
		if (body !== void 0) {
			headers["content-type"] = "application/json";
			headers["content-length"] = String(Buffer.byteLength(body));
		}
		const hardCeiling = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const request$1 = request({
			protocol: "https:",
			hostname: GIST_API_HOST,
			path,
			method,
			headers,
			signal: signal !== void 0 ? AbortSignal.any([signal, hardCeiling]) : hardCeiling
		}, (response) => {
			const chunks = [];
			let size = 0;
			const maxBytes = 2113536;
			response.once("error", reject);
			const declared = Number(response.headers["content-length"]);
			if (Number.isFinite(declared) && declared > maxBytes) {
				response.destroy(/* @__PURE__ */ new Error("GitHub response is too large"));
				return;
			}
			response.on("data", (chunk) => {
				const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				size += value.byteLength;
				if (size > maxBytes) {
					response.destroy(/* @__PURE__ */ new Error("GitHub response is too large"));
					return;
				}
				chunks.push(value);
			});
			response.once("end", () => resolve({
				status: response.statusCode ?? 0,
				body: Buffer.concat(chunks).toString("utf8")
			}));
		});
		request$1.once("error", (error) => reject(classifyRequestError(error)));
		if (body !== void 0) request$1.end(body);
		else request$1.end();
	});
}
function parseGistError(status, body, action) {
	let message = body;
	try {
		const parsed = JSON.parse(body);
		if (typeof parsed.message === "string" && parsed.message !== "") message = parsed.message;
	} catch {}
	if (status === 401) return new GistError("GitHub token is invalid or revoked", "auth");
	if (status === 403) return new GistError(`GitHub rejected the ${action} (rate limit or insufficient scope): ${message}`, "rate-limit");
	if (status === 404) return new GistError("Gist not found (check the id/URL)", "notfound");
	if (status === 422) return new GistError(`GitHub rejected the ${action}: ${message}`, "invalid");
	return new GistError(`GitHub ${action} failed: HTTP ${status} ${message}`, "other");
}
async function sendGistRequest(token, method, path, body, action, signal) {
	const response = await gistRequest(token, method, path, body, signal);
	if (!(method === "POST" ? response.status === 201 : response.status === 200)) throw parseGistError(response.status, response.body, action);
	return response;
}
/** Create a new private Gist carrying one backup file. */
async function createGist(token, content, signal) {
	const response = await sendGistRequest(token, "POST", "/gists", JSON.stringify({
		description: "dshmarket profile backup",
		public: false,
		files: { [GIST_FILENAME]: { content } }
	}), "Gist creation", signal);
	const data = JSON.parse(response.body);
	if (typeof data.id !== "string" || data.id === "") throw new Error("GitHub returned an invalid Gist");
	return {
		id: data.id,
		htmlUrl: typeof data.html_url === "string" ? data.html_url : `https://gist.github.com/${data.id}`
	};
}
/** Overwrite the backup file inside an existing Gist (other files kept). */
async function updateGist(token, gistId, content, signal) {
	const body = JSON.stringify({ files: { [GIST_FILENAME]: { content } } });
	const response = await sendGistRequest(token, "PATCH", `/gists/${gistId}`, body, "Gist update", signal);
	const data = JSON.parse(response.body);
	return {
		id: typeof data.id === "string" ? data.id : gistId,
		htmlUrl: typeof data.html_url === "string" ? data.html_url : `https://gist.github.com/${gistId}`
	};
}
/** Download and strictly validate the backup file inside a Gist. */
async function readGist(token, gistId, signal) {
	const response = await sendGistRequest(token, "GET", `/gists/${gistId}`, void 0, "Gist read", signal);
	let data;
	try {
		data = JSON.parse(response.body);
	} catch {
		throw new GistError("GitHub returned an unreadable Gist payload", "invalid");
	}
	const file = data.files?.[GIST_FILENAME];
	const content = file !== null && typeof file === "object" && !Array.isArray(file) ? file.content : void 0;
	if (typeof content !== "string") throw new GistError(`Gist has no ${GIST_FILENAME} file`, "invalid");
	let parsed;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new GistError("Gist backup is not valid JSON", "invalid");
	}
	try {
		return validatedBackup(parsed);
	} catch (error) {
		throw new GistError(error instanceof Error ? error.message : String(error), "invalid");
	}
}
/** Confirm the token is usable (GET /user). */
async function verifyGistToken(token, signal) {
	await sendGistRequest(token, "GET", "/user", void 0, "token verification", signal);
}
/** True when the serialized backup fits inside a Gist file. */
function fitsGistLimit(content) {
	return Buffer.byteLength(content) <= GIST_MAX_BYTES;
}
//#endregion
//#region lib/types/routes.js
/**
* HTTP routes bridging the browser market UI to the host. This layer only
* parses requests, calls the service modules, and serializes responses —
* process spawning lives in dsh-cli.ts, filesystem reads in profile.ts,
* orchestration in install.ts / themes.ts / updates.ts.
*
* Security: the install route executes a shell command, so it accepts only
* same-origin POSTs and only sources present in the curated registry.
*/
const PROFILE_RE = /^[A-Za-z0-9_-]+$/;
/**
* The market's own version, read once from its installed package.json.
*
* The UI puts this in the page heading so a user's screenshot carries it:
* most bug reports arrive as a photo of the screen, and without a version
* in frame the first reply always has to ask which one it was.
*/
let cachedVersion = null;
function marketVersion() {
	if (cachedVersion !== null) return cachedVersion;
	try {
		cachedVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "unknown";
	} catch {
		cachedVersion = "unknown";
	}
	return cachedVersion;
}
/** The market's own package names, as they appear in a profile manifest. */
const SELF_NAMES = new Set(["dshmarket", "dsh-market"]);
/**
* Whether an installed package declares a client part (`dsh.client`). Its UI
* is injected into the page, so toggling it needs a browser refresh to show
* the change — the install flow prompts the same way via the hot banner.
*/
function packageHasClientPart(profileDirectory, name) {
	try {
		return JSON.parse(readFileSync(join(profileDirectory, "node_modules", name, "package.json"), "utf8")).dsh?.client !== void 0;
	} catch {
		return false;
	}
}
/**
* Packages whose build scripts pnpm refused to run, from any of its three
* reporting shapes: the structured ndjson event (pnpm 11), the human
* "Ignored build scripts:" line, or the fetcher's git-prepare rejection —
* which fires BEFORE the package lands in node_modules (#68). Undefined when
* none, so the field can be spread straight into a JSON response.
*/
function blockedBuilds(result) {
	if (Array.isArray(result.ignoredBuilds) && result.ignoredBuilds.length > 0) return result.ignoredBuilds;
	const list = parseIgnoredBuilds(result.stdout, result.stderr);
	if (list.length > 0) return list;
	const pending = parsePrepareNotAllowed(result.stdout, result.stderr);
	return pending !== null ? [pending] : void 0;
}
/**
* Register the market's HTTP routes.
* @param host - Acquired webServer + shell services.
* @param config - Validated market configuration.
* @returns Disposer removing every registered route.
*/
function mountMarketRoutes(host, config, commandRuntime, agentsLookup) {
	if (config.profileDirectory === void 0 && !PROFILE_RE.test(config.profile)) throw new Error(`dsh-market: invalid profile name: ${config.profile}`);
	const activeProfileDir = profileDir(config.profile, config.profileDirectory);
	let agentGuardUnavailableLogged = false;
	/** Running-agent ids for the mutation gate; logs once when the host exposes no agents service. */
	const runningAgentsForGuard = () => {
		const service = agentsLookup?.();
		const ids = runningAgentIds(service);
		if (service === void 0 && !agentGuardUnavailableLogged) {
			agentGuardUnavailableLogged = true;
			logEvent("warn", "agent-guard", "host exposes no agents service — mutations are not guarded while agents run");
		}
		return ids;
	};
	/** Whether the host exposes a usable agents service (readable in /status). */
	const agentsGuardAvailable = () => {
		const service = agentsLookup?.();
		if (service === void 0) return false;
		try {
			return Array.isArray(service.list());
		} catch {
			return false;
		}
	};
	const userPatchPath = findUserPatchPath(host, activeProfileDir);
	const commands = commandRuntime ?? {
		runPlugin: runDshPlugin,
		probePnpm,
		provisionPnpm,
		cancelActive
	};
	cleanHotDir(activeProfileDir);
	const marketState = readMarketState(activeProfileDir);
	const disabled = marketState.disabled;
	const groups = marketState.groups;
	const groupOrder = marketState.groupOrder;
	if (marketState.channel !== void 0) config.channel = marketState.channel;
	const activeChannel = () => resolveChannel(config.channel, marketVersion());
	const themes = createThemeManager(host, config.profile, disabled, activeProfileDir);
	mountClientOnlyDeps(host, activeProfileDir).then(async (mounted) => {
		if (mounted.length > 0) logEvent("info", "boot", `client-only shims mounted: ${mounted.join(", ")}`);
		for (const name of disabled) if (await themes.setEntryDisabled(name, true)) logEvent("info", "boot", `plugin kept off: ${name}`);
	});
	host.on?.("internal/plugin", (fiber) => {
		const name = fiber.entry?.options?.name;
		if (name !== void 0 && disabled.has(name)) themes.setEntryDisabled(name, true);
	});
	let installing = false;
	let restarting = false;
	let writing = false;
	let mutationBusy = false;
	/** The shared mutation chain: every mutating operation appends to it. */
	let mutationChain = Promise.resolve();
	/**
	* Run a mutating operation under the shared mutation lock. `kind` selects
	* the UI busy flag (`install` = pnpm operation, `write` = direct profile
	* write) and the 409 message. The operation runs only after every earlier
	* mutation settled (promise chain); while one is in flight a second
	* mutating request answers 409 immediately — the UI polls /status for the
	* busy flag instead of queueing (issue #125 review).
	* @returns the operation's value, or null when the lock was busy (409 sent).
	*/
	async function withMutationLock(response, kind, fn) {
		if (mutationBusy) {
			sendJson(response, 409, { error: kind === "install" ? "another install is already running" : "another plugin operation is running" });
			return null;
		}
		mutationBusy = true;
		if (kind === "install") installing = true;
		else writing = true;
		try {
			const run = mutationChain.then(async () => fn());
			mutationChain = run.catch(() => void 0);
			return await run;
		} finally {
			mutationBusy = false;
			if (kind === "install") installing = false;
			else writing = false;
		}
	}
	/** Dependency diff vs. a pre-operation snapshot (cancel aftermath). */
	function changedSince(before) {
		const now = readInstalled(config.profile, activeProfileDir);
		const changed = /* @__PURE__ */ new Set();
		for (const [name, spec] of Object.entries(now)) if (before[name] !== spec) changed.add(name);
		for (const name of Object.keys(before)) if (now[name] === void 0) changed.add(name);
		return {
			changed: [...changed],
			partial: changed.size > 0
		};
	}
	/**
	* Apply one enable/disable request: persist the choice in state.json, then
	* drive the live composition. Covers every mount form — hot mounts and
	* client-only shims go through hotUnmount/hotMount, bundle-layer entries
	* through setEntryDisabled. Enabling a THEME goes through the caller's
	* activateTheme instead so the Themes tab's exclusivity stays intact.
	*/
	async function setPluginEnabled(name, enabled) {
		const dir = activeProfileDir;
		if (enabled) disabled.delete(name);
		else disabled.add(name);
		let ok;
		let reason;
		if (enabled) if (listHotMounts().includes(name)) ok = true;
		else if (await themes.setEntryDisabled(name, false)) ok = true;
		else {
			const result = await hotMount(host, dir, name);
			ok = result.ok;
			reason = result.reason ?? void 0;
		}
		else {
			ok = await hotUnmount(name) || await themes.setEntryDisabled(name, true);
			if (!ok) ok = true;
		}
		writeMarketState(dir, {
			disabled,
			groups,
			groupOrder
		});
		return {
			ok,
			reason
		};
	}
	/**
	* Everything live in the running composition: market hot mounts plus
	* bundle-layer loader entries whose fiber is up (loaded at boot). This is
	* the source of truth for verifyActivation's `live` state — without the
	* loader side, every boot-loaded bundle plugin would read as "restart".
	*/
	function liveNames() {
		const live = new Set(listHotMounts());
		for (const entry of host.loader.entries()) {
			if (entry.fiber === void 0) continue;
			if (entry.options.name !== void 0) live.add(entry.options.name);
			if (entry.options.id !== void 0 && entry.options.id !== "") {
				live.add(`#${entry.options.id}`);
				const bare = entry.options.id.split(":").pop();
				if (bare !== void 0 && bare !== entry.options.id) live.add(`#${bare}`);
			}
		}
		return live;
	}
	/**
	* Drop live hot mounts whose package was removed outside the market
	* (e.g. `dsh plugin remove` in a terminal): the stale mount would keep
	* serving a client bundle that 404s after refresh, wedging the page
	* until a restart (#29 by @SunYanbox).
	*/
	async function dropStaleHotMounts() {
		for (const name of listHotMounts()) {
			if (existsSync(join(activeProfileDir, "node_modules", name, "package.json"))) continue;
			await hotUnmount(name);
			logEvent("warn", "hot-sweep", `${name}: package removed outside the market — live mount dropped`);
		}
	}
	/** Every plugin command goes through the pnpm-drift recovery wrapper (#20). */
	const runPlugin = (profile, args) => withHoistRecovery(commands.runPlugin, profile, args);
	/**
	* Undo a clean-exit update whose new build cannot boot. Restoring only the
	* manifest pin (the original #159 behavior) leaves the bad package files
	* on disk, and the boot resolves bundle patches from node_modules — the
	* next start still fails. Re-run pnpm install against the restored
	* manifest to rematerialize the previous build's files.
	*/
	async function rollbackUpdateBuild(name, manifestBefore) {
		const rolledBack = restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
		if (rolledBack.length === 0) return {
			ok: true,
			detail: null
		};
		const reinstall = await runPlugin(config.profile, [
			"--no-frozen-lockfile",
			RELEASE_AGE_OVERRIDE,
			"install"
		]);
		const ok = reinstall.exitCode === 0 && !reinstall.timedOut && !reinstall.cancelled;
		if (ok) logEvent("info", "update", `${name}: previous build rematerialized (${rolledBack.join(", ")})`);
		return {
			ok,
			detail: ok ? null : failureDetail(reinstall)
		};
	}
	const pendingRollbacks = /* @__PURE__ */ new Map();
	let rollbackSequence = 0;
	function savePendingRollback(record) {
		const id = `rollback-${String(rollbackSequence++)}`;
		pendingRollbacks.set(id, {
			...record,
			id
		});
		return id;
	}
	/** Restore a github: update by re-adding the commit captured before the update. */
	async function rollbackGitBuild(name, manifestBefore, target, beforeCommit) {
		if (beforeCommit === null) return {
			ok: false,
			detail: "the previous commit is unknown; nothing to roll back to"
		};
		restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
		const add = await runPlugin(config.profile, [
			"add",
			RELEASE_AGE_OVERRIDE,
			`${target}#${beforeCommit}`
		]);
		if (add.exitCode !== 0 || add.timedOut || add.cancelled) return {
			ok: false,
			detail: failureDetail(add)
		};
		restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
		logEvent("info", "update-rollback", `${name}: restored github build at ${beforeCommit}`);
		return {
			ok: true,
			detail: null
		};
	}
	async function removeInstalledPackage(name) {
		const result = await runPlugin(config.profile, ["remove", name]);
		if (result.exitCode !== 0 || result.timedOut || result.cancelled) return {
			ok: false,
			hot: false,
			detail: failureDetail(result)
		};
		const unmounted = await hotUnmount(name);
		const entryDisabled = await themes.setEntryDisabled(name, true);
		const hot = unmounted || entryDisabled;
		removeRowBlocks(userPatchPath, rowIdsForPackage(host, activeProfileDir, name));
		disabled.delete(name);
		removeFromGroups({
			groups,
			groupOrder
		}, name);
		writeMarketState(activeProfileDir, {
			disabled,
			groups,
			groupOrder
		});
		return {
			ok: true,
			hot,
			detail: null
		};
	}
	async function restoreBackup(value) {
		if (!await probePnpm()) throw new Error("pnpm is required to restore plugins");
		const manifestBefore = JSON.parse(readFileSync(join(activeProfileDir, "package.json"), "utf8"));
		const restored = restoreProfileBackup(config.profile, value, activeProfileDir);
		try {
			const mergedManifest = mergeRestoreManifest(JSON.parse(readFileSync(join(activeProfileDir, "package.json"), "utf8")), manifestBefore);
			writeFileSync(join(activeProfileDir, "package.json"), `${JSON.stringify(mergedManifest, null, 2)}\n`);
			const unportable = unportableDeps(mergedManifest.dependencies);
			if (unportable.length > 0) logEvent("warn", "restore", `machine-specific dependency paths in the restored manifest — ${unportable.map((dep) => `${dep.name}: ${dep.spec}`).join("; ")}`);
			const result = await runPlugin(config.profile, ["install"]);
			if (result.exitCode === 0 && !result.timedOut && !result.cancelled) {
				invalidateUpdates();
				return {
					files: restored.files,
					errors: [],
					unportable
				};
			}
			const manifestFile = join(activeProfileDir, "package.json");
			const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
			const dependencies = Object.entries(manifest.dependencies ?? {});
			const desiredBundles = [...manifest.dsh?.profile?.bundles ?? []];
			const dependencyNames = new Set(dependencies.map(([name]) => name));
			manifest.dependencies = {};
			if (Array.isArray(manifest.dsh?.profile?.bundles)) manifest.dsh.profile.bundles = desiredBundles.filter((bundle) => !dependencyNames.has(bundle));
			writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
			const errors = [];
			let installed = 0;
			for (const [name, spec] of dependencies) {
				const target = /^(?:file|link|github|git\+|https?):/.test(spec) ? spec : `${name}@${spec}`;
				try {
					const item = await runPlugin(config.profile, ["add", target]);
					if (item.exitCode === 0 && !item.timedOut && !item.cancelled && existsSync(join(activeProfileDir, "node_modules", name, "package.json"))) {
						installed += 1;
						if (desiredBundles.includes(name)) {
							const current = JSON.parse(readFileSync(manifestFile, "utf8"));
							current.dsh ??= {};
							current.dsh.profile ??= {};
							current.dsh.profile.bundles ??= [];
							if (!current.dsh.profile.bundles.includes(name)) current.dsh.profile.bundles.push(name);
							writeFileSync(manifestFile, `${JSON.stringify(current, null, 2)}\n`);
						}
						continue;
					}
					errors.push({
						name,
						error: failureDetail(item).trim() || "pnpm failed"
					});
				} catch (error) {
					errors.push({
						name,
						error: error instanceof Error ? error.message : String(error)
					});
				}
				const current = JSON.parse(readFileSync(manifestFile, "utf8"));
				if (current.dependencies !== void 0) delete current.dependencies[name];
				writeFileSync(manifestFile, `${JSON.stringify(current, null, 2)}\n`);
			}
			if (installed === 0 && dependencies.length > 0) restored.rollback();
			invalidateUpdates();
			return {
				files: restored.files,
				errors,
				unportable: unportableDeps(manifest.dependencies)
			};
		} catch (error) {
			restored.rollback();
			throw error;
		}
	}
	const disposers = [
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/backup",
			handler: (request, response) => {
				if (request.method !== "GET") {
					response.writeHead(405, { allow: "GET" });
					response.end();
					return;
				}
				if (!trustedDownloadRequest(request)) {
					sendJson(response, 403, { error: "backup export is limited to same-origin loopback requests" });
					return;
				}
				try {
					const data = createProfileBackup(config.profile, activeProfileDir);
					const backup = JSON.stringify(data, null, 2);
					const timestamp = new Date(data.createdAt).toLocaleString("sv-SE").replace(/\D/g, "");
					response.writeHead(200, {
						"cache-control": "no-store",
						"content-type": "application/json; charset=utf-8",
						"content-disposition": `attachment; filename="dsh-dshmarket-backup-${timestamp}.json"`
					});
					response.end(backup);
				} catch (error) {
					sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/restore",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) return sendJson(response, 403, { error: "untrusted origin" });
				try {
					const body = await readJsonBody(request, 2101248);
					await withMutationLock(response, "install", async () => {
						sendJson(response, 200, {
							ok: true,
							...await restoreBackup(body.backup)
						});
					});
				} catch (error) {
					sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/webdav",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) return sendJson(response, 403, { error: "untrusted origin" });
				try {
					const body = await readJsonBody(request);
					const url = typeof body.url === "string" ? body.url : "";
					const username = typeof body.username === "string" ? body.username : "";
					const password = typeof body.password === "string" ? body.password : "";
					if (body.action === "backup") {
						await uploadWebdav(url, username, password, createProfileBackup(config.profile, activeProfileDir));
						sendJson(response, 200, { ok: true });
					} else if (body.action === "restore") sendJson(response, 200, {
						ok: true,
						backup: await downloadWebdav(url, username, password)
					});
					else sendJson(response, 400, { error: "invalid WebDAV action" });
				} catch (error) {
					sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/gist",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) return sendJson(response, 403, { error: "untrusted origin" });
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(new GistError("Gist operation timed out", "timeout")), 25e3);
				try {
					const body = await readJsonBody(request);
					const { token, source } = await resolveGistTokenSource(body.token);
					if (body.action === "export") {
						const gistIdInput = typeof body.gistId === "string" ? body.gistId.trim() : "";
						const includeDeps = Array.isArray(body.includeDeps) ? body.includeDeps.filter((name) => typeof name === "string" && name !== "") : void 0;
						const backup = createProfileBackup(config.profile, activeProfileDir, includeDeps !== void 0 ? {
							includeDeps,
							includeConfig: body.includeConfig === true
						} : void 0);
						const content = JSON.stringify(backup, null, 2);
						if (!fitsGistLimit(content)) throw new Error("backup exceeds the GitHub Gist 1 MB limit");
						const ref = gistIdInput === "" ? await createGist(token, content, controller.signal) : await updateGist(token, parseGistId(gistIdInput), content, controller.signal);
						sendJson(response, 200, {
							ok: true,
							gistId: ref.id,
							gistUrl: ref.htmlUrl
						});
					} else if (body.action === "import") {
						if (typeof body.gistId !== "string" || body.gistId.trim() === "") throw new Error("gist id is required");
						sendJson(response, 200, {
							ok: true,
							backup: await readGist(token, parseGistId(body.gistId), controller.signal)
						});
					} else if (body.action === "verify") {
						await verifyGistToken(token, controller.signal);
						sendJson(response, 200, {
							ok: true,
							source
						});
					} else sendJson(response, 400, { error: "invalid Gist action" });
				} catch (error) {
					sendJson(response, 400, {
						error: error instanceof Error ? error.message : String(error),
						code: gistErrorCode(error)
					});
				} finally {
					clearTimeout(timer);
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/registry",
			handler: async (request, response) => {
				if (request.method !== "GET") {
					response.writeHead(405, { allow: "GET" });
					response.end();
					return;
				}
				try {
					try {
						sendJson(response, 200, { registry: await loadRegistry() });
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						logEvent("warn", "registry", `catalog fetch failed: ${message}`);
						sendJson(response, 502, { error: message });
					}
				} catch (error) {
					sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/installed",
			handler: async (request, response) => {
				if (request.method !== "GET") {
					response.writeHead(405, { allow: "GET" });
					response.end();
					return;
				}
				await dropStaleHotMounts();
				const installed = readInstalled(config.profile, activeProfileDir);
				const repoIdentities = {};
				const repoHints = {};
				for (const [name, spec] of Object.entries(installed)) {
					const evidence = readInstalledRepoEvidence(config.profile, name, spec, activeProfileDir);
					if (evidence.identities.length > 0) repoIdentities[name] = evidence.identities;
					if (evidence.hints.length > 0) repoHints[name] = evidence.hints;
				}
				const present = Object.keys(installed).filter((name) => readInstalledVersion(config.profile, name, activeProfileDir) !== null);
				const patch = readUserPatchState(userPatchPath);
				const patchFlags = packagePatchFlags(host, activeProfileDir, Object.keys(installed), patch);
				const activation = {};
				const live = liveNames();
				for (const name of Object.keys(installed)) activation[name] = verifyActivation(config.profile, name, live, activeProfileDir, disabled.has(name) || patchFlags.disabled.includes(name));
				const diagnostics = diagnosePackageManifests(Object.keys(installed).map((packageName) => ({
					packageName,
					manifest: readInstalledManifest(config.profile, packageName, activeProfileDir)
				})));
				sendJson(response, 200, {
					profile: config.profile,
					installed,
					repoIdentities,
					repoHints,
					present,
					activation,
					diagnostics,
					live: listHotMounts(),
					disabled: [...disabled],
					groups,
					groupOrder,
					patch: {
						disables: patch.disables,
						forced: patch.forced,
						inserts: patch.inserts
					},
					patchDisabled: patchFlags.disabled,
					patchForced: patchFlags.forced,
					bundles: readProfileBundles(activeProfileDir).filter((name) => !INBOX_BUNDLES$1.has(name))
				});
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/check",
			handler: (request, response) => {
				if (request.method !== "GET") {
					response.writeHead(405, { allow: "GET" });
					response.end();
					return;
				}
				try {
					sendJson(response, 200, analyzeProfile(activeProfileDir));
				} catch (error) {
					sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/bundle-order",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				let backup = null;
				try {
					await withMutationLock(response, "write", async () => {
						const body = await readJsonBody(request);
						if (body === null || typeof body !== "object") {
							sendJson(response, 400, { error: "JSON body is required / 需要 JSON body" });
							return;
						}
						if (!Array.isArray(body.order) || !body.order.every((item) => typeof item === "string")) {
							sendJson(response, 400, { error: "order must be an array of bundle names / order 必须是 bundle 名称数组" });
							return;
						}
						const order = body.order;
						const merged = mergeOrder(readBundleStack(activeProfileDir).bundles, order);
						if (merged.ok) {
							const conflicts = validateOrder(merged.bundles, readBundleRules(activeProfileDir));
							if (conflicts.length > 0) {
								logEvent("warn", "bundle-order", `rejected by before/after rules: ${conflicts.map((c) => c.reason).join("; ")}`);
								sendJson(response, 422, {
									error: "the order violates declared before/after rules / 该顺序违反了插件声明的 before/after 规则",
									conflicts
								});
								return;
							}
						}
						const trial = trialValidate(activeProfileDir, order);
						if (!trial.ok) {
							const first = trial.errors[0];
							logEvent("warn", "bundle-order", `rejected by trial validation: ${first?.message ?? "unknown"}`);
							sendJson(response, 422, {
								error: `trial validation failed — ${first?.message ?? "this order would not boot"} / 试启动校验失败：${first?.message ?? "该顺序无法启动"}`,
								trial: {
									errors: trial.errors,
									warnings: trial.warnings,
									diff: trial.diff
								}
							});
							return;
						}
						backup = createProfileBackup(config.profile, activeProfileDir);
						const applied = applyBundleOrder(activeProfileDir, order);
						if (!applied.ok) {
							sendJson(response, 400, { error: applied.error });
							return;
						}
						invalidateUpdates();
						logEvent("info", "bundle-order", "applied new community order");
						sendJson(response, 200, {
							ok: true,
							bundles: applied.bundles
						});
					});
				} catch (error) {
					if (backup !== null) try {
						restoreProfileBackup(config.profile, backup, activeProfileDir);
						logEvent("error", "bundle-order", `write failed — profile restored from pre-write backup: ${error instanceof Error ? error.message : String(error)}`);
					} catch {
						logEvent("error", "bundle-order", "write failed AND automatic rollback failed");
					}
					sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/use-skin",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					const body = await readJsonBody(request);
					const name = typeof body.name === "string" ? body.name : "";
					const installed = readInstalled(config.profile, activeProfileDir);
					const themeNames = await themes.installedThemeNames();
					if (installed[name] === void 0 || !themeNames.has(name)) {
						sendJson(response, 400, { error: "not an installed theme" });
						return;
					}
					const activated = await themes.activateTheme(name);
					logEvent(activated ? "info" : "error", "use-skin", `${name}: ${activated ? "active" : "failed"}`);
					sendJson(response, activated ? 200 : 502, {
						ok: activated,
						live: listHotMounts()
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logEvent("error", "use-skin", `route error: ${message}`);
					sendJson(response, 500, { error: message });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/toggle",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					const body = await readJsonBody(request);
					const name = typeof body.name === "string" ? body.name : "";
					const enabled = body.enabled === true;
					if (name === "dsh-market" || name === "dshmarket") {
						sendJson(response, 400, { error: "the market cannot be disabled from its own page; use the dsh CLI" });
						return;
					}
					if (readInstalled(config.profile, activeProfileDir)[name] === void 0) {
						sendJson(response, 400, { error: "plugin is not installed" });
						return;
					}
					if (isProtectedModule(name)) {
						sendJson(response, 403, { error: `${name} 属于宿主基础设施,禁止开关(会破坏热加载/传输/存储链) / ${name} is host infrastructure and cannot be toggled (it would break the hot-reload/transport/storage chain)` });
						return;
					}
					let ok;
					let reason;
					if (enabled && (await themes.installedThemeNames()).has(name)) {
						ok = await themes.activateTheme(name);
						if (!ok) reason = "theme activation failed — restart required / 主题启用失败，需要重启";
					} else {
						const result = await setPluginEnabled(name, enabled);
						ok = result.ok;
						reason = result.reason;
					}
					const patchRows = rowIdsForPackage(host, activeProfileDir, name);
					const disablesOthers = carrierDisableIds(activeProfileDir, name);
					const isCarrier = disablesOthers.length > 0;
					let bundleSwitch = {
						ok: true,
						reason: null
					};
					if (isCarrier) try {
						if (enabled) addProfileBundle(activeProfileDir, name);
						else removeProfileBundle(activeProfileDir, name);
						logEvent("info", "toggle", `${name}: disable-carrier ${enabled ? "re-added to" : "removed from"} dsh.profile.bundles (disables: ${disablesOthers.join(", ")})`);
					} catch (error) {
						bundleSwitch = {
							ok: false,
							reason: error instanceof Error ? error.message : String(error)
						};
						logEvent("warn", "toggle", `${name}: carrier bundle switch failed — ${bundleSwitch.reason}`);
					}
					let patchWrite = null;
					if (patchRows.length > 0) {
						for (const rowId of patchRows) {
							const result = enabled ? await enableRow(userPatchPath, rowId) : await disableRow(userPatchPath, rowId);
							if (!result.ok && patchWrite === null) patchWrite = result;
						}
						if (patchWrite === null) logEvent("info", "toggle", `${name}: patch layer ${enabled ? "enabled" : "disabled"} rows ${patchRows.join(", ")}`);
						else logEvent("warn", "toggle", `${name}: patch layer write refused — ${patchWrite.reason}`);
					}
					logEvent(ok ? "info" : "error", "toggle", `${name}: ${enabled ? "on" : "off"} ok=${String(ok)}`);
					const patchNow = readUserPatchState(userPatchPath);
					const offNow = disabled.has(name) || patchRows.some((id) => patchNow.disables.includes(id));
					const liveAfter = liveNames().has(name);
					const restart = isCarrier ? true : enabled ? !liveAfter : liveAfter;
					const refresh = packageHasClientPart(activeProfileDir, name);
					sendJson(response, ok ? 200 : 502, {
						ok,
						name,
						enabled,
						disabled: [...disabled],
						live: listHotMounts(),
						activation: { [name]: verifyActivation(config.profile, name, liveNames(), activeProfileDir, offNow) },
						reason,
						patchRows,
						patchWrite: patchWrite ?? {
							ok: true,
							reason: null
						},
						carrier: disablesOthers,
						bundleSwitch,
						restart,
						refresh
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logEvent("error", "toggle", `route error: ${message}`);
					sendJson(response, 500, { error: message });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/groups",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					const body = await readJsonBody(request);
					const action = typeof body.action === "string" ? body.action : "";
					if (!(action === "create" || action === "rename" || action === "delete" || action === "set-members" || action === "toggle")) {
						sendJson(response, 400, {
							ok: false,
							error: "unknown group action"
						});
						return;
					}
					const installed = new Set(Object.keys(readInstalled(config.profile, activeProfileDir)));
					const themeNames = await themes.installedThemeNames();
					let ok = true;
					let error;
					let restartMembers = [];
					let refreshMembers = [];
					if (action === "toggle") {
						const name = typeof body.name === "string" ? body.name : "";
						const enabled = body.enabled === true;
						if (groups[name] === void 0) {
							sendJson(response, 400, {
								ok: false,
								error: "group not found / 分组不存在"
							});
							return;
						}
						const failures = [];
						for (const member of groups[name]) {
							if (!installed.has(member)) continue;
							if (!(enabled && themeNames.has(member) ? {
								ok: await themes.activateTheme(member),
								reason: void 0
							} : await setPluginEnabled(member, enabled)).ok) failures.push(member);
							const liveAfter = liveNames().has(member);
							if (enabled && !liveAfter || !enabled && liveAfter) restartMembers.push(member);
							if (packageHasClientPart(activeProfileDir, member)) refreshMembers.push(member);
						}
						ok = failures.length === 0;
						if (!ok) error = `failed to ${enabled ? "enable" : "disable"}: ${failures.join(", ")}`;
					} else {
						const state = {
							groups,
							groupOrder
						};
						const result = action === "create" ? createGroup(state, body.name) : action === "rename" ? renameGroup(state, body.name, body.newName) : action === "delete" ? deleteGroup(state, body.name) : setGroupMembers(state, body.name, body.members, installed, themeNames);
						ok = result.ok;
						error = result.error;
					}
					if (ok) writeMarketState(activeProfileDir, {
						disabled,
						groups,
						groupOrder
					});
					logEvent(ok ? "info" : "warn", "groups", `${action}${typeof body.name === "string" ? " " + body.name : ""}${ok ? "" : ` — ${error ?? ""}`}`);
					sendJson(response, ok ? 200 : 400, {
						ok,
						error,
						groups,
						groupOrder,
						disabled: [...disabled],
						restartMembers,
						refreshMembers
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logEvent("error", "groups", `route error: ${message}`);
					sendJson(response, 500, { error: message });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/status",
			handler: async (request, response) => {
				if (request.method !== "GET") {
					response.writeHead(405, { allow: "GET" });
					response.end();
					return;
				}
				await dropStaleHotMounts();
				sendJson(response, 200, {
					active: progress.active,
					target: progress.target,
					seconds: progress.active ? Math.round((Date.now() - progress.startedAt) / 1e3) : 0,
					lastLine: progress.lastLine,
					phase: progress.phase,
					done: progress.done,
					total: progress.total,
					currentPackage: progress.currentPackage,
					downloaded: progress.downloaded,
					size: progress.size,
					ndjson: progress.ndjson,
					error: progress.error,
					cancelling: progress.cancelling,
					busy: installing,
					pnpm: await commands.probePnpm(),
					boot: BOOT_ID,
					agentGuardAvailable: agentsGuardAvailable(),
					version: marketVersion(),
					channel: activeChannel(),
					channels: CHANNELS,
					restart: restartAllowed(config),
					supervisor: detectedSupervisor(),
					installed: readInstalled(config.profile, activeProfileDir)
				});
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/logs",
			handler: (request, response) => {
				if (request.method !== "GET") {
					response.writeHead(405, { allow: "GET" });
					response.end();
					return;
				}
				const version = marketVersion();
				response.writeHead(200, {
					"cache-control": "no-store",
					"content-type": "text/plain; charset=utf-8",
					"content-disposition": "attachment; filename=\"dsh-market-log.txt\""
				});
				response.end(exportLogs({
					"dsh-market": version,
					platform: `${process.platform} ${process.arch}`,
					node: process.version,
					profile: config.profile
				}));
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/updates",
			handler: async (request, response) => {
				if (request.method !== "GET") {
					response.writeHead(405, { allow: "GET" });
					response.end();
					return;
				}
				try {
					const force = (request.url ?? "").includes("force=1");
					const channel = activeChannel();
					const channelFor = new Map(Object.keys(readInstalled(config.profile, activeProfileDir)).filter((name) => SELF_NAMES.has(name)).map((name) => [name, channel]));
					sendJson(response, 200, { updates: await checkUpdates(config.profile, force, activeProfileDir, channelFor) });
				} catch (error) {
					sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/update",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					await withMutationLock(response, "install", async () => {
						const body = await readJsonBody(request);
						const name = typeof body.name === "string" ? body.name : "";
						const force = body.force === true;
						const spec = readInstalled(config.profile, activeProfileDir)[name];
						if (spec === void 0) {
							sendJson(response, 400, { error: "plugin is not installed" });
							return;
						}
						if (spec.startsWith("link:") || spec.startsWith("file:")) {
							sendJson(response, 400, { error: "locally linked plugins update from their checkout" });
							return;
						}
						const busyAgents = runningAgentsForGuard();
						if (busyAgents.length > 0) {
							logEvent("warn", "update-blocked", `${name}: refused while agents are running — ${busyAgents.join(", ")}`);
							sendJson(response, 409, {
								error: `有 agent 正在运行（${busyAgents.join(", ")}）。更新会直接替换插件文件，正在工作的 agent 可能在执行中途读到缺失或新版本的文件而报错；请等它完成或取消后再更新。 / ${busyAgents.length === 1 ? "An agent is running" : "Agents are running"} (${busyAgents.join(", ")}). Updating replaces plugin files in place, so a working agent can fail or mix versions mid-turn; wait for it to finish (or cancel it) before updating.`,
								agentsBusy: true,
								runningAgents: busyAgents
							});
							return;
						}
						const beforeInstalled = readInstalled(config.profile, activeProfileDir);
						const isGit = spec.startsWith("github:");
						const selfChannel = SELF_NAMES.has(name) ? activeChannel() : null;
						const tag = selfChannel === null ? "latest" : DIST_TAG[selfChannel];
						const target = isGit ? spec.replace(/#.*$/, "") : `${name}@${tag}`;
						if (!isGit) {
							const installedVersion = readInstalledVersion(config.profile, name, activeProfileDir);
							const registryLatest = selfChannel === null ? await fetchNpmLatest(name) : await versionOnChannel(name, selfChannel, await fetchNpmLatest(name));
							if (selfChannel === null ? installedVersion !== null && registryLatest !== null && !isUpgrade(installedVersion, registryLatest) : installedVersion !== null && registryLatest !== null && installedVersion === registryLatest) {
								logEvent("info", "update", `${name} refused: latest=${registryLatest} is not newer than installed=${installedVersion}`);
								sendJson(response, 400, { error: `已是最新：registry 的 latest 是 ${registryLatest}，不高于已装的 ${installedVersion}，更新会造成降级。 / Already current: the registry's latest (${registryLatest}) is not newer than the installed ${installedVersion}, so updating would downgrade it.` });
								return;
							}
						}
						const repoKey = isGit ? spec.slice(7).replace(/#.*$/, "").toLowerCase() : null;
						const wasLive = verifyActivation(config.profile, name, liveNames(), activeProfileDir, disabled.has(name)).state === "live" && hasHostHalf(config.profile, name, activeProfileDir);
						const beforeVersion = readInstalledVersion(config.profile, name, activeProfileDir);
						const beforeCommit = repoKey !== null ? readLockCommits(config.profile, activeProfileDir).get(repoKey) ?? null : null;
						const addArgs = force ? [
							"add",
							RELEASE_AGE_OVERRIDE,
							target
						] : ["add", target];
						pendingRollbacks.clear();
						const compatibilityBefore = assessProfile(config.profile, activeProfileDir);
						const manifestBefore = readManifestDeps(config.profile, activeProfileDir);
						const result = await runPlugin(config.profile, addArgs);
						const cancelled = result.cancelled;
						if ((result.exitCode !== 0 || result.timedOut) && !cancelled) {
							const rolledBack = restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
							if (rolledBack.length > 0) logEvent("warn", "update", `${name}: rolled back manifest residue of the failed run: ${rolledBack.join(", ")}`);
						}
						let ok = result.exitCode === 0 && !result.timedOut && !cancelled;
						let stale = false;
						let activation;
						if (ok) {
							stale = isStaleUpdate({
								isGit,
								beforeVersion,
								afterVersion: readInstalledVersion(config.profile, name, activeProfileDir),
								beforeCommit,
								afterCommit: repoKey !== null ? readLockCommits(config.profile, activeProfileDir).get(repoKey) ?? null : null
							});
							if (stale) ok = false;
						}
						let brokenEntry = false;
						let rollbackOk = true;
						let rollbackDetail = null;
						if (ok && !hasLoadableEntry(activeProfileDir, name)) {
							brokenEntry = true;
							ok = false;
							const rollback = await rollbackUpdateBuild(name, manifestBefore);
							rollbackOk = rollback.ok;
							rollbackDetail = rollback.detail;
							logEvent("error", "update", `${name}: updated build has no loadable entry — ${rollback.ok ? "previous build restored" : `could not restore previous files: ${rollback.detail ?? "unknown"}`}`);
						}
						let trialError = null;
						if (ok) {
							const trial = trialValidate(activeProfileDir, readBundleStack(activeProfileDir).community);
							if (!trial.ok) {
								ok = false;
								const first = trial.errors[0]?.message ?? "the composition would not boot";
								const rollback = await rollbackUpdateBuild(name, manifestBefore);
								rollbackOk = rollback.ok;
								rollbackDetail = rollback.detail;
								trialError = rollback.ok ? `${name} 更新后的组合无法启动（${first}），已自动回滚并恢复原版本文件。 / ${name} updated to a composition that cannot boot (${first}); the previous build was restored.` : `${name} 更新后的组合无法启动（${first}），回滚未能恢复原版本文件（${rollback.detail ?? "unknown"}）；请运行 dsh plugin --profile ${config.profile} install 手工恢复。 / ${name} updated to a composition that cannot boot (${first}); the previous files could not be restored (${rollback.detail ?? "unknown"}) — run 'dsh plugin --profile ${config.profile} install' to recover manually.`;
								logEvent("error", "update", `${name}: trial validation failed — ${first}${rollback.ok ? "; previous build restored" : `; could not restore previous files: ${rollback.detail ?? "unknown"}`}`);
							}
						}
						let compatibility;
						if (ok) {
							invalidateUpdates();
							activation = { [name]: activationAfterReplace(verifyActivation(config.profile, name, liveNames(), activeProfileDir, disabled.has(name)), wasLive) };
							const after = assessProfile(config.profile, activeProfileDir);
							const risks = introducedRisks(compatibilityBefore, after);
							const shadowed = introducedDuplicateNames(compatibilityBefore, after);
							const bundleCheck = checkClientBundle(config.profile, name, activeProfileDir);
							const brokenBundles = bundleCheck.ok ? [] : [{
								name,
								reason: bundleCheck.reason ?? "parse failed"
							}];
							if (risks.length > 0 || shadowed.length > 0 || brokenBundles.length > 0) {
								compatibility = {
									code: "soft-incompatible",
									risks,
									shadowedNames: shadowed.length > 0 ? shadowed : void 0,
									brokenBundles: brokenBundles.length > 0 ? brokenBundles : void 0,
									rollbackId: savePendingRollback({
										kind: "update",
										names: [name],
										manifestBefore,
										...isGit ? {
											gitTarget: target,
											beforeCommit
										} : {}
									})
								};
								if (brokenBundles.length > 0) logEvent("error", "update-bundle", `${brokenBundles.map((entry) => `${entry.name}: ${entry.reason}`).join("; ")}`);
								if (risks.length > 0) logEvent("warn", "update-compat", `${name}: introduced host-compatibility risks — ${risks.map((risk) => `${risk.peer}@${risk.range} vs ${risk.resolved}`).join("; ")}`);
								if (shadowed.length > 0) logEvent("warn", "update-shadow", `${name}: introduced cross-layer duplicate loader names — ${shadowed.map((entry) => `${entry.name} (${entry.layers.join(" + ")})`).join("; ")}`);
							}
						}
						const youngRelease = stale && !isGit ? await latestPublishedRecently(name) : false;
						const staleReason = stale ? youngRelease === true ? "release-age" : "unknown" : null;
						const staleError = !stale ? null : staleReason === "release-age" ? "这个新版本刚发布不久。为了安全，系统默认会等它发布满一天后再安装——刚发布的版本偶尔会被发现问题然后撤回。可以明天再试，或点「立即更新」不再等待。 / This version was just released; for safety, installs normally wait about a day after a release. Try again tomorrow, or click \"Update now\" to install it right away." : "更新命令执行完成，但版本没有变化，原因未能确认。点「立即更新」重试通常能解决；若仍不行，请导出日志反馈。 / The update command completed but the version did not change; the cause could not be confirmed. Clicking \"Update now\" to retry usually resolves it — if not, export the log and report it.";
						const brokenEntryError = !brokenEntry ? null : `${name} 更新后缺少入口文件（package.json 的 main/exports 指向的文件不存在），已自动回滚并重新安装原版本文件，下次启动不受影响。这通常是镜像源在新版本刚发布时同步不完整；若仍需这个版本，请先卸载再从官方源重装。 / ${name} arrived without the entry file its package.json points at; the previous build was restored, so the next boot is unaffected. A registry mirror serving an incomplete tarball for a just-published version is the usual cause — remove the package and reinstall from the official registry if you still want this version.${rollbackOk ? "" : ` Rollback could not restore the previous files: ${rollbackDetail ?? ""}`}`;
						const cancelDiff = cancelled ? changedSince(beforeInstalled) : null;
						const ignoredBuilds = ok || cancelled ? void 0 : blockedBuilds(result);
						logEvent(ok || cancelled ? "info" : "error", "update", `${name} -> ${target} exit=${String(result.exitCode)}${result.timedOut ? " TIMEOUT" : ""}${cancelled ? " CANCELLED" : ""}${stale ? ` STALE(${staleReason ?? "unknown"})` : ""}${ok || cancelled ? "" : ` err=${failureDetail(result)}`}`);
						sendJson(response, ok || cancelled ? 200 : result.busy === true ? 409 : 502, {
							ok,
							cancelled: cancelled || void 0,
							busy: result.busy || void 0,
							stale: stale || void 0,
							partial: cancelDiff?.partial,
							changed: cancelDiff?.changed,
							activation,
							compatibility,
							ignoredBuilds,
							staleReason: staleReason ?? void 0,
							error: trialError ?? brokenEntryError ?? staleError ?? void 0,
							exitCode: result.exitCode,
							timedOut: result.timedOut,
							stdout: result.stdout,
							stderr: result.stderr,
							installed: readInstalled(config.profile, activeProfileDir)
						});
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					host.logger?.warn(`[dsh-market] update failed: ${message}`);
					logEvent("error", "update", `route error: ${message}`);
					sendJson(response, 500, { error: message });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/setup-pnpm",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					const result = await commands.provisionPnpm();
					sendJson(response, 200, {
						ok: result.ok,
						error: result.hint
					});
				} catch (error) {
					sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/channel",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					const wanted = asChannel((await readJsonBody(request)).channel);
					if (wanted === null) {
						sendJson(response, 400, { error: "channel must be \"stable\", \"beta\" or \"dev\"" });
						return;
					}
					config.channel = wanted;
					marketState.channel = wanted;
					writeMarketState(activeProfileDir, marketState);
					invalidateUpdates();
					logEvent("info", "channel", `release channel set to ${wanted}`);
					sendJson(response, 200, {
						ok: true,
						channel: wanted
					});
				} catch (error) {
					sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/self-uninstall",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!trustedRestartRequest(request)) {
					sendJson(response, 403, { error: "self-uninstall is limited to same-origin loopback requests" });
					return;
				}
				try {
					await withMutationLock(response, "install", async () => {
						const body = await readJsonBody(request);
						if (body.confirm !== true) {
							sendJson(response, 400, { error: "self-uninstall requires an explicit confirmation" });
							return;
						}
						const installed = readInstalled(config.profile, activeProfileDir);
						const selfName = ["dshmarket", "dsh-market"].find((candidate) => installed[candidate] !== void 0);
						if (selfName === void 0) {
							sendJson(response, 400, { error: "the market is not an installed dependency of this profile" });
							return;
						}
						const result = await runPlugin(config.profile, ["remove", selfName]);
						if (!(result.exitCode === 0 && !result.timedOut && !result.cancelled)) {
							const said = (result.stderr.trim() || result.stdout.trim()).slice(-800);
							sendJson(response, 502, {
								ok: false,
								error: said === "" ? "removing the market failed" : said,
								timedOut: result.timedOut,
								cancelled: result.cancelled
							});
							return;
						}
						const purge = body.purge === true;
						const restored = [];
						if (purge) {
							for (const name of disabled) {
								const ids = rowIdsForPackage(host, activeProfileDir, name);
								if (ids.length > 0) {
									removeRowBlocks(userPatchPath, ids);
									restored.push(name);
								}
							}
							purgeMarketState(activeProfileDir);
						}
						logEvent("info", "self-uninstall", `removed ${selfName}${purge ? `; purged state, restored ${String(restored.length)} disabled plugin(s)` : "; state kept"}`);
						sendJson(response, 200, {
							ok: true,
							removed: selfName,
							purged: purge,
							restored,
							restart: restartAllowed(config)
						});
						setTimeout(() => {
							themes.setEntryDisabled(selfName, true).catch(() => {});
						}, 0);
					});
				} catch (error) {
					sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/restart",
			handler: (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!restartAllowed(config)) {
					sendJson(response, 403, { error: "self-restart is disabled for this host" });
					return;
				}
				if (!trustedRestartRequest(request)) {
					sendJson(response, 403, { error: "restart is limited to same-origin loopback requests" });
					return;
				}
				if (writing || installing) {
					sendJson(response, 409, { error: "cannot restart while a plugin operation is running" });
					return;
				}
				if (restarting) {
					sendJson(response, 409, { error: "restart already scheduled" });
					return;
				}
				restarting = true;
				try {
					const result = scheduleRestart(servingPort(request));
					logEvent("info", "restart", `scheduled pid=${String(result.pid)} helper=${String(result.helperPid)}`);
					sendJson(response, 202, {
						ok: true,
						boot: BOOT_ID,
						...result
					});
				} catch (error) {
					restarting = false;
					const message = error instanceof Error ? error.message : String(error);
					logEvent("error", "restart", message);
					sendJson(response, 500, { error: message });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/approve-builds",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					const stripVersion = (name) => {
						const at = name.lastIndexOf("@");
						return at > 0 ? name.slice(0, at) : name;
					};
					const PKG_RE = /^(@[A-Za-z0-9-~][A-Za-z0-9._~-]*\/)?[A-Za-z0-9-~][A-Za-z0-9._~-]*$/;
					const body = await readJsonBody(request);
					const requested = (Array.isArray(body.packages) ? body.packages.map(String).map(stripVersion) : []).filter((name) => PKG_RE.test(name));
					const installed = requested.filter((name) => existsSync(join(activeProfileDir, "node_modules", name, "package.json")));
					const specs = readInstalled(config.profile, activeProfileDir);
					const packages = [];
					for (const name of requested) {
						if (installed.includes(name)) {
							packages.push(name);
							const key = gitAllowBuildsKey(name, String(specs[name] ?? ""));
							if (key !== null) packages.push(key);
							continue;
						}
						if (specs[name] !== void 0) continue;
						let entry;
						try {
							entry = (await loadRegistry()).plugins.find((p) => p.name === name || p.npm === name);
						} catch (error) {
							logEvent("warn", "approve-builds", `catalog unavailable, authorizing ${name} by name only: ${error instanceof Error ? error.message : String(error)}`);
							packages.push(name);
							continue;
						}
						const target = entry === void 0 ? null : installTargetFor(entry);
						const key = target === null ? null : gitAllowBuildsKey(name, target);
						if (key !== null) packages.push(name, key);
					}
					if (packages.length === 0) {
						sendJson(response, 400, { error: "no installed packages given" });
						return;
					}
					const approved = setAllowBuilds(config.profile, packages, activeProfileDir);
					logEvent("info", "approve-builds", `allowed build scripts: ${approved.join(", ")}`);
					sendJson(response, 200, {
						ok: true,
						approved
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logEvent("error", "approve-builds", `route error: ${message}`);
					sendJson(response, 500, { error: message });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/cancel",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				if (!commands.cancelActive()) {
					sendJson(response, 400, { error: "no operation is running" });
					return;
				}
				logEvent("info", "cancel", `cancelled ${progress.target || "operation"}`);
				sendJson(response, 200, {
					ok: true,
					cancelled: true,
					target: progress.target
				});
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/uninstall",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					await withMutationLock(response, "install", async () => {
						const body = await readJsonBody(request);
						const name = typeof body.name === "string" ? body.name : "";
						if (name === "dsh-market" || name === "dshmarket") {
							sendJson(response, 400, { error: "the market cannot uninstall itself; use the dsh CLI" });
							return;
						}
						if (readInstalled(config.profile, activeProfileDir)[name] === void 0) {
							sendJson(response, 400, { error: "plugin is not installed" });
							return;
						}
						const busyAgents = runningAgentsForGuard();
						if (busyAgents.length > 0) {
							logEvent("warn", "uninstall-blocked", `${name}: refused while agents are running — ${busyAgents.join(", ")}`);
							sendJson(response, 409, {
								error: `有 agent 正在运行（${busyAgents.join(", ")}）。卸载会修改插件文件，正在工作的 agent 可能在中途报错；请等它完成或取消后再卸载。 / ${busyAgents.length === 1 ? "An agent is running" : "Agents are running"} (${busyAgents.join(", ")}). Uninstalling changes plugin files, so a working agent can fail mid-turn; wait for it to finish (or cancel it) before uninstalling.`,
								agentsBusy: true,
								runningAgents: busyAgents
							});
							return;
						}
						pendingRollbacks.clear();
						const beforeInstalled = readInstalled(config.profile, activeProfileDir);
						const activation = { [name]: verifyActivation(config.profile, name, liveNames(), activeProfileDir, disabled.has(name)) };
						const result = await runPlugin(config.profile, ["remove", name]);
						const cancelled = result.cancelled;
						const ok = result.exitCode === 0 && !result.timedOut && !cancelled;
						const cancelDiff = cancelled ? changedSince(beforeInstalled) : null;
						let hot = false;
						if (ok) {
							invalidateUpdates();
							hot = await hotUnmount(name);
							const entryDisabled = await themes.setEntryDisabled(name, true);
							hot = hot || entryDisabled;
							removeRowBlocks(userPatchPath, rowIdsForPackage(host, activeProfileDir, name));
							disabled.delete(name);
							removeFromGroups({
								groups,
								groupOrder
							}, name);
							writeMarketState(activeProfileDir, {
								disabled,
								groups,
								groupOrder
							});
						}
						logEvent(ok || cancelled ? "info" : "error", "uninstall", `${name} exit=${String(result.exitCode)}${cancelled ? " CANCELLED" : ""}${ok ? ` live-removed=${String(hot)}` : cancelled ? "" : ` err=${failureDetail(result)}`}`);
						sendJson(response, ok || cancelled ? 200 : result.busy === true ? 409 : 502, {
							ok,
							cancelled: cancelled || void 0,
							busy: result.busy || void 0,
							hot,
							partial: cancelDiff?.partial,
							changed: cancelDiff?.changed,
							activation,
							exitCode: result.exitCode,
							stdout: result.stdout,
							stderr: result.stderr,
							installed: readInstalled(config.profile, activeProfileDir)
						});
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					host.logger?.warn(`[dsh-market] uninstall failed: ${message}`);
					logEvent("error", "uninstall", `route error: ${message}`);
					sendJson(response, 500, { error: message });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/rollback",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					await withMutationLock(response, "install", async () => {
						const body = await readJsonBody(request);
						const id = typeof body.rollbackId === "string" ? body.rollbackId : "";
						const pending = pendingRollbacks.get(id);
						if (pending === void 0) {
							sendJson(response, 400, { error: "rollback is not available (it may have been superseded by another operation) / 回滚已不可用（可能已被后续操作覆盖）" });
							return;
						}
						let ok = true;
						let hot = false;
						let detail = null;
						if (pending.kind === "update") {
							const name = pending.names[0];
							const result = pending.gitTarget !== void 0 ? await rollbackGitBuild(name, pending.manifestBefore, pending.gitTarget, pending.beforeCommit ?? null) : await rollbackUpdateBuild(name, pending.manifestBefore);
							ok = result.ok;
							detail = result.detail;
						} else for (const name of pending.names) {
							const result = await removeInstalledPackage(name);
							hot ||= result.hot;
							if (!result.ok) {
								ok = false;
								detail = result.detail;
								break;
							}
						}
						if (ok) {
							pendingRollbacks.delete(id);
							invalidateUpdates();
							logEvent("info", "rollback", `${pending.kind}: ${pending.names.join(", ")} restored`);
						} else logEvent("error", "rollback", `${pending.kind}: ${pending.names.join(", ")} failed — ${detail ?? "unknown"}`);
						sendJson(response, ok ? 200 : 502, {
							ok,
							rolledBack: ok,
							hot,
							detail: detail ?? void 0,
							installed: readInstalled(config.profile, activeProfileDir)
						});
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					host.logger?.warn(`[dsh-market] rollback failed: ${message}`);
					logEvent("error", "rollback", `route error: ${message}`);
					sendJson(response, 500, { error: message });
				}
			}
		}),
		host.webServer.register({
			kind: "exact",
			path: "/dsh-market/install",
			handler: async (request, response) => {
				if (request.method !== "POST") {
					response.writeHead(405, { allow: "POST" });
					response.end();
					return;
				}
				if (!sameOrigin(request)) {
					sendJson(response, 403, { error: "untrusted origin" });
					return;
				}
				try {
					await withMutationLock(response, "install", async () => {
						const body = await readJsonBody(request);
						const busyAgents = runningAgentsForGuard();
						if (busyAgents.length > 0) {
							logEvent("warn", "install-blocked", `refused while agents are running — ${busyAgents.join(", ")}`);
							sendJson(response, 409, {
								error: `有 agent 正在运行（${busyAgents.join(", ")}）。安装会修改插件文件，正在工作的 agent 可能在中途报错；请等它完成或取消后再安装。 / ${busyAgents.length === 1 ? "An agent is running" : "Agents are running"} (${busyAgents.join(", ")}). Installing changes plugin files, so a working agent can fail mid-turn; wait for it to finish (or cancel it) before installing.`,
								agentsBusy: true,
								runningAgents: busyAgents
							});
							return;
						}
						const url = typeof body.url === "string" ? body.url : "";
						const entry = (await loadRegistry()).plugins.find((p) => p.url.toLowerCase() === url.toLowerCase());
						if (entry === void 0) {
							logEvent("warn", "install-rejected", `not in curated registry: ${url.slice(0, 120)}`);
							sendJson(response, 400, { error: "plugin is not in the curated registry" });
							return;
						}
						const target = installTargetFor(entry);
						if (target === null) {
							sendJson(response, 400, { error: "unsupported source url" });
							return;
						}
						const installedNow = readInstalled(config.profile, activeProfileDir);
						const aliasOf = findInstalledAlias(entry, installedNow);
						let retryAlias = null;
						if (aliasOf !== null) {
							const sameSource = aliasOf.toLowerCase() === (entry.npm ?? "").toLowerCase() || String(installedNow[aliasOf] ?? "").replace(/^file:/, "").toLowerCase() === String(target).replace(/^file:/, "").toLowerCase();
							let active = false;
							try {
								active = (JSON.parse(readFileSync(join(activeProfileDir, "package.json"), "utf8")).dsh?.profile?.bundles ?? []).includes(aliasOf) || liveNames().has(aliasOf);
							} catch {
								active = true;
							}
							if (active || !sameSource) {
								logEvent("warn", "install-rejected", `${entry.name}: same plugin already installed as ${aliasOf}`);
								sendJson(response, 400, { error: `已以「${aliasOf}」安装过同一个插件，无需重复安装 / this plugin is already installed as "${aliasOf}"` });
								return;
							}
							retryAlias = aliasOf;
							logEvent("info", "install", `${entry.name}: ${aliasOf} present but inactive (leftover of a failed install) — retrying`);
						}
						if (aliasOf === null) {
							const clashName = [entry.npm, entry.name].find((n) => typeof n === "string" && n !== "" && installedNow[n] !== void 0);
							if (clashName !== void 0) {
								logEvent("warn", "install-rejected", `${entry.name}: name collision with installed ${clashName} (${installedNow[clashName]}) from a different source`);
								sendJson(response, 400, { error: `同名冲突：已安装的「${clashName}」来自其他来源，两个同名插件无法共存于一个 profile，请先卸载再安装 / name conflict: an installed plugin already uses the name "${clashName}" but comes from a different source; two plugins with the same name cannot coexist in one profile — uninstall it first` });
								return;
							}
						}
						const beforeSpecs = readInstalled(config.profile, activeProfileDir);
						const before = new Set(Object.keys(beforeSpecs));
						if (retryAlias !== null) before.delete(retryAlias);
						pendingRollbacks.clear();
						const compatibilityBefore = assessProfile(config.profile, activeProfileDir);
						const manifestBefore = readManifestDeps(config.profile, activeProfileDir);
						const result = await runPlugin(config.profile, ["add", target]);
						const cancelled = result.cancelled;
						if ((result.exitCode !== 0 || result.timedOut) && !cancelled) {
							const rolledBack = restoreManifestDeps(config.profile, manifestBefore, activeProfileDir);
							if (rolledBack.length > 0) logEvent("warn", "install", `${target}: rolled back manifest residue of the failed run: ${rolledBack.join(", ")}`);
						}
						let ok = result.exitCode === 0 && !result.timedOut && !cancelled;
						const cancelDiff = cancelled ? changedSince(beforeSpecs) : null;
						if (ok) invalidateUpdates();
						if (ok) ok = await retargetCollections(runPlugin, config.profile, before, target, activeProfileDir);
						let notAPlugin = false;
						let removedBroken = [];
						let conflicts = [];
						if (result.exitCode === 0 && !result.timedOut && !cancelled) {
							const validated = await validateAddedPlugins(runPlugin, config.profile, before, activeProfileDir);
							removedBroken = validated.removedBroken;
							conflicts = validated.conflicts;
							if (removedBroken.length > 0) logEvent("warn", "install", `${target}: removed uninstallable pieces (no dsh manifest or missing build artifacts): ${removedBroken.join(", ")}`);
							if (validated.keep.length === 0) {
								ok = false;
								notAPlugin = true;
								logEvent("error", "install", `${target}: nothing installable survived validation`);
							} else ok = true;
						}
						const conflictGroups = groupConflictsByOwner(conflicts);
						const installed = readInstalled(config.profile, activeProfileDir);
						let hot = false;
						let activation;
						let compatibility;
						let addedPackages = [];
						if (ok) {
							const added = Object.keys(installed).filter((name) => !before.has(name));
							addedPackages = added;
							if (added.length > 0) {
								for (const name of added) disabled.delete(name);
								writeMarketState(activeProfileDir, {
									disabled,
									groups,
									groupOrder
								});
								hot = true;
								for (const name of added) if (!(entry.category === "theme" ? await themes.activateTheme(name) : (await hotMount(host, activeProfileDir, name)).ok)) hot = false;
								activation = {};
								const live = liveNames();
								for (const name of added) activation[name] = verifyActivation(config.profile, name, live, activeProfileDir, disabled.has(name));
							}
						}
						if (ok && addedPackages.length > 0) {
							const after = assessProfile(config.profile, activeProfileDir);
							const risks = introducedRisks(compatibilityBefore, after);
							const shadowed = introducedDuplicateNames(compatibilityBefore, after);
							const brokenBundles = addedPackages.map((pkg) => ({
								name: pkg,
								check: checkClientBundle(config.profile, pkg, activeProfileDir)
							})).filter((entry) => !entry.check.ok).map((entry) => ({
								name: entry.name,
								reason: entry.check.reason ?? "parse failed"
							}));
							if (risks.length > 0 || shadowed.length > 0 || brokenBundles.length > 0) {
								compatibility = {
									code: "soft-incompatible",
									risks,
									shadowedNames: shadowed.length > 0 ? shadowed : void 0,
									brokenBundles: brokenBundles.length > 0 ? brokenBundles : void 0,
									rollbackId: savePendingRollback({
										kind: "install",
										names: addedPackages
									})
								};
								if (brokenBundles.length > 0) logEvent("error", "install-bundle", `${brokenBundles.map((entry) => `${entry.name}: ${entry.reason}`).join("; ")}`);
								if (risks.length > 0) logEvent("warn", "install-compat", `${addedPackages.join(", ")}: introduced host-compatibility risks — ${risks.map((risk) => `${risk.peer}@${risk.range} vs ${risk.resolved}`).join("; ")}`);
								if (shadowed.length > 0) logEvent("warn", "install-shadow", `${addedPackages.join(", ")}: introduced cross-layer duplicate loader names — ${shadowed.map((entry) => `${entry.name} (${entry.layers.join(" + ")})`).join("; ")}`);
							}
						}
						logEvent(ok || cancelled ? "info" : "error", "install", `${target} exit=${String(result.exitCode)}${result.timedOut ? " TIMEOUT" : ""}${cancelled ? " CANCELLED" : ""}${ok ? ` hot=${String(hot)}` : cancelled ? "" : ` err=${failureDetail(result)}`}`);
						const ignoredBuilds = blockedBuilds(result);
						sendJson(response, ok || cancelled ? 200 : result.busy === true ? 409 : 502, {
							ok,
							cancelled: cancelled || void 0,
							busy: result.busy || void 0,
							hot,
							partial: cancelDiff?.partial,
							changed: cancelDiff?.changed,
							activation,
							compatibility,
							ignoredBuilds,
							conflictGroups: conflictGroups.length > 0 ? conflictGroups : void 0,
							error: conflictGroups.length > 0 ? `「${conflicts[0].name}」与已安装的 ${conflictGroups.map((group) => `「${group.owner}」（${group.ids.join("、")}）`).join("、")} 占用相同的 loader 条目 id，无法在同一环境中共存——保留会导致 DeepSeek Harness 下次启动失败，因此已自动移除。 / "${conflicts[0].name}" declares the same loader entry id(s) as the installed ${conflictGroups.map((group) => `"${group.owner}" (${group.ids.join(", ")})`).join(", ")}; they cannot coexist in one environment — keeping it would stop DeepSeek Harness from starting, so it was removed.` : notAPlugin ? "nothing installable: the plugin(s) need a build step (blocked by default, see allowBuilds) or ship no prebuilt artifacts / 没有可安装的内容：插件需要构建授权（allowBuilds，默认拦截）或未附带构建产物，详见导出日志" : Array.isArray(ignoredBuilds) && ignoredBuilds.length > 0 ? `构建脚本被 pnpm 默认拦截（${ignoredBuilds.join(", ")}），请点击上方按钮放行后重试 / build scripts are blocked by pnpm by default (${ignoredBuilds.join(", ")}); click "Allow build scripts and retry" above` : void 0,
							exitCode: result.exitCode,
							timedOut: result.timedOut,
							stdout: result.stdout,
							stderr: result.stderr,
							installed
						});
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					host.logger?.warn(`[dsh-market] install failed: ${message}`);
					logEvent("error", "install", `route error: ${message}`);
					sendJson(response, 500, { error: message });
				}
			}
		})
	];
	return () => {
		for (const dispose of disposers) dispose();
	};
}
//#endregion
//#region ../../../vendor/cosmokit/src/misc.ts
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
//#endregion
//#region ../../../vendor/cosmokit/src/types.ts
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
let Binary;
(function(_Binary) {
	_Binary.is = isArrayBufferLike;
	_Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	_Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	_Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	_Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	_Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	_Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
//#endregion
//#region ../../../vendor/cosmokit/src/time.ts
let Time;
(function(_Time) {
	_Time.millisecond = 1;
	const second = _Time.second = 1e3;
	const minute = _Time.minute = second * 60;
	const hour = _Time.hour = minute * 60;
	const day = _Time.day = hour * 24;
	const week = _Time.week = day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	_Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	_Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / minute - offset) / 1440);
	}
	_Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * minute);
	}
	_Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * week || 0) + (parseFloat(capture[2]) * day || 0) + (parseFloat(capture[3]) * hour || 0) + (parseFloat(capture[4]) * minute || 0) + (parseFloat(capture[5]) * second || 0);
	}
	_Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	_Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= day - hour / 2) return Math.round(ms / day) + "d";
		else if (abs >= hour - minute / 2) return Math.round(ms / hour) + "h";
		else if (abs >= minute - second / 2) return Math.round(ms / minute) + "m";
		else if (abs >= second) return Math.round(ms / second) + "s";
		return ms + "ms";
	}
	_Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	_Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	_Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../../vendor/schemastery/src/index.ts
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region lib/types/settings.js
/**
* The market's own settings namespace: the half that makes `allowRestart`
* a switch on the plugin configuration page instead of a line the user has
* to hand-write into cordis.yml.
*
* `allowRestart: false` is the documented answer for a host owned by
* systemd, launchd or pm2 — a supervisor restarts it, so the market's
* one-click restart must not launch a second one. Until now the only way to
* say that was editing YAML in the right place with the right indentation,
* where a stray space stops the profile booting.
*
* Only `allowRestart` is exposed. `profile` names which profile this
* instance manages: it is decided at mount from the composition or the
* command line, and a running instance cannot switch to another one, so
* offering it as a field would promise something the write cannot deliver.
*
* The release channel is NOT here either, and that is a correction rather
* than an omission. It was, briefly, and it made this namespace a second
* writer for a value the market already stores in its own state.json: the
* mount read the user's saved channel off disk, then `onChange` assigned
* `source().channel` — which knows nothing about that file — straight back
* over it. The choice survived exactly until the next settings event.
*
* Only a real host could show that; the unit lane mounts the routes without
* this layer at all. `allowRestart` needs this door because its only other
* one is hand-edited YAML. The channel has a control of its own on the
* plugin configuration page, so a second door bought nothing and cost the
* setting its memory.
*
* installSettingsSection rides the scoped fiber, so a host with no settings
* service — every dsh before 0.1.0-rc.7 — simply never runs any of this and
* the entry configuration stands as composed. That is why this needs no
* version check of its own.
*/
/** Namespace the card on the browser side keys itself to. */
const MARKET_SETTINGS_NS = settingsNamespace("dsh-market");
const MarketSettings = Schema.object({ allowRestart: Schema.boolean().default(true) });
/**
* Wire the namespace so a saved change reaches the routes immediately.
*
* The routes read `allowRestart` off this object on every request (the
* status route reports the capability, the restart route enforces it), so
* updating it in place is what makes a toggle take effect without a
* restart — which would be a poor thing to require of a setting whose whole
* subject is restarting.
*
* @param ctx - the plugin context owning the wiring.
* @param resolved - the live config object the routes read.
*/
function installMarketSettings(ctx, resolved) {
	const entry = { allowRestart: restartAllowed(resolved) };
	let source = () => entry;
	installSettingsSection(ctx, MARKET_SETTINGS_NS, MarketSettings, entry, {
		setSource: (current) => {
			source = current;
		},
		onChange: () => {
			resolved.allowRestart = source().allowRestart;
		}
	});
}
//#endregion
//#region lib/types/index.js
/**
* dsh-market host entry: mounts the market's HTTP routes once the profile
* composes the webServer and shell services.
*/
const name = "dsh-market";
/**
* Register the market against the host context.
* @param ctx - Host context that may acquire webServer and shell services.
* @param config - Optional profile override from the loader.
*/
/**
* The profile this host process actually booted (`--profile <name>` on the
* dsh CLI invocation). Without it the market would default to `web` and
* installs from a test/secondary profile would mutate the real one.
*/
function argvProfile() {
	const argv = process.argv;
	const flag = argv.indexOf("--profile");
	if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith("-")) return argv[flag + 1];
}
/**
* Resolve the host's `agents` inventory lazily — at request time, not at
* market startup, so the guard sees whichever agents exist by the time an
* update is asked for. Hosts without the service return undefined and the
* update route stays open (see src/agents.ts).
*/
function agentsLookupOf(ctx) {
	return () => ctx.get("agents");
}
function apply(ctx, config) {
	ctx.inject(["webServer", "loader"], (hostCtx) => {
		const host = hostCtx;
		const desktopProfiles = ctx.get("desktopProfiles");
		if (desktopProfiles === void 0) {
			const resolved = {
				profile: config?.profile ?? argvProfile() ?? "web",
				allowRestart: config?.allowRestart
			};
			installMarketSettings(ctx, resolved);
			host.effect(() => mountMarketRoutes(host, resolved, void 0, agentsLookupOf(ctx)), "dsh-market: http routes");
			return;
		}
		hostCtx.inject(["desktopPnpm"], (desktopCtx) => {
			const current = desktopProfiles.current;
			const service = desktopCtx.desktopPnpm;
			const runtime = createDesktopPluginRuntime(service, current.dir);
			const resolved = {
				profile: current.name,
				profileDirectory: current.dir,
				allowRestart: false
			};
			desktopCtx.effect(() => {
				const disposeRoutes = mountMarketRoutes(host, resolved, runtime, agentsLookupOf(ctx));
				return async () => {
					disposeRoutes();
					await runtime.dispose();
				};
			}, "dsh-market: Desktop http routes and package operations");
		});
	});
}
//#endregion
export { apply, name };
