# Argentic for TypeScript

Argentic runs the agent loop. Your Vercel AI SDK or Mastra tools and system prompt carry over; the framework's own loop (`generateText`, `Agent`, Mastra `Agent.generate`) is not used.

Argentic is an engine that keeps AI agents right for hours while prompt size is bounded: the prompt does not grow with the history. The full record of the run is kept, so you can check every step.

Each tool call the agent makes comes back to your code to carry out. If the process dies mid-run, run it again: it resumes without repeating a finished action.

## Try it

Install it below and run the example under Use. To compare Argentic with a plain loop on a scripted scenario, run `npx @argentic-ai/check` (see the [repo README](../../README.md#try-it)).

Client 0.2.0 removed `npx @argentic-ai/client demo` and the `argentic` command with it, and renamed `runDurable` to `run` and `DurableTool` to `Tool`. The old names still work as deprecated aliases (Python: `run_durable` is now `run`, with the old name kept and a `DeprecationWarning`). Nothing else in the library changed.

## Install

```
npm i @argentic-ai/client
```

- `@argentic-ai/client`: the client and `run`, no dependencies, Node 22+.
- `@argentic-ai/client/ai-sdk`: `fromAiSdkTools`, needs `ai` v5, v6 or v7.
- `@argentic-ai/client/tools`: `toolPack`, retry-safe tools for Stripe, Resend, SMTP, Slack, GitHub and a generic HTTP POST. See [TOOLS.md](TOOLS.md).
- `@argentic-ai/client/mastra`: `fromMastraTools`, takes the `createTool()` tools you would pass to an Agent (the key is the tool name). Needs `@mastra/core` 1.x for the tools; the adapter itself imports nothing.

To vendor it instead: clone this repo and copy `argentic.ts`, `ai-sdk.ts` and `mastra.ts` into your project (Node 22+, no package needed beyond what you already use).

## Use

```ts
import { tool } from 'ai'
import { z } from 'zod'
import { Argentic, modelFromEnv, run } from '@argentic-ai/client'
import { fromAiSdkTools } from '@argentic-ai/client/ai-sdk'

const tools = { refund_order: tool({
  description: 'Refund an order.',
  inputSchema: z.object({ order_id: z.string(), amount_usd: z.number() }),
  execute: async (args, { toolCallId }) => refund(args, toolCallId),
}) }

// apiKey defaults to ARGENTIC_API_KEY, modelKey to MODEL_KEY, and embedKey to EMBED_KEY
// (optional: with it, the agent's recall also finds what was said in other words)
const client = new Argentic()
const out = await run({
  client, agent: 'my-agent', runId: 'order-1182', ledgerPath: '.argentic-ledger.json',
  task: 'Refund order 1182.', system: 'Call one tool per turn.',
  tools: await fromAiSdkTools(tools),
  model: modelFromEnv(), // or { provider: 'openai', id: '...', prices: { in: 0.25, out: 2 } }
})
console.log(out.reply)
```

`task` is the new event: what happened since the agent last ran, never the earlier messages. Keep `agent` and `runId` the same when a run is retried (the id of the event that woke the agent is a good `runId`). `ledgerPath` is optional: with it, finished actions are written to that file so a killed process does not run them twice; without it they are kept in memory for the call, so make your tools safe to repeat with the `ctx.idempotencyKey` your `execute` receives. A request that takes longer than `timeoutMs` (default 300000, 0 for no limit) counts as a network failure and is retried with the same key. If the ledger file is not valid JSON, `run` warns on stderr, sets the file aside as `<path>.corrupt` and starts empty, so finished actions may run again. `client.replay(agent, wakeId)` re-renders a wake's prompts from the journal and compares them to what the model saw; it calls no model and spends nothing.

## Your model

You always name the model; there is no default. `model` is `{ provider, id, prices }` with `provider` a named endpoint (`openai`, `anthropic`, `openrouter`, ...), or `{ base_url, id, prices }` with `base_url` any public https OpenAI-compatible endpoint on port 443 (give one of the two, not both). Prices are dollars per million tokens. `modelFromEnv()` reads `ARGENTIC_MODEL_ID`, `ARGENTIC_MODEL_PROVIDER` or `ARGENTIC_MODEL_BASE_URL`, `ARGENTIC_PRICE_IN` and `ARGENTIC_PRICE_OUT`, and throws if the model is not named. A price is never guessed. With neither price variable set, no `prices` are sent: the API uses its own price for a model it has one for (today, Anthropic's models on Anthropic's API) and refuses any other with `prices_required`. One price without the other throws, and so does a price that is not a number. A free model sets both to `0`. This is new in 0.9.0: up to 0.8.0 an unset price counted as 0. `ARGENTIC_BASE_URL` is Argentic's own API, not your model's.

## Once per operation (`once_per`, 0.1.7)

A tool can declare `once_per`, a key such as `refund:{order_id}` filled in from the call's arguments. Argentic then refuses a second call with the same key, in this wake or any later one. Set it on a `Tool` directly, or pass `{ oncePer: { refund_order: 'refund:{order_id}' } }` as the second argument to `fromAiSdkTools` or `fromMastraTools`. The template is checked before the request is sent. See [TOOLS.md](TOOLS.md#declaring-a-tool-once_per). 0.1.6 and earlier dropped the field.

## Tools, context and deferred loading (0.1.10)

Declare an agent's tools once with `client.putTools(agent, tools)` and leave `tools` out of later wakes; `client.tools(agent)` reads them back. A wake can also carry `context` (facts for that call only, such as the signed-in user's plan; it is not written to the journal) and `tool_choice` (`'auto'`, `'required'` or `{ type: 'tool', name }`). On a tool, `defer_loading: true` keeps its schema out of the prompt until the agent looks it up, which pays off from about ten tools.

```ts
await client.putTools('support-bot', [{ name: 'book_slot', description: 'Book a slot.', parameters: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'] } }])
const out = await client.wake('support-bot', { message: 'Book Tuesday.', model: modelFromEnv(), context: 'Plan: pro' }, 'book-1')
```

## Structured tool results (0.1.11)

`run` answers the tools an agent asked for with a text message the model reads, and now also sends the same results as the `results` field of the wake: `[{ seq, result }]`, where `seq` is the action's `seq` and `result` is exactly what the tool returned (or the `{ error }` object when it threw). The API journals each as the real result of that call. The first wake of a run has none, and a result the ledger already held is sent again like the others. Pass `structuredResults: false` to send the text only. If the API you talk to does not know the field yet, it answers 400 and names `results`; the client sends that wake again once without it, under the same key, and leaves it out from then on. Calling `client.wake()` yourself, add `results` to the body next to the `message`, never with `fire_due`, at most 100 entries.

## Waking the agent later

Argentic has no clock of its own: your app decides when an agent runs. Pass `schedule: true` to `run` so the agent can put a time on a plan. The result's `wakeAt` is the time it next wants waking (an ISO time, already past if a plan is due), or `null`. Keep it in your own scheduler (a cron job, a delayed queue job) and wake the agent then with `fireDue: true`, which takes the place of `task`:

```ts
const out = await run({ client, agent: 'support-bot', runId: event.id, task: event.text, tools, schedule: true })
if (out.wakeAt) await queue.add('wake-support-bot', {}, { delay: Math.max(1000, Date.parse(out.wakeAt) - Date.now()) })

// later, in that job: the agent's tools run as before, and the result has the next wakeAt
const next = await run({ client, agent: 'support-bot', runId: `due-${Date.now()}`, fireDue: true, tools, schedule: true })
```

A `fireDue` wake with nothing due makes no model call and costs nothing. With `client.wake()` the same fields are `schedule: true`, `fire_due: true` and the answer's `wake_at`. `client.due()` lists every plan whose time has passed, if your scheduler loses track.

## What to know

Delivery is at-least-once. An action that was running when the process died, before its result reached the local ledger, runs again on resume. Make your handlers safe to repeat: the AI SDK `toolCallId` your `execute` receives is a stable key (`agent:seq`) to dedupe on.

Mastra tools get the same key as `context.agent.toolCallId`.

Full walkthroughs: [`examples/ai-sdk`](../../examples/ai-sdk), [`examples/mastra`](../../examples/mastra).
