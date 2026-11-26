import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixture } from './helpers/access-fixture.mjs'
import { preflight } from '../scripts/deploy/healthcheck.mjs'

test('开发替身配置仅告警不失败', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wanxin-preflight-'))
  try {
    const env = { APP_ACCESS_MODE: 'development', MODEL_MODE: 'stub', SQLITE_PATH: join(dir, 'dev.sqlite') }
    const result = preflight(env)
    assert.equal(result.ok, true)
    assert.ok(result.findings.some(finding => finding.level === 'warn' && finding.message.includes('MODEL_MODE=stub')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('缺真实模型配置时健康检查失败', t => {
  const f = fixture(t)
  const env = { ...f.env, MODEL_MODE: 'ollama', NODE_ENV: 'production' } // 无 MODEL_API_URL/NAME
  const result = preflight(env)
  assert.equal(result.ok, false)
  assert.ok(result.findings.some(finding => finding.message.includes('缺少 MODEL_API_URL')))
})

test('生产环境不允许测试替身 stub', t => {
  const f = fixture(t)
  const result = preflight({ ...f.env, NODE_ENV: 'production' }) // fixture 默认 stub
  assert.equal(result.ok, false)
  assert.ok(result.findings.some(finding => finding.message.includes('生产环境不得使用 MODEL_MODE=stub')))
})

test('development 模式叠加 production 会被拒绝', () => {
  const env = { APP_ACCESS_MODE: 'development', MODEL_MODE: 'stub', NODE_ENV: 'production' }
  const result = preflight(env)
  assert.equal(result.ok, false)
  assert.ok(result.findings.some(finding => finding.message.includes('development 模式不得与')))
})

test('HTTP Origin 临时部署给出告警，与 production Cookie 冲突时报错', t => {
  const f = fixture(t)
  const base = { ...f.env, PUBLIC_ORIGIN: 'http://101.42.26.83', ACCESS_ALLOW_INSECURE_ORIGIN: 'true', MODEL_MODE: 'ollama',
    MODEL_API_URL: 'http://127.0.0.1:11434/api/chat', MODEL_NAME: 'qwen3.5:4b' }
  const warnOnly = preflight(base)
  assert.equal(warnOnly.ok, true)
  assert.ok(warnOnly.findings.some(finding => finding.level === 'warn' && finding.message.includes('HTTP Origin')))
  const withProduction = preflight({ ...base, NODE_ENV: 'production' })
  assert.equal(withProduction.ok, false)
  assert.ok(withProduction.findings.some(finding => finding.message.includes('Secure Cookie')))
})