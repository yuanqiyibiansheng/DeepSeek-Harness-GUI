// Rewrite skills-seed SKILL.md frontmatter: kebab name matching the directory,
// single-line Chinese description (the web management parser reads only
// `key: value` lines), keep every other frontmatter field and the body.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const seed = process.argv[2]
const desc = JSON.parse(readFileSync(process.argv[3], 'utf8'))

function rewrite(raw, dirName, zhDesc) {
  if (!raw.startsWith('---')) return raw
  const close = raw.indexOf('\n---', 3)
  if (close < 0) return raw
  const fm = raw.slice(3, close)
  const body = raw.slice(close + 4)
  const lines = fm.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*name\s*:/.test(line)) {
      out.push(`name: ${dirName}`)
      i += 1
      continue
    }
    if (/^\s*description\s*:/.test(line)) {
      out.push(`description: "${zhDesc}"`)
      i += 1
      // skip folded/scalar continuation lines
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) i += 1
      continue
    }
    out.push(line)
    i += 1
  }
  return `---\n${out.join('\n')}\n---${body}`
}

for (const dir of readdirSync(seed, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const md = join(seed, dir.name, 'SKILL.md')
  const zh = desc[dir.name]
  if (zh === undefined) {
    console.error(`no Chinese description for ${dir.name}`)
    process.exit(1)
  }
  const raw = readFileSync(md, 'utf8')
  const next = rewrite(raw, dir.name, zh)
  if (next === raw) {
    console.error(`frontmatter unchanged for ${dir.name}`)
    process.exit(1)
  }
  writeFileSync(md, next, 'utf8')
  console.log(`rewrote ${dir.name}`)
}
