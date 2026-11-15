// The longshift world: the tools an agent calls, the scripted owner, customers and workers, and the clock. In-process, deterministic, no network, no model.
// The agent's only source of information is the event stream: there is no system of record to look things up in. Everything it does lands in world.log (one row per call).
import { clock, parseClock, DAY_START, norm } from "./util.mjs";
import { CUSTOMERS, SKUS, ROLES } from "./gen.mjs";

export function makeWorld(scn) {
  const T = scn.T, S = { now: 0, seq: 0, nDyn: 0, nW: 0, queue: [], log: [], wakes: [], workers: {}, answers: {}, delivered: new Set(), over: false, finished: null, ownerMinutes: 0, statusSnap: {}, wq: [], nOrders: 0, timers: 0 };
  const evById = Object.fromEntries(scn.events.map((e) => [e.id, e]));
  scn.events.forEach((e) => S.queue.push({ t: e.t, seq: ++S.seq, scripted: e }));
  const statusProbe = Object.fromEntries(scn.probes.filter((p) => p.kind === "status").map((p) => [p.ref, p.id]));
  const rec = (tool, args, extra = {}) => { const r = { i: S.log.length, t: +S.now.toFixed(2), tool, args: JSON.parse(JSON.stringify(args ?? {})), ...extra }; S.log.push(r); return r; };
  const need = (a, ...ks) => { for (const k of ks) if (a?.[k] === undefined || a[k] === null || a[k] === "") return `error: ${k} is required`; return null; };
  const live = (w) => ["running", "blocked"].includes(w.state), W = (id) => S.workers[id];
  const push = (t, ev) => S.queue.push({ t, seq: ++S.seq, dyn: ev });
  const jobWorkers = (ref) => Object.values(S.workers).filter((w) => w.job === ref);
  const jobState = (ref) => { const ws = jobWorkers(ref), w = ws[ws.length - 1]; if (!w) return { state: "not_started", waiting_on: "agent" }; if (w.state === "done") return { state: "done", waiting_on: "none" }; if (w.state === "failed") return { state: "failed", waiting_on: "agent" }; if (w.state === "blocked") return { state: "blocked", waiting_on: "agent" }; return { state: "running", waiting_on: "worker" }; };
  const statusTruth = () => scn.events.filter((e) => e.sem.op === "job" && S.delivered.has(e.id)).map((e) => ({ ref: e.id, ...jobState(e.id) })).filter((x) => x.state !== "done" || S.now - evById[x.ref].t <= 180);
  const tools = {}, def = (name, description, props, required, fn) => { tools[name] = { name, description, parameters: { type: "object", properties: props, required }, fn }; };
  const str = { type: "string" }, num = { type: "number" }, strs = { type: "array", items: { type: "string" } };
  const dynId = () => `D${String(++S.nDyn).padStart(4, "0")}`;

  def("next_event", "Get the next thing that needs attention: a message from the owner or a customer, a report from a worker, or a notice from the systems. Time advances to that event. Every event has an event_id.", {}, [], () => {
    for (;;) {
      S.queue.sort((a, b) => a.t - b.t || a.seq - b.seq); const q = S.queue[0];
      if (!q || q.t > T) { S.over = true; S.now = Math.max(S.now, T); S.wakes.push({ n: S.wakes.length + 1, t: T, type: "shift.over" }); rec("next_event", {}, { event: "shift.over" }); return { event_id: "end", sim_time: clock(T), type: "shift.over", note: "The shift is over. Call finish." }; }
      S.queue.shift(); S.now = Math.max(S.now, q.t);
      if (q.dyn) {
        const d = q.dyn;
        if (d.type === "internal.step") { const w = W(d.worker); if (!w || w.attempt !== d.attempt || !live(w)) continue; if (d.stage === "q") { w.state = "blocked"; const j = scn.jobs[w.job]; S.wq.push({ job: w.job, worker: w.id, t: S.now }); const id = dynId(); S.wakes.push({ n: S.wakes.length + 1, t: +S.now.toFixed(2), type: "worker.report", id, kind: "question" }); rec("next_event", {}, { event: "worker.report", ref: id });
            return { event_id: id, sim_time: clock(S.now), type: "worker.report", worker_id: w.id, request_id: w.job, from: `${ROLES[w.role]} (${w.role})`, kind: "question", text: `Which gate code should I use at ${j.question.c}?` }; }
          w.state = "done"; w.end = S.now; const id = dynId(); S.wakes.push({ n: S.wakes.length + 1, t: +S.now.toFixed(2), type: "worker.report", id, kind: "done" }); rec("next_event", {}, { event: "worker.report", ref: id });
          return { event_id: id, sim_time: clock(S.now), type: "worker.report", worker_id: w.id, request_id: w.job, from: `${ROLES[w.role]} (${w.role})`, kind: "done", text: `Done: ${scn.jobs[w.job].key}.` }; }
        if (d.type === "internal.fail") { const w = W(d.worker); if (!w || !live(w)) continue; w.state = "failed"; w.end = S.now; const id = dynId(); S.wakes.push({ n: S.wakes.length + 1, t: +S.now.toFixed(2), type: "worker.report", id, kind: "failed" }); rec("next_event", {}, { event: "worker.report", ref: id });
          return { event_id: id, sim_time: clock(S.now), type: "worker.report", worker_id: w.id, request_id: w.job, from: `${ROLES[w.role]} (${w.role})`, kind: "failed", text: `I hit an error and stopped on ${scn.jobs[w.job].key}.` }; }
        if (d.type === "timer") { const id = dynId(); S.wakes.push({ n: S.wakes.length + 1, t: +S.now.toFixed(2), type: "timer", id }); rec("next_event", {}, { event: "timer", ref: id }); return { event_id: id, sim_time: clock(S.now), type: "timer", from: "Timer", text: `Timer: ${d.note}` }; }
        continue;
      }
      const e = q.scripted; S.delivered.add(e.id); if (statusProbe[e.id]) S.statusSnap[statusProbe[e.id]] = statusTruth();
      S.wakes.push({ n: S.wakes.length + 1, t: e.t, type: e.type, id: e.id }); rec("next_event", {}, { event: e.type, ref: e.id });
      return { event_id: e.id, sim_time: e.clock, type: e.type, from: e.from, text: e.text, ...(e.attach ? { attachment: e.attach } : {}), ...(e.probe ? { probe_id: e.probe } : {}) };
    }
  });
  const delivered = (id) => S.delivered.has(id) && evById[id];
  def("answer", "Answer a question that carries a probe_id. value is the answer itself (a number, a name, a code, yes or no).", { probe_id: str, value: str }, ["probe_id", "value"], (a) => {
    const e = need(a, "probe_id", "value"); if (e) return e; const p = scn.probes.find((x) => x.id === a.probe_id); if (!p || p.kind !== "explicit" || !S.delivered.has(p.ref)) return "error: that probe_id was not asked yet";
    const r = rec("answer", a, { probe: p.id }); if (S.answers[p.id]) { r.ignored = true; return { recorded: false, note: "already answered" }; } S.answers[p.id] = { value: String(a.value), t: S.now }; return { recorded: true }; });
  def("create_order", "Record a customer order. ref is the event_id of the message that asked for it. Give every field you can: customer, sku, qty, unit_price (per unit, number), discount_pct (number, 0 if none), deliver_to (address), dock (letter), window (delivery window the customer wants), po (purchase order number).",
    { ref: str, customer: str, sku: str, qty: num, unit_price: num, discount_pct: num, deliver_to: str, dock: str, window: str, po: str }, ["ref", "customer", "sku", "qty"], (a) => {
      const e = need(a, "ref", "customer", "sku", "qty"); if (e) return e; if (!delivered(a.ref)) return "error: ref must be the event_id of a message you have received";
      const c = CUSTOMERS.find((x) => norm(x) === norm(a.customer)), s = SKUS.find((x) => norm(x.name) === norm(a.sku) || x.id === a.sku); if (!c || !s) return "error: unknown customer or sku";
      rec("create_order", a, { ref: a.ref, c, sku: s.id, qty: Number(a.qty), order: `A-${String(++S.nOrders).padStart(4, "0")}` }); return { order_id: `A-${String(S.nOrders).padStart(4, "0")}`, recorded: true }; });
  def("delegate", "Start a worker on a job. ref is the event_id of the owner's message that asked for it. role is baker, driver or accounts. text is the instruction for the worker. Returns the worker_id.", { ref: str, role: str, text: str }, ["ref", "role", "text"], (a) => {
    const e = need(a, "ref", "role", "text"); if (e) return e; const ev = delivered(a.ref), job = scn.jobs[a.ref]; if (!ev || !job) return "error: ref must be the event_id of a job the owner asked for"; if (!ROLES[a.role]) return "error: role must be baker, driver or accounts";
    const prev = jobWorkers(a.ref), attempt = prev.length + 1, id = `w${++S.nW}`, w = { id, job: a.ref, role: a.role, attempt, state: "running", start: S.now }; S.workers[id] = w; rec("delegate", a, { worker: id, job: a.ref, attempt, role_ok: a.role === job.role });
    if (job.fail && attempt === 1) push(S.now + 40, { type: "internal.fail", worker: id }); else if (job.question) push(S.now + 25, { type: "internal.step", worker: id, attempt, stage: "q" }); else push(S.now + job.dur, { type: "internal.step", worker: id, attempt, stage: "done" });
    return { worker_id: id, state: "running" }; });
  def("message_worker", "Send a message to a worker. Use it to pass on follow-ups and to answer a worker's question.", { worker_id: str, text: str }, ["worker_id", "text"], (a) => {
    const e = need(a, "worker_id", "text"); if (e) return e; const w = W(a.worker_id); if (!w) return "error: unknown worker"; const r = rec("message_worker", a, { worker: w.id, job: w.job, worker_state: w.state, delivered: live(w) }); if (!live(w)) return { delivered: false, note: `worker is ${w.state}` };
    const j = scn.jobs[w.job]; if (w.state === "blocked" && j.question && norm(a.text).includes(norm(j.question.literal))) { w.state = "running"; r.answered_q = true; push(S.now + Math.max(10, j.dur - 25), { type: "internal.step", worker: w.id, attempt: w.attempt, stage: "done" }); } return { delivered: true }; });
  def("reply", "Reply to the sender of a message. ref is the event_id of the message you are replying to.", { ref: str, text: str }, ["ref", "text"], (a) => { const e = need(a, "ref", "text"); if (e) return e; if (!delivered(a.ref)) return "error: ref must be the event_id of a message you have received"; rec("reply", a, { ref: a.ref }); return { sent: true }; });
  def("follow_up", "Contact someone to do a follow-up you owe them (ring them, send them something). ref is the event_id of the message that asked for it. text is what you send.", { ref: str, text: str }, ["ref", "text"], (a) => { const e = need(a, "ref", "text"); if (e) return e; if (!delivered(a.ref)) return "error: ref must be the event_id of a message you have received"; rec("follow_up", a, { ref: a.ref }); return { sent: true }; });
  def("set_timer", "Ask for an event at a clock time. at is HH:MM on the shift clock, or +N for N minutes from now. note is returned with the event.", { at: str, note: str }, ["at", "note"], (a) => { const e = need(a, "at", "note"); if (e) return e; let t = /^\+(\d+)$/.test(a.at) ? S.now + Number(RegExp.$1) : parseClock(a.at); if (t !== null && t < 0) t += 1440; if (t === null || !Number.isFinite(t)) return "error: at must be HH:MM or +N"; if (t < S.now) t = S.now; rec("set_timer", a, { fire: t }); S.timers++; push(t, { type: "timer", note: a.note }); return { set: true, fires_at: clock(t) }; });
  def("flag_conflict", "Flag that two earlier messages contradict each other. ref_a and ref_b are the event_ids of the two messages.", { ref_a: str, ref_b: str, note: str }, ["ref_a", "ref_b"], (a) => { const e = need(a, "ref_a", "ref_b"); if (e) return e; if (!delivered(a.ref_a) || !delivered(a.ref_b) || a.ref_a === a.ref_b) return "error: both refs must be event_ids of different messages you have received"; rec("flag_conflict", a, {}); return { flagged: true }; });
  def("report_status", "Report where the owner's requests stand. items is a list of strings 'event_id|state|waiting_on': event_id of the owner's request, state one of not_started, running, blocked, done, failed, and waiting_on one of worker, agent, none. Include every request from the last three hours and any older one that is not done.", { items: strs }, ["items"], (a) => { const e = need(a, "items"); if (e) return e; rec("report_status", a); return { recorded: true }; });
  def("ask_owner", "Ask the owner a question. Costs the owner's time; the owner may not answer in detail.", { question: str, ref: str }, ["question"], (a) => { const e = need(a, "question"); if (e) return e; S.ownerMinutes += 3; rec("ask_owner", a, { ref: a.ref ?? null }); return { answer: "I'm busy. Use what I've already told you today." }; });
  def("finish", "Call when the shift is over (next_event says so).", { summary: str }, ["summary"], (a) => { if (!S.over) return "Not accepted: the shift is not over. Call next_event."; S.finished = String(a.summary ?? ""); rec("finish", a); return { ok: true }; });

  const render = (out) => (typeof out === "string" ? out : JSON.stringify(out));
  const call = (name, args) => { const t = tools[name]; if (!t) return `error: unknown tool ${name}`; return t.fn(args ?? {}); };
  return { scn, state: S, log: S.log, wakes: S.wakes, tools, call, render, statusTruth, jobState, evById, get now() { return S.now; }, schemas: () => Object.values(tools).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) };
}
