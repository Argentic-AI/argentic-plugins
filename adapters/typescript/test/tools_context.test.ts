import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Argentic, freeModel, type ToolDecl, type WakeBody } from '../argentic.ts'
import { httpMock } from './mocks.ts'

const tool: ToolDecl = {
  name: 'book_slot',
  description: 'Book an appointment slot.',
  parameters: { type: 'object', properties: { day: { type: 'string', enum: ['mon', 'tue'] } }, required: ['day'] },
  defer_loading: true,
}

test('putTools sends the declarations with PUT and returns what was stored', async () => {
  const m = await httpMock({ honorsKey: false })
  m.server.removeAllListeners('request')
  m.server.on('request', async (r, res) => {
    let body = ''
    for await (const c of r) body += c
    m.requests.push({ method: r.method!, path: r.url!, headers: r.headers, body })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ agent: 'a b', tools: JSON.parse(body || '{"tools":[]}').tools ?? [] }))
  })
  try {
    const client = new Argentic({ apiKey: 'aek_test', baseUrl: m.url })
    const stored = await client.putTools('a b', [tool])
    assert.equal(m.requests[0]!.method, 'PUT')
    assert.equal(m.requests[0]!.path, '/v1/agents/a%20b/tools')
    assert.deepEqual(JSON.parse(m.requests[0]!.body), { tools: [tool] })
    assert.equal(m.requests[0]!.headers['authorization'], 'Bearer aek_test')
    assert.deepEqual(stored, [tool])
    assert.deepEqual(await client.tools('a b'), [])
    assert.equal(m.requests[1]!.method, 'GET')
  } finally {
    await m.close()
  }
})

test('context and tool_choice go out on the wake body as typed', async () => {
  const m = await httpMock({ honorsKey: false })
  m.server.removeAllListeners('request')
  m.server.on('request', async (r, res) => {
    let body = ''
    for await (const c of r) body += c
    m.requests.push({ method: r.method!, path: r.url!, headers: r.headers, body })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'done', reply: 'ok', spent_usd: 0, turns: 1, wake_id: 'wk_1' }))
  })
  try {
    const client = new Argentic({ apiKey: 'aek_test', baseUrl: m.url })
    const body: WakeBody = { message: 'hi', model: freeModel, context: 'Plan: pro', tools: [tool], tool_choice: { type: 'tool', name: 'book_slot' } }
    await client.wake('a', body, 'k1')
    const sent = JSON.parse(m.requests[0]!.body)
    assert.equal(sent.context, 'Plan: pro')
    assert.deepEqual(sent.tool_choice, { type: 'tool', name: 'book_slot' })
    assert.equal(sent.tools[0].defer_loading, true)
  } finally {
    await m.close()
  }
})
