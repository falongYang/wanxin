import { DatabaseSync } from 'node:sqlite'
import { trialMetrics, RETENTION_MS } from '../server/analytics.mjs'

const filename = process.argv[2]
if (!filename) throw new Error('Usage: node scripts/trial-metrics.mjs <sqlite-path> [as-of-ISO]')
const asOf = process.argv[3] ? new Date(process.argv[3]) : new Date()
if (!Number.isFinite(asOf.getTime())) throw new Error('Invalid as-of timestamp')
const db = new DatabaseSync(filename, { readOnly: true })
try {
  const events = db.prepare('SELECT analysisId, event, occurredAt FROM trial_events WHERE occurredAt > ? AND occurredAt <= ?')
    .all(new Date(asOf.getTime() - RETENTION_MS).toISOString(), asOf.toISOString())
  console.log(JSON.stringify({ asOf: asOf.toISOString(), windowStartExclusive: new Date(asOf.getTime() - RETENTION_MS).toISOString(), retentionDays: 7, ...trialMetrics(events, asOf) }, null, 2))
} finally { db.close() }
