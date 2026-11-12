// The Kestrel Supply world: the event stream, the agent's tools, and the deterministic grader. Same ctx shape as tally.mjs, so stress-ops.mjs can reuse the kill/dedupe plumbing.
// Mutating tools are idempotent by the engine's action seq: a retried (cut-off) action returns its recorded result instead of applying twice.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "./gen.mjs";

const need = (o, ...ks) => { for (const k of ks) if (o?.[k] === undefined || o[k] === null || o[k] === "") return `error: ${k} is required`; return null; };
const HINT = { order: "Reply with ship_order(order_id, packaging, invoice_email).", delivery: "Reply with receive_stock(delivery_id, sku, qty).", quote: "Reply with answer(event_id, price_cents).", refund: "Reply with decide_refund(request_id, decision).", stock_q: "Reply with answer(event_id, units).", email: "Reply with answer(event_id, text).", directive: "Reply with answer(event_id).", newsletter: "Reply with answer(event_id).", customer_msg: "Reply with answer(event_id, text)." };
export const render = (e, cfg) => {
  const cu = e.customer ? cfg.customers.find((c) => c.id === e.customer) : null;
  const head = `${e.id} | ${e.date} | ${e.type}`;
  const body = e.type === "order" ? `New order ${e.order_id} from ${cu.name} (${cu.id}, email on file ${cu.email}): ${e.qty} x ${e.sku}.`
    : e.type === "delivery" ? `Supplier delivery ${e.delivery_id}: ${e.qty} units of ${e.sku} arrived at the warehouse.`
    : e.type === "quote" ? `${cu.name} (${cu.id}) asks (request ${e.request_id}): what is the price of ${e.sku} right now?`
    : e.type === "refund" ? `Refund request ${e.request_id} from ${cu.name} (${cu.id}) for order ${e.order_id}, placed ${e.age_days} days ago.`
    : e.type === "stock_q" ? `CEO asks (question ${e.question_id}): how many units of ${e.sku} are in stock right now?`
    : e.type === "email" || e.type === "customer_msg" ? `Email from ${cu.name} (${cu.id}, ${cu.email}): "${e.text}"`
    : e.type === "directive" ? `Message from ${e.from}: "${e.text}"` : `Incoming mail: "${e.text}"`;
  return `${head}\n${body}\n${HINT[e.type]}`;
};

export function makeWorld(ctx) {
  const { stateDir, event } = ctx;
  const { events, config: cfg, N } = ctx.scenario ?? (ctx.scenario = generate(ctx.N, ctx.seed));
  mkdirSync(join(stateDir, "applied"), { recursive: true });
  const stateFile = join(stateDir, "world.json");
  const load = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { cursor: 0, pending: null, reminders: 0, handled: {}, missed: [], actions: [], shift_over: false });
  const save = (s) => writeFileSync(stateFile, JSON.stringify(s));
  ctx.world = { load, save, events, cfg, N };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pendingEvent = (s) => (s.pending === null ? null : events[s.pending]);

  // Record an action and, when it answers the event waiting for the agent, mark that event handled. Side-effect tools (refund) do not need a waiting event.
  const act = (tool, args, matches) => {
    const s = load(), p = pendingEvent(s), a = { n: s.actions.length + 1, tool, args, at: new Date().toISOString(), cursor: s.cursor, event: p?.id ?? null };
    s.actions.push(a);
    let note = "recorded.";
    if (matches && p && matches(p)) { if (s.handled[p.id]) note = "recorded (this event was already answered)."; else { s.handled[p.id] = { n: a.n, tool }; s.pending = null; s.reminders = 0; note = `${p.id} answered. Call next_event for the next one.`; } }
    else if (matches) note = "recorded, but it does not match the event waiting for you (check the id).";
    save(s); return note;
  };
  const tools = [
    { name: "next_event", mutating: true, description: "Get the next thing that needs the company's attention (an order, an email, a delivery, a CEO message). If you have not answered the current one yet, you get it again. Waits if nothing has arrived yet.", parameters: { type: "object", properties: {} },
      execute: async () => {
        for (;;) {
          const s = load(), p = pendingEvent(s);
          if (p) { s.reminders++; if (s.reminders >= 4) { s.missed.push(p.id); s.handled[p.id] = { n: null, tool: null, missed: true }; s.pending = null; s.reminders = 0; save(s); event({ type: "missed", event: p.id }); continue; } save(s); return `(still waiting for your answer)\n${render(p, cfg)}`; }
          if (s.cursor >= N || ctx.shiftOver?.()) { s.shift_over = true; save(s); return "The shift is over: no more events. Call finish with a short summary."; }
          const due = (ctx.t0 ?? 0) + s.cursor * (ctx.paceMs ?? 0), wait = due - Date.now();
          if (wait > 0) { await sleep(Math.min(wait, 3000)); continue; }
          const e = events[s.cursor]; s.pending = s.cursor; s.cursor++; s.reminders = 0; save(s); return render(e, cfg);
        }
      } },
    { name: "ship_order", mutating: true, description: "Ship an order. packaging: standard or plain. invoice_email: where the invoice goes.", parameters: { type: "object", properties: { order_id: { type: "string" }, packaging: { type: "string", enum: ["standard", "plain"] }, invoice_email: { type: "string" } }, required: ["order_id", "packaging", "invoice_email"] },
      execute: (a) => need(a, "order_id", "packaging", "invoice_email") ?? act("ship_order", { order_id: a.order_id, packaging: a.packaging, invoice_email: a.invoice_email }, (p) => p.type === "order" && p.order_id === a.order_id) },
    { name: "receive_stock", mutating: true, description: "Book a supplier delivery into stock.", parameters: { type: "object", properties: { delivery_id: { type: "string" }, sku: { type: "string" }, qty: { type: "integer" } }, required: ["delivery_id", "sku", "qty"] },
      execute: (a) => need(a, "delivery_id", "sku", "qty") ?? act("receive_stock", { delivery_id: a.delivery_id, sku: a.sku, qty: a.qty }, (p) => p.type === "delivery" && p.delivery_id === a.delivery_id) },
    { name: "refund", mutating: true, description: "Pay a refund to the customer of an order. amount_cents is an integer number of cents. Each refund is real money out: pay each one once.", parameters: { type: "object", properties: { order_id: { type: "string" }, amount_cents: { type: "integer" } }, required: ["order_id", "amount_cents"] },
      execute: (a) => need(a, "order_id", "amount_cents") ?? act("refund", { order_id: a.order_id, amount_cents: a.amount_cents }, null) },
    { name: "decide_refund", mutating: true, description: "Decide a customer's refund request: approve or deny.", parameters: { type: "object", properties: { request_id: { type: "string" }, decision: { type: "string", enum: ["approve", "deny"] } }, required: ["request_id", "decision"] },
      execute: (a) => need(a, "request_id", "decision") ?? act("decide_refund", { request_id: a.request_id, decision: a.decision }, (p) => p.type === "refund" && p.request_id === a.request_id) },
    { name: "answer", mutating: true, description: "Answer a quote, a CEO stock question, a customer email, a CEO/purchasing message or a piece of mail. event_id is the id on the event (E0123). Give price_cents (integer cents) for a quote, units (whole number) for a stock question, text (short) for an email. For a CEO/purchasing message or mail that needs nothing, event_id alone is enough.", parameters: { type: "object", properties: { event_id: { type: "string" }, price_cents: { type: "integer" }, units: { type: "integer" }, text: { type: "string" } }, required: ["event_id"] },
      execute: (a) => need(a, "event_id") ?? act("answer", { event_id: a.event_id, ...(a.price_cents !== undefined ? { price_cents: a.price_cents } : {}), ...(a.units !== undefined ? { units: a.units } : {}), ...(a.text !== undefined ? { text: String(a.text).slice(0, 300) } : {}) }, (p) => p.id === a.event_id && ["quote", "stock_q", "email", "customer_msg", "directive", "newsletter"].includes(p.type)) },
    { name: "finish", description: "Call when the shift is over (next_event says so). summary: how it went.", parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      execute: ({ summary }) => { const s = load(); if (!s.shift_over) return "Not accepted: the shift is not over. Call next_event."; ctx.onFinish(String(summary ?? "").slice(0, 600)); return "recorded"; } },
  ];
  return tools.map((t) => ({ ...t, execute: async (args, c = {}) => {
    const seq = c.seq, applied = join(stateDir, "applied", `${seq}.json`);
    let result;
    if (t.mutating && seq != null && existsSync(applied)) { result = JSON.parse(readFileSync(applied, "utf8")).result; event({ type: "dedup", tool: t.name, seq }); return result; }
    ctx.hooks.beforeTool(t.name, seq);
    result = await t.execute(args ?? {}, c);
    if (t.mutating && seq != null) { writeFileSync(applied, JSON.stringify({ result })); event({ type: "applied", tool: t.name, seq }); }
    ctx.hooks.afterTool(t.name, seq, !!t.mutating);
    const s = load(); if (s.notice) { result = `${result}\n\nSYSTEM NOTICE: ${s.notice}`; s.notice = null; save(s); }
    return result;
  } }));
}

// ---- grader: one row per event, from the recorded actions only. No model, no judgement.
export function grade(events, world) {
  const byTool = (tool) => world.actions.filter((a) => a.tool === tool);
  const refunds = byTool("refund"), rows = [];
  const spurious = refunds.filter((r) => !events.some((e) => e.fact?.kind === "promise" && e.fact.order_id === r.args.order_id));
  const handledBy = (e, tool, key) => world.actions.find((a) => a.tool === tool && a.args[key] === e[key]);
  for (const e of events) {
    if (!e.expect || e.i >= world.cursor - (world.pending !== null ? 1 : 0)) continue;       // delivered and finished with only
    const x = e.expect, h = world.handled[e.id], row = { event: e.id, i: e.i, type: e.type, family: e.probe?.family ?? (e.noise ? "noise" : e.fact ? "setup" : "routine"), bucket: e.probe?.bucket ?? null, fact_distance: e.probe?.fact_distance ?? null, pass: false, why: null };
    const a = x.tool === "answer" ? world.actions.find((q) => q.tool === "answer" && q.args.event_id === e.id)
      : x.tool === "ship_order" ? handledBy(e, "ship_order", "order_id") : x.tool === "receive_stock" ? handledBy(e, "receive_stock", "delivery_id") : handledBy(e, "decide_refund", "request_id");
    if (!a || h?.missed) { row.why = h?.missed ? "missed" : "no answer"; rows.push(row); continue; }
    if (x.tool === "ship_order") { row.pass = a.args.packaging === x.packaging && a.args.invoice_email === x.invoice_email; row.why = row.pass ? null : `got ${a.args.packaging}/${a.args.invoice_email}, want ${x.packaging}/${x.invoice_email}`; }
    else if (x.tool === "receive_stock") {
      const pays = x.refunds.map((r) => { const m = refunds.filter((q) => q.args.order_id === r.order_id); return { r, m }; });
      const bad = pays.filter(({ r, m }) => m.length !== 1 || m[0].args.amount_cents !== r.amount_cents);
      const early = pays.filter(({ m }) => m.some((q) => q.cursor <= e.i)).length;           // paid before this delivery was handed to the agent
      row.pass = a.args.sku === x.sku && a.args.qty === x.qty && bad.length === 0 && early === 0;
      row.why = row.pass ? null : bad.length ? `refund wrong: ${bad.map(({ r, m }) => `${r.order_id} paid ${m.length}x ${m.map((q) => q.args.amount_cents).join(",")} want ${r.amount_cents}`).join("; ")}` : early ? "refund paid before the delivery" : "delivery booked wrong";
      row.refunds_expected = x.refunds.length; }
    else if (x.tool === "decide_refund") { row.pass = a.args.decision === x.decision; row.why = row.pass ? null : `got ${a.args.decision}, want ${x.decision}`; }
    else if (x.price_cents !== undefined) { row.pass = a.args.price_cents === x.price_cents; row.why = row.pass ? null : `got ${a.args.price_cents}, want ${x.price_cents}`; }
    else if (x.units !== undefined) { row.pass = a.args.units === x.units; row.why = row.pass ? null : `got ${a.args.units}, want ${x.units}`; }
    else row.pass = true;
    rows.push(row);
  }
  const dupShip = Object.values(byTool("ship_order").reduce((m, a) => ((m[a.args.order_id] = (m[a.args.order_id] ?? 0) + 1), m), {})).filter((n) => n > 1).length;
  const dupRefund = Object.values(refunds.reduce((m, a) => ((m[a.args.order_id] = (m[a.args.order_id] ?? 0) + 1), m), {})).filter((n) => n > 1).length;
  return { rows, side_effects: { orders_shipped_twice: dupShip, refunds_paid_twice: dupRefund, refunds_not_promised: spurious.length, events_missed: world.missed.length } };
}
