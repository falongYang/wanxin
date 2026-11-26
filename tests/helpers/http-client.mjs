import { Readable } from 'node:stream'
export function makeClient(app) {
  return (path, body, cookie, method = body ? 'POST' : 'GET', headers = {}) => {
    const input = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(input, { method, url: '/api/' + path, headers: {
      cookie, origin: 'https://trial.example', 'content-type': 'application/json', ...headers,
    }, socket: { remoteAddress: '127.0.0.1' } })
    return new Promise(resolve => {
      const headers = new Map()
      const response = { setHeader: (k, v) => headers.set(k.toLowerCase(), v),
        writeHead: status => { response.status = status },
        end: data => resolve({ status: response.status, headers, cookie: headers.get('set-cookie')?.split(';')[0], json: () => JSON.parse(data) }) }
      app.emit('request', input, response)
    })
  }
}
