import { openSync, writeFileSync, closeSync, unlinkSync } from 'node:fs'
import { realpathSync, existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'

export function acquireInstanceLock(filename) {
  const canonical = existsSync(filename) ? realpathSync(filename) : join(realpathSync(dirname(filename)), basename(filename))
  const path = canonical + '.instance-lock'
  let fd
  try { fd = openSync(path, 'wx', 0o600) } catch { throw new Error('Instance lock exists or unavailable; confirm old process stopped before manual takeover') }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })) }
  catch (error) { closeSync(fd); unlinkSync(path); throw error }
  let released = false
  return () => {
    if (released) return
    released = true
    closeSync(fd)
    unlinkSync(path)
  }
}
