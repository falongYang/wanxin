import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app.mjs'
import { createModel } from './model.mjs'

const model = createModel()
const database = process.env.SQLITE_PATH || 'data/wanxin.sqlite'
mkdirSync(dirname(database), { recursive: true })
const port = Number(process.env.API_PORT || 3001)
createApp(database, model, {
  secure: process.env.NODE_ENV === 'production',
  timeoutMs: process.env.MODEL_MODE === 'ollama' ? 200_000 : undefined,
})
  .listen(port, '127.0.0.1', () => console.log('API listening on port ' + port))
