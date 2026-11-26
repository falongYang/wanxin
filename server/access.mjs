import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { isIP } from 'node:net'

export class ControlError extends Error {
  constructor(status, code, retryAfter) {
    super(code)
    Object.assign(this, { status, code, retryAfter })
  }
}
const rejectConfig = () => { throw new Error('Invalid access configuration') }
export const developmentPolicy = () => Object.freeze({ mode: 'development', modelMode: 'stub' })
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/
export function readInvites(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(value.invites) || value.invites.length === 0) rejectConfig()
  const keys = new Set(), subjects = new Set(), digests = new Set()
  for (const row of value.invites) {
    if (typeof row.tokenId !== 'string' || typeof row.subjectId !== 'string' || !idPattern.test(row.tokenId) || !idPattern.test(row.subjectId) || !Number.isSafeInteger(row.version) || row.version < 1 ||
        !/^[a-f0-9]{64}$/.test(row.digest) || typeof row.enabled !== 'boolean' || row.maxRedemptions !== 1 ||
        !Number.isFinite(Date.parse(row.notBefore)) || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.notBefore) >= Date.parse(row.expiresAt) ||
        keys.has(row.tokenId) || subjects.has(row.subjectId) || digests.has(row.digest)) rejectConfig()
    keys.add(row.tokenId); subjects.add(row.subjectId); digests.add(row.digest)
  }
  return value.invites
}
export function loadPolicy(env = process.env) {
  if (env.APP_ACCESS_MODE === 'development') {
    if (env.NODE_ENV === 'production' || env.MODEL_MODE !== 'stub') rejectConfig()
    return developmentPolicy()
  }
  if (env.APP_ACCESS_MODE !== 'invitation' || !isAbsolute(env.ACCESS_INVITES_FILE || '') ||
      !isAbsolute(env.SQLITE_PATH || '') || (env.ACCESS_HMAC_SECRET || '').length < 32) rejectConfig()
  let origin, limits
  try {
    origin = new URL(env.PUBLIC_ORIGIN)
    limits = JSON.parse(env.ACCESS_LIMITS)
  } catch { rejectConfig() }
  // Interim IP trial only: an explicitly acknowledged flag permits an http://
  // PUBLIC_ORIGIN (cleartext transport). Remove once a domain + TLS is in place.
  const insecure = env.ACCESS_ALLOW_INSECURE_ORIGIN === 'true'
  if (origin.origin !== env.PUBLIC_ORIGIN || (origin.protocol !== 'https:' && !insecure)) rejectConfig()
  for (const key of ['subjectDaily', 'globalDaily', 'subjectMinute', 'globalMinute', 'inFlight', 'redeemSource', 'redeemGlobal', 'endpointMinute']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > 1000000) rejectConfig()
  }
  try { new Intl.DateTimeFormat('en', { timeZone: limits.timeZone }).format() } catch { rejectConfig() }
  if (!limits.timeZone || !['none', 'single-proxy'].includes(env.ACCESS_PROXY_MODE)) rejectConfig()
  if (env.ACCESS_PROXY_MODE === 'single-proxy' && !isIP(env.ACCESS_PROXY_ADDRESS || '')) rejectConfig()
  try { readInvites(env.ACCESS_INVITES_FILE) } catch { rejectConfig() }
  return Object.freeze({ mode: 'invitation', origin: origin.origin, file: env.ACCESS_INVITES_FILE,
    secret: env.ACCESS_HMAC_SECRET, limits: Object.freeze(limits), proxy: env.ACCESS_PROXY_MODE, proxyAddress: env.ACCESS_PROXY_ADDRESS })
}

export function createAccess(db, policy, clock) {
  if (!policy || !['development', 'invitation'].includes(policy.mode)) rejectConfig()
  const controlled = policy.mode === 'invitation'
  db.exec(`CREATE TABLE IF NOT EXISTS invite_redemptions (
    tokenId TEXT PRIMARY KEY, subjectId TEXT NOT NULL, version INTEGER NOT NULL, digest TEXT NOT NULL UNIQUE,
    redeemedAt TEXT NOT NULL, UNIQUE(subjectId, version));
    CREATE TABLE IF NOT EXISTS visitor_access (
      visitorId TEXT PRIMARY KEY REFERENCES visitors(id) ON DELETE CASCADE,
      subjectId TEXT NOT NULL, tokenId TEXT NOT NULL, version INTEGER NOT NULL
    );`)
  function invites() {
    try { return readInvites(policy.file) } catch { throw new ControlError(503, 'access_unavailable') }
  }
  function active(row) {
    const now = clock().getTime()
    return row && row.enabled && now >= Date.parse(row.notBefore) && now < Date.parse(row.expiresAt)
  }
  return {
    controlled,
    digest(value) { return createHmac('sha256', policy.secret).update(value).digest('hex') },
    checkWrite(request) {
      if (!controlled) return
      if (request.headers.origin !== policy.origin) throw new ControlError(403, 'origin_denied')
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ControlError(415, 'json_required')
    },
    source(request) {
      let address = request.socket?.remoteAddress || 'unknown'
      if (policy.proxy === 'single-proxy') {
        if (address !== policy.proxyAddress || !isIP(request.headers['x-real-ip'] || '')) throw new ControlError(403, 'proxy_denied')
        address = request.headers['x-real-ip']
      }
      return controlled ? createHmac('sha256', policy.secret).update(address).digest('hex') : 'development'
    },
    authorize(visitorId) {
      if (!controlled) return visitorId
      const binding = db.prepare('SELECT * FROM visitor_access WHERE visitorId = ?').get(visitorId || '')
      const list = invites()
      const row = binding && list.find(row => row.tokenId === binding.tokenId && row.subjectId === binding.subjectId && row.version === binding.version)
      const redemption = binding && db.prepare('SELECT digest FROM invite_redemptions WHERE tokenId=? AND subjectId=? AND version=?').get(binding.tokenId, binding.subjectId, binding.version)
      const latest = binding && db.prepare('SELECT max(version) version FROM invite_redemptions WHERE subjectId=?').get(binding.subjectId)
      if (!active(row) || !redemption || redemption.digest !== row.digest || latest.version !== binding.version) throw new ControlError(403, 'invitation_required')
      return binding.subjectId
    },
    redeem(visitorId, token) {
      if (!controlled) return
      const digest = createHash('sha256').update(typeof token === 'string' && token.length <= 256 ? token : '').digest()
      const row = invites().find(row => timingSafeEqual(Buffer.from(row.digest, 'hex'), digest))
      if (!active(row)) throw new ControlError(403, 'invitation_required')
      const used = db.prepare('SELECT 1 FROM invite_redemptions WHERE tokenId = ? OR digest = ? OR (subjectId = ? AND version >= ?)')
        .get(row.tokenId, row.digest, row.subjectId, row.version)
      if (used) throw new ControlError(403, 'invitation_required')
      // Caller holds the same transaction that creates the visitor and thread.
      db.prepare('INSERT INTO invite_redemptions VALUES (?, ?, ?, ?, ?)').run(row.tokenId, row.subjectId, row.version, row.digest, clock().toISOString())
      db.prepare('INSERT INTO visitor_access VALUES (?, ?, ?, ?)').run(visitorId, row.subjectId, row.tokenId, row.version)
    },
  }
}
