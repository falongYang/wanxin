// Built assets + synthetic HTTP, independent of shared servers and databases.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true })
const output = process.env.UI_SCREENSHOTS || 'docs/verification/merge-screenshots'
try {
  await mkdir(output, { recursive: true })
  for (const [width, height] of [[390, 844], [320, 740], [1280, 900]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    page.setDefaultTimeout(6000)
    const faults = []
    page.on('pageerror', error => faults.push(error.message))
    const messages = [
      { id: 'opening', role: 'assistant', content: '【合成HTTP】今晚的电台。', status: 'complete', pinned: 0 },
      { id: 'user', role: 'user', content: '今天听见海风。', status: 'complete', requestId: 'synthetic-send', pinned: 0 },
      { id: 'reply', role: 'assistant', content: '海风留在电台，慢慢听。', status: 'complete', contextCount: 1, pinned: 0 },
    ]
    const cards = [
      { id: 'card', sourceMessageId: 'user', title: '海风来信', body: '一起留下的电台片段。', createdAt: '2026-11-01T00:00:00Z' },
      { id: 'older', sourceMessageId: 'user', title: '十月灯光', body: '回看另一个月份。', createdAt: '2026-10-01T00:00:00Z' },
    ]
    let failPin = false
    let modelSends = 0
    await page.route('https://trial.example/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path === '/api/session') return route.fulfill({ json: { threadId: 'synthetic', accessRequired: false } })
      if (path === '/api/thread') return route.fulfill({ json: { messages } })
      if (path.startsWith('/api/pins/')) {
        if (failPin) return route.fulfill({ status: 403, json: { code: 'invitation_required', error: '合成邀请失效' } })
        const row = messages.find(row => row.id === path.split('/').at(-1))
        row.pinned = request.method() === 'PUT' ? 1 : 0
        return route.fulfill({ json: { messages } })
      }
      if (path === '/api/cards') return route.fulfill({ json: { cards } })
      if (path.startsWith('/api/cards/')) return route.fulfill({ json: { card: { ...cards.find(row => row.id === path.split('/').at(-1)), sourceContent: messages[1].content } } })
      if (path === '/api/messages') { modelSends++; throw new Error('Unexpected automatic send') }
      if (path.startsWith('/api/')) throw new Error('Unexpected API')
      const file = resolve('dist', path === '/' ? 'index.html' : '.' + path)
      if (!file.startsWith(resolve('dist') + '/')) throw new Error('Invalid asset')
      return route.fulfill({ body: await readFile(file), contentType: extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html' })
    })
    const button = name => page.getByRole('button', { name, exact: true })
    const shot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `${output}/${name}-${width}.png` })
    }
    await page.goto('https://trial.example/')
    await button('和林舟聊天').click()
    await page.getByText('回复已收到', { exact: true }).waitFor()
    await page.getByText('回复过程', { exact: true }).click()
    await page.getByText('读取本次消息及 1 条近期消息', { exact: true }).waitFor()
    await page.locator('.history-drawer summary').click()
    const search = page.getByRole('searchbox', { name: '搜索聊天记录', exact: true })
    await search.fill(' 海风 ')
    await page.locator('.drawer-panel').getByRole('button', { name: '置顶', exact: true }).first().click()
    await page.locator('.drawer-panel').getByRole('button', { name: '取消置顶', exact: true }).waitFor()
    await search.fill('')
    assert.equal(await page.getByRole('list', { name: '置顶消息', exact: true }).locator('li').count(), 1)
    await shot('drawer')
    await button('海风留在电台，慢慢听。').click()
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'message-reply')
    assert.equal(await page.locator('.history-drawer').getAttribute('open'), null)
    await button('共同经历').click()
    await page.getByRole('searchbox', { name: '寻找一个片段', exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.album-actions button')?.disabled)
    assert.equal(await page.locator('.card-month').count(), 2)
    assert.equal(await page.locator('.lantern-river .card-list-item').count(), 2)
    await shot('river')
    await page.getByRole('searchbox', { name: '寻找一个片段', exact: true }).fill(' 海风 ')
    await page.locator('#card-card').click()
    await button('查看来源').waitFor()
    await button('返回').click()
    await page.waitForFunction(() => !document.querySelector('.album-actions button')?.disabled)
    assert.equal(await page.getByRole('searchbox', { name: '寻找一个片段', exact: true }).inputValue(), ' 海风 ')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'card-card')
    await button('返回').click()
    await page.locator('.history-drawer summary').click()
    failPin = true
    await page.locator('.drawer-panel').getByRole('button', { name: '取消置顶', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '合成邀请失效' }).waitFor()
    await button('重新确认邀请').waitFor()
    assert.equal(modelSends, 0)
    assert.equal(messages[2].pinned, 1)
    assert.deepEqual(faults, [])
    await context.close()
  }
  console.log('通过：三视口会话抽屉/搜索/置顶/定位、活动说明、河灯分组及返回查询焦点、置顶403恢复；无自动模型发送。')
} finally { await browser.close() }
