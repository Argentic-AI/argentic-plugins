// argentic-check: run the shop shift or the coordinator day against Argentic and against a plain loop, with your own keys and a hard spend cap.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError, parseArgs, resolveModel, estimateText, ESTIMATE, confirm, mk, engineBuild, usd } from "./common.mjs";
import { runShopArgentic, runShopPlain, SHOP_EVENTS, SHOP_SEED } from "./shop.mjs";
import { shopReport, dayReport, controlsReport } from "./report.mjs";
import { allControls } from "./controls.mjs";
import { verifyLab } from "./lab.mjs";

const HELP = `argentic-check: test our shop shift and coordinator day yourself.

  argentic-check controls                 free: the scorers on scripted agents. No keys, no network.
  argentic-check shop  --cap-usd 0.5      the Kestrel Supply shift (default ${SHOP_EVENTS} events), plain loop vs Argentic
  argentic-check day   --cap-usd 0.3      the coordinator day (default 18 asks), plain loop vs Argentic
  argentic-check verify                   check that the scenario and scorer files are byte-identical to the lab's

Keys (set them in your shell, never in a file we read):
  MODEL_KEY or ANTHROPIC_API_KEY   your Anthropic key (needed by both arms)
  ARGENTIC_API_KEY                 your Argentic key (the Argentic arm), from getargentic.com/platform

Flags for shop and day:
  --cap-usd N       required. The most you will spend in total; each arm gets an equal share and stops at it.
  --events N        shop only: events in the shift (default ${SHOP_EVENTS}; our published runs used 900, about 3 hours per arm)
  --asks N          day only: asks in the day (default 18; our multi-seed runs used 54)
  --seed N          scenario seed (default: ours)
  --arms LIST       plain,argentic (default both). One arm, e.g. --arms argentic, halves the cost.
  --model ID        default claude-haiku-5-5. Another model needs --prices in,out,cache_hit,cache_write (USD per million tokens).
  --out DIR         where run files go (default ./check-runs)
  --base-url URL    Argentic API (default https://api.getargentic.com)
  --yes             start without asking. Without it a terminal asks first and a script refuses.
`;

const SPEC = { "cap-usd": "val", events: "val", asks: "val", seed: "val", arms: "val", model: "val", prices: "val", out: "val", "base-url": "val", "window-tokens": "val", yes: "bool", help: "bool" };
const num = (flags, k, d) => { if (flags[k] === undefined) return d; const n = Number(flags[k]); if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${k} must be a positive number`); return n; };

async function preflight(baseUrl, apiKey) {
  try {
    const r = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/usage?days=1`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (r.status === 401 || r.status === 403) throw new UsageError(`Argentic refused ARGENTIC_API_KEY (HTTP ${r.status}). Make one at https://getargentic.com/platform.`);
  } catch (e) { if (e instanceof UsageError) throw e; /* offline checks happen later, with a clearer error */ }
}

export async function main(argv, env = process.env, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { io.out(HELP); return 0; }
  try {
    if (cmd === "verify") { const v = verifyLab(); io.out(v.lines.join("\n")); return v.ok ? 0 : 1; }
    if (cmd === "controls") { const { shop, day } = await allControls(); io.out(controlsReport(shop, day)); return 0; }
    if (cmd !== "shop" && cmd !== "day") throw new UsageError(`unknown command ${cmd}. Try: argentic-check help`);

    const flags = parseArgs(argv.slice(1), SPEC);
    if (flags.help) { io.out(HELP); return 0; }
    if (flags["cap-usd"] === undefined) throw new UsageError("--cap-usd is required: it is the most this run will spend, in total. A run without a cap does not start.");
    const cap = num(flags, "cap-usd"), model = resolveModel(flags, env);
    const arms = (flags.arms ?? "plain,argentic").split(",").map((s) => s.trim()).filter(Boolean);
    if (!arms.length || arms.some((a) => a !== "plain" && a !== "argentic")) throw new UsageError("--arms is plain, argentic or plain,argentic");
    const modelKey = env.MODEL_KEY ?? env.ANTHROPIC_API_KEY, apiKey = env.ARGENTIC_API_KEY, baseUrl = (flags["base-url"] ?? env.ARGENTIC_BASE_URL ?? "https://api.getargentic.com").replace(/\/+$/, "");
    if (!modelKey) throw new UsageError("MODEL_KEY (or ANTHROPIC_API_KEY) is not set. It is your Anthropic key; both arms call the model with it.");
    if (arms.includes("argentic") && !apiKey) throw new UsageError("ARGENTIC_API_KEY is not set (get one at https://getargentic.com/platform), or run --arms plain.");
    const events = cmd === "shop" ? Math.round(num(flags, "events", SHOP_EVENTS)) : null, asks = cmd === "day" ? Math.round(num(flags, "asks", 18)) : null;
    const seed = flags.seed !== undefined ? Math.round(num(flags, "seed")) : cmd === "shop" ? SHOP_SEED : 20261106;
    const est = arms.map((a) => ({ arm: a === "argentic" ? "Argentic" : "plain loop", usd: ESTIMATE[cmd][a](events ?? asks), minutes: Math.max(1, Math.round(cmd === "shop" ? (events / 100) * ESTIMATE.shop.minutesPer100[a] : asks * ESTIMATE.day.minutesPerAsk[a])) }));

    io.out(`${cmd === "shop" ? `Shop shift: ${events} events` : `Coordinator day: ${asks} asks`}, seed ${seed}, model ${model.id}, arms: ${arms.join(" and ")}.`);
    io.out(estimateText(est, cap));
    io.out("Your Anthropic key goes to Anthropic, and (Argentic arm) in a header to Argentic, which does not store it. Nothing is sent anywhere else.");
    if (!(await confirm(flags))) { io.err("Not started: pass --yes to go ahead."); return 2; }

    if (arms.includes("argentic")) await preflight(baseUrl, apiKey);
    const out = resolve(flags.out ?? "check-runs"), stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19), root = mk(join(out, `${cmd}-${stamp}`));
    const upstream = (env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, ""), perArm = cap / arms.length, results = [], engine = arms.includes("argentic") ? await engineBuild(baseUrl) : null;
    const meta = { events, asks, seed, model: model.id, date: new Date().toISOString().slice(0, 10), engine };
    for (const arm of arms) {
      io.out(`\n== ${arm === "argentic" ? "Argentic" : "plain loop"} (cap ${usd(perArm)}) ==`);
      if (cmd === "shop") results.push(arm === "argentic"
        ? await runShopArgentic({ out: root, events, seed, capUsd: perArm, model, apiKey, modelKey, baseUrl, log: io.out })
        : await runShopPlain({ out: root, events, seed, capUsd: perArm, model, apiKey: modelKey, upstream, windowTokens: num(flags, "window-tokens", 40000), log: io.out }));
      else {
        const common = { name: arm === "argentic" ? "argentic" : "plain", root, asks, seed, capUsd: perArm };
        if (arm === "argentic") { const { runArgentic } = await import("./day-argentic.mjs"); results.push((await runArgentic({ ...common, apiKey, modelKey, baseUrl, modelId: model.id, prices: model.prices })).summary); }
        else { const { runPlainLoop } = await import("../lab/day/plain-loop.mjs"); results.push((await runPlainLoop({ ...common, variant: "b1", modelId: model.id, apiKey: modelKey, upstream, prices: model.prices })).summary); }
      }
    }
    writeFileSync(join(root, "result.json"), JSON.stringify({ meta, results }, null, 2));
    io.out("\n" + (cmd === "shop" ? shopReport(results, meta) : dayReport(results, meta)));
    io.out(`\nRun files: ${root}`);
    return results.every((r) => r.complete) ? 0 : 3;
  } catch (e) {
    if (e instanceof UsageError) { io.err(`argentic-check: ${e.message}`); return 2; }
    io.err(`argentic-check: ${e?.stack ?? e}`); return 1;
  }
}
