import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = resolve(desktopDir, '..', '..')
const bundleDir = join(desktopDir, 'bundle')
const dshDir = join(bundleDir, 'dsh')
const nodeDir = join(bundleDir, 'node')
const nodeExe = join(nodeDir, 'node.exe')

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

if (existsSync(dshDir)) {
  rmSync(dshDir, { recursive: true, force: true })
}
mkdirSync(bundleDir, { recursive: true })

execFileSync(
  pnpm,
  [
    '--filter', '@deepseek-ai/dsh',
    '--config.inject-workspace-packages=true',
    '--config.dangerously-allow-all-builds=true',
    'deploy', '--prod', 'bundle/dsh',
  ],
  {
    cwd: desktopDir,
    stdio: 'inherit',
    shell: true,
  },
)

const entry = join(dshDir, 'lib', 'bin.js')
if (!existsSync(entry)) {
  const nestedPackage = join(dshDir, 'node_modules', '@deepseek-ai', 'dsh')
  const nestedEntry = join(nestedPackage, 'lib', 'bin.js')
  if (!existsSync(nestedEntry)) {
    throw new Error(`dsh bundle entry missing: ${entry}`)
  }
  cpSync(nestedPackage, dshDir, {
    recursive: true,
    force: true,
    dereference: false,
    filter: sourcePath => {
      const parts = sourcePath.split(/[\\/]/)
      return !parts.includes('node_modules') && !sourcePath.endsWith('.map')
    },
  })
}

copyWorkspacePackages()
flattenTopLevelFromPnpm()
removePnpmStore()
flattenLinks()
removeJunk()
cleanRuntimeFiles()

mkdirSync(nodeDir, { recursive: true })
if (existsSync(nodeExe)) {
  try {
    const existing = realpathSync(nodeExe).toLowerCase()
    const current = realpathSync(process.execPath).toLowerCase()
    if (existing === current) {
      console.log('bundled node is already the current runtime; keeping it')
    } else {
      cpSync(process.execPath, nodeExe, { force: true, dereference: true })
    }
  } catch {
    cpSync(process.execPath, nodeExe, { force: true, dereference: true })
  }
} else {
  cpSync(process.execPath, nodeExe, { force: true, dereference: true })
}
bundleNpm()
bundleMemorix()
console.log(`desktop bundle ready: ${bundleDir}`)

/**
 * Bundle the built Memorix runtime beside the bundled node so the
 * project-memory switch can start `memorix serve` without a system install.
 * The runtime directory is produced locally by the desktop build workflow
 * (and ignored by git); prepare-bundle fails loud when it is incomplete.
 */
function bundleMemorix() {
  const source = join(desktopDir, 'memorix-runtime')
  const dest = join(bundleDir, 'memorix')
  if (!existsSync(source)) {
    console.log('memorix runtime absent; skipping project-memory bundle')
    return
  }
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }
  cpSync(source, dest, { recursive: true, force: true, dereference: false })
  if (!existsSync(join(dest, 'dist', 'cli', 'index.js'))) {
    throw new Error('memorix bundle incomplete: dist/cli/index.js missing')
  }
}

/**
 * Bundle the npm CLI beside the bundled node so the plugin marketplace can
 * install packages on machines without a Node/npm installation. The npm
 * package is installed into `<bundle>/npm` via the system npm; the host half
 * of ui-plugin-marketplace finds it at `<root>/npm/node_modules/npm`.
 */
function bundleNpm() {
  const npmDir = join(bundleDir, 'npm')
  mkdirSync(npmDir, { recursive: true })
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(
    npmCommand,
    ['install', '--prefix', npmDir, 'npm@10', '--no-audit', '--no-fund', '--no-progress'],
    { stdio: 'inherit', shell: true },
  )
  if (!existsSync(join(npmDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))) {
    throw new Error('npm bundle incomplete: npm-cli.js missing after install')
  }
}

function copyWorkspacePackages() {
  const rels = new Set(['apps/cli', 'apps/web'])
  for (const group of readdirSync(join(rootDir, 'packages'))) {
    const groupDir = join(rootDir, 'packages', group)
    if (!lstatSync(groupDir).isDirectory()) continue
    for (const name of readdirSync(groupDir)) {
      const pkgDir = join(groupDir, name)
      if (existsSync(join(pkgDir, 'package.json'))) {
        rels.add(`packages/${group}/${name}`)
      }
    }
  }
  for (const name of readdirSync(join(rootDir, 'vendor'))) {
    const pkgDir = join(rootDir, 'vendor', name)
    if (existsSync(join(pkgDir, 'package.json'))) {
      rels.add(`vendor/${name}`)
    }
  }

  for (const rel of rels) {
    const source = join(rootDir, rel)
    const manifest = join(source, 'package.json')
    if (!existsSync(manifest)) continue
    const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof name !== 'string' || !name.startsWith('@deepseek-ai/')) continue
    const dest = join(dshDir, 'node_modules', ...name.split('/'))
    if (existsSync(dest)) {
      continue
    }
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(source, dest, {
      recursive: true,
      force: true,
      dereference: false,
      filter: sourcePath => {
        const parts = sourcePath.split(/[\\/]/)
        return !parts.some(part => part === 'node_modules' || part === 'src' || part === 'tests' || part === 'coverage' || part === '.git')
          && !sourcePath.endsWith('.map')
      },
    })
  }
}

function flattenTopLevelFromPnpm() {
  const nodeModules = join(dshDir, 'node_modules')
  const pnpmDir = join(nodeModules, '.pnpm')
  if (!existsSync(pnpmDir)) return
  for (const entry of readdirSync(pnpmDir)) {
    const pkgNodeModules = join(pnpmDir, entry, 'node_modules')
    if (!existsSync(pkgNodeModules)) continue
    for (const scope of readdirSync(pkgNodeModules)) {
      const names = scope.startsWith('@')
        ? readdirSync(join(pkgNodeModules, scope)).map(name => join(scope, name))
        : [scope]
      for (const rel of names) {
        let source = join(pkgNodeModules, ...rel.split(/[\\/]/))
        try {
          if (lstatSync(source).isSymbolicLink()) source = realpathSync(source)
        } catch {}
        if (!existsSync(join(source, 'package.json'))) continue
        const dest = join(nodeModules, ...rel.split(/[\\/]/))
        if (existsSync(dest)) {
          const stats = lstatSync(dest)
          if (stats.isSymbolicLink()) {
            rmSync(dest, { recursive: true, force: true })
          } else {
            continue
          }
        }
        mkdirSync(dirname(dest), { recursive: true })
        cpSync(source, dest, {
          recursive: true,
          force: true,
          dereference: false,
          filter: sourcePath => !sourcePath.slice(source.length).replace(/^[\\/]+/, '').split(/[\\/]/).includes('node_modules'),
        })
      }
    }
  }
}
function removePnpmStore() {
  const pnpmDir = join(dshDir, 'node_modules', '.pnpm')
  if (existsSync(pnpmDir)) {
    rmSync(pnpmDir, { recursive: true, force: true })
  }
}
function flattenLinks() {
  const nodeModules = join(dshDir, 'node_modules')
  const pnpmDir = join(nodeModules, '.pnpm')
  const copied = new Map()
  let pending = []
  if (existsSync(nodeModules)) {
    pending.push(nodeModules)
  }
  if (existsSync(pnpmDir)) {
    pending.push(pnpmDir)
  }

  let rounds = 0
  while (pending.length > 0 && rounds < 20) {
    const next = []
    for (const dir of pending) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        let stats
        try {
          stats = lstatSync(full)
        } catch {
          continue
        }
        if (stats.isSymbolicLink()) {
          let target
          try {
            target = realpathSync(full)
          } catch {
            continue
          }
          const key = target.toLowerCase()
          rmSync(full, { recursive: true, force: true })
          if (copied.has(key)) {
            cpSync(copied.get(key), full, {
              recursive: true,
              force: true,
              dereference: false,
              filter: sourcePath => !sourcePath.slice(copied.get(key).length).replace(/^[\\/]+/, '').split(/[\\/]/).includes('node_modules'),
            })
          } else {
            cpSync(target, full, {
              recursive: true,
              force: true,
              dereference: false,
              filter: sourcePath => !sourcePath.slice(target.length).replace(/^[\\/]+/, '').split(/[\\/]/).includes('node_modules'),
            })
            copied.set(key, full)
          }
          next.push(full)
        } else if (stats.isDirectory()) {
          next.push(full)
        }
      }
    }
    pending = next
    rounds += 1
  }
}
function removeJunk() {
  const junkDirs = new Set(['tests', 'coverage', '.git'])
  const stack = [dshDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      let stats
      try {
        stats = lstatSync(full)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        if (junkDirs.has(name)) {
          rmSync(full, { recursive: true, force: true })
        } else {
          stack.push(full)
        }
      } else if (name.endsWith('.map')) {
        rmSync(full, { force: true })
      }
    }
  }
}

function cleanRuntimeFiles() {
  const nodeModules = join(dshDir, 'node_modules')
  for (const name of ['.modules.yaml', '.package-lock.json', '.pnpm-workspace-state-v1.json', '.package-map.json']) {
    const file = join(nodeModules, name)
    if (existsSync(file)) rmSync(file, { force: true })
  }
  const bin = join(nodeModules, '.bin')
  if (existsSync(bin)) rmSync(bin, { recursive: true, force: true })
  for (const name of ['pnpm-lock.yaml', 'package-lock.json']) {
    const file = join(dshDir, name)
    if (existsSync(file)) rmSync(file, { force: true })
  }
}
