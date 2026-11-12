// Free controls: scripted agents with no model. They prove the scorer can reach 100% (headroom), and that an agent without memory does not.
// solver  = perfect state (reads the world's own bookkeeping; this is the INTERNAL oracle row, never a public entry)
// amnesiac= handles each wake with only that wake in view (no rules, no memory of earlier messages)
// perMsg  = starts a new worker for every person message (no routing)
// idle    = calls next_event until the day ends
import { generate } from "./gen.mjs";
import { makeWorld } from "./world.mjs";
import { grade } from "./grade.mjs";

const live = (w) => ["running", "blocked"].includes(w.state);
const drain = (world, handler) => { let n = 0; while (!world.state.over && n++ < 5000) { const ev = world.call("next_event"); handler(ev, world); } world.call("finish", { summary: "done" }); return world; };
const workersOf = (S, req) => Object.values(S.workers).filter((w) => w.req === req);

function solver(ev, world) {
  const S = world.state, scn = world.scn, T = (n, a) => world.call(n, a);
  const lastW = (req) => workersOf(S, req).filter(live).pop();
  const startFor = (req, text) => T("start_worker", { brief: text, cap_usd: world.capNow(req, S.now), request_id: req });
  if (ev.type === "person.message") {
    const m = scn.msgs.find((x) => x.id === ev.message_id);
    if (m.kind === "ask") startFor(m.id, m.text);
    else if (m.kind === "follow") { const w = lastW(m.target_id); if (w) T("message_worker", { worker_id: w.id, text: m.text }); else if (!S.dropped.has(m.target_id)) startFor(m.target_id, `${scn.plans[m.target_id].text}. Also: ${m.text}`); }
    else if (m.kind === "drop") for (const w of workersOf(S, m.target_id).filter(live)) T("cancel_worker", { worker_id: w.id });
    else if (m.kind === "recall") T("reply_user", { text: `Right: ${m.literal}.`, refs: [m.id] });
    else if (m.kind === "probe") T("report_status", { items: world.truthItems().map((x) => `${x.ref}|${x.state}|${x.waiting_on}`) });
    // rule, fact, change, chat: nothing to do now (caps and gates are read from the world's own rule table by this oracle)
  } else if (ev.type === "worker.event") {
    const w = S.workers[ev.worker_id], p = S.pending[ev.id];
    if (ev.kind === "question") { if (p.spec.type === "fact") T("message_worker", { worker_id: w.id, text: p.spec.literal }); else T("ask_user", { question: ev.text, refs: [ev.id] }); }
    else if (ev.kind === "proposal") { if (p.gated) T("ask_user", { question: ev.text, refs: [ev.id] }); else T("approve_action", { worker_id: w.id, proposal_id: ev.id }); }
    else if (ev.kind === "done") T("notify_user", { text: ev.text, kind: "done", refs: [w.id, w.req] });
    else if (ev.kind === "failed") { if (!S.dropped.has(w.req)) { T("notify_user", { text: `Worker ${w.id} failed, restarting`, kind: "update", refs: [w.id, w.req] }); startFor(w.req, scn.plans[w.req].text); } }
  } else if (ev.type === "person.answer") {
    for (const a of ev.answers) {
      if (!a.ref) continue; const p = S.pending[a.ref]; if (!p) continue; const w = S.workers[p.worker];
      if (p.type === "proposal") T(a.answer === "approve" ? "approve_action" : "reject_action", { worker_id: w.id, proposal_id: a.ref });
      else T("message_worker", { worker_id: w.id, text: a.answer });
    }
  }
  // quiet worker check: anything running and silent for an hour gets replaced
  for (const w of Object.values(S.workers)) if (live(w) && w.state === "running" && S.now - w.last >= 60 && !S.dropped.has(w.req)) { T("cancel_worker", { worker_id: w.id }); T("notify_user", { text: `Worker ${w.id} went quiet, restarting`, kind: "update", refs: [w.id, w.req] }); startFor(w.req, scn.plans[w.req].text); }
}
function amnesiac(ev, world) {
  const T = (n, a) => world.call(n, a), S = world.state, scn = world.scn;
  if (ev.type === "person.message") { const m = scn.msgs.find((x) => x.id === ev.message_id); if (m.kind === "ask") T("start_worker", { brief: m.text, cap_usd: 5, request_id: m.id }); else if (m.kind === "probe") T("report_status", { items: [] }); else if (m.kind === "recall") T("reply_user", { text: "I don't have that.", refs: [m.id] }); }
  else if (ev.type === "worker.event") { const w = S.workers[ev.worker_id]; if (ev.kind === "proposal") T("approve_action", { worker_id: w.id, proposal_id: ev.id }); else if (ev.kind === "question") T("ask_user", { question: ev.text, refs: [ev.id] }); else if (ev.kind === "done") T("notify_user", { text: ev.text, kind: "done", refs: [w.id] }); }
  else if (ev.type === "person.answer") for (const a of ev.answers) { const p = S.pending[a.ref]; if (!p) continue; if (p.type === "proposal") T(a.answer === "approve" ? "approve_action" : "reject_action", { worker_id: p.worker, proposal_id: a.ref }); else T("message_worker", { worker_id: p.worker, text: a.answer }); }
}
function perMsg(ev, world) {
  const T = (n, a) => world.call(n, a), scn = world.scn;
  if (ev.type === "person.message") { const m = scn.msgs.find((x) => x.id === ev.message_id); const r = m.kind === "ask" ? m.id : m.target_id; if (r && ["ask", "follow", "change"].includes(m.kind)) T("start_worker", { brief: m.text, cap_usd: 2, request_id: r }); }
}
const idle = () => {};
export const CONTROLS = { solver, amnesiac, perMsg, idle };

export function runControl(name, scn) { const world = makeWorld(scn); drain(world, CONTROLS[name]); return { world, grade: grade(world) }; }
const rate = (g) => ({ R1: g.R1_routing.rate, R2: g.R2_lost_or_doubled.rate, R3: g.R3_rules.rate, R4: g.R4_recall.rate, R6_f1: g.R6_status.mean_f1, false_done: g.R6_status.false_done_claims, asks: g.R5_batching.ask_user_calls, bothered: g.R5_batching.bothered, spend: g.R7_cost.worker_spend_usd, dup: g.R7_cost.duplicate_workers });
if (import.meta.url === `file://${process.argv[1]}`) {
  const asks = +(process.argv[2] ?? 18), seed = +(process.argv[3] ?? 20261106), scn = generate(asks, seed);
  console.log(`asks=${asks} seed=${seed} msgs=${scn.msgs.length}`);
  for (const n of Object.keys(CONTROLS)) { const { grade: g } = runControl(n, scn); console.log(n.padEnd(9), JSON.stringify(rate(g))); if (process.argv[4] === "-v" && n === "solver") for (const i of g.items_detail.filter((x) => x.verdict !== "pass")) console.log("   ", JSON.stringify(i)); }
}
