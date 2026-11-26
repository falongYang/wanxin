const monthFormat = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' })
export function groupCards(cards, query) {
  const needle = query.trim().toLowerCase()
  const time = card => Number.isFinite(Date.parse(card.createdAt)) ? Date.parse(card.createdAt) : -Infinity
  const sorted = cards.filter(card => !needle || [card.title, card.body].some(text => text.trim().toLowerCase().includes(needle)))
    .sort((a, b) => {
      const left = time(a), right = time(b)
      if (left !== right) return left > right ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  const groups = new Map()
  for (const card of sorted) {
    let key = 'unknown', label = '日期未知'
    if (Number.isFinite(time(card))) {
      const parts = monthFormat.formatToParts(new Date(card.createdAt))
      const year = parts.find(part => part.type === 'year').value
      const month = parts.find(part => part.type === 'month').value
      key = year + '-' + month
      label = year + '年' + month + '月'
    }
    if (!groups.has(key)) groups.set(key, { key, label, cards: [] })
    groups.get(key).cards.push(card)
  }
  return [...groups.values()]
}
