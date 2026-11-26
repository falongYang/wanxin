import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPolicy } from '../../server/access.mjs'
const hash = token => createHash('sha256').update(token).digest('hex')
export function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wanxin-access-'))
  const cleanups = []
  t.after(() => { try { for (const fn of cleanups.reverse()) fn() } finally { rmSync(dir, { recursive: true, force: true }) } })
  const file = join(dir, 'invites.json')
  const token = 'a'.repeat(64)
  const invite = { tokenId: 'ticket-1', subjectId: 'trial-1', version: 1, digest: hash(token), enabled: true,
    notBefore: '2026-11-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z', maxRedemptions: 1 }
  const save = (invites = [invite]) => writeFileSync(file, JSON.stringify({ invites }))
  save()
  const env = { APP_ACCESS_MODE: 'invitation', MODEL_MODE: 'stub', PUBLIC_ORIGIN: 'https://trial.example',
    ACCESS_INVITES_FILE: file, ACCESS_HMAC_SECRET: 's'.repeat(64), SQLITE_PATH: join(dir, 'db.sqlite'),
    ACCESS_LIMITS: JSON.stringify({ subjectDaily: 3, globalDaily: 5, subjectMinute: 3, globalMinute: 5,
      inFlight: 1, redeemSource: 3, redeemGlobal: 5, endpointMinute: 30, timeZone: 'Asia/Shanghai' }),
    ACCESS_PROXY_MODE: 'none' }
  return { dir, file, token, invite, save, env, policy: loadPolicy(env), after: fn => cleanups.push(fn) }
}
