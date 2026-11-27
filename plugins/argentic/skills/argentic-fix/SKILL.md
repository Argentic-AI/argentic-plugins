---
name: argentic-fix
description: Use when an Argentic run stopped or the user asks why ("why did my run stop", "resume it", "it hit a cap"). Finds the cause from the wake and its replay check and proposes a fix. Resuming is done by the user's app.
---

# Fix a run that stopped

This MCP cannot wake or resume an agent: the user's app does that over the REST API, on its own model key. Find the cause first, say it, and tell the user what their app should do.

## Steps

1. Get the wake. If you do not have the wake id, call `argentic_wakes` with `state: "open"` for the agent. Then call `argentic_wake_get` and read its `status`.
2. Read what `argentic_wake_get` says about the wake (its state, runs and any reply or error). If you need the individual steps, send the user to the run page in the dashboard (`get_run_links` gives the address); the MCP does not read journals. `argentic_replay` with `wake` set to the wake id checks the run still matches what the model was shown.
3. State the cause in one sentence, with the evidence. Example: "The run stopped on `spend_cap`: it had spent $0.05 of a $0.05 limit after 6 turns."
4. Propose the fix from the table below.
5. Tell the user the fix. To resume, their app calls `POST /v1/agents/{agent}/resume` with its own model key and API key. Do not try to resume from here.

## Status, meaning, fix

| State | What it means | What to do |
|---|---|---|
| `interrupted` | The process died mid-run. | Resume. |
| `queued` | Another call holds the agent. | Wait `retry_after` seconds and send again. A run that died holds the agent for up to two minutes. |
| `spend_cap` or `budget_cap` | A spend limit stopped it. Work so far is kept. | Ask the user. If they agree, resume with a higher `max_usd`. For the organization budget, `set_budget` needs an owner or admin. |
| `turn_cap` | It ran out of turns. | Resume with a higher `max_turns`. |
| `time_cap` | It ran out of time. | Resume. It continues. |
| `error`, `bad_model`, `model_key_rejected` | The model call failed or the provider refused. Nothing was spent. | Fix the model id or the key in the app, then resume. The reply says why. |
| `model_key_required` | The app's wake call has no model key header. | The user adds `X-Model-Key` to the app's call. |

## Raising a cap

A cap stopped the run. Ask the human whether to raise the budget with `set_budget`, then tell them to resume from their app. Never raise it on your own.

## What resume does

Anything you send, such as a higher `max_usd`, replaces what the wake had. A tool call that already finished is not run again. A tool call that was cut off is requested again once, so de-duplicate on the action's stable `seq` (the key is `agent:seq`). A model call that was lost is asked again and charged at its estimate. Resume does not add the original message a second time.

## After

If the app resumed and it stopped again, go back to step 1 with the new wake.
