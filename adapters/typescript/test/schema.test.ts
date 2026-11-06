import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toArgenticSchema, checkOncePer } from '../argentic.ts'

test('a flat schema is trimmed as it always was', () => {
  const out = toArgenticSchema({ $schema: 'x', type: 'object', additionalProperties: false, properties: { a: { type: 'string', title: 'A', description: 'd' }, tags: { type: 'array', items: { type: 'string', enum: ['x'] } } }, required: ['a'] })
  assert.deepEqual(out, { type: 'object', properties: { a: { type: 'string', description: 'd' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['a'] })
})

test('a nested object or an array of objects goes through whole, less $schema', () => {
  const nested = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { order_id: { type: 'string' }, payload: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }, items: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' } } } } }, required: ['order_id'] }
  const out = toArgenticSchema(nested) as any
  assert.equal(out.$schema, undefined)
  assert.deepEqual(out.properties.payload, nested.properties.payload)
  assert.deepEqual(out.properties.items, nested.properties.items)
  assert.deepEqual(out.required, ['order_id'])
  checkOncePer('delegate', 'delegate:{order_id}', out)
})
