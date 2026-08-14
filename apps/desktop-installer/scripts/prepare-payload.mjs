import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const installerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = resolve(installerDir, '..', '..')
const desktopDir = join(rootDir, 'apps', 'desktop')
const stagingDir = join(installerDir, 'staging')
const payloadZip = join(installerDir, 'src-tauri', 'payload.zip')

const sourceExe = join(desktopDir, 'src-tauri', 'target', 'release', 'dsh-desktop.exe')
const sourceNode = join(desktopDir, 'bundle', 'node')
const sourceDsh = join(desktopDir, 'bundle', 'dsh')
if (!existsSync(sourceExe) || !existsSync(sourceNode) || !existsSync(sourceDsh)) {
  throw new Error('dsh desktop build missing; run apps/desktop tauri build first')
}

if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true })
mkdirSync(join(stagingDir, 'resources'), { recursive: true })

cpSync(sourceExe, join(stagingDir, 'DeepSeek Harness.exe'), { force: true })
cpSync(sourceNode, join(stagingDir, 'resources', 'node'), { recursive: true, force: true })
cpSync(sourceDsh, join(stagingDir, 'resources', 'dsh'), { recursive: true, force: true })

if (existsSync(payloadZip)) rmSync(payloadZip, { force: true })
execFileSync(
  'tar.exe',
  ['-a', '-c', '-f', payloadZip, '-C', stagingDir, '.'],
  { stdio: 'inherit' },
)

const sizeMb = (statSync(payloadZip).size / 1024 / 1024).toFixed(1)
console.log(`payload ready: ${payloadZip} (${sizeMb} MB)`)