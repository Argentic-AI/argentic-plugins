import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Argentic } from '../argentic.ts'
import { httpMock, type Mock } from './mocks.ts'

type Reply = { code: number; json: unknown }

/** A mock API that answers each request with `reply(method, path, body)`. */
async function api(reply: (method: string, path: string, body: string) => Reply): Promise<Mock> {
  const m = await httpMock({ honorsKey: false })
  m.server.removeAllListeners('request')
  m.server.on('request', async (r, res) => {
    let body = ''
    for await (const c of r) body += c
    m.requests.push({ method: r.method!, path: r.url!, headers: r.headers, body })
    const out = reply(r.method!, r.url!, body)
    res.writeHead(out.code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out.json))
  })
  return m
}

const client = (m: Mock) => new Argentic({ apiKey: 'aek_test', baseUrl: m.url, backoffMs: [], sleep: async () => {} })

test('due() reads GET /v1/due with the limit and returns the items', async () => {
  const items = [{ agent: 'a', plan_id: 41, text: 'Call the customer back', wake_at: '2026-11-07T09:00:00.000Z' }]
  const m = await api(() => ({ code: 200, json: { due: items } }))
  try {
    assert.deepEqual(await client(m).due({ limit: 5 }), items)
    assert.equal(m.requests[0].method, 'GET')
    assert.equal(m.requests[0].path, '/v1/due?limit=5')
    assert.equal(m.requests[0].headers.authorization, 'Bearer aek_test')
    assert.equal(m.requests[0].body, '')
  } finally { await m.close() }
})
