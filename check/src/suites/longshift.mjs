// Suite: longshift, a bakery operations desk worked over hours. Scenario, world, tools, scorer and both entries come from the longshift kit (../../lab/longshift, byte-identical).
// Length is in hours of shift. Argentic built longshift and also enters it: the report says so.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError, usd } from "../common.mjs";
import { table, state } from "../report.mjs";

const LAB = fileURLToPath(new URL("../../lab/longshift/", import.meta.url));
const MIN_H = 3, MAX_H = 48;
const ENGINE = (m) => (m.engine ? `, engine build ${m.engine.build ?? "?"} (commit ${String(m.engine.commit ?? "?").slice(0, 10)})` : "");
const pct = (x) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);

// the prompt the model was sent, by shift hour (mean of the requests in that hour), from the run's own metrics file
function promptByHour(dir) {
  const f = join(dir, "metrics.jsonl"); if (!existsSync(f)) return {};
  const acc = {};
  for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) { try { const r = JSON.parse(l); if (typeof r.prompt_tokens === "number" && r.hour) (acc[r.hour] ??= []).push(r.prompt_tokens); } catch { /* skip */ } }
  return Object.fromEntries(Object.entries(acc).map(([h, xs]) => [h, Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)]));
}
const withPrompt = ({ summary, dir }) => ({ ...summary, prompt_by_hour: promptByHour(dir ?? join(LAB, "__none__")) });

export default {
  id: "longshift",
  title: "Longshift",
  blurb: "An agent is the one desk worker at a small bakery for a shift of hours; code scores recall, current values, standing rules, contradictions, commitments, delegation, running counts and conflicting updates, by hour and by how long ago the fact arrived.",
  size: { flag: "hours", unit: "hours", default: 6 },
  seed: 20261201,
  flags: { "plain-variant": "val" },
  validate(size, flags = {}) {
    if (size < MIN_H || size > MAX_H || !Number.isInteger(size)) throw new UsageError(`--hours must be a whole number from ${MIN_H} to ${MAX_H}. Question family F8 needs 5 hours or more, so 6 is the default.`);
    if (flags["plain-variant"] !== undefined && !["compact", "keep"].includes(flags["plain-variant"])) throw new UsageError("--plain-variant is compact or keep");
  },
  arms: {
    // estimates: the kit's free estimator, 6 h and 12 h, bounded entry about $0.025 an hour, plain compaction about $0.3 an hour (keep-everything is far higher: about $4.7 at 6 h). Minutes are a guess from the shop pace.
    plain: { label: "plain loop", estimate: (h) => ({ usd: 0.33 * h, minutes: 9 * h }),
      run: async (c) => { c.log(`  progress: tail -f ${join(c.root, "plain", "run.log")}`); const { runPlainLoop } = await import("../../lab/longshift/adapters/plain-loop.mjs"); return withPrompt(await runPlainLoop({ name: "plain", root: c.root, seed: c.seed, hours: c.size, capUsd: c.capUsd, variant: c.flags["plain-variant"] ?? "compact", modelId: c.model.id, apiKey: c.modelKey, upstream: c.upstream, prices: c.model.prices, quiet: true })); } },
    argentic: { label: "Argentic", argentic: true, estimate: (h) => ({ usd: 0.025 * h, minutes: 23 * h }),
      run: async (c) => { c.log(`  progress: tail -f ${join(c.root, "argentic", "run.log")}`); const { runArgentic } = await import("../../lab/longshift/adapters/argentic.mjs"); return withPrompt(await runArgentic({ name: "argentic", root: c.root, seed: c.seed, hours: c.size, capUsd: c.capUsd, apiKey: c.apiKey, modelKey: c.modelKey, baseUrl: c.baseUrl, modelId: c.model.id, prices: c.model.prices, quiet: true })); } },
  },
  describe: (size, seed) => `Longshift: ${size}-hour shift, seed ${seed}`,
  report(results, meta) {
    const name = (s) => (String(s.entry ?? s.arm ?? "").startsWith("plain") ? "plain loop" : "Argentic");
    const fam = (s, k) => pct(s.families?.[k]?.score);
    const rows = results.map((s) => [name(s), pct(s.pooled?.score), ...["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"].map((k) => fam(s, k)), usd(s.spent_usd), state(s)]);
    const hours = [...new Set(results.flatMap((s) => Object.keys(s.by_hour ?? {})))].map(Number).sort((a, b) => a - b);
    const byHour = hours.map((h) => [String(h), ...results.flatMap((s) => [pct(s.by_hour?.[h]?.score), s.prompt_by_hour?.[h] ? `${s.prompt_by_hour[h]}` : "n/a"])]);
    return [
      `Longshift: ${meta.hours}-hour shift, seed ${meta.seed}, ${meta.model}, ${meta.date}${ENGINE(meta)}`,
      "Argentic built longshift and also enters it, so read the rows with that in mind. Nothing here is a single score.",
      "",
      table(["arm", "all", "recall", "current", "rules", "contradictions", "commitments", "delegation", "counts", "conflicting updates", "spend", "run"], rows),
      "",
      "Accuracy and prompt size by hour of the shift (prompt = mean tokens sent per request in that hour):",
      table(["hour", ...results.flatMap((s) => [`${name(s)} accuracy`, `${name(s)} prompt`])], byHour),
      "",
      "Recall: a fact given earlier. Current: the present value of something that changed. Rules: standing instructions added, changed, limited or cancelled. Contradictions: two statements that disagree, without crying wolf at announced changes.",
      "Commitments: do it at the time. Delegation: route follow-ups and report where each request stands. Counts: running totals. Conflicting updates: what the choice is now, what it was, when it changed and why.",
      "One invented business, one model, scripted people, one seed: a spot check of your own setup, not a benchmark. The plain loop is the kit's plain agent (provider context compaction by default), not your agent.",
    ].join("\n");
  },
  controls: async (size = 6) => {
    const { generate } = await import("../../lab/longshift/core/gen.mjs"), { makeWorld } = await import("../../lab/longshift/core/world.mjs"), { grade } = await import("../../lab/longshift/core/grade.mjs"), { playControl } = await import("../../lab/longshift/core/controls.mjs");
    const lines = ["Longshift (scripted agents, not language models):"];
    for (const [label, kind] of [["perfect", "solver"], ["forgetful", "amnesiac"], ["recency-300", "recency-300"], ["idle", "noop"]]) {
      const w = makeWorld(generate(20261201, { hours: size })); playControl(kind, w); const g = grade(w);
      lines.push(`  ${label.padEnd(11)} all ${pct(g.pooled.score)}, ${Object.entries(g.families).map(([k, v]) => `${k} ${pct(v.score)}`).join(", ")}`);
    }
    lines.push("  perfect reads the world's own bookkeeping, so it shows the scorer can reach 100%. forgetful remembers nothing. recency-300 remembers only the last 300 minutes, so accuracy falls with distance. idle does nothing.");
    return lines;
  },
};
