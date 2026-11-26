import { ControlError } from './access.mjs'
const events = new Set(['startup', 'request', 'model_success', 'model_error', 'model_timeout', 'control_error'])
const routes = new Set(['session', 'messages', 'preview', 'cards', 'thread', 'weather', 'other'])
const codes = new Set(['origin_denied', 'json_required', 'invitation_required', 'access_unavailable', 'proxy_denied',
  'clock_unavailable', 'calls_stopped', 'capacity_limit', 'rate_limited', 'daily_limit', 'operation_denied', 'log_unavailable'])
export function createTelemetry(sink = line => process.stdout.write(line + '\n')) {
  let healthy = true
  return {
    ensure() { if (!healthy) throw new ControlError(503, 'log_unavailable') },
    emit(value) {
      const record = { time: new Date().toISOString(), event: events.has(value.event) ? value.event : 'control_error' }
      if (routes.has(value.route)) record.route = value.route
      if (Number.isInteger(value.status) && value.status >= 100 && value.status <= 599) record.status = value.status
      if (Number.isFinite(value.durationMs)) record.durationMs = Math.max(0, Math.round(value.durationMs))
      if (codes.has(value.code)) record.code = value.code
      if (!healthy) return
      try { sink(JSON.stringify(record)) } catch {
        healthy = false
        try { process.stderr.write('runtime_log_unavailable\n') } catch { /* Never print sink errors. */ }
      }
    },
  }
}
export function routeCategory(url) {
  if (url === '/api/session') return 'session'
  if (url === '/api/messages') return 'messages'
  if (url === '/api/card-preview') return 'preview'
  if (/^\/api\/cards(?:\/[^/]+)?$/.test(url)) return 'cards'
  if (url === '/api/thread') return 'thread'
  if (url.startsWith('/api/weather/')) return 'weather'
  return 'other'
}
