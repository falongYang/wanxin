// Production preflight. Reuses the same access policy loader the server uses,
// plus structural checks (storage, instance lock, model mode). It only READS
// configuration and metadata; it never writes, never starts the server and
// never prints secrets.
import { loadPolicy } from '../../server/access.mjs'
import { accessSync, constants, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { acquireInstanceLock } from '../../server/instance-lock.mjs'

export function preflight(env = process.env, { cwd = process.cwd() } = {}) {
  const findings = []
  const ok = message => findings.push({ level: 'ok', message })
  const warn = message => findings.push({ level: 'warn', message })
  const fail = message => findings.push({ level: 'fail', message })
  const path = value => value && isAbsolute(value) ? value : (value ? resolve(cwd, value) : value)

  if (env.APP_ACCESS_MODE === 'development' && env.NODE_ENV === 'production') fail('development 模式不得与 NODE_ENV=production 组合')
  try {
    const policy = loadPolicy(env)
    ok(`准入策略：${policy.mode === 'invitation' ? '受控邀请' : '开发替身'}`)
    if (policy.mode === 'invitation') ok(`PUBLIC_ORIGIN=${policy.origin}`)
    if (policy.mode === 'development' && env.NODE_ENV === 'production') fail('development 模式不得与 NODE_ENV=production 组合')
    if (policy.mode === 'invitation' && policy.origin.startsWith('http:')) {
      warn('HTTP Origin（临时 IP 试用）：邀请令牌与内容明文传输；上域名+TLS 后必须移除 ACCESS_ALLOW_INSECURE_ORIGIN')
      if (env.NODE_ENV === 'production') fail('HTTP Origin 与 NODE_ENV=production 冲突：Secure Cookie 在 HTTP 下会被浏览器丢弃，登录将失效')
    }
  } catch (error) {
    fail('准入配置校验失败：' + String(error?.message ?? error))
  }

  const mode = env.MODEL_MODE || ''
  const dbPath = path(env.SQLITE_PATH || 'data/wanxin.sqlite')
  if (env.NODE_ENV === 'production' && mode === 'stub') fail('生产环境不得使用 MODEL_MODE=stub（测试替身）')
  if (mode === 'stub') warn('MODEL_MODE=stub（测试替身），生产真实回复必须切换真实模型')
  if (mode !== 'stub') {
    if (!env.MODEL_API_URL) fail('缺少 MODEL_API_URL')
    if (!env.MODEL_NAME) fail('缺少 MODEL_NAME')
    if (mode !== 'ollama' && !env.MODEL_API_KEY) fail('非 ollama 模式缺少 MODEL_API_KEY')
  }

  if (env.NODE_ENV !== 'production') warn('NODE_ENV 非 production：Secure Cookie 不会启用')

  try {
    mkdirSync(dirname(dbPath), { recursive: true })
    accessSync(dirname(dbPath), constants.W_OK | constants.R_OK | constants.X_OK)
  } catch (error) {
    fail('数据库目录不可创建/访问：' + String(error.message ?? error))
  }

  let lock
  try {
    lock = acquireInstanceLock(dbPath)
    ok(`SQLite 可读写且单实例锁可获取（${dbPath}）`)
  } catch (error) {
    fail('实例锁/SQLite 不可用：' + String(error.message ?? error))
  } finally {
    if (lock) { try { lock() } catch { /* ignore */ } }
  }

  if (dbPath !== ':memory:') {
    try {
      const handle = new DatabaseSync(dbPath)
      const row = handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='control_schema'").get()
      ok(row ? '数据库存在受控模式表' : '数据库尚未初始化受控表（首次启动会创建）')
      handle.close()
    } catch (error) {
      fail('无法打开 SQLite：' + String(error.message ?? error))
    }
  }

  const failed = findings.filter(finding => finding.level === 'fail')
  return { ok: failed.length === 0, failed: failed.length, findings }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = preflight()
  for (const finding of result.findings) console.log(`[${finding.level.toUpperCase()}] ${finding.message}`)
  process.exitCode = result.ok ? 0 : 1
}