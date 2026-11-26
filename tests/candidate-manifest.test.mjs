import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceManifest, artifactManifest, copyCandidate } from '../scripts/candidate-manifest.mjs'

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'wanxin-candidate-test-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const root = join(parent, 'source')
  mkdirSync(root)
  for (const dir of ['server', 'src', 'scripts', 'tests', 'data', 'dist', '.agentsroom']) mkdirSync(join(root, dir))
  const files = ['.nvmrc', '.env.example', 'package.json', 'package-lock.json', 'scripts/candidate-files.json', 'scripts/candidate-manifest.mjs', 'src/main.ts']
  writeFileSync(join(root, '.nvmrc'), process.versions.node + '\n')
  writeFileSync(join(root, '.env.example'), 'MODEL_MODE=stub\n')
  writeFileSync(join(root, 'package.json'), '{}\n')
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n')
  writeFileSync(join(root, 'scripts/candidate-files.json'), JSON.stringify(files))
  writeFileSync(join(root, 'scripts/candidate-manifest.mjs'), '// synthetic script\n')
  writeFileSync(join(root, 'src/main.ts'), 'export const message = "original"\n')
  for (const file of ['.env', 'data/private.sqlite', '.agentsroom/private.json']) writeFileSync(join(root, file), 'SYNTHETIC_SECRET')
  writeFileSync(join(root, 'dist/index.html'), '<html>synthetic artifact</html>')
  return { parent, root, files }
}

test('候选摘要稳定、排除运行输出和秘密；拷贝后独立验证，源变更可发现', t => {
  const f = fixture(t)
  const first = sourceManifest(f.root)
  writeFileSync(join(f.root, '.env'), 'CHANGED_SECRET')
  writeFileSync(join(f.root, 'dist/index.html'), '<html>changed artifact</html>')
  assert.deepEqual(sourceManifest(f.root), first)
  assert.ok(!JSON.stringify(first).includes('SECRET'))
  const copy = join(f.parent, 'copy')
  copyCandidate(f.root, copy, first)
  assert.deepEqual(sourceManifest(copy), first)
  assert.throws(() => copyCandidate(f.root, join(f.root, 'inside'), first))
  writeFileSync(join(f.root, 'src/main.ts'), 'export const message = "changed"\n')
  assert.notEqual(sourceManifest(f.root).sha256, first.sha256)
  const artifact = artifactManifest(join(f.root, 'dist'))
  writeFileSync(join(f.root, 'dist/index.html'), '<html>different artifact</html>')
  assert.notEqual(artifactManifest(join(f.root, 'dist')).sha256, artifact.sha256)
})

test('未知源码、秘密路径白名单、符号链接及带认证锁URL均拒绝', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'server/unlisted.mjs'), '// new code')
  assert.throws(() => sourceManifest(f.root), /Unlisted code/)
  rmSync(join(f.root, 'server/unlisted.mjs'))
  writeFileSync(join(f.root, 'scripts/candidate-files.json'), JSON.stringify([...f.files, '.env']))
  assert.throws(() => sourceManifest(f.root), /allowlist/)
  writeFileSync(join(f.root, 'scripts/candidate-files.json'), JSON.stringify(f.files))
  rmSync(join(f.root, 'src/main.ts'))
  symlinkSync(join(f.root, '.env'), join(f.root, 'src/main.ts'))
  assert.throws(() => sourceManifest(f.root), /Symlinks/)
  rmSync(join(f.root, 'src/main.ts'))
  writeFileSync(join(f.root, 'src/main.ts'), '// restored')
  writeFileSync(join(f.root, 'package-lock.json'), JSON.stringify({ packages: { private: { resolved: 'https://user:password@example.com/pkg.tgz' } } }))
  assert.throws(() => sourceManifest(f.root), /unsafe resolved URL/)
})
