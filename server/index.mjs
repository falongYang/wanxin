import { loadPolicy } from './access.mjs'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app.mjs'
import { createModel } from './model.mjs'
import { createOpenMeteoWeather } from './weather.mjs'

try {
const access = loadPolicy()
const model = createModel()
const database = process.env.SQLITE_PATH || 'data/wanxin.sqlite'
mkdirSync(dirname(database), { recursive: true })
const port = Number(process.env.API_PORT || 3001)
const envTimeout = Number(process.env.MODEL_TIMEOUT_MS)
const app = createApp(database, model, {
  access,
  weather: process.env.WEATHER_PROVIDER === 'open-meteo' ? createOpenMeteoWeather() : undefined,
  secure: process.env.NODE_ENV === 'production',
  timeoutMs: Number.isFinite(envTimeout) && envTimeout >= 1000 ? envTimeout
    : process.env.MODEL_MODE === 'ollama' ? 200_000 : undefined,
  summarize: model.summarize,
})
  .listen(port, '127.0.0.1')
app.on('error', () => {
  process.stderr.write('api_start_failed\n')
  process.exitCode = 1
  app.close()
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close())
} catch {
  process.stderr.write('api_start_failed: validate private configuration, storage and instance lock\n')
  process.exitCode = 1
}
