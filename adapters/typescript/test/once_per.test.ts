import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { jsonSchema, tool } from 'ai'
import { Argentic, run, checkOncePer, type Tool, type ModelSpec } from '../argentic.ts'
import { fromAiSdkTools } from '../ai-sdk.ts'
import { fromMastraTools } from '../mastra.ts'
import { httpMock, type Mock } from './mocks.ts'

const MODEL: ModelSpec = { provider: 'p', id: 'm', prices: { in: 0, out: 0 } }
const REFUND_PARAMS = {
  type: 'object',
  properties: { order_id: { type: 'string' }, amount_usd: { type: 'number' }, note: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } },
  required: ['order_id', 'amount_usd'],
}
const refund = (extra: Partial<Tool> = {}): Tool => ({
  name: 'refund_order',
  description: 'Refund an order.',
  parameters: REFUND_PARAMS,
  execute: async () => ({ ok: true }),
  ...extra,
})

let dir: string
before(() => { dir = mkdtempSync(join(tmpdir(), 'argentic-once-per-')) })
after(() => rmSync(dir, { recursive: true, force: true }))

let n = 0
/** Run one wake against a server that answers `done`, and return the exact body the client sent. */
async function sentBody(tools: Tool[]): Promise<string> {
  const m: Mock = await httpMock({ honorsKey: false })
  m.server.removeAllListeners('request')
  m.server.on('request', async (r, res) => {
    let body = ''
    for await (const c of r) body += c
    m.requests.push({ method: r.method!, path: r.url!, headers: r.headers, body })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'done', reply: 'ok', spent_usd: 0, turns: 1, wake_id: 'wk_1' }))
  })
  try {
    const client = new Argentic({ apiKey: 'aek_test', modelKey: 'mk_customer', baseUrl: m.url })
    await run({ client, agent: 'a', runId: 'r', task: 'go', tools, model: MODEL, ledgerPath: join(dir, `ledger-${++n}.json`), log: () => {} })
    assert.equal(m.requests.length, 1)
    return m.requests[0]!.body
  } finally {
    await m.close()
  }
}

test('once_per is sent on the tool definition', async () => {
  const body = JSON.parse(await sentBody([refund({ once_per: 'refund:{order_id}' })]))
  assert.equal(body.tools.length, 1)
  assert.equal(body.tools[0].once_per, 'refund:{order_id}')
  assert.equal(body.tools[0].name, 'refund_order')
})

test('absent once_per: the request body is byte-identical to the one 0.1.6 sent', async () => {
  const expected = JSON.stringify({
    message: 'go',
    model: MODEL,
    tools: [{ name: 'refund_order', description: 'Refund an order.', parameters: {
      type: 'object',
      properties: { order_id: { type: 'string' }, amount_usd: { type: 'number' }, note: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } },
      required: ['order_id', 'amount_usd'],
    } }],
  })
  assert.equal(await sentBody([refund()]), expected)
  // An explicit undefined is the same as absent.
  assert.equal(await sentBody([refund({ once_per: undefined })]), expected)
})

test('a template the API would refuse is rejected here, before any request', async () => {
  const bad: [string, RegExp][] = [
    ['refund', /once_per needs at least one \{argument\}, such as "refund:\{order_id\}"/],
    ['re', /3 to 120 characters/],
    ['x'.repeat(121) + '{order_id}', /3 to 120 characters/],
    ['refund:{order_id} now', /letters, digits and _ : \. - plus \{argument\} placeholders/],
    ['refund:{order_id', /needs at least one/],
    ['refund:{order-id}', /needs at least one/],
    ['refund:{order_id}{', /unmatched brace/],
    ['refund:{order_id}:{order-id}', /unmatched brace/],
    ['refund:{order_id}}', /unmatched brace/],
    ['refund:{amount}', /once_per \{amount\} must be a string, number, integer or boolean property of this tool/],
    ['refund:{ids}', /once_per \{ids\} must be a string, number, integer or boolean property of this tool/],
    ['refund:{note}', /once_per \{note\} must be a required property, so every call has a key/],
  ]
  for (const [tpl, re] of bad) {
    await assert.rejects(sentBody([refund({ once_per: tpl })]), (e: Error) => { assert.match(e.message, /^tool "refund_order": /); assert.match(e.message, re, tpl); return true })
  }
  assert.throws(() => checkOncePer('t', 42 as any, REFUND_PARAMS), /once_per must be a string/)
})

test('a placeholder that is not a declared parameter is rejected, and Object.prototype names do not count', () => {
  assert.throws(() => checkOncePer('refund_order', 'refund:{order_number}', REFUND_PARAMS), /once_per \{order_number\} must be a string, number, integer or boolean property of this tool/)
  assert.throws(() => checkOncePer('refund_order', 'refund:{constructor}', REFUND_PARAMS), /\{constructor\} must be a string/)
  assert.throws(() => checkOncePer('refund_order', 'refund:{order_id}', { type: 'object', properties: {} }), /\{order_id\} must be a string/)
  checkOncePer('refund_order', 'refund:{order_id}', REFUND_PARAMS)
  checkOncePer('refund_order', 'refund:{order_id}:{amount_usd}', REFUND_PARAMS)
  checkOncePer('refund_order', 'refund.v2-{order_id}', REFUND_PARAMS)
})

test('AI SDK adapter: oncePer sets once_per on the named tool and it reaches the wire', async () => {
  const tools = {
    refund_order: tool({
      description: 'Refund an order.',
      inputSchema: jsonSchema({ type: 'object', properties: { order_id: { type: 'string' }, amount_usd: { type: 'number' } }, required: ['order_id', 'amount_usd'] }),
      execute: async () => ({ ok: true }),
    }),
    lookup: tool({ description: 'Look up.', inputSchema: jsonSchema({ type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }), execute: async () => ({}) }),
  }
  const decl = await fromAiSdkTools(tools, { oncePer: { refund_order: 'refund:{order_id}' } })
  assert.equal(decl.find((t) => t.name === 'refund_order')!.once_per, 'refund:{order_id}')
  assert.equal('once_per' in decl.find((t) => t.name === 'lookup')!, false)
  const body = JSON.parse(await sentBody(decl))
  assert.equal(body.tools.find((t: any) => t.name === 'refund_order').once_per, 'refund:{order_id}')
  assert.equal('once_per' in body.tools.find((t: any) => t.name === 'lookup'), false)
  // Without the option nothing is added.
  assert.equal((await fromAiSdkTools(tools)).some((t) => 'once_per' in t), false)
  await assert.rejects(fromAiSdkTools(tools, { oncePer: { refund_order: 'refund:{nope}' } }), /\{nope\} must be a string/)
  await assert.rejects(fromAiSdkTools(tools, { oncePer: { missing_tool: 'x:{q}' } }), /"missing_tool", which is not one of the tools/)
})

test('Mastra adapter: oncePer sets once_per on the named tool', () => {
  const schema = { '~standard': { validate: (v: unknown) => ({ value: v }), jsonSchema: { input: () => REFUND_PARAMS } } }
  const tools = { refund_order: { description: 'Refund an order.', inputSchema: schema, execute: async () => ({}) } }
  const decl = fromMastraTools(tools, { oncePer: { refund_order: 'refund:{order_id}' } })
  assert.equal(decl[0]!.once_per, 'refund:{order_id}')
  assert.equal('once_per' in fromMastraTools(tools)[0]!, false)
  assert.throws(() => fromMastraTools(tools, { oncePer: { refund_order: 'refund:{note}' } }), /\{note\} must be a required property/)
  assert.throws(() => fromMastraTools(tools, { oncePer: { other: 'refund:{order_id}' } }), /not one of the tools/)
})
