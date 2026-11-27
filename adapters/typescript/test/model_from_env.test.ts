import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as client from '../argentic.ts'
import { modelFromEnv } from '../argentic.ts'

test('there is no default model: nothing is exported to fall back on, and an unnamed model throws', () => {
  assert.equal('freeModel' in client, false)
  assert.throws(() => modelFromEnv({}), /ARGENTIC_MODEL_ID/)
  assert.throws(() => modelFromEnv({ ARGENTIC_MODEL_PROVIDER: 'openai', ARGENTIC_PRICE_IN: '9' }), /ARGENTIC_MODEL_ID/)
  assert.throws(() => modelFromEnv({ ARGENTIC_MODEL_ID: 'm' }), /ARGENTIC_MODEL_BASE_URL/)
})

test('a provider or a base URL names the endpoint, never both', () => {
  assert.deepEqual(
    modelFromEnv({ ARGENTIC_MODEL_ID: 'gpt-x', ARGENTIC_MODEL_PROVIDER: 'openai', ARGENTIC_PRICE_IN: '0.25', ARGENTIC_PRICE_OUT: '2' }),
    { provider: 'openai', id: 'gpt-x', prices: { in: 0.25, out: 2 } },
  )
  assert.deepEqual(
    modelFromEnv({ ARGENTIC_MODEL_ID: 'm', ARGENTIC_MODEL_BASE_URL: 'https://llm.example.com/v1', ARGENTIC_PRICE_IN: '0', ARGENTIC_PRICE_OUT: '0' }),
    { base_url: 'https://llm.example.com/v1', id: 'm', prices: { in: 0, out: 0 } },
  )
  assert.throws(() => modelFromEnv({ ARGENTIC_MODEL_ID: 'm', ARGENTIC_MODEL_PROVIDER: 'openai', ARGENTIC_MODEL_BASE_URL: 'https://x.example.com' }), /not both/)
})

test('a price is never guessed', () => {
  const named = { ARGENTIC_MODEL_ID: 'm', ARGENTIC_MODEL_PROVIDER: 'openai' }
  // neither price set: no prices are sent, so the API uses its own price or refuses the call; it is not counted as free
  assert.deepEqual(modelFromEnv(named), { provider: 'openai', id: 'm' })
  assert.deepEqual(modelFromEnv({ ...named, ARGENTIC_PRICE_IN: ' ', ARGENTIC_PRICE_OUT: '' }), { provider: 'openai', id: 'm' })
  assert.throws(() => modelFromEnv({ ...named, ARGENTIC_PRICE_IN: '0.25' }), /ARGENTIC_PRICE_OUT is not set/)
  // the docs' placeholder left in, a negative price and not-a-number are all refused by name
  for (const bad of ['INPUT_USD_PER_MILLION', '-1', 'NaN', '$0.25']) {
    assert.throws(() => modelFromEnv({ ...named, ARGENTIC_PRICE_IN: bad, ARGENTIC_PRICE_OUT: '2' }), /ARGENTIC_PRICE_IN must be a number/)
  }
})

test('a first-run mistake gets a hint that names the fix', () => {
  const said = 'nvidia answered HTTP 404 for model "x": Not Found'
  const hint = (body: unknown, status = 400) => client.hintFor(new client.ArgenticError('x', status, body))
  assert.match(hint({ error: 'model_key_required' })!, /MODEL_KEY/)
  assert.ok(hint({ error: 'bad_model', detail: said })!.includes(said)) // the API's own words say which of provider and id is wrong
  assert.match(hint({ error: 'bad_model', detail: said })!, /ARGENTIC_MODEL_PROVIDER/)
  assert.match(hint({ error: 'prices_required', detail: 'no price is known' })!, /ARGENTIC_PRICE_IN/)
  assert.match(hint({ error: 'idempotency_key_reused' })!, /new run id/)
  assert.match(hint({ error: 'history_resent', detail: '`message` repeats a reply' })!, /only the new event/)
  assert.match(hint({ error: 'bad_request', detail: ['model.prices.in: Expected number, received string'] })!, /Prices are numbers/)
  assert.equal(hint({ error: 'bad_request', detail: ['message: Required'] }), undefined)
  const paid = hint({ error: 'payment_required' }, 402)!
  assert.match(paid, /Billing/)
  assert.doesNotMatch(paid, /free in beta/)
})
