import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Argentic, ArgenticError } from '../argentic.ts'
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
  const items = [{ agent: 'a', schedule: 'daily', scheduled_at: '2026-11-07T09:00:00.000Z' }, { agent: 'b', reasons: ['hook'], since: '2026-11-07T09:01:00.000Z' }]
  const m = await api(() => ({ code: 200, json: { due: items } }))
  try {
    assert.deepEqual(await client(m).due({ limit: 5 }), items)
    assert.equal(m.requests[0].method, 'GET')
    assert.equal(m.requests[0].path, '/v1/due?limit=5')
    assert.equal(m.requests[0].headers.authorization, 'Bearer aek_test')
    assert.equal(m.requests[0].body, '')
  } finally { await m.close() }
})

test('putSchedule sends PUT with the body and returns the schedule; memory rides the query', async () => {
  const sched = { name: 'daily', cron: '0 9 * * *', message: 'check', enabled: true, next_at: '2026-11-07T09:00:00.000Z', last_fired_at: null, fires: 0 }
  const m = await api(() => ({ code: 200, json: { agent: 'a', schedule: sched } }))
  try {
    const out = await client(m).putSchedule('a b', 'daily', { cron: '0 9 * * *', message: 'check' }, { memory: 'org' })
    assert.deepEqual(out, sched)
    assert.equal(m.requests[0].method, 'PUT')
    assert.equal(m.requests[0].path, '/v1/agents/a%20b/schedules/daily?memory=org')
    assert.deepEqual(JSON.parse(m.requests[0].body), { cron: '0 9 * * *', message: 'check' })
    assert.equal(m.requests[0].headers['content-type'], 'application/json')
  } finally { await m.close() }
})

test('a 409 schedule_limit is an error, not a queued wait', async () => {
  const m = await api(() => ({ code: 409, json: { error: 'schedule_limit', detail: 'an agent can have 5 schedules; delete one first' } }))
  try {
    await assert.rejects(client(m).putSchedule('a', 'x', { cron: '0 9 * * *', message: 'm' }), (e: unknown) => e instanceof ArgenticError && e.status === 409 && /schedule_limit/.test(e.message))
    assert.equal(m.requests.length, 1)
  } finally { await m.close() }
})

test('schedules() lists, deleteSchedule() deletes and a missing one throws 404', async () => {
  const m = await api(() => ({ code: 200, json: { agent: 'a', schedules: [] } }))
  try {
    assert.deepEqual(await client(m).schedules('a'), [])
    assert.equal(m.requests[0].path, '/v1/agents/a/schedules')
  } finally { await m.close() }
  const gone = await api((method) => (method === 'DELETE' ? { code: 404, json: { error: 'not_found' } } : { code: 200, json: {} }))
  try {
    await assert.rejects(client(gone).deleteSchedule('a', 'nope'), (e: unknown) => e instanceof ArgenticError && e.status === 404)
    assert.equal(gone.requests[0].method, 'DELETE')
    assert.equal(gone.requests[0].path, '/v1/agents/a/schedules/nope')
  } finally { await gone.close() }
})

test('setWakeUrl and notices use /v1/settings', async () => {
  const m = await api((method) => (method === 'PUT' ? { code: 200, json: { wake_url: 'https://app.example.com/due' } } : { code: 200, json: { wake_url: 'https://app.example.com/due', signing_secret: 'whsec_abc' } }))
  try {
    const c = client(m)
    assert.equal(await c.setWakeUrl('https://app.example.com/due'), 'https://app.example.com/due')
    assert.deepEqual(JSON.parse(m.requests[0].body), { url: 'https://app.example.com/due' })
    assert.deepEqual(await c.notices(), { wake_url: 'https://app.example.com/due', signing_secret: 'whsec_abc' })
    assert.equal(m.requests[1].path, '/v1/settings/notices')
  } finally { await m.close() }
})
