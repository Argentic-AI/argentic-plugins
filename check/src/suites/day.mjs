// Suite: the coordinator day. The scenario, world and scorer are the lab's (../../lab/day); the Argentic runner is ../day-argentic.mjs.
import { usd } from "../common.mjs";
import { table } from "../report.mjs";
import { dayControl } from "../controls.mjs";

const ENGINE = (m) => (m.engine ? `, engine build ${m.engine.build ?? "?"} (commit ${String(m.engine.commit ?? "?").slice(0, 10)})` : "");

export default {
  id: "day",
  title: "Coordinator day",
  blurb: "An agent runs a crew of workers for one person across a simulated day; code scores routing, lost or doubled work, standing rules, memory and status reports. Early.",
  size: { flag: "asks", unit: "asks", default: 18 },
  seed: 20261106,
  flags: {},
  arms: {
    plain: { label: "plain loop", estimate: (n) => ({ usd: 0.0027 * n, minutes: n * 0.15 }),
      run: async (c) => { const { runPlainLoop } = await import("../../lab/day/plain-loop.mjs"); return (await runPlainLoop({ name: "plain", root: c.root, asks: c.size, seed: c.seed, capUsd: c.capUsd, variant: "b1", modelId: c.model.id, apiKey: c.modelKey, upstream: c.upstream, prices: c.model.prices })).summary; } },
    argentic: { label: "Argentic", argentic: true, estimate: (n) => ({ usd: 0.0035 * n, minutes: n * 0.4 }),
      run: async (c) => { const { runArgentic } = await import("../day-argentic.mjs"); return (await runArgentic({ name: "argentic", root: c.root, asks: c.size, seed: c.seed, capUsd: c.capUsd, apiKey: c.apiKey, modelKey: c.modelKey, baseUrl: c.baseUrl, modelId: c.model.id, prices: c.model.prices })).summary; } },
  },
  describe: (size, seed) => `Coordinator day: ${size} asks, seed ${seed}`,
  report(results, meta) {
    const r = (s, k) => (s.rows?.[k] ? `${s.rows[k].pass} of ${s.rows[k].n}` : "n/a");
    const rows = results.map((s) => [s.entry?.startsWith("plain") ? "plain loop" : "Argentic", r(s, "R1_routing"), r(s, "R2_lost_or_doubled"), r(s, "R3_rules"), r(s, "R4_recall"), s.rows?.R6_status?.mean_f1 ?? "n/a", s.rows?.R7_cost?.duplicate_workers ?? "n/a", usd(s.spent_usd), s.complete ? "finished" : `INCOMPLETE (${s.stop_reason})`]);
    return [
      `Coordinator day: ${meta.asks} asks, seed ${meta.seed}, ${meta.model}, ${meta.date}${ENGINE(meta)}`,
      "",
      table(["arm", "routing", "asks started once", "rules kept", "earlier facts", "status F1", "duplicate workers", "spend", "run"], rows),
      "",
      "Scripted owner and workers, code-scored, no model in the scoring. Routing: follow-ups and drops reached the right worker. Work lost or doubled: each ask started once. Rules kept: the owner's standing rules held.",
      "Early: we have run this on only a few seeds and our own runs showed gaps (see getargentic.com/research/check). One seed means no claim; run a few seeds before you read anything into a difference.",
    ].join("\n");
  },
  controls: async (size = 18) => {
    const lines = ["Coordinator day (scripted agents, not language models):"];
    for (const m of ["perfect", "forgetful", "repeats", "idle"]) {
      const g = dayControl(m, size);
      lines.push(`  ${m.padEnd(10)} routing ${g.R1_routing.pass}/${g.R1_routing.n}, lost or doubled ${g.R2_lost_or_doubled.pass}/${g.R2_lost_or_doubled.n}, rules ${g.R3_rules.pass}/${g.R3_rules.n}, earlier facts ${g.R4_recall.pass}/${g.R4_recall.n}, status F1 ${g.R6_status.mean_f1}`);
    }
    return lines;
  },
};
