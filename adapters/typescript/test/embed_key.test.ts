// The caller's embedding key: EMBED_KEY (or `embedKey`) rides on every wake as X-Embed-Key, with the provider and region when given, so the agent's
// recall also finds what was said in other words. With no key, no X-Embed-* header goes out at all.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Argentic } from '../argentic.ts'
import { httpMock } from './mocks.ts'

const ok = { status: 'done', reply: 'hi', spent_usd: 0, turns: 1, wake_id: 'wk_1', wake_at: null }
const MODEL = { provider: 'anthropic', id: 'claude-haiku-5-5', prices: { in: 0.1, out: 0.5 } }

async function headersOf(make: (url: string) => Argentic): Promise<Record<string, unknown>> {
  const m = await httpMock({ honorsKey: false })
  m.server.removeAllListeners('request')
  let seen: Record<string, unknown> = {}
  m.server.on('request', async (r, res) => { for await (const _ of r) { /* drain */ } seen = r.headers; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(ok)) })
  try { await make(m.url).wake('a1', { message: 'hello', model: MODEL } as never, 'k.0') } finally { await m.close() }
  return seen
}

const env = (vars: Record<string, string | undefined>, f: () => Promise<void>) => async () => {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v
  try { await f() } finally { for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v }
}

test('EMBED_KEY, EMBED_PROVIDER and EMBED_REGION from the environment go out on the wake', env({ EMBED_KEY: 'co-env', EMBED_PROVIDER: 'bedrock', EMBED_REGION: 'ap-southeast-2' }, async () => {
  const h = await headersOf((url) => new Argentic({ apiKey: 'aek_test', baseUrl: url }))
  assert.deepEqual([h['x-embed-key'], h['x-embed-provider'], h['x-embed-region']], ['co-env', 'bedrock', 'ap-southeast-2'])
}))

test('an embedKey option beats the environment', env({ EMBED_KEY: 'co-env', EMBED_PROVIDER: undefined, EMBED_REGION: undefined }, async () => {
  const h = await headersOf((url) => new Argentic({ apiKey: 'aek_test', baseUrl: url, embedKey: 'co-arg' }))
  assert.equal(h['x-embed-key'], 'co-arg')
  assert.equal(h['x-embed-provider'], undefined)
}))

test('no embedding key: no X-Embed-* header, even with a provider set', env({ EMBED_KEY: undefined, EMBED_PROVIDER: 'bedrock', EMBED_REGION: undefined }, async () => {
  const h = await headersOf((url) => new Argentic({ apiKey: 'aek_test', baseUrl: url }))
  assert.deepEqual(Object.keys(h).filter((k) => k.startsWith('x-embed-')), [])
}))
