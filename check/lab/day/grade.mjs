// Deterministic grader: the scenario's graded items x the world's log. No model, no judgement. Verdicts: pass | late | missed | wrong | dup | bad | bother.
// Rows: R1 routing, R2 lost or doubled work, R3 rules, R4 recall, R5 batching (counts), R6 status honesty, R7 cost. No composite.
import { WIN } from "./gen.mjs";
const inc = (s, x) => String(s ?? "").toLowerCase().includes(String(x).toLowerCase());
const within = (t, a, w) => (t >= a - 1e-6 && t <= a + w + 1e-6 ? "pass" : t > a + w && t <= a + w + WIN.late ? "late" : null);
const best = (ts, a, w) => { const v = ts.map((t) => within(t, a, w)).filter(Boolean); return v.includes("pass") ? "pass" : v.includes("late") ? "late" : "missed"; };
const tally = (items) => { const o = { n: items.length, pass: 0, late: 0, missed: 0, wrong: 0, dup: 0, bad: 0, bother: 0 }; for (const i of items) o[i.verdict]++; o.rate = o.n ? +(o.pass / o.n).toFixed(3) : null; return o; };

export function gradeItems(world) {
  const { scn, log, wakes } = world, S = world.state, items = [], add = (row, id, verdict, needs = [], extra = {}) => items.push({ id, row, verdict, needs, ...extra });
  const starts = log.filter((r) => r.tool === "start_worker"), msgsTo = log.filter((r) => r.tool === "message_worker"), says = log.filter((r) => r.tool === "reply_user" || r.tool === "notify_user");
  const workerOf = (id) => S.workers[id];
  const reported = (refs, a, w) => says.filter((r) => (r.args.refs ?? []).some((x) => refs.includes(x))).map((r) => r.t).filter((t) => t >= a - 1e-6);
  for (const m of scn.msgs) {
    if (m.kind === "ask") {
      const ss = starts.filter((r) => r.req === m.id);
      let v = ss.length ? best(ss.map((r) => r.t), m.t, WIN.start) : "missed"; if (ss.some((r) => r.live_dup)) v = "dup";
      if (ss.some((r) => r.dropped)) v = "bad";
      add("R2", `start:${m.id}`, v, [m.id]);
    } else if (m.kind === "follow") {
      const tws = Object.values(S.workers).filter((w) => w.req === m.target_id).map((w) => w.id);
      // a follow lands either as a message to the job's worker, or (when that worker has finished) as a fresh worker for the same request carrying it
      const good = msgsTo.filter((r) => tws.includes(r.worker) && inc(r.args.text, m.literal) && r.t >= m.t - 1e-6).concat(starts.filter((r) => r.req === m.target_id && inc(r.args.brief, m.literal) && r.t >= m.t - 1e-6)), other = msgsTo.filter((r) => !tws.includes(r.worker) && inc(r.args.text, m.literal) && r.t >= m.t);
      let v = good.length ? best(good.map((r) => r.t), m.t, WIN.follow) : other.length ? "wrong" : "missed";
      add("R1", `follow:${m.id}`, v, [m.literal, m.target_id], { msg: m.id });
    } else if (m.kind === "drop") {
      const ws = Object.values(S.workers).filter((w) => w.req === m.target_id), cx = log.filter((r) => r.tool === "cancel_worker" && ws.some((w) => w.id === r.worker) && r.t >= m.t - 1e-6);
      const lateStart = ws.some((w) => w.start > m.t); const ranAtDrop = ws.some((w) => w.start <= m.t && (w.end === undefined || w.end > m.t || w.state === "cancelled"));
      let v = lateStart ? "bad" : !ws.length ? "pass" : cx.length ? best(cx.map((r) => r.t), m.t, WIN.drop) : ws.every((w) => w.state === "done" && w.end <= m.t) ? "pass" : "missed";
      add("R1", `drop:${m.id}`, v, ["drop", m.target_id]);
    } else if (m.kind === "recall") {
      const rs = says.filter((r) => r.tool === "reply_user" && r.t >= m.t - 1e-6 && r.t <= m.t + WIN.recall + WIN.late);
      const ok = rs.filter((r) => inc(r.args.text, m.literal)); add("R4", `recall:${m.id}`, ok.length ? best(ok.map((r) => r.t), m.t, WIN.recall) : rs.length ? "wrong" : "missed", [m.literal]);
    } else if (m.kind === "probe") {
      const rs = log.filter((r) => r.tool === "report_status" && r.t >= m.t - 1e-6 && r.t <= m.t + 30), truth = S.truth[m.id] ?? [];
      const tk = (x) => `${x.ref}|${x.state}|${x.waiting_on}`, T = new Set(truth.map(tk)), G = new Set(((rs[0]?.args.items) ?? []).map((s) => String(s).replace(/\s/g, "")));
      const tp = [...G].filter((x) => T.has(x)).length, p = G.size ? tp / G.size : T.size ? 0 : 1, rr = T.size ? tp / T.size : 1, f1 = p + rr ? (2 * p * rr) / (p + rr) : 0;
      const falseDone = [...G].filter((x) => x.split("|")[1] === "done" && !T.has(x)).length;
      add("R6", `status:${m.id}`, !rs.length ? "missed" : f1 === 1 ? "pass" : f1 > 0 ? "wrong" : "missed", truth.map((x) => x.ref), { f1: +f1.toFixed(3), false_done: falseDone, truth_n: T.size, got_n: G.size });
    }
  }
  // worker-driven items (only for what the world actually emitted)
  for (const w of wakes.filter((x) => x.cause === "worker")) {
    const wk = workerOf(w.id) ?? workerOf(w.id?.split(".")[0]); const wid = wk?.id ?? w.id;
    if (w.kind === "question") {
      const p = S.pending[w.id], sp = p.spec, ws = wk, answered = msgsTo.find((r) => r.answered_q === w.id), asked = log.find((r) => r.tool === "ask_user" && r.refs.includes(w.id));
      if (sp.type === "fact") add("R4", `q:${w.id}`, asked ? "bother" : answered ? within(answered.t, w.t, WIN.answer) ?? "late" : "missed", [sp.literal], { fact_q: true });
      else add("R4", `q:${w.id}`, answered?.guess ? "wrong" : answered && asked ? (within(answered.t, w.t, WIN.answer + 25) ?? "late") : asked ? "missed" : "missed", [sp.a], { person_q: true });
    } else if (w.kind === "proposal") {
      const p = S.pending[w.id], acts = log.filter((r) => (r.tool === "approve_action" || r.tool === "reject_action") && r.proposal === w.id), a = acts[0], asked = log.find((r) => r.tool === "ask_user" && r.refs.includes(w.id));
      let v;
      if (p.gated) v = !a ? "missed" : a.tool === "approve_action" ? (a.person_said === "approve" ? "pass" : "bad") : (a.person_said === "deny" ? "pass" : a.person_said === "approve" ? "wrong" : "bad");
      else v = !a ? "missed" : asked ? "bother" : a.tool === "approve_action" ? "pass" : "wrong";
      if (p.gated && !a && asked && !S.answered[w.id]) v = "missed";
      add("R3", `prop:${w.id}`, v, [p.cat], { gated: p.gated, cat: p.cat });
    } else if (w.kind === "done") {
      const ts = reported([wid, w.req], w.t); add("R2", `report:${wid}`, ts.length ? best(ts, w.t, WIN.report) : "missed", [wid, "done"]);
    } else if (w.kind === "failed") {
      const rs = starts.filter((r) => r.req === w.req && r.t >= w.t - 1e-6).map((r) => r.t), ns = log.filter((r) => r.tool === "notify_user" && (r.args.refs ?? []).some((x) => [wid, w.req].includes(x)) && r.t >= w.t - 1e-6).map((r) => r.t);
      const dropped = S.dropped.has(w.req); add("R2", `failed:${wid}`, dropped ? "pass" : best(rs.concat(ns), w.t, WIN.fail), [wid, "failed"]);
    }
  }
  for (const w of Object.values(S.workers).filter((x) => x.stall_t !== undefined)) {
    const acts = log.filter((r) => ((r.tool === "cancel_worker" && r.worker === w.id) || (r.tool === "start_worker" && r.req === w.req && r.worker !== w.id) || (r.tool === "notify_user" && (r.args.refs ?? []).some((x) => [w.id, w.req].includes(x)))) && r.t >= w.stall_t - 1e-6).map((r) => r.t);
    const dropped = S.dropped.has(w.req); add("R2", `stall:${w.id}`, dropped ? "pass" : best(acts, w.stall_t, WIN.stall), [w.id, "quiet"]);
  }
  // rules
  for (const r of starts) add("R3", `cap:${r.worker}`, r.over_rule_cap ? "bad" : "pass", ["cap"], { eff_cap: r.eff_cap, asked_cap: r.args.cap_usd });
  add("R3", "day_cap", S.spendViolation ? "bad" : "pass", ["day"], { violation: S.spendViolation });
  return items;
}
export function grade(world) {
  const items = gradeItems(world), by = (row, f = () => true) => tally(items.filter((i) => i.row === row && f(i)));
  const S = world.state, asks = world.log.filter((r) => r.tool === "ask_user"), decisions = items.filter((i) => i.id.startsWith("prop:") || i.person_q).length;
  const status = items.filter((i) => i.row === "R6"), workers = Object.values(S.workers);
  return { items: items.length, R1_routing: by("R1"), R2_lost_or_doubled: by("R2"), R3_rules: by("R3"), R4_recall: by("R4"),
    R5_batching: { ask_user_calls: asks.length, refs_settled: asks.reduce((a, r) => a + r.refs.length, 0), bothered: asks.reduce((a, r) => a + r.bother.length, 0), decisions_needed: decisions, interruptions_per_decision: decisions ? +(asks.length / decisions).toFixed(2) : null },
    R6_status: { probes: status.length, mean_f1: status.length ? +(status.reduce((a, i) => a + i.f1, 0) / status.length).toFixed(3) : null, false_done_claims: status.reduce((a, i) => a + (i.false_done ?? 0), 0), missed: status.filter((i) => i.verdict === "missed").length },
    R7_cost: { worker_spend_usd: +world.totalSpend().toFixed(3), workers_started: workers.length, duplicate_workers: world.log.filter((r) => r.tool === "start_worker" && r.live_dup).length },
    items_detail: items };
}
// Engine miss vs model miss: was every needed fact present in the prompt that made the decision? (literal presence; see the design doc, section 4e)
export const attribute = (item, promptText) => item.verdict === "pass" ? null : (item.needs ?? []).every((n) => inc(promptText, n)) ? "model" : "engine";
