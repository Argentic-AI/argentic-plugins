// One plain table per command, in the words of the research pages. Nothing here is a verdict: it prints counts.
import { ratio, usd } from "./common.mjs";

const pad = (s, n) => String(s).padEnd(n);
function table(head, rows) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => pad(c, w[i])).join("  ").trimEnd();
  return [line(head), line(w.map((n) => "-".repeat(n))), ...rows.map(line)].join("\n");
}
const state = (s) => (s.complete ? "finished" : `INCOMPLETE (${s.stopReason ?? s.stop_reason ?? "stopped early"})`);

export function shopReport(results, meta) {
  const rows = results.map((s) => [s.arm === "argentic" ? "Argentic" : "plain loop", ratio(s.earlier), ratio(s.stock), s.oldPrices, s.refundedTwice, `${s.answered}/${s.events}`, usd(s.spent_usd), state(s)]);
  return [
    `Shop shift: ${meta.events} events, seed ${meta.seed}, ${meta.model}, ${meta.date}${meta.engine ? `, engine build ${meta.engine.build ?? "?"} (commit ${String(meta.engine.commit ?? "?").slice(0, 10)})` : ""}`,
    "",
    table(["arm", "earlier facts", "stock exact", "old prices", "refunded twice", "answered", "spend", "run"], rows),
    "",
    "Earlier facts: questions about preferences, promised refunds, price changes and the refund window. Stock exact: the CEO's stock-count questions answered with the exact number.",
    "Old prices: quote questions answered with a price that had since changed. Refunded twice: refund calls made for an order that was already refunded.",
    "One scenario, one seed, one model: read this as a spot check of your own setup, not a benchmark. The plain loop is a simple windowed loop we wrote, not your agent.",
  ].join("\n");
}

export function dayReport(results, meta) {
  const r = (s, k) => s.rows?.[k] ? `${s.rows[k].pass} of ${s.rows[k].n}` : "n/a";
  const rows = results.map((s) => [s.entry?.startsWith("plain") ? "plain loop" : "Argentic", r(s, "R1_routing"), r(s, "R2_lost_or_doubled"), r(s, "R3_rules"), r(s, "R4_recall"), s.rows?.R6_status?.mean_f1 ?? "n/a", s.rows?.R7_cost?.duplicate_workers ?? "n/a", usd(s.spent_usd), s.complete ? "finished" : `INCOMPLETE (${s.stop_reason})`]);
  return [
    `Coordinator day: ${meta.asks} asks, seed ${meta.seed}, ${meta.model}, ${meta.date}${meta.engine ? `, engine build ${meta.engine.build ?? "?"} (commit ${String(meta.engine.commit ?? "?").slice(0, 10)})` : ""}`,
    "",
    table(["arm", "routing", "asks started once", "rules kept", "earlier facts", "status F1", "duplicate workers", "spend", "run"], rows),
    "",
    "Scripted owner and workers, code-scored, no model in the scoring. Routing: follow-ups and drops reached the right worker. Work lost or doubled: each ask started once. Rules kept: the owner's standing rules held.",
    "Early: we have run this on only a few seeds and our own runs showed gaps (see getargentic.com/research/check). One seed means no claim; run a few seeds before you read anything into a difference.",
  ].join("\n");
}

export function controlsReport(shop, day) {
  const f = (s) => `earlier ${ratio(s.earlier)}, stock ${ratio(s.stock)}, old prices ${s.oldPrices}, refunded twice ${s.refundedTwice}`;
  const lines = ["Free scorer checks: no model, no keys, no network.", "", "Shop shift (scripted agents, not language models):"];
  for (const [name, s] of Object.entries(shop)) lines.push(`  ${pad(name, 10)} ${f(s)}`);
  lines.push("", "Coordinator day (scripted agents, not language models):");
  for (const [name, g] of Object.entries(day)) lines.push(`  ${pad(name, 10)} routing ${g.R1_routing.pass}/${g.R1_routing.n}, lost or doubled ${g.R2_lost_or_doubled.pass}/${g.R2_lost_or_doubled.n}, rules ${g.R3_rules.pass}/${g.R3_rules.n}, earlier facts ${g.R4_recall.pass}/${g.R4_recall.n}, status F1 ${g.R6_status.mean_f1}`);
  lines.push("", "perfect reads the world's own bookkeeping, so it shows the scorer can reach 100%. forgetful loses what it was told earlier. repeats pays every refund twice (shop) or starts a worker per message (day). idle answers nothing.");
  return lines.join("\n");
}
