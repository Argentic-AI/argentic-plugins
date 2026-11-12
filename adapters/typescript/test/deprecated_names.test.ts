// 0.2.0 renamed runDurable to run and DurableTool to Tool. The old names stay as aliases, so existing code keeps working.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { run, runDurable, type DurableTool, type Tool } from '../argentic.ts'

test('runDurable is the same function as run', () => {
  assert.equal(runDurable, run)
})

test('DurableTool is the same type as Tool', () => {
  const tool: Tool = { name: 'echo', description: 'Echo.', parameters: { type: 'object', properties: {} }, execute: () => 'ok' }
  const old: DurableTool = tool
  assert.equal(old.name, 'echo')
})

test('the package entry point exports both names', async () => {
  const mod = await import('../argentic.ts')
  assert.equal(typeof mod.run, 'function')
  assert.equal(typeof mod.runDurable, 'function')
})
