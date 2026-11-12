// The shop shift (Kestrel Supply): two arms on the same seeded event stream, one scorer.
// The generator, world, prompt and refund bookkeeping come from lab/shop (byte-identical to the lab's, see lab/MANIFEST.json).
// Everything below this line is the runner: it decides only how the model is called.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../lab/shop/gen.mjs";
import { makeWorld, grade } from "../lab/shop/world.mjs";
import { system_v2 as system, task, nudge_v2 as nudge } from "../lab/shop/prompt-ops.mjs";
import { makeAttemptLog, withRefundAttempts, refundCounters, readAttempts } from "../lab/shop/attempts.mjs";
import { trim, withCache, priceOf } from "../lab/day/plain-loop.mjs";
import { sleep, jsonl, mk, patientFetch } from "./common.mjs";

export const SHOP_SEED = 20261028;
export const SHOP_EVENTS = 300;

class Stop extends Error { constructor(reason) { super(reason); this.reason = reason; } }

function makeCtx(dir, N, seed, event) {
  const ctx = { stateDir: dir, N, seed, paceMs: 0, t0: Date.now(), shiftOver: () => false, event, onFinish: (s) => { ctx.finished = s; }, finished: null, hooks: { beforeTool() {}, afterTool() {} } };
  return ctx;
}
const nonEmpty = (s) => (typeof s === "string" ? s : JSON.stringify(s));

// ---- scoring: the lab's grader, plus the same counts the research page shows. Denominators come from the full scenario, so an early stop shows as "x of 300", not as a smaller test.
export function scoreShop(dir, { events: N, seed }) {
  const world = JSON.parse(readFileSync(join(dir, "world.json"), "utf8"));
  const { events } = generate(N, seed), g = grade(events, world);
  const pass = (rows) => rows.filter((r) => r.pass).length;
  const probesAll = events.filter((e) => e.probe && e.expect), isStock = (e) => e.probe.family === "STOCK", isQuote = (e) => e.probe.family === "QUOTE";
  const rowsOf = (pred) => g.rows.filter((r) => { const e = events[r.i]; return e?.probe && e.expect && pred(e); });
  const earlier = [pass(rowsOf((e) => !isStock(e))), probesAll.filter((e) => !isStock(e)).length];
  const stock = [pass(rowsOf(isStock)), probesAll.filter(isStock).length];
  const quotes = probesAll.filter(isQuote).length, quotesRight = pass(rowsOf(isQuote));
  const dir_ = dir, rc = refundCounters(world.actions, readAttempts(dir_));
  return {
    events: N, delivered: world.cursor, answered: Object.values(world.handled).filter((h) => !h.missed).length, missed: world.missed.length,
    earlier, stock, oldPrices: quotes - quotesRight, refundedTwice: rc.refund_attempts_dup, refundsAppliedTwice: rc.refunds_applied_dup, ordersShippedTwice: g.side_effects.orders_shipped_twice, refundsNotPromised: g.side_effects.refunds_not_promised,
    complete: world.cursor >= N && world.shift_over === true,
  };
}

// ---- arm: Argentic through the public client
export async function runShopArgentic({ out, name = "shop-argentic", events: N = SHOP_EVENTS, seed = SHOP_SEED, capUsd, model, apiKey, modelKey, baseUrl, log = console.log, maxSteps = 20 * N + 200, parkAfter = 40 }) {
  if (!(capUsd > 0)) throw new Error("capUsd is required");
  const { Argentic, runDurable } = await import("@argentic-ai/client");
  const dir = mk(join(out, name)), P = (f) => join(dir, f), event = jsonl(P("events.jsonl"));
  const runFile = P("run.json"), resumed = existsSync(runFile);
  const run = resumed ? JSON.parse(readFileSync(runFile, "utf8")) : { arm: "argentic", agent: `check-${name}-${Date.now().toString(36)}`, created: new Date().toISOString(), events: N, seed, baseUrl, model: { provider: model.provider, id: model.id }, segments: [{ runId: `check-${name}`, task, steps: null }] };
  if (resumed && (run.events !== N || run.seed !== seed)) throw new Error(`${dir} holds a run with other settings; use a new --out`);
  const save = () => writeFileSync(runFile, JSON.stringify(run, null, 2)); save();
  log(resumed ? `resuming ${name}` : `shop shift, Argentic arm: ${N} events`);

  const ctx = makeCtx(dir, N, seed, event); ctx.t0 = Date.parse(run.created);
  const attempts = makeAttemptLog(dir);
  // once_per: the same refund guard our own runs declared, so a refund is paid once per order by the engine as well as by the prompt.
  const tools = withRefundAttempts(makeWorld(ctx), ctx, attempts, (a, c) => `seq:${c.seq}`).map((t) => (t.name === "refund" ? { ...t, once_per: "refund:{order_id}" } : t));
  const wakeSpend = new Map(), spent = () => [...wakeSpend.values()].reduce((a, b) => a + b, 0);
  let lastWake = null, curStep = 0, hosted429 = 0;
  class Tracking extends Argentic {
    async wake(agent, body, key) {
      for (let tries = 0; ; tries++) {
        const res = await super.wake(agent, body, key);
        const transient = res.status === "error" && /provider_rate_limited|provider_unavailable|overloaded/.test(String(res.error ?? ""));
        if (transient && tries < 30) { const w = res.error === "provider_rate_limited" ? 30 : 15; event({ type: "provider_error", key, error: res.error, wait_s: w }); log(`  ${res.error}, waiting ${w}s and sending the same call again`); await sleep(w * 1000); continue; }
        if (res.wake_id && typeof res.spent_usd === "number") wakeSpend.set(res.wake_id, res.spent_usd);
        lastWake = res; return res;
      }
    }
  }
  const client = new Tracking({ apiKey, modelKey, baseUrl, timeoutMs: 900_000, fetch: patientFetch((w) => { hosted429 = w.total; event({ type: "hosted_429", ...w }); }) });
  // spend from earlier processes (a resumed run): the metrics file has one row per wake id
  const metrics = P("metrics.jsonl");
  if (existsSync(metrics)) for (const l of readFileSync(metrics, "utf8").split("\n").filter(Boolean)) { try { const r = JSON.parse(l); if (r.wake_id) wakeSpend.set(r.wake_id, r.spent_usd ?? 0); } catch { /* skip */ } }

  let stopReason = null, result = null, progress = 0, lastProgressStep = 0;
  const HARD = new Set(["spend_cap", "budget_cap", "hard_cap", "daily_cap", "approval_required", "error"]);
  try {
    for (;;) {
      const si = run.segments.length - 1, seg = run.segments[si], offset = run.segments.slice(0, si).reduce((a, g) => a + (g.steps ?? 0), 0);
      if (offset >= maxSteps) { stopReason = `step limit ${maxSteps}`; break; }
      result = await runDurable({
        client, agent: run.agent, runId: seg.runId, task: seg.task, system, tools, ledgerPath: P("ledger.json"), model, maxSteps: maxSteps - offset, limits: { max_turns: 1 }, log: () => {},
        onWakeStart: ({ step }) => {
          curStep = offset + step;
          if (ctx.finished !== null) throw new Stop("finish");
          const s = spent(); if (s >= capUsd) throw new Stop(`spend cap ${capUsd} reached (${s.toFixed(3)})`);
          const w = ctx.world.load(), done = Object.keys(w.handled).length;
          if (done !== progress) { progress = done; lastProgressStep = curStep; }
          if (w.shift_over && curStep - lastProgressStep > 5 && ctx.finished === null) throw new Stop("shift over, finish not called");
          if (w.pending !== null && curStep - lastProgressStep >= parkAfter) { const e = ctx.world.events[w.pending]; w.missed.push(e.id); w.handled[e.id] = { n: null, tool: null, missed: true }; w.pending = null; w.reminders = 0; w.notice = `Event ${e.id} was skipped by the system after ${parkAfter} steps without progress. Call next_event.`; ctx.world.save(w); lastProgressStep = curStep; event({ type: "park", event: e.id }); }
          if (curStep % 25 === 0) log(`  step ${curStep}: delivered ${w.cursor} of ${N}, answered ${done}, spent ${s.toFixed(3)} USD`);
        },
        onWake: ({ step, wakeId, status }) => { const r = lastWake ?? {}; appendFileSync(metrics, JSON.stringify({ step: offset + step, wake_id: wakeId, status, spent_usd: r.spent_usd ?? 0, tokens_in: r.usage?.prompt_tokens ?? null, tokens_out: r.usage?.output_tokens ?? null, cache_hit_tokens: r.usage?.cache_hit_tokens ?? null }) + "\n"); },
        onAction: ({ tool }) => { if (ctx.finished !== null && tool === "finish") throw new Stop("finish"); },
      });
      seg.steps = result.steps; save();
      if (!HARD.has(result.status) && offset + result.steps < maxSteps) { event({ type: "new_segment", after: result.status }); run.segments.push({ runId: `check-${name}-s${si + 1}`, task: nudge({ status: result.status }), steps: null }); save(); continue; }
      stopReason = `engine stopped: ${result.status}`; break;
    }
  } catch (e) {
    if (e instanceof Stop) stopReason = e.reason; else { stopReason = `error: ${String(e?.message ?? e).slice(0, 200)}`; event({ type: "error", error: String(e?.stack ?? e).slice(0, 600) }); }
  }
  const score = scoreShop(dir, run);
  const summary = { arm: "argentic", events: N, seed, stopReason, finished: ctx.finished !== null, spent_usd: +spent().toFixed(4), wakes: wakeSpend.size, hosted_429: hosted429, model: run.model, ...score };
  summary.complete = score.complete && stopReason === "finish";
  writeFileSync(P("summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}

// ---- arm: the plain loop on the Messages API. What a developer writes first: send the transcript, run the tools the model asks for, append the results, repeat.
// The transcript is windowed (oldest turns dropped in a chunk, first message kept). No memory, no summary.
export async function runShopPlain({ out, name = "shop-plain", events: N = SHOP_EVENTS, seed = SHOP_SEED, capUsd, model, apiKey, upstream = "https://api.anthropic.com", windowTokens = 40000, log = console.log, callModel: injected = null, maxCalls = 12 * N + 200, maxTokens = 2048 }) {
  if (!(capUsd > 0)) throw new Error("capUsd is required");
  if (!apiKey && !injected) throw new Error("an Anthropic API key is required (MODEL_KEY or ANTHROPIC_API_KEY)");
  const dir = mk(join(out, name)), P = (f) => join(dir, f), event = jsonl(P("events.jsonl"));
  if (existsSync(P("summary.json"))) throw new Error(`${dir} already holds a finished run; use a new --out`);
  writeFileSync(P("run.json"), JSON.stringify({ arm: "plain", events: N, seed, model: { provider: model.provider, id: model.id }, window_tokens: windowTokens, memory: "none", compaction: "none", created: new Date().toISOString() }, null, 2));
  log(`shop shift, plain-loop arm: ${N} events, window ${windowTokens} tokens`);
  const ctx = makeCtx(dir, N, seed, event), attempts = makeAttemptLog(dir);
  const tools = withRefundAttempts(makeWorld(ctx), ctx, attempts, (a, c) => `seq:${c.seq}`);
  const byName = new Map(tools.map((t) => [t.name, t]));
  const decls = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const sys = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const headers = { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  async function call(messages) {
    if (injected) return injected({ system: sys, tools: decls, messages });
    const body = JSON.stringify({ model: model.id, max_tokens: maxTokens, system: sys, tools: decls, messages });
    for (let attempt = 0; ; attempt++) {
      let res; try { res = await fetch(`${upstream}/v1/messages`, { method: "POST", headers, body }); } catch (e) { if (attempt >= 6) throw e; await sleep(2000 * 2 ** attempt); continue; }
      if (res.ok) return res.json();
      const txt = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 6) { event({ type: "api_retry", status: res.status, attempt }); await sleep(Math.min(60000, 2000 * 2 ** attempt)); continue; }
      throw new Error(`Messages API ${res.status}: ${txt.slice(0, 300)}`);
    }
  }
  let messages = [{ role: "user", content: task }], spentUsd = 0, calls = 0, seq = 0, nudges = 0, trims = 0, stopReason = null, overCalls = 0, quiet = 0;
  try {
    for (;;) {
      if (ctx.finished !== null) throw new Stop("finish");
      if (spentUsd >= capUsd) throw new Stop(`spend cap ${capUsd} reached (${spentUsd.toFixed(3)})`);
      if (calls >= maxCalls) throw new Stop(`call limit ${maxCalls} reached`);
      const w = ctx.world.load(); if (w.shift_over && ++overCalls > 8) throw new Stop("shift over, finish not called");
      messages = trim(messages, windowTokens, (t) => { trims++; event({ type: "trim", ...t }); });
      const r = await call(withCache(messages)); calls++;
      const u = r.usage ?? {}; spentUsd += priceOf(u, model.prices);
      messages.push({ role: "assistant", content: r.content });
      const uses = r.content.filter((b) => b.type === "tool_use");
      if (!uses.length) { if (++nudges > 50) throw new Stop("too many replies without a tool call"); messages.push({ role: "user", content: nudge({ status: `ended with ${r.stop_reason}` }) }); continue; }
      const results = [];
      for (const b of uses) {
        const t = byName.get(b.name);
        if (!t) { results.push({ type: "tool_result", tool_use_id: b.id, content: `error: unknown tool ${b.name}`, is_error: true }); continue; }
        const outText = nonEmpty(await t.execute(b.input ?? {}, { seq: ++seq }));
        results.push({ type: "tool_result", tool_use_id: b.id, content: outText, ...(/^error[: ]/i.test(outText) ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      if (calls % 50 === 0) { const s = ctx.world.load(); log(`  call ${calls}: delivered ${s.cursor} of ${N}, answered ${Object.keys(s.handled).length}, spent ${spentUsd.toFixed(3)} USD`); }
      quiet = 0;
    }
  } catch (e) {
    if (e instanceof Stop) stopReason = e.reason; else { stopReason = `error: ${String(e?.message ?? e).slice(0, 200)}`; event({ type: "error", error: String(e?.stack ?? e).slice(0, 600) }); }
  }
  const score = scoreShop(dir, { events: N, seed });
  const summary = { arm: "plain", events: N, seed, stopReason, finished: ctx.finished !== null, spent_usd: +spentUsd.toFixed(4), model_calls: calls, trims, nudges, model: { provider: model.provider, id: model.id }, window_tokens: windowTokens, ...score };
  summary.complete = score.complete && stopReason === "finish";
  writeFileSync(P("summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}
