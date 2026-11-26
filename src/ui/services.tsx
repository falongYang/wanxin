// 生活服务：目录由服务端下发；点击时先取得用户授权，然后尝试深链唤起 App，
// 未唤起则回退网页版。不接入平台 API、不代操作账号；真实平台对接需商务合作。
import { useEffect, useState } from 'react'

export type ServiceItem = { id: string; name: string; category: string; categoryLabel: string; scheme: string; web: string }

type Api = <T>(path: string, data?: unknown, method?: string) => Promise<T>

const AUTH_KEY = 'wanxin.services.authorized'

// 打开一个服务：首次点击需要授权确认；点击量只做匿名统计（service_click）。
export function openService(service: ServiceItem) {
  if (localStorage.getItem(AUTH_KEY) !== '1') {
    const allowed = window.confirm(`晚信将在你的设备上打开「${service.name}」：已安装会尝试唤起 App，否则打开网页版。外部应用完全由你自行操作，晚信不会替你下单，也不会触碰你的账号。允许继续吗？`)
    if (!allowed) return
    try { localStorage.setItem(AUTH_KEY, '1') } catch { /* 隐私模式下跳过记忆 */ }
  }
  void fetch('/api/services/' + service.id + '/click', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).catch(() => { /* 统计失败不影响打开 */ })
  window.location.href = service.scheme
  window.setTimeout(() => { if (!document.hidden) window.location.href = service.web }, 900)
}

// 聊天快捷入口：从输入内容识别生活服务线索（纯客户端关键词匹配，不调用模型）。
const HINT_RULES: [RegExp, string][] = [
  [/外卖|饿了|夜宵|点餐|吃饭|吃点/, 'meituan-food'],
  [/淘宝|京东|购物|买东西|下单/, 'taobao'],
  [/看剧|追剧|电影|视频|电视/, 'tencent-video'],
  [/小说|看书|读书|听书/, 'tomato'],
  [/听歌|音乐|歌单|电台歌/, 'netease-music'],
  [/地图|导航|打车|路线|怎么走/, 'amap'],
]
export function detectServiceHint(text: string, services: ServiceItem[]): ServiceItem | null {
  for (const [pattern, id] of HINT_RULES) {
    if (pattern.test(text)) return services.find(service => service.id === id) ?? null
  }
  return null
}

export function fetchServices(api: Api): Promise<ServiceItem[]> {
  return api<{ services: ServiceItem[] }>('services').then(({ services }) => services)
}

/* ---------- 服务面板 ---------- */
export function ServicesScreen({ api, onError, services }: {
  api: Api
  onError: (message: string) => void
  services: ServiceItem[]
}) {
  const [catalog, setCatalog] = useState<ServiceItem[]>(services)
  useEffect(() => { setCatalog(services) }, [services])
  useEffect(() => {
    if (services.length) return
    void fetchServices(api).then(setCatalog).catch(() => onError('暂时无法加载生活服务，请重试。'))
  }, [])

  const groups: [string, string, ServiceItem[]][] = []
  for (const service of catalog) {
    const found = groups.find(([label]) => label === service.categoryLabel)
    if (found) found[2].push(service)
    else groups.push([service.categoryLabel, SCENE_NOTES[service.category] ?? '', [service]])
  }
  return <section className="services-screen">
    <header className="album-actions">
      <p className="eyebrow">顺手的事</p>
      <h1>生活服务</h1>
    </header>
    <p className="services-note">由你的设备决定打开 App 还是网页；晚信不接入平台接口，也不代你操作任何账号。</p>
    {!catalog.length && <p className="muted">正在加载服务目录…</p>}
    {groups.map(([label, note, items]) => <section className="service-group" key={label}>
      <h2>{label}{note && <small> · {note}</small>}</h2>
      <div className="service-grid">
        {items.map(service => <button type="button" key={service.id} className="service-item" onClick={() => openService(service)}>
          <strong>{service.name}</strong>
          <small>打开 App / 网页</small>
        </button>)}
      </div>
    </section>)}
  </section>
}

// 分组场景注释：给「为什么现在用它」一个理由，不做工具列表
const SCENE_NOTES: Record<string, string> = {
  eat: '深夜饿了，不用硬扛',
  buy: '想要的东西，睡前就能到',
  watch: '一起看的深夜档',
  read: '睡前翻几页就好',
  listen: '把耳机分你一只',
  go: '出门的路，交给地图',
}
