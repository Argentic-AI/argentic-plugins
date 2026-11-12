import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { Argentic, run as runAgent, type Tool, type ModelSpec } from '../argentic.ts'
import { httpMock, type Mock } from './mocks.ts'

const MODEL: ModelSpec = { provider: 'p', id: 'm', prices: { in: 0, out: 0 } }
const PARAMS = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
const tools = (ran: string[] = []): Tool[] =>
  ['read_a', 'read_b'].map((name) => ({
    name,
    description: name,
    parameters: PARAMS,
    execute: async (args: { id: string }) => {
      ran.push(name)
      return { name, id: args.id }
    },
  }))

let dir: string
before(() => { dir = mkdtempSync(join(tmpdir(), 'argentic-results-')) })
after(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
const ledgerPath = () => join(dir, `ledger-${++n}.json`)

const TEXT = (results: unknown[]) => 'Results of the tools you asked for:\n' + JSON.stringify(results)

type Seen = { key: string | undefined; body: any }

/**
 * A scripted server: wake 0 asks for read_a (seq 1) and read_b (seq 2), wake 1 asks for read_a again (seq 3), wake 2 answers.
 * `refuseResults` answers 400 to any body carrying `results`, as a server with strict validation that does not know it.
 */
async function server(refuseResults: boolean): Promise<{ m: Mock; seen: Seen[] }> {
  const m: Mock = await httpMock({ honorsKey: false })
  const seen: Seen[] = []
  m.server.removeAllListeners('request')
  m.server.on('request', async (r, res) => {
    let raw = ''
    for await (const c of r) raw += c
    m.requests.push({ method: r.method!, path: r.url!, headers: r.headers, body: raw })
    const body = JSON.parse(raw)
    if (refuseResults && 'results' in body) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'bad_request', detail: ["body: Unrecognized key(s) in object: 'results'"] }))
    }
    const wakes = seen.length
    seen.push({ key: r.headers['idempotency-key'] as string | undefined, body })
    const answer =
      wakes === 0
        ? { status: 'done', reply: '', spent_usd: 0, turns: 1, wake_id: 'wk_0', actions: [{ id: 'a1', tool: 'read_a', args: { id: 'x' }, seq: 1 }, { id: 'a2', tool: 'read_b', args: { id: 'y' }, seq: 2 }] }
        : wakes === 1
          ? { status: 'done', reply: '', spent_usd: 0, turns: 1, wake_id: 'wk_1', actions: [{ id: 'a3', tool: 'read_a', args: { id: 'z' }, seq: 3 }] }
          : { status: 'done', reply: 'finished', spent_usd: 0, turns: 1, wake_id: `wk_${wakes}` }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(answer))
  })
  return { m, seen }
}

const run = (m: Mock, extra: Partial<Parameters<typeof runAgent>[0]> = {}, client = new Argentic({ apiKey: 'aek_test', baseUrl: m.url })) =>
  runAgent({ client, agent: 'a', runId: 'r', task: 'go', tools: tools(), model: MODEL, ledgerPath: ledgerPath(), log: () => {}, ...extra })

test('a follow-up wake carries results with the right seq and result, and still the text message', async () => {
  const { m, seen } = await server(false)
  try {
    const out = await run(m)
    assert.equal(out.status, 'done')
    assert.equal(seen.length, 3)
    const first = [{ seq: 1, result: { name: 'read_a', id: 'x' } }, { seq: 2, result: { name: 'read_b', id: 'y' } }]
    assert.deepEqual(seen[1]!.body.results, first)
    assert.equal(seen[1]!.body.message, TEXT(first.map((r, i) => ({ tool: ['read_a', 'read_b'][i], ...r }))))
    assert.deepEqual(seen[2]!.body.results, [{ seq: 3, result: { name: 'read_a', id: 'z' } }])
    assert.equal(seen[2]!.body.message, TEXT([{ tool: 'read_a', seq: 3, result: { name: 'read_a', id: 'z' } }]))
  } finally {
    await m.close()
  }
})

test('the first wake of a run has no results', async () => {
  const { m, seen } = await server(false)
  try {
    await run(m)
    assert.equal('results' in seen[0]!.body, false)
    assert.equal(seen[0]!.body.message, 'go')
  } finally {
    await m.close()
  }
})

test('a server that refuses results: the same wake is sent again once without it, under the same key, and later wakes omit it', async () => {
  const { m, seen } = await server(true)
  try {
    const client = new Argentic({ apiKey: 'aek_test', baseUrl: m.url })
    const out = await run(m, {}, client)
    assert.equal(out.status, 'done')
    // 1 first wake, then: refused (with results), resent without, then wake 2 sent without results at all.
    const posts = m.requests.map((r) => ({ key: r.headers['idempotency-key'], hasResults: 'results' in JSON.parse(r.body) }))
    assert.deepEqual(posts.map((p) => p.hasResults), [false, true, false, false])
    assert.equal(posts[1]!.key, posts[2]!.key)
    assert.equal(posts[3]!.key, 'r.2')
    assert.equal(seen.length, 3)
    assert.match(seen[1]!.body.message, /^Results of the tools you asked for:\n/)
    // The refusal is remembered by the client: a second run on it never sends results.
    const before = m.requests.length
    await run(m, { runId: 'r2' }, client)
    assert.ok(m.requests.slice(before).every((r) => !('results' in JSON.parse(r.body))))
  } finally {
    await m.close()
  }
})

test('a 400 that does not mention results is not swallowed', async () => {
  const m: Mock = await httpMock({ honorsKey: false })
  m.server.removeAllListeners('request')
  m.server.on('request', async (r, res) => {
    let raw = ''
    for await (const c of r) raw += c
    m.requests.push({ method: r.method!, path: r.url!, headers: r.headers, body: raw })
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'bad_request', detail: ['body.model: Required'] }))
  })
  try {
    const client = new Argentic({ apiKey: 'aek_test', baseUrl: m.url })
    await assert.rejects(client.wake('a', { message: 'm', model: MODEL, results: [{ seq: 1, result: 1 }] }, 'k'), { status: 400 })
    assert.equal(m.requests.length, 1)
  } finally {
    await m.close()
  }
})

test('structuredResults: false sends no results', async () => {
  const { m, seen } = await server(false)
  try {
    const out = await run(m, { structuredResults: false })
    assert.equal(out.status, 'done')
    assert.equal(seen.length, 3)
    assert.ok(seen.every((s) => !('results' in s.body)))
    assert.match(seen[1]!.body.message, /^Results of the tools you asked for:\n/)
  } finally {
    await m.close()
  }
})

test('the result of an action the ledger already finished is still included', async () => {
  const { m, seen } = await server(false)
  const path = ledgerPath()
  writeFileSync(path, JSON.stringify({ entries: { 'a:1': { tool: 'read_a', args: { id: 'x' }, result: { cached: true }, at: '2026-01-01T00:00:00.000Z' } } }))
  const ran: string[] = []
  try {
    await run(m, { ledgerPath: path, tools: tools(ran) })
    assert.deepEqual(ran, ['read_b', 'read_a'])
    assert.deepEqual(seen[1]!.body.results, [{ seq: 1, result: { cached: true } }, { seq: 2, result: { name: 'read_b', id: 'y' } }])
  } finally {
    await m.close()
  }
})
