// Install Playwright separately, then set PLAYWRIGHT_MODULE to its ESM entry.
// Uses an isolated browser identity against a MODEL_MODE=stub preview server.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()
page.setDefaultTimeout(8000)
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173'
const output = process.env.UI_SCREENSHOTS || 'docs/verification/screenshots'
const faults = []
page.on('pageerror', error => faults.push(error.message))
const button = name => page.getByRole('button', { name, exact: true })
const message = () => page.getByRole('textbox', { name: '消息', exact: true })
async function screenshot(name) {
  const screens = {
    gate: '.intro button', discover: '.radio-scene', 'empty-cards': '.album',
    preview: '.card-form input', source: '.source-highlight', card: '.letter-body',
    cards: '.card-list-item', chat: '.chat', 'long-chat': '.chat', 'edited-card': '.letter-body', 'message-menu': '[role="menu"]',
  }
  await page.locator(screens[name]).first().waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('.chat-header button, .album-actions > button, .intro > button')?.disabled)
  for (const [width, height] of [[390, 844], [1280, 900], [320, 740]]) {
    await page.setViewportSize({ width, height })
    if (name === 'message-menu') {
      assert.ok(await page.locator('.history').evaluate(el => el.scrollWidth <= el.clientWidth), '消息区不应有横向溢出')
      await page.getByRole('menuitem').scrollIntoViewIfNeeded()
      assert.ok(await page.getByRole('menuitem').evaluate(el => {
        const rect = el.getBoundingClientRect()
        const panel = el.closest('.history').getBoundingClientRect()
        return rect.left >= panel.left && rect.right <= panel.right && rect.top >= panel.top && rect.bottom <= panel.bottom
      }), '菜单操作必须完整位于消息区内')
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' 页面横向溢出 ' + width)
    const undersized = await page.locator('button:visible, summary:visible').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().height < 43.5).map(el => el.textContent))
    assert.deepEqual(undersized, [], name + ' 触控区域不足')
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
}
async function send(text) {
  await message().fill(text)
  await button('发送').click()
  await page.locator('.bubble.user').filter({ hasText: text }).locator('.message-trigger').waitFor()
}
async function previewLast() {
  await page.getByRole('button', { name: '消息操作', exact: true }).last().click()
  await page.getByRole('menuitem', { name: '做成经历卡' }).click()
  await button('收藏').waitFor({ state: 'visible' })
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(el => el.textContent === '收藏')?.disabled)
}
async function cards() {
  const response = await context.request.get(base + '/api/cards')
  return (await response.json()).cards
}
async function openFirstCard() {
  await button('共同经历').click()
  await page.locator('.card-list-item').first().click()
  await button('查看来源').waitFor()
}
try {
  await mkdir(output, { recursive: true })
  await page.goto(base)
  await button('我已年满 18 岁').waitFor()
  await screenshot('gate')
  await button('我已年满 18 岁').click()
  await page.getByRole('button', { name: /和林舟聊天/ }).waitFor()
  await screenshot('discover')
  await page.getByRole('button', { name: /和林舟聊天/ }).click()
  await button('共同经历').click()
  await screenshot('empty-cards')
  await button('返回').click()
  await button('聊聊今天').click()
  assert.equal(await page.locator('.bubble.user').count(), 0)
  assert.equal(await message().inputValue(), '我想说说今天发生的一件事。')

  const firstText = '今天终于把会议上没说出口的话说了出来。'
  let releaseReply
  let requestReached
  const replyGate = new Promise(resolve => { releaseReply = resolve })
  const reached = new Promise(resolve => { requestReached = resolve })
  let sends = 0
  await page.route('**/api/messages', async route => {
    sends++
    const response = await route.fetch()
    requestReached()
    await replyGate
    await route.fulfill({ response })
  })
  await message().fill(firstText)
  await button('发送').click()
  await reached
  assert.equal(await button('发送').isDisabled(), true)
  await page.locator('.composer form').evaluate(el => el.requestSubmit())
  assert.equal(sends, 1, '等待中禁止重复发送')
  releaseReply()
  await page.locator('.bubble.user .message-trigger').waitFor()
  await page.unroute('**/api/messages')
  await screenshot('chat')
  const menu = page.getByRole('button', { name: '消息操作', exact: true }).last()
  await menu.click()
  await page.getByRole('menuitem', { name: '做成经历卡' }).waitFor()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.getByRole('menuitem').evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('ArrowUp')
  assert.equal(await page.getByRole('menuitem').evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('menu').count(), 0)
  assert.equal(await menu.evaluate(el => el === document.activeElement), true)
  await menu.click()
  await page.locator('.history-intro').click()
  assert.equal(await page.getByRole('menu').count(), 0)
  await menu.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('menu').count(), 0)
  await previewLast()
  await button('取消预览').click()
  await message().waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '消息操作', '取消预览应恢复来源操作焦点')
  assert.equal((await cards()).length, 0)
  await previewLast()
  await screenshot('preview')
  await button('收藏').click()
  await page.getByRole('status').filter({ hasText: '已存入共同经历' }).waitFor()
  await button('查看来源').click()
  await page.locator('.source-highlight').waitFor()
  assert.ok((await page.locator('.source-highlight').innerText()).includes(firstText))
  assert.ok(await page.locator('.source-highlight').evaluate(el => el === document.activeElement))
  await screenshot('source')
  await page.waitForFunction(() => !document.querySelector('.source-highlight'))
  await previewLast()
  await button('收藏').click()
  await button('查看来源').waitFor()
  assert.equal((await cards()).length, 1, '相同来源应去重')
  await button('查看来源').click()

  const longText = '第二封信：' + '海风和灯光'.repeat(45) + '\nhttps://example.com/' + 'a'.repeat(230)
  await send(longText)
  await page.route('**/api/card-preview', route => route.fulfill({ status: 503, json: { error: '预览生成失败' } }))
  await previewLast()
  await page.getByRole('status').filter({ hasText: '预览生成失败' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '正文', exact: true }).inputValue(), longText)
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('海风与灯光')
  await button('收藏').click()
  await button('查看来源').waitFor()
  await page.unroute('**/api/card-preview')
  assert.equal((await cards()).length, 2)
  await screenshot('card')
  await button('返回').click()
  await screenshot('cards')
  await button('返回').click()
  await screenshot('long-chat')
  const box = await message().boundingBox()
  assert.ok(box.y >= 0 && box.y + box.height <= 844, '输入区可见')

  await page.reload()
  await page.getByRole('button', { name: /和林舟聊天/ }).click()
  await button('共同经历').click()
  await page.waitForFunction(() => document.querySelectorAll('.card-list-item').length === 2)
  assert.equal(await page.locator('.card-list-item').count(), 2)
  await page.locator('.card-list-item').first().click()
  await button('编辑').click()
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('不保存的修改')
  await button('取消修改').click()
  assert.equal(await page.getByRole('heading', { name: '不保存的修改' }).count(), 0)
  await button('编辑').click()
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('新的海风标题')
  await page.getByRole('textbox', { name: '正文', exact: true }).fill('这是一张修改后留存的信笺。')
  await button('保存修改').click()
  await page.getByRole('status').filter({ hasText: '已保存修改' }).waitFor()
  await screenshot('edited-card')
  const saved = (await cards()).find(card => card.title === '新的海风标题')
  // Simulate another tab editing after this detail was opened.
  await context.request.patch(base + '/api/cards/' + saved.id, { data: { title: '最新的海风标题', body: '服务器最新正文' } })
  await button('从这里继续聊').click()
  await page.locator('.reference').filter({ hasText: '最新的海风标题' }).waitFor()
  assert.equal(await message().inputValue(), '')
  assert.equal(await page.locator('.bubble.user').count(), 2, '续聊不应自动发送')
  await button('移除引用').click()
  assert.equal(await page.locator('.reference').count(), 0)

  // Source absent from returned history must not highlight a different message.
  await openFirstCard()
  await page.route('**/api/thread', async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.messages = body.messages.filter(item => item.id !== saved.sourceMessageId)
    await route.fulfill({ response, json: body })
  })
  await button('查看来源').click()
  await page.getByRole('status').filter({ hasText: '无法定位' }).waitFor()
  assert.equal(await page.locator('.source-highlight').count(), 0)
  await page.unroute('**/api/thread')
  await openFirstCard()
  await button('查看来源').click()
  await page.locator('.source-highlight').waitFor()
  assert.ok((await page.locator('.source-highlight').innerText()).includes(longText))

  // Remove selected card from another tab; user can recover their unsent text.
  await openFirstCard()
  await button('从这里继续聊').click()
  await button('移除引用').waitFor()
  await context.request.delete(base + '/api/cards/' + saved.id)
  await message().fill('引用被删除后仍想说的话')
  await button('发送').click()
  await page.getByRole('alert').filter({ hasText: '经历卡已不可用' }).waitFor()
  assert.equal(await message().inputValue(), '引用被删除后仍想说的话')
  await button('移除引用').click()
  await button('发送').click()
  await page.locator('.bubble.user').filter({ hasText: '引用被删除后仍想说的话' }).locator('.message-trigger').waitFor()

  // Deliver a real request but discard its response, then retry its requestId.
  let dropped = false
  await page.route('**/api/messages', async route => {
    if (dropped) return route.continue()
    dropped = true
    await route.fetch()
    await route.abort('failed')
  })
  await message().fill('断线后原位重试的一封信')
  await button('发送').click()
  await button('重试').waitFor()
  await button('重试').click()
  await page.locator('.bubble.user').filter({ hasText: '断线后原位重试的一封信' }).locator('.message-trigger').waitFor()
  assert.equal(await page.locator('.bubble.user').filter({ hasText: '断线后原位重试的一封信' }).count(), 1)
  await page.unroute('**/api/messages')

  await openFirstCard()
  page.once('dialog', dialog => dialog.dismiss())
  await button('删除卡片').click()
  assert.equal((await cards()).length, 1, '取消删除应保留')
  page.once('dialog', dialog => dialog.accept())
  await button('删除卡片').click()
  await page.getByText('这里会收好你与林舟的片段。', { exact: false }).waitFor()
  assert.equal((await cards()).length, 0)
  await button('返回').click()
  await send('好')
  await page.getByRole('button', { name: '消息操作', exact: true }).last().click()
  await screenshot('message-menu')
  await page.keyboard.press('Escape')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await button('发送').evaluate(el => getComputedStyle(el).transitionDuration), '0s')
  await page.locator('.chat-menu summary').click()
  let confirms = 0
  const cancelSecond = async dialog => { confirms++; confirms === 1 ? await dialog.accept() : await dialog.dismiss() }
  page.on('dialog', cancelSecond)
  await button('清除会话').click()
  page.off('dialog', cancelSecond)
  assert.equal(confirms, 2)
  assert.equal(await button('共同经历').count(), 1)
  const confirmClear = dialog => dialog.accept()
  page.on('dialog', confirmClear)
  await button('清除会话').click()
  await button('我已年满 18 岁').waitFor()
  page.off('dialog', confirmClear)
  assert.deepEqual(faults, [])
  console.log('通过：三视口布局和触控、菜单键盘/外点关闭、取消预览、预览失败手动保存、两卡持久化、来源定位/缺失、编辑取消/保存、最新引用/移除、失效恢复、原位重试去重、删除确认、减少动态效果。')
} finally {
  // Delete only this isolated test identity, never the user's data.
  await context.request.delete(base + '/api/session').catch(() => {})
  await context.close()
  await browser.close()
}
