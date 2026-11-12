// Test doubles: a scripted stand-in for a model, served as a fake Anthropic Messages API and a fake Argentic wake API. No keys, no network beyond 127.0.0.1.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { generate } from "../lab/shop/gen.mjs";

let failures = 0, total = 0;
export const check = (name, ok, extra = "") => { total++; if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra ? `  (${extra})` : ""}`); };
export const finish = () => { console.log(`\n${total - failures} of ${total} checks passed`); process.exit(failures ? 1 : 0); };

// ---- the scripted model for the shop shift. results: [{tool, text}] of the last round of tool calls. mode: oracle | forgetful
const EVENT_RE = /^(?:\(still waiting[^\n]*\n)?(E\d{4}) \|/;
export function shopOracle(N, seed, mode = "oracle") {
  const { events, config } = generate(N, seed), byId = new Map(events.map((e) => [e.id, e]));
  const actionsFor = (e) => {
    const x = e.expect, far = mode === "forgetful" && e.probe && e.probe.fact_distance != null && e.probe.fact_distance > 60, base = config.skus.find((s) => s.id === e.sku);
    if (x.tool === "ship_order") return [["ship_order", far ? { order_id: x.order_id, packaging: "standard", invoice_email: e.email } : { order_id: x.order_id, packaging: x.packaging, invoice_email: x.invoice_email }]];
    if (x.tool === "receive_stock") { const out = [["receive_stock", { delivery_id: x.delivery_id, sku: x.sku, qty: x.qty }]]; if (!far) for (const r of x.refunds) out.push(["refund", r]); return out; }
    if (x.price_cents !== undefined) return [["answer", { event_id: e.id, price_cents: far ? base.price_cents : x.price_cents }]];
    if (x.tool === "decide_refund") return [["decide_refund", { request_id: x.request_id, decision: far ? (e.age_days <= 30 ? "approve" : "deny") : x.decision }]];
    if (x.units !== undefined) return [["answer", { event_id: e.id, units: x.units - (mode === "forgetful" ? 7 : 0) }]];
    return [["answer", { event_id: e.id, text: "ok" }]];
  };
  return (results) => {
    const ev = [...results].reverse().find((r) => r.tool === "next_event");
    if (!ev) return results.length && results.every((r) => r.tool === "finish") ? [] : [["next_event", {}]];
    if (/shift is over/.test(ev.text)) return [["finish", { summary: "shift over" }]];
    const m = EVENT_RE.exec(ev.text); if (!m) return [["next_event", {}]];
    return [...actionsFor(byId.get(m[1])), ["next_event", {}]];
  };
}
// the coordinator day, as an agent that only reads: calls next_event until the day ends, then finishes
export const idleDay = (results) => {
  const ev = [...results].reverse().find((r) => r.tool === "next_event");
  if (ev && /shift\.over/.test(ev.text)) return [["finish", { summary: "done" }]];
  return results.length && results.every((r) => r.tool === "finish") ? [] : [["next_event", {}]];
};

const body = async (req) => { let b = ""; for await (const c of req) b += c; return b; };
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));

// Anthropic Messages API (not streaming). tokens: usage reported per call.
export function fakeAnthropic({ decide, inputTokens = 3000, outputTokens = 60, log = [] }) {
  return listen(http.createServer(async (req, res) => {
    const j = JSON.parse(await body(req)); log.push({ url: req.url, key: req.headers["x-api-key"], model: j.model, n_messages: j.messages.length });
    const msgs = j.messages, last = msgs[msgs.length - 1], names = new Map();
    for (const m of msgs) if (m.role === "assistant" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_use") names.set(b.id, b.name);
    const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result").map((b) => ({ tool: names.get(b.tool_use_id), text: typeof b.content === "string" ? b.content : JSON.stringify(b.content) })) : [];
    const plan = decide(results), content = plan.length ? plan.map(([name, input]) => ({ type: "tool_use", id: `toolu_${randomUUID().slice(0, 12)}`, name, input })) : [{ type: "text", text: "Nothing more to do." }];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", content, stop_reason: plan.length ? "tool_use" : "end_turn", usage: { input_tokens: 200, cache_read_input_tokens: inputTokens, cache_creation_input_tokens: 0, output_tokens: outputTokens } }));
  }));
}

// Argentic wake API: same key => the stored answer again with Idempotent-Replay. spentPerWake: what each new wake reports.
export function fakeArgentic({ decide, spentPerWake = 0.0004, log = [] }) {
  const answers = new Map(), seqs = new Map(); let wakes = 0;
  return listen(http.createServer(async (req, res) => {
    const raw = await body(req), json = (code, o, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(o)); };
    if (req.method === "GET" && /^\/health/.test(req.url)) return json(200, { ok: true, build: "fake-build", commit: "0123456789abcdef" });
    if (req.method === "GET" && /^\/v1\/usage/.test(req.url)) return json(200, { limits: { fake: true } });
    const m = /^\/v1\/agents\/([^/]+)\/wake/.exec(req.url ?? ""); if (req.method !== "POST" || !m) return json(404, {});
    const agent = decodeURIComponent(m[1]), key = req.headers["idempotency-key"], j = JSON.parse(raw), mk = `${agent}|${key}`;
    if (answers.has(mk)) return json(200, answers.get(mk), { "Idempotent-Replay": "true" });
    wakes++; log.push({ wake: wakes, key, agent, model: j.model, model_key: req.headers["x-model-key"], auth: req.headers.authorization, tools: (j.tools ?? []).map((t) => ({ name: t.name, once_per: t.once_per ?? null })), limits: j.limits });
    let results = []; const mm = /^Results of the tools you asked for:\n([\s\S]*)$/.exec(j.message ?? "");
    if (mm) results = JSON.parse(mm[1]).map((r) => ({ tool: r.tool, text: typeof r.result === "string" ? r.result : JSON.stringify(r.result) }));
    const plan = decide(results), actions = plan.map(([tool, args]) => { const seq = (seqs.get(agent) ?? 0) + 1; seqs.set(agent, seq); return { id: `act_${seq}`, tool, args, seq }; });
    const ans = { wake_id: `w_${randomUUID().slice(0, 8)}`, status: "done", reply: plan.length ? "" : "Done for now.", actions, turns: 1, tool_calls: { count: actions.length }, usage: { prompt_tokens: 3000, output_tokens: 60, cache_hit_tokens: 2500, cache_write_tokens: 0 }, spent_usd: spentPerWake };
    answers.set(mk, ans); json(200, ans);
  }));
}
