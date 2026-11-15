# @argentic-ai/check

One harness for running a scripted agent scenario yourself. Same script for both arms, scored by code, on your own keys, with a spend cap you set. The harness knows nothing about any one scenario: each scenario is a **suite**, and `list` shows the ones that ship with this version.

| suite | what it is |
|---|---|
| `shop` (shop shift) | An agent runs a small online shop through hundreds of events: orders, price changes, refund requests, supplier deliveries, questions from the CEO. Code scores what it remembers from earlier (preferences, promised refunds, price changes, the refund window), whether the stock counts are exact, and whether it paid a refund twice. |
| `day` (coordinator day) | An agent runs a crew of workers for one person across a simulated day. Code scores whether follow-ups reached the right worker, whether any ask was lost or started twice, whether the person's standing rules held, what it remembered, and whether its status reports were honest. This one is early: we have run it on only a few seeds, and our own runs showed gaps we are still working on. |
| `longshift` | An agent is the one desk worker at a small bakery for a shift of hours, with about a hundred events an hour from the owner, customers, workers and systems. Code scores eight kinds of question (a fact given earlier, the current value of something that changed, standing instructions, contradictions, commitments, delegation and status, running counts, conflicting updates), each placed at a known hour and a known distance from what it needs. You get accuracy by hour and prompt size by hour, not one score. Argentic built longshift and also enters it. |

Each run uses two arms on the same script: a plain windowed loop we wrote (the transcript, with the oldest turns dropped when it grows) and Argentic through the public client. You get one table. It is a spot check on your own keys, not a benchmark: one scenario, one seed, one model. Run a few seeds before you read anything into a difference.

## Run it

You need an Anthropic key and an Argentic key (https://getargentic.com/platform). Node 22 or newer. Set the keys in your shell, not in a file.

```
export MODEL_KEY=sk-ant-...
export ARGENTIC_API_KEY=aek_...
npx @argentic-ai/check run shop --cap-usd 0.5
```

`run shop` and `shop` are the same command; every suite id works as a command.

fish:

```
set -x MODEL_KEY sk-ant-...
set -x ARGENTIC_API_KEY aek_...
npx @argentic-ai/check run shop --cap-usd 0.5
```

It prints an estimate and the cap, then waits for you to confirm (`--yes` skips the question; without a terminal and without `--yes` it refuses to start).

```
npx @argentic-ai/check run day --cap-usd 0.3
```

Free, no keys: `npx @argentic-ai/check list` shows the suites, and `npx @argentic-ai/check controls` runs scripted agents (a perfect one, a forgetful one, one that repeats every action, one that does nothing) against each scorer.

| flag | |
|---|---|
| `--cap-usd N` | Required. The most the run will spend in total. Each arm gets an equal share and stops when it reaches it; the table then marks that arm INCOMPLETE and scores against the whole scenario, so a stopped run cannot look better by being shorter. |
| `--size N` | How long the scenario is. Every suite takes it, and each has its own name for it: `--events N` for shop (default 300; our published runs used 900) and `--asks N` for day (default 18; our multi-seed runs used 54). |
| `--hours N` | Longshift's name for `--size`: whole hours of shift, 3 to 48 (default 6; question kind F8 needs 5 or more). |
| `--window-tokens N` | Shop only. The plain loop's window. Default 40000. |
| `--plain-variant compact\|keep` | Longshift only. The plain loop with the provider's own context compaction (default), or one that keeps the whole transcript. Keep-everything costs far more over a long shift. |
| `--seed N` | Scenario seed. Defaults to ours; change it to run a different shift. |
| `--arms plain,argentic` | Default every arm the suite has. One arm halves the cost. |
| `--model ID` | Default `claude-haiku-5-5`. Another model needs `--prices in,out,cache_hit,cache_write` (USD per million tokens), so the cap means something. |
| `--out DIR` | Where run files go. Default `./check-runs`. |
| `--base-url URL` | Argentic API. Default `https://api.getargentic.com`. |

Set `ANTHROPIC_BASE_URL` to send the plain loop's calls through a proxy.

## Add a suite

A suite is one file that default-exports an object; nothing in the harness changes. It names the scenario, its length knob, its arms (each with a cost estimate and a `run` function that stops itself at the cap it is handed), and how to print the result:

```js
export default {
  id: "my-suite", title: "My suite", blurb: "one plain sentence",
  size: { flag: "rounds", unit: "rounds", default: 50 }, seed: 1, flags: {},
  arms: {
    mine: { label: "my agent", estimate: (n) => ({ usd: 0.002 * n, minutes: n / 10 }),
            run: async (ctx) => ({ spent_usd: 0, complete: true /* ...your scores */ }) },
  },
  describe: (size, seed) => `My suite: ${size} rounds, seed ${seed}`,
  report: (results, meta) => "a table",
};
```

```
npx @argentic-ai/check run ./my-suite.mjs --cap-usd 1
```

`ctx` carries the run folder, the size and seed, this arm's share of the cap, the model and its prices, both keys, and the API URLs. An arm that needs an Argentic key sets `argentic: true` and the harness checks for it. A suite file is code that runs with your keys in its environment, so read one before you run it. The harness gives every suite the same refusals: no cap, no run; no confirmation, no run; an arm that hits its cap is marked INCOMPLETE and scored against the whole scenario.

## What it costs

From our own runs on Haiku 5.5. These are guesses for your run; the cap is the guarantee.

| | Argentic | plain loop | time |
|---|---|---|---|
| shop, 300 events (default) | about $0.17 | about $0.24 | about an hour and a half in total |
| shop, 900 events | about $0.50 | about $0.7 | about 3 hours for Argentic |
| day, 18 asks (default) | about $0.06 | about $0.05 | about 8 minutes in total |
| day, 54 asks | about $0.19 | about $0.15 | 10 to 25 minutes for Argentic |
| longshift, 6 hours (default) | about $0.15 | about $1.7 with compaction (about $4.7 keeping everything) | about 2 hours for Argentic |

The longshift figures come from the kit's own free cost estimator, which is assumptions, not measurements. We have not yet run longshift live on your setup's path, so treat its estimate as the roughest of the three.

The plain loop has no run of ours at shop size, so its figure is the least certain. The Argentic arm makes about 1.2 wakes per shop event (a 300-event shift is about 350 wakes) and about 7 per day ask; check your plan's call limit first.

## The rows

Shop: **earlier facts** are the questions about preferences, promised refunds, price changes and the refund window, answered right out of the total asked. **Stock exact** is the CEO's stock-count questions answered with the exact number. **Old prices** are quote questions answered with a price that had since changed. **Refunded twice** counts refund calls made for an order that was already refunded. These are the same rows as the November shop-shift page at https://getargentic.com/research/long-run-november/.

Day: **routing**, **asks started once**, **rules kept**, **earlier facts**, **status F1** and **duplicate workers**, from the lab's scorer. No composite score.

Longshift: one column per question kind (recall, current value, rules, contradictions, commitments, delegation, counts, conflicting updates), then accuracy and mean prompt tokens by hour of the shift. No composite score.

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

MIT licensed, except `lab/longshift/`, which is Apache-2.0 for code and CC BY 4.0 for scenario text and data (see the licence files in that folder).
