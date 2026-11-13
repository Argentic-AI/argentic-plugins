// Adapted from the lab's coordinator-day/argentic.mjs: only the import paths and the client package name changed (@argentic-labs -> @argentic-ai). Nothing here is scored; the scorer is lab/day/grade.mjs.
// Entry A: the Argentic hosted engine, driven only through the public @argentic-ai/client (the calls any customer makes). Nothing here reaches into engine internals.
// The engine decides what goes into each prompt. This process carries out the tool calls the engine hands back (the client's run) and sends their results with the next wake.
// Spend comes from the engine's own per-wake spent_usd. No resume: the world lives in this process, so a crashed run is void and restarts under a new name.
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { setupRun, Stop, sleep } from "../lab/day/drive-core.mjs";
import { system_p1, task_p1, nudge_p1 } from "../lab/day/prompt.mjs";

const HAIKU_PRICES = { in: 0.1, out: 0.5, cache_hit: 0.01, cache_write: 0.125 };
const maybeJson = (t) => { if (typeof t === "string" && /^[{\[]/.test(t)) { try { return JSON.parse(t); } catch { /* keep the text */ } } return t; };
export function clientVersion() { try { const entry = createRequire(import.meta.url).resolve("@argentic-ai/client"), root = dirname(dirname(entry)); return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version; } catch { return "unknown"; } }

export async function runArgentic({ name, root, asks = 18, seed = 20261106, capUsd, maxMs, maxCalls, maxSteps = 4000, maxTurns = 1, baseUrl = process.env.ARGENTIC_BASE_URL ?? "https://api.getargentic.com", apiKey = process.env.ARGENTIC_API_KEY,
  modelKey = process.env.MODEL_KEY, provider = process.env.MODEL_PROVIDER ?? "anthropic", modelId = process.env.MODEL_ID ?? "claude-haiku-5-5", prices = HAIKU_PRICES, providerWaitMs = 15000, maxProviderRetries = 30, maxSegments = 50, quiet = false }) {
  if (!apiKey) throw new Error("ARGENTIC_API_KEY is not set");
  if (!modelKey) throw new Error("MODEL_KEY is not set");
  const { Argentic, run: runLoop } = await import("@argentic-ai/client");
  const model = { provider, id: modelId, prices: typeof prices === "string" ? JSON.parse(prices) : prices };
  const wakeSpend = new Map(), spent = () => { let s = 0; for (const v of wakeSpend.values()) s += v; return s; };
  const run = setupRun({ root, name, asks, seed, entry: "argentic-hosted", capUsd, maxMs, maxCalls, spent, quiet, config: { client: "@argentic-ai/client", client_version: clientVersion(), base_url: baseUrl, model, max_turns: maxTurns, resume: "none (run is void if the process dies)" } });
  const metricsFile = run.P("metrics.jsonl"), rows = []; let hosted429 = 0;
  const patientFetch = async (url, init) => { for (;;) { const r = await fetch(url, init); if (r.status !== 429) return r; hosted429++; const ra = Number(r.headers.get("retry-after")) || 5; await r.body?.cancel().catch(() => {}); run.event({ type: "hosted_429", wait_s: ra, total: hosted429 }); await sleep(ra * 1000 + 250); } };
  class TrackClient extends Argentic {
    async wake(agent, body, key) {
      for (let tries = 0; ; tries++) {
        const started = Date.now(), res = await super.wake(agent, body, key), ended = Date.now();
        const transient = res.status === "error" && /provider_rate_limited|provider_unavailable|overloaded/.test(String(res.error ?? ""));
        if (transient && tries < maxProviderRetries) { run.event({ type: "provider_error", key, error: res.error, tries: tries + 1 }); await sleep(providerWaitMs); continue; }
        if (res.wake_id && typeof res.spent_usd === "number") wakeSpend.set(res.wake_id, res.spent_usd);
        const u = res.usage, tok = u && ["prompt_tokens", "output_tokens"].every((k) => typeof u[k] === "number") ? { prompt: u.prompt_tokens, output: u.output_tokens, read: u.cache_hit_tokens ?? 0, write: u.cache_write_tokens ?? 0 } : null;
        const row = { t: new Date(ended).toISOString(), latency_ms: ended - started, usd: res.spent_usd ?? 0, wake_id: res.wake_id, wake_status: res.status, turns: res.turns ?? null, n_actions: res.actions?.length ?? 0, key, prompt_tokens: tok?.prompt ?? null, output_tokens: tok?.output ?? null, cursor: run.world.wakes.length, call: run.modelCalls() };
        rows.push(row); appendFileSync(metricsFile, JSON.stringify(row) + "\n"); return res;
      }
    }
  }
  const client = new TrackClient({ apiKey, modelKey, baseUrl, timeoutMs: 900_000, fetch: patientFetch });
  const tools = run.world.schemas().map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema, execute: async (args) => maybeJson(run.exec(t.name, args)) }));
  const agent = `coordday-${name}`, system = system_p1(); let stopReason = null, result = null, segments = 0, segTask = task_p1, nudges = 0; const HARD = new Set(["spend_cap", "budget_cap", "approval_required", "error"]);
  try {
    for (;;) {
      result = await runLoop({ client, agent, runId: `${name}-s${segments}`, task: segTask, system, tools, ledgerPath: run.P("action-ledger.json"), model, maxSteps, limits: { max_turns: maxTurns }, log: (l) => run.logLine(l), onWakeStart: () => { run.beforeCall(); run.noteModelCall(); } });
      if (run.state.finished !== null) { stopReason = "finish"; break; }
      if (HARD.has(result.status)) { stopReason = `engine stopped: ${result.status}`; break; }
      if (++segments >= maxSegments) { stopReason = "too many segments without finish"; break; }
      nudges++; run.event({ type: "new_segment", after: result.status, segments }); segTask = nudge_p1({ status: `ended with status ${result.status}` });
    }
  } catch (e) {
    if (e instanceof Stop) stopReason = e.reason;
    else { run.event({ type: "error", error: String(e?.stack ?? e).slice(0, 800) }); run.logLine(`ERROR ${String(e?.message ?? e)}`); stopReason = `error: ${String(e?.message ?? e).slice(0, 160)}`; process.exitCode = 1; }
  }
  return { ...run.finalize({ stopReason, extra: { wakes_engine: rows.length, segments: segments + 1, nudges, hosted_429: hosted429, metrics: "metrics.jsonl" } }), dir: run.dir };
}
