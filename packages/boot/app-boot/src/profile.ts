/**
 * Profile discovery, initialization, and patch-layer composition for the
 * `dsh --profile` launcher family.
 *
 * A profile is a directory under `$DSH_HOME/profiles/<name>` holding a
 * `package.json` (out-of-tree plugin dependencies plus the profile manifest
 * `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml`
 * (the user's own patch layer, applied after every bundle layer). Bundles are
 * npm packages whose manifest declares
 * `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; the tree is
 * composed by applying each bundle's patch list in `dsh.profile.bundles` order over
 * an empty entry list, then the profile's own patches, then any launcher
 * layers (`--patch` files and flag-derived patches).
 *
 * Module resolution is two-anchor by construction: a bundle name resolves
 * first from the dsh installation (the launcher's own package), then from the
 * profile directory. The Loader's `baseUrl` is the profile directory, whose
 * `node_modules` pnpm manages for out-of-tree plugins, while the maintained
 * flat fallback directory `$DSH_HOME/profiles/node_modules` (one symlink per
 * package the installation's app and bundles depend on) makes every in-box
 * plugin Node-resolvable from any profile through the ordinary parent-walk.
 * @module @deepseek-ai/dsh-app-boot/profile
 */

import { createRequire } from 'node:module'
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { loadOverlayPatches } from './index.ts'

/** Directory under the Harness home holding every profile. */
export const PROFILES_DIR = 'profiles'

/** The user patch layer inside a profile directory (hot-reloaded on long-lived surfaces). */
export const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** The bundle half of the `dsh` manifest section: what a bundle package exports. */
export interface DshBundleManifest {
  /** The patch layer this bundle exports, relative to its package root. */
  patch: string
}

/** The profile half of the `dsh` manifest section: what a profile directory composes. */
export interface DshProfileManifest {
  /** Ordered bundle layer list (package names). */
  bundles?: string[]
}

/**
 * The profile-launcher slice of the `dsh`-owned package.json section. A
 * manifest may declare both roles; other consumers own additional keys.
 */
export interface DshManifestSection {
  /** Bundle metadata consumed by the profile launcher. */
  bundle?: DshBundleManifest
  /** Profile metadata consumed by the profile launcher. */
  profile?: DshProfileManifest
}

/** The slice of package.json both profiles and bundles use. */
export interface ProfileManifest {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: DshManifestSection
}

/** One resolved bundle layer of a profile. */
export interface ProfileLayer {
  /** The bundle's package name, as listed in `dsh.profile.bundles`. */
  packageName: string
  /** Absolute directory of the resolved bundle package. */
  packageDir: string
  /** Absolute path of the bundle's patch file. */
  patchPath: string
  /** The parsed patch list. */
  patches: PatchOptions[]
}

/** A loaded profile: resolved bundle layers plus the user's own patch layer. */
export interface Profile {
  /** The profile name (its directory basename). */
  name: string
  /** Absolute profile directory. */
  dir: string
  /** Bundle layers in `dsh.profile.bundles` order. */
  layers: ProfileLayer[]
  /** Absolute path of the profile's own patch file. */
  patchPath: string
  /** The profile's own patches; empty when the file is absent. */
  patches: PatchOptions[]
}

/**
 * Resolve a profile's directory under the Harness home.
 * @param name - the profile name (`dsh --profile <name>`).
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 * @returns the absolute profile directory (which may not exist yet).
 */
export function resolveProfileDir(name: string, home: string = resolveDshHome()): string {
  if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..'
    // The launcher-maintained flat module fallback lives at this sibling path.
    || name === 'node_modules') {
    throw new Error(`dsh: invalid profile name ${JSON.stringify(name)}`)
  }
  return join(home, PROFILES_DIR, name)
}

/** The shipped profile templates auto-initialized on first use, by name. */
export const PROFILE_TEMPLATES: Record<string, readonly string[]> = {
  web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-theme-firefly', '@magiczerowxy/dsh-modef'],
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
}

/**
 * Shipped default dependencies seeded into a freshly-initialized profile's
 * manifest (in addition to the in-box bundles above). In-box bundles are
 * provided by the installation and are not dependencies; a shipped plugin that
 * should also appear as an installed community plugin in the plugin market is
 * declared here so the profile manifest lists it in `dependencies`.
 */
export const PROFILE_TEMPLATE_DEPENDENCIES: Record<string, Record<string, string>> = {
  web: { 'dsh-theme-firefly': '^0.1.1', '@magiczerowxy/dsh-modef': '^0.1.0' },
}

/** Installation-owned bundle tuples normalized to the shipped template. */
const INSTALLATION_OWNED_PROFILE_TUPLES: Record<string, readonly string[]> = {
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless'],
}

/** The bundle list a `dsh plugin` init uses for a name with no shipped template. */
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-base']

const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

// The hoisted linker gives out-of-tree plugins a flat node_modules whose
// missing peers (cordis and friends) fall through to the healed
// profiles/node_modules installation fallback, so every plugin shares the
// installation's single cordis instance instead of a duplicate. pnpm ≥10
// reads its settings from pnpm-workspace.yaml, not .npmrc.
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/**
 * Initialize a profile directory: manifest, empty user patch layer, and the
 * pnpm settings out-of-tree plugins need. Existing files are never touched,
 * so re-running is a no-op on an initialized profile.
 * @param dir - the profile directory from {@link resolveProfileDir}.
 * @param bundles - the initial `dsh.profile.bundles` layer list.
 * @param defaultDependencies - optional shipped dependencies seeded into the
 * profile manifest (e.g. a default plugin the market should show installed).
 */
export function initProfile(dir: string, bundles: readonly string[], defaultDependencies?: Record<string, string>): void {
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    const manifest: ProfileManifest & { private: boolean } = {
      name: `dsh-profile-${basename(dir)}`,
      private: true,
      dependencies: { ...defaultDependencies },
      dsh: { profile: { bundles: [...bundles] } },
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  }
  const patchPath = join(dir, PROFILE_PATCH_FILENAME)
  if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
}

/** Retry delay between stale-fallback-link unlink attempts, in milliseconds. */
const FALLBACK_UNLINK_RETRY_DELAY_MS = 200
/** Retry budget for one stale-fallback-link unlink (plus the first attempt). */
const FALLBACK_UNLINK_RETRIES = 5

/** Block the current thread for `ms` milliseconds (this module is fully synchronous). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Replace one stale fallback link. On Windows a live process holding the
 * reparse point (or a file under its target) makes unlink fail with EPERM or
 * EBUSY until the holder releases it — typically a previously launched app
 * instance still walking this fallback. Retry briefly so a transient holder
 * (startup race, antivirus scan) self-heals; a persistent holder fails loud
 * with the link, the wanted target, and the remedy instead of a bare EPERM
 * that aborts the whole boot.
 * @param link - the stale fallback link path.
 * @param target - the link's desired target, for the failure message.
 */
function unlinkWithRetry(link: string, target: string): void {
  let lastError: unknown
  for (let attempt = 0; attempt <= FALLBACK_UNLINK_RETRIES; attempt++) {
    try {
      unlinkSync(link)
      return
    } catch (error) {
      // A concurrent launcher already removed the link — success.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if ((code === 'EPERM' || code === 'EBUSY') && attempt < FALLBACK_UNLINK_RETRIES) {
        sleepSync(FALLBACK_UNLINK_RETRY_DELAY_MS)
        continue
      }
      break
    }
  }
  throw new Error(
    `dsh: cannot replace stale fallback link ${link} (wanted target ${target}): ${String(lastError)}; `
    + 'close other DeepSeek Harness instances and retry',
  )
}

/** Ensure `link` is a symlink to `target`, replacing a wrong or dangling link; a real directory throws. */
function ensureSymlink(link: string, target: string): void {
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    // Missing link (first run) — created below. Any other lstat failure on a
    // path we just created the parent of would resurface on symlinkSync.
    stat = undefined
  }
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) {
      throw new Error(`dsh: ${link} exists and is not a symlink; remove it so dsh can manage the installation fallback`)
    }
    if (readlinkSync(link) === target) return
    // unlink deletes the reparse point itself on Windows too; rmSync treats a
    // junction as a directory and throws EISDIR unless recursive. A live
    // holder (another app instance walking the fallback) fails the unlink with
    // EPERM/EBUSY until it releases — unlinkWithRetry absorbs that transient.
    unlinkWithRetry(link, target)
  }
  try {
    symlinkSync(target, link, 'junction')
  } catch (error) {
    // Concurrent launches heal the same fallback; losing the race to a
    // process writing the identical link is success, anything else is not.
    // The window between the lstat miss above and this write cannot be
    // staged deterministically from the public API.
    /* v8 ignore next 4 */
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
      || !lstatSync(link).isSymbolicLink() || readlinkSync(link) !== target) {
      throw error
    }
  }
}

/**
 * Maintain the flat module fallback `$DSH_HOME/profiles/node_modules`: one
 * symlink per package in the dsh app's resolvable dependency CLOSURE (BFS
 * over `dependencies` from the app manifest), each resolved from its own
 * real location. Node's parent-directory walk from any profile finds this
 * directory after the profile's own `node_modules`, so every in-box plugin
 * resolves without pnpm ever managing it — the exact "bundles come from the
 * installation" contract. The closure (not just direct dependencies) is
 * required for out-of-tree plugins: their peer dependencies name Service
 * Definition packages (`dsh-compaction`, `dsh-invariants`, ...) that the app
 * reaches only through its Service Provider packages. Symlinked packages
 * resolve their own dependencies from their real directories (Node's default
 * symlink-following), so each package needs only its one flat link.
 * Idempotent: correct links are kept and moved installations are
 * re-pointed; a stale link to a vanished package stays until its name is
 * reused (dangling links are invisible to resolution).
 * @param installAnchor - absolute path of the dsh app's package.json.
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 */
export function healProfilesModuleFallback(installAnchor: string, home: string = resolveDshHome()): void {
  const profilesDir = join(home, PROFILES_DIR)
  const modulesDir = join(profilesDir, 'node_modules')
  mkdirSync(modulesDir, { recursive: true })
  const appManifest = readJsonFile<ProfileManifest>(installAnchor)
  const links = new Map<string, string>()
  /* v8 ignore next -- a real app manifest always declares its name */
  if (appManifest.name !== undefined) links.set(appManifest.name, dirname(installAnchor))
  // BFS over the resolvable dependency graph; the visited set is the link
  // map itself (first resolution wins, matching Node's own nearest-wins).
  const queue: { anchor: string; manifest: ProfileManifest }[] = [{ anchor: installAnchor, manifest: appManifest }]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    // Peer dependencies participate: Service Definition packages (dsh-subprocess,
    // dsh-compaction, ...) are peers of their implementations, never plain
    // dependencies, yet out-of-tree plugins import them directly.
    /* v8 ignore next -- a real app manifest always declares dependencies */
    for (const dep of [...Object.keys(next.manifest.dependencies ?? {}), ...Object.keys(next.manifest.peerDependencies ?? {})]) {
      if (links.has(dep)) continue
      const dir = packageDirFromAnchor(next.anchor, dep)
      // A declared-but-uninstalled dependency cannot be a loader-visible
      // plugin; skip it rather than fail the whole boot.
      if (dir === undefined) continue
      links.set(dep, dir)
      const manifestPath = join(dir, 'package.json')
      queue.push({ anchor: manifestPath, manifest: readJsonFile<ProfileManifest>(manifestPath) })
    }
  }
  for (const [packageName, target] of links) {
    const link = join(modulesDir, packageName)
    mkdirSync(dirname(link), { recursive: true })
    ensureSymlink(link, target)
  }
}

/**
 * Read and parse one JSON file, tolerating a UTF-8 BOM prefix: Windows
 * editors and tools commonly write one, and JSON.parse rejects it, which
 * would otherwise fail every profile/bundle manifest read loudly.
 * @param path - JSON file to read.
 * @returns the parsed value.
 */
function readJsonFile<T>(path: string): T {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw.replace(/^\uFEFF/, '')) as T
}

/**
 * Read a profile's manifest.
 * @param binName - the diagnostic prefix on the thrown error.
 * @param dir - the profile directory.
 * @returns the parsed manifest.
 */
export function readProfileManifest(binName: string, dir: string): ProfileManifest {
  const path = join(dir, 'package.json')
  let parsed: ProfileManifest | null
  try {
    parsed = readJsonFile<ProfileManifest | null>(path)
  } catch (error) {
    throw new Error(`${binName}: failed to read profile manifest ${path}: ${String(error)}`)
  }
  // The field checks below validate the file data before trusting the parse type.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${binName}: profile manifest ${path} must hold a JSON object`)
  }
  return parsed
}

/**
 * Write a profile's manifest back (2-space JSON, trailing newline).
 * @param dir - the profile directory.
 * @param manifest - the manifest value to persist.
 */
export function writeProfileManifest(dir: string, manifest: ProfileManifest): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
}

/** Return whether two bundle lists have the same values in the same order. */
function sameBundles(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Normalize an exact installation-owned bundle tuple to its shipped template
 * while preserving every other manifest field. Any other list is user-owned.
 */
function normalizeShippedProfile(name: string, dir: string, manifest: ProfileManifest): ProfileManifest {
  const installationOwned = INSTALLATION_OWNED_PROFILE_TUPLES[name]
  const current = PROFILE_TEMPLATES[name]
  const bundles = manifest.dsh?.profile?.bundles
  if (installationOwned === undefined || current === undefined || bundles === undefined
    || !sameBundles(bundles, installationOwned)) return manifest
  const normalized: ProfileManifest = {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles: [...current] },
    },
  }
  writeProfileManifest(dir, normalized)
  return normalized
}

/**
 * Resolve a package's root directory from one anchor without depending on the
 * package exporting `./package.json` (`require.resolve` would need that):
 * probe the require resolution paths for a directory holding the named
 * manifest. This is Node's own node_modules lookup order, so the result
 * matches what the Loader would import from the same anchor, and
 * `existsSync` follows the symlinks pnpm's isolated layout uses.
 */
function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
  // resolve.paths returns null only for builtins, which no bundle name is.
  /* v8 ignore next */
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Resolve one bundle package's directory: installation anchor first, then the
 * profile directory. The installation-first order is the contract that
 * `@deepseek-ai/dsh-base` (and every other in-box bundle) always comes from
 * the same installation as the running dsh, never from a profile-local copy.
 * Resolution does not require the package to export `./package.json`.
 * @param binName - the diagnostic prefix on the thrown error.
 * @param packageName - the bundle's package name from `dsh.profile.bundles`.
 * @param installAnchor - absolute path of a file inside the dsh app package (its package.json).
 * @param profileDir - the profile directory (second anchor).
 * @returns the bundle package's absolute directory.
 */
export function resolveBundleDir(
  binName: string, packageName: string, installAnchor: string, profileDir: string,
): string {
  for (const anchor of [installAnchor, join(profileDir, 'package.json')]) {
    const dir = packageDirFromAnchor(anchor, packageName)
    if (dir !== undefined) return dir
  }
  throw new Error(
    `${binName}: cannot resolve profile bundle ${JSON.stringify(packageName)} from the dsh installation or ${profileDir}; `
    + `run 'dsh plugin --profile ${basename(profileDir)} install' if its dependency is not installed`,
  )
}

/**
 * Load a profile: resolve every `dsh.profile.bundles` entry to its patch
 * layer and parse the profile's own patch file. A listed bundle without a
 * `dsh.bundle` manifest fails loud — naming a bundle-less package as a layer
 * is a misconfiguration, not "no patches".
 * @param binName - the diagnostic prefix on thrown errors.
 * @param name - the profile name.
 * @param installAnchor - absolute path of the dsh app's package.json (first resolution anchor).
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 * @param options - `userLayer: false` skips reading `cordis.patch.yml`, so a
 * bundles-only consumer (`--dump-default-config`, a recovery diagnostic)
 * cannot fail on a broken user layer.
 * @returns the loaded profile (empty `patches` when the user layer is skipped).
 */
export function loadProfile(
  binName: string, name: string, installAnchor: string, home: string = resolveDshHome(),
  options: { userLayer?: boolean } = {},
): Profile {
  const dir = resolveProfileDir(name, home)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[name]
    if (template === undefined) {
      throw new Error(
        `${binName}: profile ${JSON.stringify(name)} does not exist; create it with 'dsh plugin --profile ${name} add <package>'`,
      )
    }
    initProfile(dir, template, PROFILE_TEMPLATE_DEPENDENCIES[name])
  }
  const manifest = normalizeShippedProfile(name, dir, readProfileManifest(binName, dir))
  // A hand-written profile manifest may omit the dsh section entirely.
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const layers: ProfileLayer[] = []
  for (const packageName of bundles) {
    try {
      const packageDir = resolveBundleDir(binName, packageName, installAnchor, dir)
      const bundleManifest = readJsonFile<ProfileManifest>(join(packageDir, 'package.json'))
      const declared = bundleManifest.dsh?.bundle?.patch
      if (declared === undefined) {
        throw new Error(`${binName}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json`)
      }
      const patchPath = join(packageDir, declared)
      layers.push({ packageName, packageDir, patchPath, patches: loadOverlayPatches(binName, patchPath) })
    } catch (error) {
      process.stderr.write(`${binName}: warning: skipping unresolved profile bundle ${JSON.stringify(packageName)}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  const patchPath = join(dir, PROFILE_PATCH_FILENAME)
  const patches: PatchOptions[] = []
  if (options.userLayer !== false && existsSync(patchPath)) {
    try {
      patches.push(...loadOverlayPatches(binName, patchPath))
    } catch (error) {
      // A broken marketplace-installed user layer must not block the desktop
      // client on its launch screen; skip the layer and let the app open.
      process.stderr.write(`${binName}: warning: skipping unreadable user patch layer ${patchPath}: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  return { name, dir, layers, patchPath, patches }
}

/**
 * Compose patch layers into the effective entry list over an empty root —
 * the same single `applyEntryPatches` call the boot include makes, so flag
 * derivation and config dumps see exactly what mounts.
 * @param layers - patch lists in application order.
 * @param warn - sink for skipped-patch diagnostics; defaults to silent (boot repeats them).
 * @returns the composed entry list.
 */
export function composeEntries(
  layers: readonly PatchOptions[][], warn: (message: string) => void = () => {},
): EntryOptions[] {
  return applyEntryPatches([], structuredClone(layers.flat()), (message: string, ...args: unknown[]) => {
    let index = 0
    warn(message.replace(/%C/g, () => JSON.stringify(args[index++])))
  })
}
