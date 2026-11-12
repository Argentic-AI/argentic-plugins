// Shared helpers for the tester: flags, prices, the spend estimate, the confirmation step, small formatting.
import { appendFileSync, mkdirSync } from "node:fs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const usd = (n) => (n == null ? "n/a" : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);
export const ratio = (p) => `${p[0]} of ${p[1]}`;

// USD per 1,000,000 tokens. Haiku 5.5 is the default because it is what our own runs used; other models need --prices.
export const MODELS = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cache_hit: 0.01, cache_write: 0.125, long_above: 100_000, long_mult: 5 },
};
export const DEFAULT_MODEL = "claude-haiku-5-5";

export class UsageError extends Error {}

export function parseArgs(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const k = a.slice(2), kind = spec[k];
    if (kind === undefined) throw new UsageError(`unknown flag --${k}`);
    if (kind === "bool") out[k] = true;
    else { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw new UsageError(`--${k} needs a value`); out[k] = v; }
  }
  return out;
}

export function resolveModel(flags, env) {
  const id = flags.model ?? env.MODEL_ID ?? DEFAULT_MODEL;
  let prices = MODELS[id];
  if (flags.prices) {
    const [i, o, h, w] = flags.prices.split(",").map(Number);
    if ([i, o, h, w].some((x) => !Number.isFinite(x) || x < 0)) throw new UsageError("--prices wants four numbers: in,out,cache_hit,cache_write (USD per million tokens)");
    prices = { in: i, out: o, cache_hit: h, cache_write: w, long_above: Infinity, long_mult: 1 };
  }
  if (!prices) throw new UsageError(`no price table for ${id}. Pass --prices in,out,cache_hit,cache_write (USD per million tokens) so the spend cap means something.`);
  return { id, prices, provider: "anthropic" };
}

// Rough per-arm cost. From our own runs on Haiku 5.5: the shop shift cost about $0.0005 per event on Argentic (900 events, $0.41 to $0.52);
// the plain loop has no run of ours at this size, so its figure is a guess. The cap is the guarantee, not this number.
export const ESTIMATE = {
  shop: { argentic: (events) => 0.00055 * events, plain: (events) => 0.0008 * events, minutesPer100: { argentic: 20, plain: 8 } },
  // day, from our own runs on Haiku 5.5 (v2 and seeds3): 18 asks cost $0.06 on Argentic ($0.045 plain), 54 asks $0.13 to $0.21 ($0.10 to $0.13 plain)
  day: { argentic: (asks) => 0.0035 * asks, plain: (asks) => 0.0027 * asks, minutesPerAsk: { argentic: 0.4, plain: 0.15 } },
};
export function estimateText(rows, capUsd) {
  const lines = rows.map((r) => `  ${r.arm.padEnd(10)} about ${usd(r.usd)}${r.minutes ? `, roughly ${r.minutes} min` : ""}`);
  const total = rows.reduce((s, r) => s + r.usd, 0);
  return [`Estimated spend (a guess from our runs on Haiku 5.5; real cost can differ):`, ...lines, `  total      about ${usd(total)}`, `Hard cap: ${usd(capUsd)} in total (${usd(capUsd / rows.length)} per arm). A run that reaches its cap stops and says so; its score is then marked incomplete.`].join("\n");
}

export async function confirm(flags, stdin = process.stdin, stdout = process.stdout) {
  if (flags.yes) return true;
  if (!stdin.isTTY) return false;
  stdout.write("Start? [y/N] ");
  const ans = await new Promise((r) => { stdin.setEncoding("utf8"); stdin.once("data", (d) => r(String(d).trim().toLowerCase())); });
  return ans === "y" || ans === "yes";
}

export const jsonl = (file) => (o) => appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
export const mk = (d) => (mkdirSync(d, { recursive: true }), d);

// 429s from the engine wait their Retry-After instead of failing the run.
export function patientFetch(onWait = () => {}) {
  let total = 0;
  return async (url, init) => {
    for (;;) {
      const r = await fetch(url, init);
      if (r.status !== 429) return r;
      total++; const ra = Number(r.headers.get("retry-after")) || 5; await r.body?.cancel().catch(() => {});
      onWait({ wait_s: ra, total }); await sleep(ra * 1000 + 250);
    }
  };
}

export async function engineBuild(baseUrl, fetchFn = fetch) {
  try { const r = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/health`); if (!r.ok) return null; const j = await r.json(); return { build: j.build ?? null, commit: j.commit ?? null }; } catch { return null; }
}
