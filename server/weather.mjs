export function createOpenMeteoWeather(fetcher = fetch) {
  const cache = new Map()

  async function query(origin, path, parameters) {
    const url = new URL(path, origin)
    url.search = new URLSearchParams(parameters)
    const response = await fetcher(url, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) throw new Error('Weather provider unavailable')
    return response.json()
  }

  return {
    async cities(name) {
      if (name.length < 2 || name.length > 80) return []
      const { results = [] } = await query('https://geocoding-api.open-meteo.com', '/v1/search',
        { name, count: 6, language: 'zh' })
      return results.map(({ id, name, admin1, country, latitude, longitude }) => ({
        id, label: [...new Set([name, admin1, country].filter(Boolean))].join(' · '), latitude, longitude,
      }))
    },
    async temperature(latitude, longitude) {
      const key = latitude + ',' + longitude
      const cached = cache.get(key)
      if (cached?.expires > Date.now()) return cached.temperature
      const { current } = await query('https://api.open-meteo.com', '/v1/forecast',
        { latitude, longitude, current: 'temperature_2m' })
      const temperature = current?.temperature_2m
      if (!Number.isFinite(temperature)) return null
      if (cache.size >= 256) cache.delete(cache.keys().next().value)
      cache.set(key, { temperature, expires: Date.now() + 15 * 60 * 1000 })
      return temperature
    },
  }
}
