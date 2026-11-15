// Scripted control agents. They make no model calls and cost nothing. They play the same world through the same tools as any entry.
// Their job is to prove the benchmark cannot be passed by a trick and that the axes mean something (see tools/release-gate.mjs for the checks that must hold before a family ships).
//   solver       perfect state, never forgets            recency-N   perfect state over only the last N events (a monotone decline with distance proves the time axis measures something)
//   amnesiac     acts only on the current event          broadcast   forwards every follow-up to every worker, remembers nothing
//   flag-all     flags every pair it can                 ask-always  asks the owner instead of answering
//   retrieval    keyword search over the history, answers from the top hit, keeps no state        last-mention  answers with the most recent mention of the thing asked about
//   majority     the most common answer for each probe type   noop  does nothing
//   first-mention / most-mentioned   (F8 only) answer with the oldest, or the most often named, option of the topic asked about
//   arrival-order   the solver, except that it lets the thread that arrived last win instead of the decision made last (F8's late forwards; a diagnostic, not a ceiling)
// Controls may read the semantic annotations on events (the generator's own bookkeeping); a real entry only ever sees the text.
import { Truth } from "./truth.mjs";
import { clock, norm, money, DAY_START } from "./util.mjs";
import { CUSTOMERS, SKUS, TEAM_TOPICS } from "./generate-reexport.mjs";

export const CONTROLS = ["solver", "recency-100", "recency-300", "recency-600", "amnesiac", "broadcast", "flag-all", "ask-always", "retrieval", "last-mention", "first-mention", "most-mentioned", "majority", "arrival-order", "noop"];
const parse = (world, name, args) => { const r = world.render(world.call(name, args)); try { return JSON.parse(r); } catch { return r; } };

export function playControl(kind, world) {
  const scn = world.scn, probeById = Object.fromEntries(scn.probes.map((p) => [p.id, p])), probeByRef = Object.fromEntries(scn.probes.filter((p) => p.kind === "explicit" || p.kind === "status").map((p) => [p.ref, p]));
  const call = (n, a) => parse(world, n, a), seen = [];                           // scripted events seen so far
  const N = kind === "solver" ? Infinity : kind.startsWith("recency-") ? Number(kind.slice(8)) : kind === "amnesiac" ? 1 : kind === "broadcast" ? 1 : Infinity;
  const smart = kind === "solver" || kind.startsWith("recency-") || kind === "amnesiac" || kind === "arrival-order", teamOnly = kind === "first-mention" || kind === "most-mentioned";
  let truth = new Truth({ byArrival: kind === "arrival-order" }); const wmap = {}, jobByKey = {}, jobSeen = {}, pendingTrig = {}, timerFor = {}, stateOf = {}, workersAll = [], lastStmt = {};
  const inWin = (id) => { const e = world.evById[id]; if (!e) return false; return seen.length - seen.findIndex((x) => x.id === id) <= N || N === Infinity; };
  const rebuild = () => { truth = new Truth(); for (const e of seen.slice(-N)) truth.apply(e); };
  const mode = {}; if (kind === "majority") { const by = {}; for (const p of scn.probes) { const k = `${p.fam}|${p.ask?.kind ?? p.field ?? p.kind}`; (by[k] ??= {})[p.expected] = (by[k][p.expected] ?? 0) + 1; } for (const [k, o] of Object.entries(by)) mode[k] = Object.entries(o).sort((a, b) => b[1] - a[1])[0][0]; }
  // keyword search for the retrieval control
  const docs = []; const tok = (s) => norm(s).split(" ").filter(Boolean);
  const search = (query, filter) => { const q = tok(query), cand = docs.filter(filter); if (!cand.length) return null; const df = {}; for (const d of docs) for (const t of new Set(d.tokens)) df[t] = (df[t] ?? 0) + 1; let best = null, bs = -1; for (const d of cand) { let s = 0; for (const t of q) { const tf = d.tokens.filter((x) => x === t).length; if (tf) s += (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.tokens.length / 14)) * Math.log(1 + docs.length / (df[t] ?? 1)); } if (s > bs) { bs = s; best = d; } } return best; };
  const mention = {};                                                                // last-mention: key -> latest statement event
  const keyOf = (s) => (s.op === "price" ? `price:${s.sku}` : s.op === "claim" || s.op === "resolve" || s.op === "restate" ? s.key : s.op === "fact" ? `fact:${s.c}:${s.attr}` : s.op === "rule" ? (s.kind === "dock" ? `rule:dock:${s.c}` : null) : null);
  // F8: what a control that does not track decisions makes of "what is our flour supplier / when did it change / why". Controls read the annotations, so their parsing of every thread is perfect.
  const teamAnswer = (ask) => {
    const T8 = TEAM_TOPICS.find((t) => t.id === ask.topic), evs = seen.filter((x) => ["team", "team_base", "team_chatter"].includes(x.sem.op) && x.sem.topic === ask.topic), optOf = (h) => h.sem.opt ?? h.sem.val;
    const stamp = (h) => clock(h.sem.decided_at ?? h.sem.proposed_at ?? h.t), reasonOf = (h) => h.sem.reason ?? h.sem.argued?.[0], distinct = (hs) => hs.map(optOf).filter((o, i, a) => a.indexOf(o) === i);
    const freq = {}; for (const h of evs) freq[optOf(h)] = (freq[optOf(h)] ?? 0) + 1;
    const byFreq = Object.keys(freq).sort((a, b) => freq[b] - freq[a] || evs.findLastIndex((h) => optOf(h) === b) - evs.findLastIndex((h) => optOf(h) === a)), order = kind === "first-mention" ? evs : [...evs].reverse();
    let pick;
    if (kind === "retrieval") pick = search(`${T8.label} ${ask.opt ?? ""} decision change`, (d) => ["team", "team_base", "team_chatter"].includes(d.ev.sem.op) && d.ev.sem.topic === ask.topic)?.ev;
    else if (kind === "most-mentioned") pick = [...evs].reverse().find((h) => optOf(h) === (ask.opt ?? byFreq[0]));
    else pick = order.find((h) => !ask.opt || h.sem.opt === ask.opt);
    if (!pick) return undefined;
    switch (ask.kind) { case "team_cur": return kind === "most-mentioned" ? byFreq[0] : optOf(pick); case "team_prev": return kind === "retrieval" ? optOf(pick) : kind === "most-mentioned" ? byFreq[1] : distinct(order)[1]; case "team_when": return stamp(pick); case "team_why": return reasonOf(pick); default: return undefined; }
  };
  const fieldAnswer = (ask, e) => {                                                    // the same per-kind lookup for retrieval and last-mention
    const t = e.t; if (kind === "majority") return mode[`${probeById[e.probe]?.fam}|${ask.kind}`];
    if (ask.kind.startsWith("team_") && kind !== "majority") return teamAnswer(ask); if (teamOnly) return undefined;
    const by = kind === "retrieval" ? (q, f) => search(q, f)?.ev : (q, f, k) => [...seen].reverse().find((x) => f({ ev: x }) && (!k || k(x)));
    const typed = (kindName) => { switch (kindName) {
      case "price": { const h = by(`price update ${SKUS.find((s) => s.id === ask.sku).name} each`, (d) => /price|claim/.test(d.ev.sem.op) && (d.ev.sem.sku === ask.sku || d.ev.sem.key === `price:${ask.sku}`)); return h?.sem.val; }
      case "addr": return by(`deliver address ${ask.c}`, (d) => d.ev.sem.op === "addr" && d.ev.sem.c === ask.c)?.sem.val;
      case "cutoff": return by("same-day order cutoff", (d) => d.ev.sem.op === "cutoff")?.sem.val;
      case "limit": return by("orders need sign-off approve above", (d) => d.ev.sem.op === "limit")?.sem.val;
      case "window": case "po": case "allergy": case "gate": return by(`${ask.c} ${ask.kind === "gate" ? "gate code" : ask.kind === "po" ? "PO purchase order" : ask.kind}`, (d) => (d.ev.sem.op === "fact" && d.ev.sem.c === ask.c && d.ev.sem.attr === ask.kind) || (d.ev.sem.op === "claim" && d.ev.sem.key === `fact:${ask.c}:${ask.kind}`))?.sem.val;
      case "discount": { const h = by(`${ask.c} discount off`, (d) => d.ev.sem.op === "rule" && d.ev.sem.kind === "discount" && d.ev.sem.c === ask.c && (kind === "retrieval" || d.ev.sem.val != null)); return h ? String(h.sem.action === "revoke" ? 0 : h.sem.val ?? 0) : undefined; }
      case "dock": { const h = by(`${ask.c} dock deliveries`, (d) => (d.ev.sem.op === "rule" && d.ev.sem.kind === "dock" && d.ev.sem.c === ask.c && (kind === "retrieval" || d.ev.sem.val != null)) || (d.ev.sem.op === "claim" && d.ev.sem.key === `rule:dock:${ask.c}`)); return h?.sem.val2 && kind === "retrieval" ? h.sem.val2 : h?.sem.val ?? undefined; }
      case "hold": { const h = by(`${ask.c} credit hold orders`, (d) => d.ev.sem.op === "rule" && d.ev.sem.kind === "hold" && d.ev.sem.c === ask.c && (kind === "retrieval" || d.ev.sem.action === "add")); return h ? (h.sem.action === "add" ? "no" : "yes") : undefined; }
      case "stock": { const h = by(`${SKUS.find((s) => s.id === ask.sku).name} stock sold received counted opening`, (d) => d.ev.sem.op === "stock" && d.ev.sem.sku === ask.sku); return h ? String(h.sem.set ?? Math.abs(h.sem.delta)) : undefined; }
      case "tickets": return undefined; default: return undefined; } };
    return typed(ask.kind);
  };
  const askOf = (id) => probeById[id]?.ask;

  const handle = (e, out) => {
    const s = e.sem ?? {};
    if (kind === "noop") return;
    if (kind === "ask-always") { if (s.op === "ask" || s.op === "order") call("ask_owner", { question: `What should I do about ${e.id}?`, ref: e.id }); return; }
    if (kind === "flag-all") { const k = keyOf(s) ?? (s.op === "addr" ? `addr:${s.c}` : null); if (k) { for (const prev of seen.slice(0, -1)) { const pk = keyOf(prev.sem ?? {}) ?? (prev.sem?.op === "addr" ? `addr:${prev.sem.c}` : null); if (pk === k) call("flag_conflict", { ref_a: e.id, ref_b: prev.id }); } } return; }
    if (kind === "broadcast") {
      if (s.op === "job") { const r = call("delegate", { ref: e.id, role: s.role, text: s.key }); if (r.worker_id) workersAll.push(r.worker_id); }
      if (s.op === "followup") for (const wid of workersAll) call("message_worker", { worker_id: wid, text: s.literal });
      return;
    }
    if (kind === "retrieval" || kind === "last-mention" || kind === "majority" || teamOnly) {
      if (s.op === "order" && !teamOnly) { const f = {}; for (const [field, ask] of [["unit_price", { kind: "price", sku: s.sku }], ["deliver_to", { kind: "addr", c: s.c }], ["discount_pct", { kind: "discount", c: s.c, qty: s.qty }], ["dock", { kind: "dock", c: s.c }], ["window", { kind: "window", c: s.c }], ["po", { kind: "po", c: s.c }]]) { const v = kind === "majority" ? mode[`${field === "unit_price" || field === "deliver_to" ? "F2" : field === "window" || field === "po" ? "F1" : "F3"}|${field}`] : fieldAnswer(ask, e); if (v !== undefined && v !== null) f[field] = v; }
        call("create_order", { ref: e.id, customer: s.c, sku: SKUS.find((x) => x.id === s.sku).name, qty: s.qty, ...f }); }
      if (s.op === "ask" && e.probe) { const p = probeById[e.probe]; if (p?.ask) { const v = fieldAnswer(p.ask, e); if (v !== undefined && v !== null) call("answer", { probe_id: e.probe, value: String(v) }); } }
      return;
    }
    // smart controls (solver, recency-N, amnesiac)
    if (s.op === "order") {
      const f = truth.orderFields(s.c, s.sku, s.qty, e.t), sku = SKUS.find((x) => x.id === s.sku).name;
      if (f.hold) call("reply", { ref: e.id, text: "Sorry, we can't take new orders right now." });
      else call("create_order", { ref: e.id, customer: s.c, sku, qty: s.qty, ...Object.fromEntries(Object.entries({ unit_price: f.unit_price, discount_pct: f.discount_pct, deliver_to: f.deliver_to, dock: f.dock, window: f.window, po: f.po }).filter(([, v]) => v !== undefined && v !== null)) });
    } else if (s.op === "ask" && e.probe) {
      const p = probeById[e.probe];
      if (p.kind === "status") { const items = []; for (const [ref, js] of Object.entries(jobSeen)) { if (!inWin(ref)) continue; const st = stateOf[ref] ?? "running"; if (st === "done" && e.t - world.evById[ref].t > 180) continue; items.push(`${ref}|${st}|${{ running: "worker", blocked: "agent", done: "none", failed: "agent", not_started: "agent" }[st]}`); } call("report_status", { items }); }
      else { const v = truth.answer(p.ask, e.t); if (v !== undefined && v !== null) call("answer", { probe_id: e.probe, value: String(v) }); }
    } else if (s.op === "job") {
      const r = call("delegate", { ref: e.id, role: s.role, text: s.key }); if (r.worker_id) { wmap[e.id] = r.worker_id; jobByKey[s.key] = e.id; jobSeen[e.id] = true; stateOf[e.id] = "running"; }
    } else if (s.op === "followup") { const ref = jobByKey[s.key]; if (ref && inWin(ref) && wmap[ref] && !["done", "failed"].includes(stateOf[ref])) call("message_worker", { worker_id: wmap[ref], text: s.literal });
    } else if (s.op === "promise") { if (s.kind === "timed") { call("set_timer", { at: clock(s.due), note: e.id }); } else pendingTrig[s.c] = (pendingTrig[s.c] ?? []).concat(e.id);
    } else if (s.op === "trigger") { const ref = s.promise; if (ref && inWin(ref)) call("follow_up", { ref, text: "Following up as promised." });
    } else if (s.op === "claim") { const cur = truth.value[s.key], stmt = truth.stmt[s.key]; if (stmt && cur !== undefined && cur !== s.val && inWin(stmt)) call("flag_conflict", { ref_a: e.id, ref_b: stmt }); }
  };
  const handleDyn = (out) => {
    if (!smart) return;
    if (out.type === "worker.report") { const ref = out.request_id; stateOf[ref] = out.kind === "question" ? "blocked" : out.kind; if (out.kind === "failed" && inWin(ref)) { const j = world.evById[ref].sem; const r = call("delegate", { ref, role: j.role, text: j.key }); if (r.worker_id) { wmap[ref] = r.worker_id; stateOf[ref] = "running"; } }
      if (out.kind === "question") { const q = scn.jobs[ref].question, code = truth.facts[q.c]?.gate; if (code && inWin(ref)) { call("message_worker", { worker_id: out.worker_id, text: `Gate code is ${code}` }); stateOf[ref] = "running"; } } }
    if (out.type === "timer") { const ref = out.text.replace("Timer: ", ""); if (inWin(ref)) call("follow_up", { ref, text: "Following up as promised." }); }
  };
  for (;;) {
    const out = call("next_event", {}); if (out.type === "shift.over") break;
    const e = world.evById[out.event_id];
    if (e) { seen.push(e); docs.push({ ev: e, tokens: tok(e.text) }); if (N === Infinity) truth.apply(e); else if (smart) rebuild(); handle(e, out); } else handleDyn(out);
  }
  call("finish", { summary: `${kind} done` });
  return world;
}
