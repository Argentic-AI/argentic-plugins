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
    modelFromEnv({ ARGENTIC_MODEL_ID: 'm', ARGENTIC_MODEL_BASE_URL: 'https://llm.example.com/v1' }),
    { base_url: 'https://llm.example.com/v1', id: 'm', prices: { in: 0, out: 0 } },
  )
  assert.throws(() => modelFromEnv({ ARGENTIC_MODEL_ID: 'm', ARGENTIC_MODEL_PROVIDER: 'openai', ARGENTIC_MODEL_BASE_URL: 'https://x.example.com' }), /not both/)
})
