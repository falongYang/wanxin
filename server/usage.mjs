import { randomUUID } from 'node:crypto'
import { ControlError } from './access.mjs'

export function createUsage(db, policy, clock) {
  const controlled = policy.mode === 'invitation'
  db.exec(`CREATE TABLE IF NOT EXISTS runtime_control (id INTEGER PRIMARY KEY CHECK(id=1), callsEnabled INTEGER NOT NULL DEFAULT 0, maxClock INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO runtime_control(id) VALUES (1);
    CREATE TABLE IF NOT EXISTS call_daily (scope TEXT NOT NULL, subject TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(scope, subject, day));
    CREATE TABLE IF NOT EXISTS control_rates (key TEXT NOT NULL, windowStart INTEGER NOT NULL, expiresAt INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(key, windowStart));
    CREATE TABLE IF NOT EXISTS call_attempts (id TEXT PRIMARY KEY, subject TEXT NOT NULL, requestHash TEXT NOT NULL, operation TEXT NOT NULL,
      day TEXT NOT NULL, state TEXT NOT NULL, startedAt TEXT NOT NULL, finishedAt TEXT);
    CREATE INDEX IF NOT EXISTS call_attempt_state ON call_attempts(state);`)
  // Safe only after the single-instance lock is acquired, never as a live cleanup.
  db.prepare("UPDATE call_attempts SET state='unknown', finishedAt=? WHERE state IN ('reserved','timeout_pending')").run(clock().toISOString())
  function checkClock() {
    const now = clock().getTime()
    const last = db.prepare('SELECT maxClock FROM runtime_control WHERE id=1').get().maxClock
    if (!Number.isFinite(now) || now < last) throw new ControlError(503, 'clock_unavailable')
    db.prepare('UPDATE runtime_control SET maxClock=? WHERE id=1').run(now)
    return now
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  function rate(key, max, duration) {
    const now = checkClock()
    const start = Math.floor(now / duration) * duration
    const used = db.prepare('SELECT count FROM control_rates WHERE key=? AND windowStart=?').get(key, start)?.count || 0
    if (used >= max) throw new ControlError(429, 'rate_limited', Math.max(1, Math.ceil((start + duration - now) / 1000)))
    db.prepare('INSERT INTO control_rates VALUES (?, ?, ?, 1) ON CONFLICT(key,windowStart) DO UPDATE SET count=count+1').run(key, start, start + duration)
    db.prepare('DELETE FROM control_rates WHERE expiresAt <= ?').run(now)
  }
  function daily(scope, subject, day, max) {
    const used = db.prepare('SELECT used FROM call_daily WHERE scope=? AND subject=? AND day=?').get(scope, subject, day)?.used || 0
    if (used >= max) throw new ControlError(429, 'daily_limit', 60)
    db.prepare('INSERT INTO call_daily VALUES (?, ?, ?, 1) ON CONFLICT(scope,subject,day) DO UPDATE SET used=used+1').run(scope, subject, day)
  }
  return {
    transaction,
    redeemRate(source) {
      if (controlled) transaction(() => {
        rate('redeem-source:' + source, policy.limits.redeemSource, 600000)
        rate('redeem-global', policy.limits.redeemGlobal, 600000)
      })
    },
    endpointRate(subject) {
      if (controlled) transaction(() => rate('endpoint:' + subject, policy.limits.endpointMinute, 60000))
    },
    reserve(subject, requestHash, operation = 'message') {
      if (!controlled) return null
      if (!['message', 'preview', 'moment', 'letter', 'care', 'memory'].includes(operation)) throw new ControlError(503, 'operation_denied')
      checkClock()
      if (!db.prepare('SELECT callsEnabled FROM runtime_control WHERE id=1').get().callsEnabled) throw new ControlError(503, 'calls_stopped')
      const active = db.prepare("SELECT count(*) n FROM call_attempts WHERE state IN ('reserved','timeout_pending')").get().n
      if (active >= policy.limits.inFlight) throw new ControlError(429, 'capacity_limit', 5)
      rate('model-subject:' + subject, policy.limits.subjectMinute, 60000)
      rate('model-global', policy.limits.globalMinute, 60000)
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: policy.limits.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock())
      daily('subject', subject, day, policy.limits.subjectDaily)
      daily('global', '*', day, policy.limits.globalDaily)
      const id = randomUUID()
      db.prepare("INSERT INTO call_attempts VALUES (?, ?, ?, ?, ?, 'reserved', ?, NULL)").run(id, subject, requestHash, operation, day, clock().toISOString())
      return id
    },
    timeout(id) {
      if (id) db.prepare("UPDATE call_attempts SET state='timeout_pending' WHERE id=? AND state='reserved'").run(id)
    },
    settle(id, state) {
      if (!id) return
      if (!['success', 'error'].includes(state)) throw new Error('Invalid attempt outcome')
      db.prepare("UPDATE call_attempts SET state=CASE WHEN state='timeout_pending' THEN 'timeout' ELSE ? END, finishedAt=? WHERE id=? AND state IN ('reserved','timeout_pending')")
        .run(state, clock().toISOString(), id)
    },
  }
}
