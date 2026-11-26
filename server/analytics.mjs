import { randomUUID } from 'node:crypto'

export const RETENTION_MS = 7 * 86400000
export function createAnalytics(db, clock = () => new Date()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_visitors (
      visitorId TEXT PRIMARY KEY REFERENCES visitors(id) ON DELETE CASCADE,
      analysisId TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS trial_events (
      analysisId TEXT NOT NULL REFERENCES analytics_visitors(analysisId) ON DELETE CASCADE,
      event TEXT NOT NULL CHECK(event IN ('send','first_send','card_preview','card_save','card_open','card_send')),
      occurredAt TEXT NOT NULL
    );
  `)
  // SQLite CHECK constraints require a table rebuild for existing installations.
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'trial_events'").get().sql
  if (!schema.includes("'send'")) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`CREATE TABLE trial_events_next (
        analysisId TEXT NOT NULL REFERENCES analytics_visitors(analysisId) ON DELETE CASCADE,
        event TEXT NOT NULL CHECK(event IN ('send','first_send','card_preview','card_save','card_open','card_send')),
        occurredAt TEXT NOT NULL
      );
      INSERT INTO trial_events_next SELECT analysisId, event, occurredAt FROM trial_events ORDER BY rowid;
      DROP TABLE trial_events;
      ALTER TABLE trial_events_next RENAME TO trial_events;`)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS trial_events_time ON trial_events(occurredAt);
    CREATE INDEX IF NOT EXISTS trial_events_visitor ON trial_events(analysisId, event, occurredAt);
    CREATE UNIQUE INDEX IF NOT EXISTS trial_first_send ON trial_events(analysisId) WHERE event = 'first_send';
  `)
  const prune = () => db.prepare('DELETE FROM trial_events WHERE occurredAt <= ?')
    .run(new Date(clock().getTime() - RETENTION_MS).toISOString())
  prune()
  return {
    prune,
    record(visitorId, event) {
      prune()
      db.prepare('INSERT INTO analytics_visitors VALUES (?, ?) ON CONFLICT(visitorId) DO NOTHING').run(visitorId, randomUUID())
      const { analysisId } = db.prepare('SELECT analysisId FROM analytics_visitors WHERE visitorId = ?').get(visitorId)
      db.prepare('INSERT OR IGNORE INTO trial_events VALUES (?, ?, ?)').run(analysisId, event, clock().toISOString())
    },
  }
}

// Inputs are already restricted to the event table's three allowlisted fields.
export function trialMetrics(events, asOf = new Date()) {
  const day = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 10)
  const end = new Date(asOf).getTime()
  if (!Number.isFinite(end)) throw new Error('Invalid as-of timestamp')
  const start = end - RETENTION_MS
  const groups = new Map()
  for (const event of events) {
    const timestamp = new Date(event.occurredAt).getTime()
    if (!(timestamp > start && timestamp <= end)) continue
    if (!groups.has(event.analysisId)) groups.set(event.analysisId, [])
    groups.get(event.analysisId).push(event)
  }
  let senders = 0, savers = 0, matureSavers = 0, returners = 0, openers = 0, converters = 0, windowSavingVisitors = 0
  for (const rows of groups.values()) {
    const times = name => rows.filter(row => row.event === name).map(row => row.occurredAt).sort()
    const firstSend = times('send')[0]
    const save = times('card_save').find(time => firstSend && time >= firstSend)
    const opens = times('card_open')
    if (firstSend) senders++
    if (save) savers++
    const firstSave = times('card_save')[0]
    if (firstSave) {
      windowSavingVisitors++
      const nextDay = day(new Date(new Date(firstSave).getTime() + 86400000))
      if (day(asOf) > nextDay) {
        matureSavers++
        if (opens.some(time => day(time) === nextDay)) returners++
      }
    }
    if (opens.length) {
      openers++
      if (times('card_send').some(time => time >= opens[0])) converters++
    }
  }
  const metric = (numerator, denominator) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null })
  return {
    windowSavingVisitors,
    senderSaveRate: metric(savers, senders),
    saverNextDayReturnRate: metric(returners, matureSavers),
    openToSendRate: metric(converters, openers),
  }
}
