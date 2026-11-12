// Entry B: the plain loop on the Messages API. What a developer writes first: send the transcript, run the tools the model asks for, append the results, repeat. No framework.
//   b0  keep everything.   b1  window (default): when the transcript passes windowTokens the oldest turns are dropped in a chunk (down to 60%), the first message stays. No memory, no summary.
//   oracle  INTERNAL attribution row only: b1 plus a block of the true state (rules in force, facts, jobs) appended to each request. Never an entry, never published as one.
// Spend comes from each response's own usage block at the model's price sheet (a prompt over 100K tokens bills at the long-context multiple). One request in flight at a time.
import { setupRun, Stop, sleep } from "./drive-core.mjs";
import { system_p1, task_p1, nudge_p1 } from "./prompt.mjs";

export const HAIKU = { in: 0.1, out: 0.5, cache_hit: 0.01, cache_write: 0.125, long_above: 100_000, long_mult: 5 };
export const priceOf = (u, P = HAIKU) => { const read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0, inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0, m = inp + read + write > P.long_above ? P.long_mult : 1;
  return m * (inp * P.in + read * P.cache_hit + write * P.cache_write + out * P.out) / 1e6; };
const est = (messages) => Math.ceil(JSON.stringify(messages).length / 3.6);
export function withCache(messages) {
  const out = messages.slice(), m = out[out.length - 1], c = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content.map((b) => ({ ...b }));
  c[c.length - 1] = { ...c[c.length - 1], cache_control: { type: "ephemeral" } }; out[out.length - 1] = { ...m, content: c }; return out;
}
export function trim(messages, windowTokens, onTrim = () => {}) {
  if (est(messages) <= windowTokens) return messages;
  const target = Math.floor(windowTokens * 0.6), size = messages.map((m) => Math.ceil(JSON.stringify(m).length / 3.6)); let tail = size.reduce((a, b) => a + b, 0), k = 1;
  while (k < messages.length - 2 && tail > target) tail -= size[k++];
  while (k < messages.length && messages[k].role !== "assistant") k++;
  if (k >= messages.length) return messages;
  const out = [messages[0], ...messages.slice(k)]; onTrim({ dropped: k - 1, kept: out.length, est_before: est(messages), est_after: est(out) }); return out;
}
// the true state, read from the world's own bookkeeping (oracle row only)
export function oracleBlock(world) {
  const S = world.state, scn = world.scn, said = scn.msgs.filter((m) => S.delivered.has(m.id) && ["rule", "fact", "change"].includes(m.kind)).map((m) => `- ${m.text}`);
  const jobs = world.truthItems().map((x) => { const w = Object.values(S.workers).filter((v) => v.req === x.ref && v.state !== "cancelled").pop(); return `- ${x.ref} "${scn.plans[x.ref].text}" -> worker ${w?.id ?? "none"}, ${x.state}, waiting on ${x.waiting_on}`; });
  const dropped = [...S.dropped].map((x) => `- ${x} dropped by the owner`);
  return `[state kept by the desk, exact as of now]\nStanding rules, facts and changes the owner has given:\n${said.join("\n") || "- none"}\nJobs:\n${jobs.join("\n") || "- none"}${dropped.length ? "\n" + dropped.join("\n") : ""}`;
}

export async function runPlainLoop({ name, root, asks = 18, seed = 20261106, variant = "b1", capUsd, maxMs, maxCalls, windowTokens = 40000, modelId = "claude-haiku-5-5", apiKey, upstream = "https://api.anthropic.com",
  prices = HAIKU, anthropicVersion = "2023-06-01", retryBaseMs = 2000, maxRetries = 6, maxNudges = 50, maxTokens = 2048, callModel: injected = null, quiet = false }) {
  if (!["b0", "b1", "oracle"].includes(variant)) throw new Error("variant must be b0, b1 or oracle");
  if (!apiKey && !injected) throw new Error("an Anthropic API key is required (MODEL_KEY or ANTHROPIC_API_KEY)");
  let spentUsd = 0; const calls = [];
  const run = setupRun({ root, name, asks, seed, entry: `plain-loop-${variant}`, capUsd, maxMs, maxCalls, spent: () => spentUsd, quiet,
    config: { model_id: modelId, variant, window_tokens: variant === "b0" ? null : windowTokens, window_estimate: variant === "b0" ? null : "chars/3.6", max_tokens: maxTokens, prices, memory: "none", compaction: "none", internal_attribution_row: variant === "oracle" } });
  const tools = run.world.schemas().map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const system = [{ type: "text", text: system_p1(), cache_control: { type: "ephemeral" } }];
  const headers = { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": anthropicVersion };
  async function callModel(messages) {
    if (injected) return injected({ system, tools, messages });
    const body = JSON.stringify({ model: modelId, max_tokens: maxTokens, system, tools, messages });
    for (let attempt = 0; ; attempt++) {
      let res; try { res = await fetch(`${upstream}/v1/messages`, { method: "POST", headers, body }); } catch (e) { if (attempt >= maxRetries) throw e; await sleep(retryBaseMs * 2 ** attempt); continue; }
      if (res.ok) return res.json();
      const txt = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) { run.event({ type: "api_retry", status: res.status, attempt }); await sleep(Math.min(60000, retryBaseMs * 2 ** attempt)); continue; }
      throw new Error(`Messages API ${res.status}: ${txt.slice(0, 300)}`);
    }
  }
  let messages = [{ role: "user", content: task_p1 }], stopReason = null, nudges = 0, trims = 0;
  try {
    for (;;) {
      run.beforeCall();
      if (variant !== "b0") messages = trim(messages, windowTokens, (t) => { trims++; run.event({ type: "trim", ...t }); });
      let sent = withCache(messages);
      // oracle text goes after every tool_result (the API wants those first); the cache breakpoint stays on the block before it
      if (variant === "oracle") { const last = sent[sent.length - 1], blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content.slice(); blocks.push({ type: "text", text: oracleBlock(run.world) }); sent = sent.slice(0, -1).concat([{ ...last, content: blocks }]); }
      const n = run.noteModelCall(), text = JSON.stringify(sent), r = await callModel(sent), usd = priceOf(r.usage ?? {}, prices); spentUsd += usd;
      calls.push({ call: n, prompt_chars: text.length, usd: +usd.toFixed(6), usage: r.usage ?? null, cursor: run.world.wakes.length });
      // keep what each decision could see, so a miss can be traced to the prompt (see attribute.mjs): the full request text, one line per call
      run.event({ type: "prompt", call: n, text });
      messages.push({ role: "assistant", content: r.content });
      const uses = r.content.filter((b) => b.type === "tool_use");
      if (!uses.length) { if (++nudges > maxNudges) { stopReason = "too many replies without a tool call"; break; } run.event({ type: "nudge", nudges, stop_reason: r.stop_reason }); messages.push({ role: "user", content: nudge_p1({ status: `ended with ${r.stop_reason}` }) }); continue; }
      const results = [];
      for (const b of uses) {
        if (!run.world.tools[b.name]) { results.push({ type: "tool_result", tool_use_id: b.id, content: `error: unknown tool ${b.name}`, is_error: true }); continue; }
        const out = run.exec(b.name, b.input ?? {}); results.push({ type: "tool_result", tool_use_id: b.id, content: out, ...(run.isError(out) ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    if (e instanceof Stop) stopReason = e.reason;
    else { run.event({ type: "error", error: String(e?.stack ?? e).slice(0, 800) }); run.logLine(`ERROR ${String(e?.message ?? e)}`); stopReason = `error: ${String(e?.message ?? e).slice(0, 160)}`; process.exitCode = 1; }
  }
  const mean = calls.length ? Math.round(calls.reduce((a, c) => a + (c.usage ? (c.usage.input_tokens ?? 0) + (c.usage.cache_read_input_tokens ?? 0) + (c.usage.cache_creation_input_tokens ?? 0) : 0), 0) / calls.length) : 0;
  const result = run.finalize({ stopReason, extra: { trims, nudges, mean_prompt_tokens: mean, calls_detail: calls } });
  return { ...result, dir: run.dir };
}
