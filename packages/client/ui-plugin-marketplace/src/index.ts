/**
 * Host half of the plugin marketplace: runs inside the `dsh web` process and
 * exposes the `pluginMarketplace` Typert Remote the Settings → Plugins tab
 * drives — browse/search npm for dsh plugins and install/uninstall them into
 * the current web profile (the same destination the CLI's
 * `dsh plugin --profile web add <pkg>` manages, executed with the bundled
 * npm).
 *
 * Activation model (why a restart is needed):
 * - a bundle package (declares dsh.bundle.patch) joins dsh.profile.bundles;
 * - any other package (client-only or host-only plugin) gets an idempotent
 *   row inserted into the profile's cordis.patch.yml;
 * both take effect when dsh web next boots.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import type {
  MarketplaceActionResult, MarketplaceInstalledSnapshot, MarketplacePluginEntry, MarketplaceSearchHit,
} from './types.ts'

export type {
  MarketplaceActionResult, MarketplaceInstalledSnapshot, MarketplacePluginEntry, MarketplaceSearchHit,
} from './types.ts'

const PROFILE_NAME = 'web'
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000
const SEARCH_TIMEOUT_MS = 30 * 1000
const SEARCH_PAGE_SIZE = 250
const OUTPUT_CAP = 65536

/** npm public registry search endpoint (the discovery the studio plugin center uses). */
const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search'

interface NpmRun {
  code: number | null
  stdout: string
  stderr: string
  error?: string
  timedOut?: boolean
}

// The client half drives the remote through the generated Typert gateway,
// whose descriptors come from @Remote markers. The desktop bundle keeps this
// plugin in its own module tree, so marker state is visible; the explicit
// registration below is kept as a safety net for profiles where the plugin is
// copied into the profile's node_modules (markers are not visible across
// module instances there).
const REMOTE_PACKAGE = '@deepseek-ai/dsh-client-ui-plugin-marketplace'

const looseCodec = (): InvocationDescriptor['parameters'][number]['codec'] => ({
  mode: 'strict',
  typeSymbol: `${REMOTE_PACKAGE}/types#Json`,
  schema: { parse: (value: unknown) => value },
})

const descriptor = (method: string, parameters: string[]): InvocationDescriptor => ({
  id: `${REMOTE_PACKAGE}#pluginMarketplace/${method}`,
  service: 'pluginMarketplace',
  namespace: 'pluginMarketplace',
  method,
  invocation: { kind: 'direct' },
  parameters: parameters.map((name) => ({
    name,
    wire: name,
    source: 'json' as const,
    codec: looseCodec(),
  })),
  result: looseCodec(),
})

const REMOTE_INVOCATIONS: readonly InvocationDescriptor[] = [
  descriptor('search', ['query']),
  descriptor('installed', []),
  descriptor('installPlugin', ['packageName']),
  descriptor('uninstallPlugin', ['packageName']),
]

/** The harness home the host booted with (same rule dsh itself uses). */
function homeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** The web profile directory: $DSH_HOME/profiles/web. */
function profileDir(): string {
  return join(homeDir(), 'profiles', PROFILE_NAME)
}

function manifestPath(): string {
  return join(profileDir(), 'package.json')
}

function patchPath(): string {
  return join(profileDir(), 'cordis.patch.yml')
}

/** Absolute directory a profile-installed package resolves to (scoped-aware). */
function packageDir(name: string): string {
  return join(profileDir(), 'node_modules', ...name.split('/'))
}

/**
 * The npm CLI to drive. Prefer the bundled copy beside the bundled node
 * runtime (desktop bundle: `<root>/npm/node_modules/npm`) and fall back to
 * npm on PATH when that copy is absent.
 */
function npmCommand(): { file: string; prefix: string[]; shell: boolean } {
  const bundledCandidates = [
    join(dirname(process.execPath), '..', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const cli of bundledCandidates) {
    if (existsSync(cli)) return { file: process.execPath, prefix: [cli], shell: false }
  }
  return { file: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [], shell: true }
}

/**
 * Run one npm invocation in the profile directory, collecting capped output.
 * @param args - npm arguments after the CLI script.
 * @param timeoutMs - hard timeout; resolves with a timed-out settlement.
 * @returns settlement.
 */
function runNpm(args: string[], timeoutMs: number): Promise<NpmRun> {
  return new Promise((resolve) => {
    const cmd = npmCommand()
    const child = spawn(cmd.file, [...cmd.prefix, ...args], {
      cwd: profileDir(),
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: cmd.shell,
    })
    const out: { stdout: string; stderr: string } = { stdout: '', stderr: '' }
    const feed = (key: 'stdout' | 'stderr') => (chunk: Buffer): void => {
      const text = chunk.toString()
      const keep = OUTPUT_CAP - out[key].length
      if (keep > 0) out[key] += text.slice(0, keep)
    }
    child.stdout?.on('data', feed('stdout'))
    child.stderr?.on('data', feed('stderr'))
    let settled = false
    const settle = (value: NpmRun): void => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      settle({ code: null, stdout: out.stdout, stderr: out.stderr, timedOut: true, error: 'npm 执行超时' })
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      settle({ code: null, stdout: out.stdout, stderr: out.stderr, error: String((error && error.message) || error) })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      settle({ code, stdout: out.stdout, stderr: out.stderr })
    })
  })
}

function readJson(path: string): Record<string, unknown> {
  // Tolerate a UTF-8 BOM prefix (Windows editors commonly write one; the
  // profile manifest is user-editable).
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>
}

/** Snapshot of what the web profile currently has installed (user-managed). */
function snapshot(): MarketplaceInstalledSnapshot {
  const dir = profileDir()
  const manifest = existsSync(manifestPath()) ? readJson(manifestPath()) : {}
  const dependencies = (manifest.dependencies ?? {}) as Record<string, string>
  const profile = (manifest.dsh as { profile?: { bundles?: string[] } } | undefined)?.profile
  const bundles = profile?.bundles ?? []
  const plugins: MarketplacePluginEntry[] = []
  for (const name of Object.keys(dependencies)) {
    let version = ''
    let isBundle = false
    let isClient = false
    try {
      const pkg = readJson(join(packageDir(name), 'package.json'))
      version = typeof pkg.version === 'string' ? pkg.version : ''
      const dsh = pkg.dsh as { bundle?: { patch?: unknown }; client?: { platform?: string } } | undefined
      isBundle = dsh?.bundle?.patch !== undefined
      isClient = dsh?.client?.platform === 'web'
    } catch { /* not installed locally */ }
    plugins.push({
      name,
      version: version || String(dependencies[name] ?? '').replace(/^[\^~]/, ''),
      isBundle,
      isClient,
      inBundles: bundles.includes(name),
    })
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return { profileDir: dir, bundles, plugins }
}

/** Row-id slug for packages this plugin manages in cordis.patch.yml. */
function slugOf(name: string): string {
  return name.replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
}

/**
 * Idempotently add a loader row for a non-bundle plugin package.
 * @returns whether the patch file changed.
 */
function ensureRow(name: string): boolean {
  const path = patchPath()
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '[]\n'
  if (text.includes(`name: '${name}'`) || text.includes(`name: "${name}"`)) return false
  const id = `pm-${slugOf(name)}`
  const block = `- insert:\n    - id: ${id}\n      name: '${name}'\n`
  if (/^\s*\[\]\s*$/m.test(text)) text = text.replace(/\[\]/m, block)
  else text = text.replace(/\s+$/, '') + '\n' + block
  writeFileSync(path, text)
  return true
}

/** Remove the row this plugin added for a package (exact block match). */
function removeRow(name: string): void {
  const path = patchPath()
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  const id = `pm-${slugOf(name)}`
  const block = `- insert:\n    - id: ${id}\n      name: '${name}'\n`
  if (!text.includes(block)) return
  writeFileSync(path, text.split(block).join(''))
}

/** Validate and normalize a package name from the wire. */
function validName(value: unknown): string {
  const name = String(value ?? '').trim()
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) throw new Error(`无效的包名 ${JSON.stringify(name)}`)
  return name
}

/** First useful npm failure text (stderr wins, then stdout, then the code). */
function npmFailure(run: NpmRun, verb: string): string {
  return (run.error ?? run.stderr ?? run.stdout ?? `npm ${verb} 失败 (exit ${run.code})`).trim().slice(0, 800)
}

/**
 * The marketplace gateway service: search npm, list installed plugins, and
 * install/uninstall them into the web profile.
 */
export class PluginMarketplaceGateway extends TypertRemoteService {
  static inject = ['typert']

  constructor(ctx: Context) {
    super(ctx, 'pluginMarketplace')
    // Safety-net registration into the host typert local store (see the file
    // header). Failure only warns: if the endpoints were already registered,
    // the claim still works.
    const typert = (ctx as unknown as { typert?: { register(contribution: {
      package: string
      face: 'host'
      model: 'src'
      schemas: unknown[]
      invocations: readonly InvocationDescriptor[]
    }): () => void } }).typert
    if (typert !== undefined && typeof typert.register === 'function') {
      try {
        const dispose = typert.register({
          package: REMOTE_PACKAGE,
          face: 'host',
          model: 'src',
          schemas: [],
          invocations: REMOTE_INVOCATIONS,
        })
        ctx.effect(() => dispose, 'ui-plugin-marketplace: typert registration')
      } catch (error) {
        ctx.logger?.warn?.(`ui-plugin-marketplace: typert local registration failed: ${String((error && (error as Error).message) || error)}`)
      }
    }
  }

  /**
   * Search the npm public registry for dsh plugins (the same discovery the
   * studio plugin center uses: the registry search API, one 250-hit page).
   * @param query - optional free-text terms combined with keywords:dsh-plugin.
   * @returns matching packages with their install state.
   */
  @Remote('search')
  async search(query: string): Promise<{ query: string; results: MarketplaceSearchHit[] }> {
    const text = String(query ?? '').trim()
    const terms = text.length > 0 ? `keywords:dsh-plugin ${text}` : 'keywords:dsh-plugin'
    const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(terms)}&size=${SEARCH_PAGE_SIZE}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
    let payload: { objects?: Array<{ package?: Record<string, unknown> }> }
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`npm 搜索服务返回 HTTP ${response.status}`)
      payload = await response.json() as { objects?: Array<{ package?: Record<string, unknown> }> }
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new Error('npm 搜索服务响应超时')
      throw error
    } finally {
      clearTimeout(timer)
    }
    const rows = (payload.objects ?? [])
      .map(obj => obj.package)
      .filter((pkg): pkg is Record<string, unknown> => pkg !== null && typeof pkg === 'object' && typeof pkg.name === 'string')
    const installed = snapshot()
    const byName = new Map(installed.plugins.map((plugin) => [plugin.name, plugin]))
    return {
      query: text,
      results: rows.map((pkg) => {
        const name = pkg.name as string
        const hit = byName.get(name)
        const links = pkg.links !== null && typeof pkg.links === 'object' ? pkg.links as Record<string, string> : {}
        return {
          name,
          version: typeof pkg.version === 'string' ? pkg.version : '',
          description: typeof pkg.description === 'string' ? pkg.description : '',
          date: typeof pkg.date === 'string' ? pkg.date : null,
          license: typeof pkg.license === 'string' ? pkg.license : '',
          links,
          installed: hit === undefined ? null : { version: hit.version, isBundle: hit.isBundle, isClient: hit.isClient },
        }
      }),
    }
  }

  /** The profile's currently installed user plugins. */
  @Remote('installed')
  installed(): MarketplaceInstalledSnapshot {
    return snapshot()
  }

  /**
   * Install one npm package into the web profile and activate it: bundles
   * join dsh.profile.bundles, everything else gets a loader row.
   * @param packageName - exact npm package name from the search results.
   * @returns the action result; `needsRestart` when a reboot activates it.
   */
  @Remote('installPlugin')
  async installPlugin(packageName: string): Promise<MarketplaceActionResult> {
    const name = validName(packageName)
    const run = await runNpm(['install', '--save', '--no-fund', '--no-audit', '--legacy-peer-deps', '--install-strategy=hoisted', name], INSTALL_TIMEOUT_MS)
    if (run.code !== 0) return { ok: false, name, error: npmFailure(run, 'install') }
    const after = snapshot()
    const entry = after.plugins.find((plugin) => plugin.name === name)
    if (entry === undefined) {
      return { ok: false, name, error: '安装命令成功，但未在 profile 依赖中找到该包（git/别名规格不受支持）' }
    }
    let rowsAdded = false
    if (entry.isBundle) {
      const manifest = readJson(manifestPath())
      manifest.dsh ??= {}
      const profile = (manifest.dsh as { profile?: { bundles?: string[] } }).profile ??= { bundles: [] }
      profile.bundles ??= []
      if (!profile.bundles.includes(name)) {
        profile.bundles.push(name)
        writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2) + '\n')
      }
    } else {
      rowsAdded = ensureRow(name)
    }
    return { ok: true, name, version: entry.version, isBundle: entry.isBundle, isClient: entry.isClient, rowsAdded, needsRestart: true }
  }

  /**
   * Remove one user-installed plugin from the web profile, including the
   * activation state this plugin manages.
   * @param packageName - exact npm package name.
   * @returns the action result.
   */
  @Remote('uninstallPlugin')
  async uninstallPlugin(packageName: string): Promise<MarketplaceActionResult> {
    const name = validName(packageName)
    const before = snapshot()
    if (!before.plugins.some((plugin) => plugin.name === name)) {
      return { ok: false, name, error: '该插件不在本 profile 的依赖里' }
    }
    const run = await runNpm(['uninstall', '--save', '--no-fund', '--no-audit', name], INSTALL_TIMEOUT_MS)
    if (run.code !== 0) return { ok: false, name, error: npmFailure(run, 'uninstall') }
    const manifest = existsSync(manifestPath()) ? readJson(manifestPath()) : {}
    const profile = (manifest.dsh as { profile?: { bundles?: string[] } } | undefined)?.profile
    if (profile !== undefined && Array.isArray(profile.bundles)) {
      profile.bundles = profile.bundles.filter((bundle) => bundle !== name)
      writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2) + '\n')
    }
    removeRow(name)
    return { ok: true, name, needsRestart: true }
  }
}

export default PluginMarketplaceGateway
