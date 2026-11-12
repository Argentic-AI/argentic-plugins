// Shared plumbing for the P1 drivers: one run = one scenario, one world, one run folder. Identical for every entry: scenario, world, tool path, stop rules, dump and grade.
// An entry decides only how the model is called. No model call happens here; importing this file spends nothing.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { generate } from "./gen.mjs";
import { makeWorld } from "./world.mjs";
import { grade } from "./grade.mjs";
import { promptHash } from "./prompt.mjs";

export class Stop extends Error { constructor(reason) { super(reason); this.reason = reason; } }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const parseFlags = (argv) => ({ flag: (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; }, has: (n) => argv.includes(`--${n}`) });
export const scenarioHash = (scn) => createHash("sha256").update(JSON.stringify({ msgs: scn.msgs, plans: scn.plans, rules: scn.rules })).digest("hex");
const sha = (f) => { try { return createHash("sha256").update(readFileSync(new URL(f, import.meta.url))).digest("hex"); } catch { return null; } };
const stamp = (t0, s) => { const e = Math.round((Date.now() - t0) / 1000), p = (n) => String(n).padStart(2, "0"); return `[${p(Math.floor(e / 3600))}:${p(Math.floor((e % 3600) / 60))}:${p(e % 60)}] ${s}`; };

export function setupRun({ root = new URL("./runs", import.meta.url).pathname, name, asks = 18, seed = 20261106, entry, capUsd, maxMs = Infinity, maxCalls = Infinity, afterOverCalls = 8, spent = () => 0, config = {}, quiet = false }) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(name ?? "")) throw new Error("run name: letters, digits, - and _ (max 40)");
  if (!(capUsd > 0)) throw new Error("capUsd is required and must be above 0: a run without a spend cap does not start");
  const dir = join(root, name); mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, "summary.json"))) throw new Error(`${dir} already holds a finished run; use a new --name`);
  const P = (f) => join(dir, f), t0 = Date.now(), deadline = Number.isFinite(maxMs) ? t0 + maxMs : Infinity;
  const logLine = (s) => { const l = stamp(t0, s); if (!quiet) console.log(l); appendFileSync(P("run.log"), l + "\n"); };
  const event = (o) => appendFileSync(P("events.jsonl"), JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
  const scn = generate(asks, seed), world = makeWorld(scn), S = world.state;
  let toolCalls = 0, modelCalls = 0, overCalls = 0;
  const config_ = { track: "P1 coordinator day", entry, asks, seed, cap_usd: capUsd, max_ms: Number.isFinite(maxMs) ? maxMs : null, max_calls: Number.isFinite(maxCalls) ? maxCalls : null,
    scenario_sha256: scenarioHash(scn), prompt_sha256: promptHash(), scoring_sha256: sha("./grade.mjs"), world_sha256: sha("./world.mjs"), started: new Date(t0).toISOString(), ...config };
  writeFileSync(P("run.json"), JSON.stringify(config_, null, 2));
  const exec = (toolName, args) => { // one path for every tool call, whatever the entry; each log row is tagged with the model call that made it
    toolCalls++; let out; const n0 = world.log.length;
    try { out = world.call(toolName, args ?? {}); } catch (e) { out = `error: ${String(e?.message ?? e).slice(0, 200)}`; event({ type: "tool_throw", tool: toolName, error: String(e?.stack ?? e).slice(0, 400) }); }
    for (let i = n0; i < world.log.length; i++) world.log[i].call = modelCalls;
    return world.render(out);
  };
  const isError = (text) => typeof text === "string" && /^error[: ]/i.test(text);
  const beforeCall = () => { // called before every model request; throws Stop with the reason
    if (S.finished !== null) throw new Stop("finish");
    if (Date.now() > deadline) throw new Stop(`wall clock ${Math.round(maxMs / 1000)}s reached`);
    const s = spent(); if (s >= capUsd) throw new Stop(`spend cap $${capUsd} reached ($${s.toFixed(3)})`);
    if (modelCalls >= maxCalls) throw new Stop(`call cap ${maxCalls} reached`);
    if (S.over && ++overCalls > afterOverCalls) throw new Stop("shift over and finish was not called");
  };
  const noteModelCall = () => ++modelCalls;
  const finalize = ({ stopReason, extra = {} }) => {
    const g = grade(world); writeFileSync(P("grade.json"), JSON.stringify(g, null, 1));
    writeFileSync(P("log.json"), JSON.stringify(world.log)); writeFileSync(P("wakes.json"), JSON.stringify(world.wakes));
    const { items_detail, ...rows } = g;
    const summary = { ...config_, ended: new Date().toISOString(), wall_s: Math.round((Date.now() - t0) / 1000), stop_reason: stopReason, complete: S.finished !== null, finish_summary: S.finished, tool_calls: toolCalls, model_calls: modelCalls, day_over: S.over, spent_usd: +spent().toFixed(4), rows, ...extra };
    writeFileSync(P("summary.json"), JSON.stringify(summary, null, 2));
    logLine(`end: ${stopReason}; R1 ${g.R1_routing.pass}/${g.R1_routing.n} R2 ${g.R2_lost_or_doubled.pass}/${g.R2_lost_or_doubled.n} R3 ${g.R3_rules.pass}/${g.R3_rules.n} R4 ${g.R4_recall.pass}/${g.R4_recall.n} R6 f1 ${g.R6_status.mean_f1}; spent $${spent().toFixed(3)}`);
    return { summary, grade: g };
  };
  return { dir, P, scn, world, state: S, exec, isError, beforeCall, noteModelCall, finalize, logLine, event, config: config_, modelCalls: () => modelCalls };
}
