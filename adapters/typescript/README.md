# Argentic for TypeScript

Argentic runs the agent loop. Your Vercel AI SDK or Mastra tools and system prompt carry over; the framework's own loop (`generateText`, `Agent`, Mastra `Agent.generate`) is not used.

Each turn, Argentic rebuilds the prompt from a journal of the run instead of replaying an ever-growing transcript: state blocks plus a recent tail of about 40K tokens. The journal keeps the full record, so you can see every step the agent took and check it against what the model saw.

Each tool call the agent makes comes back to your code to carry out. If the process dies mid-run, run it again: it resumes without repeating a finished action.

## Try it

```
npx @argentic-ai/client demo
```

Set `ARGENTIC_API_KEY` and `MODEL_KEY` first. Press Ctrl-C while it works, run it again, and it skips what already finished. Details in the [repo README](../../README.md#run-the-demo-2-minutes).

## Install

```
npm i @argentic-ai/client
```

- `@argentic-ai/client`: the client and `runDurable`, no dependencies, Node 22+.
- `@argentic-ai/client/ai-sdk`: `fromAiSdkTools`, needs `ai` v5, v6 or v7.
- `@argentic-ai/client/tools`: `toolPack`, retry-safe tools for Stripe, Resend, SMTP, Slack, GitHub and a generic HTTP POST. See [TOOLS.md](TOOLS.md).
- `@argentic-ai/client/mastra`: `fromMastraTools`, takes the `createTool()` tools you would pass to an Agent (the key is the tool name). Needs `@mastra/core` 1.x for the tools; the adapter itself imports nothing.

To vendor it instead: clone this repo and copy `argentic.ts`, `ai-sdk.ts` and `mastra.ts` into your project (Node 22+, no package needed beyond what you already use).

## Use

```ts
import { tool } from 'ai'
import { z } from 'zod'
import { Argentic, runDurable } from '@argentic-ai/client'
import { fromAiSdkTools } from '@argentic-ai/client/ai-sdk'

const tools = { refund_order: tool({
  description: 'Refund an order.',
  inputSchema: z.object({ order_id: z.string(), amount_usd: z.number() }),
  execute: async (args, { toolCallId }) => refund(args, toolCallId),
}) }

// apiKey defaults to ARGENTIC_API_KEY and modelKey to MODEL_KEY
const client = new Argentic()
const out = await runDurable({
  client, agent: 'my-agent', runId: 'order-1182', ledgerPath: '.argentic-ledger.json',
  task: 'Refund order 1182.', system: 'Call one tool per turn.',
  tools: await fromAiSdkTools(tools),
})
console.log(out.reply)
```

Keep `agent` and `runId` the same across restarts. A request that takes longer than `timeoutMs` (default 300000, 0 for no limit) counts as a network failure and is retried with the same key. If the ledger file is not valid JSON, `runDurable` warns on stderr, sets the file aside as `<path>.corrupt` and starts empty, so finished actions may run again. `client.replay(agent, wakeId)` re-renders a wake's prompts from the journal and compares them to what the model saw; it calls no model and spends nothing.

## Once per operation (`once_per`, 0.1.7)

A tool can declare `once_per`, a key such as `refund:{order_id}` filled in from the call's arguments. Argentic then refuses a second call with the same key, in this wake or any later one. Set it on a `DurableTool` directly, or pass `{ oncePer: { refund_order: 'refund:{order_id}' } }` as the second argument to `fromAiSdkTools` or `fromMastraTools`. The template is checked before the request is sent. See [TOOLS.md](TOOLS.md#declaring-a-tool-once_per). 0.1.6 and earlier dropped the field.

## Tools, context and deferred loading (0.1.10)

Declare an agent's tools once with `client.putTools(agent, tools)` and leave `tools` out of later wakes; `client.tools(agent)` reads them back. A wake can also carry `context` (facts for that call only, such as the signed-in user's plan; it is not written to the journal) and `tool_choice` (`'auto'`, `'required'` or `{ type: 'tool', name }`). On a tool, `defer_loading: true` keeps its schema out of the prompt until the agent looks it up, which pays off from about ten tools.

```ts
await client.putTools('support-bot', [{ name: 'book_slot', description: 'Book a slot.', parameters: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'] } }])
const out = await client.wake('support-bot', { message: 'Book Tuesday.', model: freeModel, context: 'Plan: pro' }, 'book-1')
```

## Structured tool results (0.1.11)

`runDurable` answers the tools an agent asked for with a text message the model reads, and now also sends the same results as the `results` field of the wake: `[{ seq, result }]`, where `seq` is the action's `seq` and `result` is exactly what the tool returned (or the `{ error }` object when it threw). The API journals each as the real result of that call. The first wake of a run has none, and a result the ledger already held is sent again like the others. Pass `structuredResults: false` to send the text only. If the API you talk to does not know the field yet, it answers 400 and names `results`; the client sends that wake again once without it, under the same key, and leaves it out from then on. Calling `client.wake()` yourself, add `results` to the body next to the `message`, never with `fire_due`, at most 100 entries.

## Waking on a schedule (handleDue)

Create a recurring schedule or a one-shot timer, and read what is due:

```ts
const client = new Argentic()
await client.putSchedule('support-bot', 'morning-check', { cron: '0 9 * * *', message: 'Review overnight tickets.' }) // five UTC fields
await client.putSchedule('support-bot', 'follow-up', { at: '2026-11-20T09:00:00Z', message: 'Chase the open refund.' }) // one-shot
await client.schedules('support-bot')   // name, cron or at, next_at, last_fired_at, fires
await client.due()                      // what is due now; wake each agent with fire_due, or let the notice below do it
await client.deleteSchedule('support-bot', 'follow-up')
```


Beta, off by default on the hosted API, and open to single beta users only for now. When an agent falls due (a plan's `wake_at`, a schedule, a timer or a hook event), Argentic POSTs a signed notice to the `wake_url` you registered. The notice names the agent and why it is due and carries no agent content and no model key. `handleDue` checks the signature and the time, then wakes the agent with `fire_due` on your own model key.

Register the address and read the secret with the client: `await client.setWakeUrl('https://app.example.com/argentic/due')`, then `(await client.notices()).signing_secret` (`whsec_...`). Store it like a password, for example as `ARGENTIC_WEBHOOK_SECRET`. The model key stays on your server: set `MODEL_KEY` there, as for any other wake.

```ts
import { Hono } from 'hono'
import { handleDueResponse } from '@argentic-ai/client'

const app = new Hono()
// Reads ARGENTIC_API_KEY, MODEL_KEY and ARGENTIC_WEBHOOK_SECRET from the environment.
app.post('/argentic/due', (c) => handleDueResponse(c.req.raw))
```

`handleDueResponse` answers 200 when the agent was woken, 401 if the signature or time is wrong, 400 if the body is not an `agent.due` notice, 500 if the secret is missing or malformed, and 502 if the wake itself failed (the notice is then sent again). It takes a Fetch `Request` or `{ body, headers }` with the raw body text, and works the same in a Next.js route handler. `handleDue(request, { secret, client, model, toleranceSeconds })` returns `{ notice, wake }` and throws `WebhookVerificationError` (with a `code`) before any call is made. `verifyDue(request)` only verifies and parses, so you can queue the notice and wake later. The wake uses the notice's `webhook-id` as its idempotency key, so a notice delivered twice replays the first wake instead of waking twice. Timestamps more than 300 seconds off are refused.

## What to know

Delivery is at-least-once. An action that was running when the process died, before its result reached the local ledger, runs again on resume. Make your handlers safe to repeat: the AI SDK `toolCallId` your `execute` receives is a stable key (`agent:seq`) to dedupe on.

Mastra tools get the same key as `context.agent.toolCallId`.

Full walkthroughs: [`examples/ai-sdk`](../../examples/ai-sdk), [`examples/mastra`](../../examples/mastra).
