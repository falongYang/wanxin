// Real built UI + isolated synthetic HTTP. No server, model or existing DB.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true })
const output = process.env.UI_SCREENSHOTS || 'docs/verification/card-library-screenshots'
const make = (id, createdAt, title, body) => ({ id, createdAt, title, body, sourceMessageId: 'source-' + id, sourceContent: '合成来源 ' + id })
const original = [
  make('b', '2026-10-31T16:00:00Z', 'Radio里的海风', '我们把今晚的灯光留了下来。'),
  make('a', '2026-10-31T16:00:00Z', '海风 Radio', '一封写给深夜的信。'),
  make('oct', '2026-10-31T15:59:59Z', '十月的海风', '月末的一个安静片段。'),
  ...Array.from({ length: 12 }, (_, i) => make('old-' + String(i).padStart(2, '0'), '2026-09-20T00:00:00Z', `海风来信 ${i + 1}`, '海边的日常，值得慢慢回看。')),
]
try {
  await mkdir(output, { recursive: true })
  for (const [width, height] of [[390, 844], [320, 740], [1280, 900]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    page.setDefaultTimeout(6000)
    let rows = structuredClone(original)
    let failNextOpen = 0
    const requests = []
    const faults = []
    page.on('pageerror', error => faults.push(error.message))
    const opening = { id: 'opening', role: 'assistant', content: '【合成HTTP】电台的灯还亮着。', requestId: null, status: 'complete' }
    await page.route('https://trial.example/**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      if (path.startsWith('/api/')) requests.push({ url: url.href, method: request.method(), body: request.postData() })
      if (path === '/api/session') return route.fulfill({ json: { threadId: 'synthetic-thread', accessRequired: false } })
      if (path === '/api/thread') return route.fulfill({ json: { messages: [opening, ...rows.map(row => ({ id: row.sourceMessageId, role: 'user', content: row.sourceContent, status: 'complete', requestId: null }))] } })
      if (path === '/api/cards') return route.fulfill({ json: { cards: rows } })
      if (path.startsWith('/api/cards/')) {
        const id = decodeURIComponent(path.slice('/api/cards/'.length))
        const row = rows.find(row => row.id === id)
        if (request.method() === 'GET' && failNextOpen) {
          const status = failNextOpen
          failNextOpen = 0
          return route.fulfill({ status, json: { error: '合成详情读取失败', code: status === 403 ? 'invitation_required' : 'access_unavailable' } })
        }
        if (!row) return route.fulfill({ status: 404, json: {} })
        if (request.method() === 'PATCH') Object.assign(row, request.postDataJSON())
        if (request.method() === 'DELETE') { rows = rows.filter(item => item.id !== id); return route.fulfill({ json: {} }) }
        return route.fulfill({ json: { card: row } })
      }
      if (path.startsWith('/api/')) throw new Error('Unexpected API: ' + path)
      const file = resolve('dist', path === '/' ? 'index.html' : '.' + path)
      if (!file.startsWith(resolve('dist') + '/')) throw new Error('Invalid asset')
      return route.fulfill({ body: await readFile(file), contentType: extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html' })
    })
    const button = name => page.getByRole('button', { name, exact: true })
    const search = () => page.getByRole('searchbox', { name: '寻找一个片段', exact: true })
    const waitList = async () => { await search().waitFor(); await page.waitForFunction(() => !document.querySelector('.album-actions button')?.disabled) }
    const shot = async name => {
      await page.waitForFunction(() => !document.querySelector('.album-actions button')?.disabled)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '横向溢出')
      assert.deepEqual(await page.locator('button:visible,input:visible').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().height < 43.5).map(el => el.tagName)), [])
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: false })
    }
    await page.goto('https://trial.example/')
    await button('和林舟聊天').click()
    await button('共同经历').click()
    await waitList()
    assert.equal(await page.locator('.card-list-item').count(), 15)
    assert.deepEqual(await page.locator('.card-month').evaluateAll(groups => groups.map(group => group.getAttribute('aria-label'))), ['2026年11月', '2026年10月', '2026年09月'])
    assert.deepEqual(await page.locator('.card-list-item').evaluateAll(cards => cards.slice(0, 2).map(card => card.id)), ['card-a', 'card-b'])
    await shot('grouped')
    const beforeSearch = requests.length
    await search().fill(' rADio ')
    assert.equal(await page.locator('.card-list-item').count(), 2)
    await shot('search')
    await search().fill('   ')
    assert.equal(await page.locator('.card-list-item').count(), 15)
    await search().fill('SEARCH_PRIVATE_海风')
    await page.getByText('没有找到这个片段，换个关键词或清空搜索试试。').waitFor()
    assert.equal(requests.length, beforeSearch)
    assert.ok(!JSON.stringify(requests).includes('SEARCH_PRIVATE'))
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('SEARCH_PRIVATE') || JSON.stringify(sessionStorage).includes('SEARCH_PRIVATE')), false)
    await shot('no-results')
    await button('清空搜索').click()
    assert.equal(await search().inputValue(), '')
    assert.ok(await search().evaluate(el => el === document.activeElement))

    // Preserve a real nonzero document scroll offset and focus after a detail round trip.
    await search().fill(' 海风 ')
    failNextOpen = 503
    await page.locator('#card-a').click()
    await page.getByRole('alert').filter({ hasText: '合成详情读取失败' }).waitFor()
    await waitList()
    assert.equal(await search().inputValue(), ' 海风 ')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'card-a', '读取失败应回到来源按钮')
    const target = page.locator('.card-list-item').nth(8)
    const targetId = await target.getAttribute('id')
    await target.scrollIntoViewIfNeeded()
    const top = await page.evaluate(() => scrollY)
    assert.ok(top > 0)
    await target.click()
    await button('查看来源').waitFor()
    await button('返回').click()
    await waitList()
    assert.equal(await search().inputValue(), ' 海风 ')
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - top) <= 2, '列表滚动位置未恢复')
    assert.equal(await page.evaluate(() => document.activeElement?.id), targetId)

    // Editing a card out of the result set moves focus to a surviving neighbour.
    await page.locator('#' + targetId).click()
    await button('编辑').click()
    await page.getByRole('textbox', { name: '标题', exact: true }).fill('已改写的片段')
    await page.getByRole('textbox', { name: '正文', exact: true }).fill('这里已经没有原先的关键词。')
    await button('保存修改').click()
    await button('查看来源').waitFor()
    await button('返回').click()
    await waitList()
    assert.equal(await page.locator('.card-list-item').count(), 14)
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), targetId)
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('card-list-item')))

    await search().fill('Radio')
    await page.locator('#card-a').click()
    page.once('dialog', dialog => dialog.dismiss())
    await button('删除卡片').click()
    assert.ok(rows.some(row => row.id === 'a'))
    page.once('dialog', dialog => dialog.accept())
    await button('删除卡片').click()
    await waitList()
    assert.equal(await page.locator('.card-list-item').count(), 1)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'card-b')
    await page.locator('#card-b').click()
    // The existing continuation path must load the latest server card and never auto-send.
    rows.find(row => row.id === 'b').title = '最新的Radio片段'
    await button('从这里继续聊').click()
    await page.locator('.reference').filter({ hasText: '最新的Radio片段' }).waitFor()
    assert.equal(requests.filter(row => row.url.includes('/api/messages')).length, 0)
    await button('移除引用').click()
    await button('共同经历').click()
    await waitList()
    assert.equal(await search().inputValue(), 'Radio')
    await page.locator('#card-b').click()
    await button('查看来源').click()
    await page.locator('.source-highlight').waitFor()
    assert.ok((await page.locator('.source-highlight').innerText()).includes('合成来源 b'))
    await button('共同经历').click()
    await waitList()
    await page.locator('#card-b').click()
    page.once('dialog', dialog => dialog.accept())
    await button('删除卡片').click()
    await waitList()
    assert.equal(await page.locator('.card-list-item').count(), 0)
    assert.ok(await search().evaluate(el => el === document.activeElement))
    assert.equal(await search().inputValue(), 'Radio')
    await button('清空搜索').click()
    assert.equal(await page.locator('.card-list-item').count(), 13)

    // Refresh resets only in-memory query; an actually empty collection gets its own state.
    failNextOpen = 403
    await page.locator('.card-list-item').first().click()
    await button('重新确认邀请').waitFor()
    assert.equal(await page.locator('.card-list-item').count(), 13)
    await search().fill('不保存的查询')
    rows = []
    await page.reload()
    await button('和林舟聊天').click()
    await button('共同经历').click()
    await waitList()
    assert.equal(await search().inputValue(), '')
    await page.getByText('这里会收好你与林舟的片段。', { exact: false }).waitFor()
    assert.equal(await page.getByText('没有找到这个片段，换个关键词或清空搜索试试。').count(), 0)
    await shot('empty')
    assert.deepEqual(faults, [])
    await context.close()
  }
  console.log('通过：搜索隐私/匹配、上海分月稳定排序、返回查询/滚动/焦点、编辑/删除更新、续聊/来源、三视口与空态。')
} finally { await browser.close() }
