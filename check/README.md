# @argentic-ai/check

Run our shop shift and our coordinator day yourself. Same scripted scenario for both arms, scored by code, on your own keys, with a spend cap you set.

- **Shop shift.** An agent runs a small online shop through hundreds of events: orders, price changes, refund requests, supplier deliveries, questions from the CEO. Code scores what it remembers from earlier (preferences, promised refunds, price changes, the refund window), whether the stock counts are exact, and whether it paid a refund twice.
- **Coordinator day.** An agent runs a crew of workers for one person across a simulated day. Code scores whether follow-ups reached the right worker, whether any ask was lost or started twice, whether the person's standing rules held, what it remembered, and whether its status reports were honest. This one is early: we have run it on only a few seeds, and our own runs showed gaps we are still working on.

Each command runs two arms on the same script: a plain windowed loop we wrote (the transcript, with the oldest turns dropped when it grows) and Argentic through the public client. You get one table. It is a spot check on your own keys, not a benchmark: one scenario, one seed, one model. Run a few seeds before you read anything into a difference.

## Try it without a key

```
npx @argentic-ai/check controls
```

Runs the scorers on scripted agents (a perfect one, a forgetful one, one that pays refunds twice, an idle one). No model, no keys, no network. It shows the scorers can reach 100% and that an agent without memory does not.

## Run it

You need an Anthropic key and an Argentic key (https://getargentic.com/platform). Node 22 or newer. Set the keys in your shell, not in a file.

```
export MODEL_KEY=sk-ant-...
export ARGENTIC_API_KEY=aek_...
npx @argentic-ai/check shop --cap-usd 0.5
```

fish:

```
set -x MODEL_KEY sk-ant-...
set -x ARGENTIC_API_KEY aek_...
npx @argentic-ai/check shop --cap-usd 0.5
```

It prints an estimate and the cap, then waits for you to confirm (`--yes` skips the question; without a terminal and without `--yes` it refuses to start).

```
npx @argentic-ai/check day --cap-usd 0.3
```

| flag | |
|---|---|
| `--cap-usd N` | Required. The most the run will spend in total. Each arm gets an equal share and stops when it reaches it; the table then marks that arm INCOMPLETE and scores against the whole scenario, so a stopped run cannot look better by being shorter. |
| `--events N` | Shop only. Events in the shift. Default 300. Our published runs used 900. |
| `--asks N` | Day only. Asks in the day. Default 18. Our multi-seed runs used 54. |
| `--seed N` | Scenario seed. Defaults to ours; change it to run a different shift. |
| `--arms plain,argentic` | Default both. One arm halves the cost. |
| `--model ID` | Default `claude-haiku-5-5`. Another model needs `--prices in,out,cache_hit,cache_write` (USD per million tokens), so the cap means something. |
| `--out DIR` | Where run files go. Default `./check-runs`. |
| `--base-url URL` | Argentic API. Default `https://api.getargentic.com`. |

Set `ANTHROPIC_BASE_URL` to send the plain loop's calls through a proxy.

## What it costs

From our own runs on Haiku 5.5. These are guesses for your run; the cap is the guarantee.

| | Argentic | plain loop | time |
|---|---|---|---|
| shop, 300 events (default) | about $0.17 | about $0.24 | about an hour and a half in total |
| shop, 900 events | about $0.50 | about $0.7 | about 3 hours for Argentic |
| day, 18 asks (default) | about $0.06 | about $0.05 | about 8 minutes in total |
| day, 54 asks | about $0.19 | about $0.15 | 10 to 25 minutes for Argentic |

The plain loop has no run of ours at shop size, so its figure is the least certain. The Argentic arm makes about 1.2 wakes per shop event (a 300-event shift is about 350 wakes) and about 7 per day ask; check your plan's call limit first.

## The rows

Shop shift: **earlier facts** are the questions about preferences, promised refunds, price changes and the refund window, answered right out of the total asked. **Stock exact** is the CEO's stock-count questions answered with the exact number. **Old prices** are quote questions answered with a price that had since changed. **Refunded twice** counts refund calls made for an order that was already refunded. These are the same rows as the November shop-shift page at https://getargentic.com/research/long-run-november/.

Coordinator day: **routing**, **asks started once**, **rules kept**, **earlier facts**, **status F1** and **duplicate workers**, from the lab's scorer. No composite score.

## Same files as the lab's

The scenario generators, worlds, prompts and scorers in `lab/` are byte-identical copies of the lab's. `npx @argentic-ai/check verify` checks their hashes against `lab/MANIFEST.json`, and the test suite does too. Only the runners in `src/` are new: they decide how the model is called and nothing else.

## What differs from our published runs

- **Shorter shift by default.** 300 events has about 20 earlier-fact questions and 8 stock questions, so a single run moves by whole questions. Use `--events 900` for the published length.
- **No journal-state on/off arm.** That is a server setting per account that you cannot flip. Your comparison is Argentic against a plain loop, which our November page did not have.
- **Model and prompts.** Haiku 5.5 and the same shared prompt (v2). The Argentic arm declares the same once-per-order guard on the refund tool that our runs did.
- **No kills.** Our published shop runs also killed the process at random and resumed it. This tool does not.
- **Engine build.** The table prints the build and commit the API reports at `/health`. The API does not report the engine's release number yet, so match the commit against the changelog.

## What it does with your keys

Your Anthropic key goes to Anthropic for the plain loop. For the Argentic arm it goes in the `X-Model-Key` header to Argentic, which does not store it. Your Argentic key goes only to Argentic. Run files in `--out` hold the scenario's events and what each arm did; they never hold either key.

MIT licensed.
