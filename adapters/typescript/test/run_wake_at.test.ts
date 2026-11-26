// run() for an app that owns the clock: it returns `wakeAt`, can send `schedule`, can wake with `fireDue` instead of a task, and
// needs no ledger file.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { Argentic, run as runAgent, type ModelSpec, type Tool } from '../argentic.ts'
import { httpMock, type Mock } from './mocks.ts'

const MODEL: ModelSpec = { provider: 'anthropic', id: 'claude-haiku-5-5', prices: { in: 0.1, out: 0.5, cache_hit: 0.01 } }
const WAKE_AT = '2026-11-25T01:00:00.000Z'

/** Wake 0 asks for `ping` (seq 1); wake 1 finishes and says when to wake next. */
async function server(): Promise<{ m: Mock; bodies: any[] }> {
  const m: Mock = await httpMock({ honorsKey: false })
  const bodies: any[] = []
  m.server.removeAllListeners('request')
  m.server.on('request', async (r, res) => {
    let raw = ''
    for await (const c of r) raw += c
    const body = JSON.parse(raw)
    bodies.push(body)
    const first = bodies.length === 1
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(first
      ? { status: 'done', reply: '', spent_usd: 0, turns: 1, wake_id: 'wk_0', wake_at: null, actions: [{ id: 'a1', tool: 'ping', args: {}, seq: 1 }] }
      : { status: 'done', reply: 'finished', spent_usd: 0, turns: 1, wake_id: 'wk_1', wake_at: WAKE_AT }))
  })
  return { m, bodies }
}

const ping = (ran: string[]): Tool => ({ name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} }, execute: () => { ran.push('ping'); return { pong: true } } })

let dir: string
before(() => { dir = mkdtempSync(join(tmpdir(), 'argentic-wakeat-')) })
after(() => rmSync(dir, { recursive: true, force: true }))

test('run returns the last answer\'s wake_at as wakeAt, and schedule goes out on every wake', async () => {
  const { m, bodies } = await server()
  try {
    const ran: string[] = []
    const out = await runAgent({ client: new Argentic({ apiKey: 'k', baseUrl: m.url }), agent: 'a', runId: 'r1', task: 'ping it', tools: [ping(ran)], model: MODEL, schedule: true, log: () => {} })
    assert.equal(out.wakeAt, WAKE_AT)
    assert.equal(out.status, 'done')
    assert.deepEqual(ran, ['ping'])
    assert.deepEqual(bodies.map((b) => b.schedule), [true, true])
    assert.equal(bodies[0].message, 'ping it')
    assert.equal(bodies[0].fire_due, undefined)
  } finally { await m.close() }
})

test('without schedule the field is not sent', async () => {
  const { m, bodies } = await server()
  try {
    await runAgent({ client: new Argentic({ apiKey: 'k', baseUrl: m.url }), agent: 'a', runId: 'r2', task: 'x', tools: [ping([])], model: MODEL, log: () => {} })
    assert.equal(bodies.some((b) => 'schedule' in b), false)
  } finally { await m.close() }
})

test('fireDue wakes with fire_due and no message; the follow-up wake carries the results alone', async () => {
  const { m, bodies } = await server()
  try {
    const ran: string[] = []
    const out = await runAgent({ client: new Argentic({ apiKey: 'k', baseUrl: m.url }), agent: 'a', runId: 'due-1', fireDue: true, tools: [ping(ran)], model: MODEL, schedule: true, log: () => {} })
    assert.equal(bodies[0].fire_due, true)
    assert.equal('message' in bodies[0], false)
    assert.equal('message' in bodies[1], false)
    assert.deepEqual(bodies[1].results, [{ seq: 1, result: { pong: true } }])
    assert.equal(bodies[1].fire_due, undefined)
    assert.equal(out.wakeAt, WAKE_AT)
  } finally { await m.close() }
})

test('run needs a task or fireDue, exactly one', async () => {
  const client = new Argentic({ apiKey: 'k', baseUrl: 'http://127.0.0.1:1' })
  await assert.rejects(() => runAgent({ client, agent: 'a', runId: 'x', tools: [], model: MODEL }), /task.*fireDue/)
  await assert.rejects(() => runAgent({ client, agent: 'a', runId: 'x', task: 'hi', fireDue: true, tools: [], model: MODEL }), /task.*fireDue/)
})

test('with no ledgerPath nothing is written to disk', async () => {
  const { m } = await server()
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    const ran: string[] = []
    await runAgent({ client: new Argentic({ apiKey: 'k', baseUrl: m.url }), agent: 'a', runId: 'r3', task: 'x', tools: [ping(ran)], model: MODEL, log: () => {} })
    assert.deepEqual(ran, ['ping'])
    assert.deepEqual(readdirSync(dir), [])
    assert.equal(existsSync(join(dir, '.argentic-ledger.json')), false)
  } finally { process.chdir(cwd); await m.close() }
})
