// Local operator tool. Never invoke against a database without owner authorization.
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync, readFileSync, unlinkSync, realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

try {
  const [action, path, ...args] = process.argv.slice(2)
  if (!isAbsolute(path || '')) throw new Error('path')
  if (action === 'generate') {
    const [subjectId, versionText, tokenId, notBefore, expiresAt] = args
    const version = Number(versionText)
    if (!/^[\w-]{1,80}$/.test(subjectId || '') || !/^[\w-]{1,80}$/.test(tokenId || '') ||
        !Number.isSafeInteger(version) || version < 1 || !Number.isFinite(Date.parse(notBefore)) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(notBefore) >= Date.parse(expiresAt)) throw new Error('arguments')
    mkdirSync(path, { mode: 0o700 })
    if ((statSync(path).mode & 0o077) !== 0) throw new Error('directory permissions')
    const token = randomBytes(32).toString('hex')
    // New files only: never overwrite an earlier secret or silently rotate credentials.
    writeFileSync(join(path, 'invite-secret.txt'), token + '\n', { flag: 'wx', mode: 0o600 })
    writeFileSync(join(path, 'invite.json'), JSON.stringify({ invites: [{ subjectId, version, tokenId,
      digest: createHash('sha256').update(token).digest('hex'), enabled: true, maxRedemptions: 1, notBefore, expiresAt }] }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    console.log('invite_generated_to_private_files')
  } else if (action === 'takeover') {
    if (args[0] !== '--confirmed-old-process-stopped') throw new Error('confirmation')
    const lock = realpathSync(path) + '.instance-lock'
    const data = readFileSync(lock, 'utf8')
    const { pid } = JSON.parse(data)
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('pid')
    let running = true
    try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') running = false }
    if (running || readFileSync(lock, 'utf8') !== data) throw new Error('old process may be running')
    unlinkSync(lock)
    console.log('instance_lock_released_after_operator_confirmation')
  } else {
    if (!['inspect', 'enable', 'stop'].includes(action) || !statSync(path).isFile()) throw new Error('action')
    if (action !== 'inspect' && args[0] !== '--confirm-local-control') throw new Error('confirmation')
    const db = new DatabaseSync(path, { readOnly: action === 'inspect' })
    try {
      if (action === 'inspect') {
        const control = db.prepare('SELECT callsEnabled FROM runtime_control WHERE id=1').get()
        const { n } = db.prepare("SELECT count(*) n FROM call_attempts WHERE state IN ('reserved','timeout_pending')").get()
        console.log(JSON.stringify({ callsEnabled: !!control.callsEnabled, inFlight: n }))
      } else {
        db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE')
        try {
          if (db.prepare('UPDATE runtime_control SET callsEnabled=? WHERE id=1').run(action === 'enable' ? 1 : 0).changes !== 1) throw new Error('missing control')
          db.exec('COMMIT')
        } catch (error) { db.exec('ROLLBACK'); throw error }
        console.log(action === 'enable' ? 'model_calls_enabled' : 'model_calls_stopped')
      }
    } finally { db.close() }
  }
} catch {
  console.error('access_control_command_failed: check action, explicit confirmation, paths, permissions, configuration and process state; secrets are not printed')
  process.exitCode = 1
}
