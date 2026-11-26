// Uses built assets and isolated mocked HTTP responses; no server or existing DB.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true })
try {
  for (const status of [403, 429, 503]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    let admitted = false
    let requests = []
    let admissionBody
    const opening = { id: 'opening', role: 'assistant', content: '合成开场', requestId: null, status: 'complete' }
    await page.route('https://trial.example/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/session') {
        if (route.request().method() === 'POST') { admissionBody = route.request().postDataJSON(); admitted = true }
        return route.fulfill({ json: { accessRequired: true, threadId: admitted ? 'thread' : null } })
      }
      if (path === '/api/thread') return route.fulfill({ json: { messages: [opening] } })
      if (path === '/api/messages') {
        const body = route.request().postDataJSON()
        requests.push(body)
        if (requests.length === 1) return route.fulfill({ status, headers: { 'Retry-After': '9' },
          json: { code: status === 403 ? 'invitation_required' : status === 429 ? 'rate_limited' : 'calls_stopped', error: '合成受控拒绝' } })
        return route.fulfill({ json: { messages: [opening, { id: 'user', role: 'user', content: body.text, requestId: body.requestId, status: 'complete' }] } })
      }
      const file = resolve('dist', path === '/' ? 'index.html' : '.' + path)
      if (!file.startsWith(resolve('dist') + '/')) throw new Error('Invalid asset path')
      return route.fulfill({ body: await readFile(file), contentType: extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html' })
    })
    await page.goto('https://trial.example/')
    const token = 'synthetic-token-not-real'
    await page.getByRole('textbox', { name: '邀请码', exact: true }).fill(token)
    await page.getByRole('button', { name: '我已年满 18 岁', exact: true }).click()
    assert.equal(admissionBody.inviteToken, token)
    await page.getByRole('button', { name: /和林舟聊天/ }).click()
    const input = page.getByRole('textbox', { name: '消息', exact: true })
    await input.fill('拒绝后保留的合成输入')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '合成受控拒绝' }).waitFor()
    assert.equal(await input.inputValue(), '拒绝后保留的合成输入')
    assert.equal(requests.length, 1)
    assert.equal(await page.evaluate(value => JSON.stringify(localStorage).includes(value) || JSON.stringify(sessionStorage).includes(value), token), false)
    if (status === 403) {
      await page.getByRole('button', { name: '重新确认邀请', exact: true }).click()
      assert.equal(await page.getByRole('textbox', { name: '邀请码', exact: true }).inputValue(), '')
      assert.equal(requests.length, 1)
    } else {
      if (status === 429) assert.ok((await page.getByRole('alert').innerText()).includes('9 秒'))
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await page.getByRole('button', { name: '消息操作', exact: true }).waitFor()
      assert.equal(requests.length, 2)
      assert.equal(requests[0].requestId, requests[1].requestId)
      assert.equal(await input.inputValue(), '')
    }
    await context.close()
  }
  console.log('通过：邀请POST/清空与不持久化；403/429/503保留原文，无自动重发；429/503手动重试沿用requestId。')
} finally { await browser.close() }
