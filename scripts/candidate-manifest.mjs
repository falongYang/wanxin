import { createHash } from 'node:crypto'
import { copyFileSync, lstatSync, readFileSync, readdirSync, mkdirSync, realpathSync } from 'node:fs'
import { resolve, relative, dirname, join, isAbsolute } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const hash = data => createHash('sha256').update(data).digest('hex')
const compare = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0
const codeRoots = ['server', 'src', 'scripts', 'tests']
const required = ['.nvmrc', '.env.example', 'package.json', 'package-lock.json', 'scripts/candidate-files.json', 'scripts/candidate-manifest.mjs']
function safePath(path) {
  if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) return false
  const parts = path.split('/')
  if (parts.some(part => ['.git', '.agentsroom', '.claude', 'node_modules', 'dist', 'data'].includes(part) || part.endsWith('.instance-lock') || part.includes('.sqlite'))) return false
  if (parts.some(part => part.startsWith('.env')) && path !== '.env.example') return false
  if (path.startsWith('docs/verification/')) return false
  const rootFiles = ['.gitignore', '.nvmrc', '.env.example', 'package.json', 'package-lock.json', 'README.md', 'index.html', 'tsconfig.json', 'vite.config.mjs']
  return rootFiles.includes(path) || /^(server|src|scripts|tests)\/.+\.(mjs|js|ts|tsx|css|json)$/.test(path) || /^docs\/(?!verification\/).+\.md$/.test(path) || path === 'prototype/index.html'
}
function regularFile(root, path) {
  const parts = path.split('/')
  let current = root
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error('Candidate paths must be regular files without symlinks')
  }
  return current
}
function walk(root, prefix = '') {
  const rows = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not candidate inputs')
    if (entry.isDirectory()) rows.push(...walk(join(root, entry.name), path))
    else if (entry.isFile()) rows.push(path)
    else throw new Error('Unsupported candidate file type')
  }
  return rows.sort()
}
export function sourceManifest(directory) {
  const root = realpathSync(directory)
  const listing = regularFile(root, 'scripts/candidate-files.json')
  const paths = JSON.parse(readFileSync(listing, 'utf8'))
  if (!Array.isArray(paths) || new Set(paths).size !== paths.length || paths.some(path => !safePath(path)) || required.some(path => !paths.includes(path))) throw new Error('Invalid source allowlist')
  const expectedNode = readFileSync(regularFile(root, '.nvmrc'), 'utf8').trim()
  if (process.versions.node !== expectedNode) throw new Error('Use the exact Node version in .nvmrc')
  for (const subdir of codeRoots) {
    // A new code file requires an explicit allowlist update; never silently omit it.
    for (const file of walk(join(root, subdir), subdir)) {
      if (!paths.includes(file)) throw new Error('Unlisted code file: ' + file)
    }
  }
  const lock = JSON.parse(readFileSync(regularFile(root, 'package-lock.json'), 'utf8'))
  for (const entry of Object.values(lock.packages || {})) {
    if (!entry.resolved) continue
    const url = new URL(entry.resolved)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Lockfile contains an unsafe resolved URL')
  }
  const files = paths.sort().map(path => {
    const bytes = readFileSync(regularFile(root, path))
    return { path, bytes: bytes.length, sha256: hash(bytes) }
  })
  return { kind: 'working-tree-snapshot', sha256: hash(JSON.stringify(files)), files }
}
export function artifactManifest(directory) {
  const root = realpathSync(directory)
  const files = walk(root).map(path => {
    if (!/\.(html|css|js)$/.test(path)) throw new Error('Unexpected build artifact type')
    const bytes = readFileSync(regularFile(root, path))
    return { path, bytes: bytes.length, sha256: hash(bytes) }
  }).sort(compare)
  if (!files.some(file => file.path === 'index.html')) throw new Error('Missing build entry')
  return { sha256: hash(JSON.stringify(files)), files }
}
export function copyCandidate(root, destination, source) {
  const target = resolve(realpathSync(dirname(destination)), destination.split(/[\\/]/).at(-1))
  const rel = relative(realpathSync(root), target)
  if (!rel || (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel))) throw new Error('Snapshot destination must be outside the source tree')
  mkdirSync(target) // Must be new; never overwrite an existing checkout or directory.
  for (const subdir of codeRoots) mkdirSync(join(target, subdir))
  for (const file of source.files) {
    const output = join(target, file.path)
    mkdirSync(dirname(output), { recursive: true })
    copyFileSync(regularFile(realpathSync(root), file.path), output)
  }
  if (sourceManifest(target).sha256 !== source.sha256) throw new Error('Source changed during copy; discard this snapshot')
  return target
}
function main() {
  const options = {}
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i += 2) {
    if (!['--root', '--dist-root', '--copy-to', '--verify'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Invalid candidate arguments')
    options[args[i]] = args[i + 1]
  }
  const root = resolve(options['--root'] || '.')
  const source = sourceManifest(root)
  const artifacts = options['--dist-root'] ? artifactManifest(resolve(options['--dist-root'])) : null
  let baseCommit = null
  try { baseCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* A copied snapshot has no Git metadata. */ }
  const report = { schemaVersion: 1, baseCommit, versionLabel: 'uncommitted-working-tree; HEAD is context only', node: process.version,
    platform: process.platform, architecture: process.arch, source, artifacts }
  if (options['--verify']) {
    const expected = JSON.parse(readFileSync(options['--verify'], 'utf8'))
    if (JSON.stringify(source) !== JSON.stringify(expected.source) || JSON.stringify(artifacts) !== JSON.stringify(expected.artifacts)) throw new Error('Candidate checksum mismatch')
    process.stdout.write('candidate_verified\n')
    return
  }
  if (options['--copy-to']) copyCandidate(root, resolve(options['--copy-to']), source)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) {
    // Do not print file contents, private config values or raw parser errors.
    process.stderr.write('candidate_failed: ' + (error.message.startsWith('Unlisted code file:') ? error.message : 'check runtime, allowlist, paths and checksum') + '\n')
    process.exitCode = 1
  }
}
