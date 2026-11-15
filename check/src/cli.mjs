// argentic-check: run a scripted scenario (a "suite") against Argentic and against a plain loop, with your own keys and a hard spend cap.
// This file knows nothing about any one scenario: suites live in ./suites and bring their own arms, estimate, report and free controls.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError, parseArgs, resolveModel, estimateText, confirm, mk, engineBuild, usd } from "./common.mjs";
import { SUITES, resolveSuite } from "./suites/index.mjs";
import { controlsReport } from "./report.mjs";
import { verifyLab } from "./lab.mjs";

const helpText = () => `argentic-check: run a scripted agent scenario yourself, with your own keys and a hard spend cap.

  argentic-check list                       the suites that ship with this version
  argentic-check run <suite> --cap-usd 0.5  run one suite: a plain windowed loop vs Argentic on the same script
  argentic-check shop --cap-usd 0.5         the same, shorter: every suite id works as a command (${SUITES.map((s) => s.id).join(", ")})
  argentic-check controls [suite]           free: scripted agents against each scorer, no model and no keys
  argentic-check verify                     check that the scenario and scorer files are byte-identical to the lab's

<suite> is one of the ids from \`list\`, or the path to a suite file of your own (see "Add a suite" in the README).

Keys (set them in your shell, never in a file we read):
  MODEL_KEY or ANTHROPIC_API_KEY   your Anthropic key (needed by every arm)
  ARGENTIC_API_KEY                 your Argentic key (the Argentic arm), from getargentic.com/platform

Flags for run:
  --cap-usd N       required. The most you will spend in total; each arm gets an equal share and stops at it.
  --size N          how long the scenario is. Each suite also has its own name for it (see \`list\`); both work.
  --seed N          scenario seed (default: the suite's own)
  --arms LIST       plain,argentic (default every arm the suite has). One arm halves the cost.
  --model ID        default claude-haiku-5-5. Another model needs --prices in,out,cache_hit,cache_write (USD per million tokens).
  --out DIR         where run files go (default ./check-runs)
  --base-url URL    Argentic API (default https://api.getargentic.com)
  --yes             start without asking. Without it a terminal asks first and a script refuses.
`;

const COMMON = { "cap-usd": "val", size: "val", seed: "val", arms: "val", model: "val", prices: "val", out: "val", "base-url": "val", yes: "bool", help: "bool" };
const num = (flags, k, d) => { if (flags[k] === undefined) return d; const n = Number(flags[k]); if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${k} must be a positive number`); return n; };

async function preflight(baseUrl, apiKey) {
  try {
    const r = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/usage?days=1`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (r.status === 401 || r.status === 403) throw new UsageError(`Argentic refused ARGENTIC_API_KEY (HTTP ${r.status}). Make one at https://getargentic.com/platform.`);
  } catch (e) { if (e instanceof UsageError) throw e; /* offline checks happen later, with a clearer error */ }
}

export async function main(argv, env = process.env, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { io.out(helpText()); return 0; }
  try {
    if (cmd === "verify") { const v = verifyLab(); io.out(v.lines.join("\n")); return v.ok ? 0 : 1; }
    if (cmd === "list") {
      io.out(SUITES.map((s) => `  ${s.id.padEnd(10)} ${s.title}: ${s.blurb}\n         length --${s.size.flag} N (default ${s.size.default}), seed ${s.seed}, arms ${Object.keys(s.arms).join(", ")}`).join("\n"));
      return 0;
    }
    if (cmd === "controls") {
      let suites = SUITES;
      if (argv[1]) { const s = await resolveSuite(argv[1]); if (!s) throw new UsageError(`unknown suite ${argv[1]}. Try: argentic-check list`); suites = [s]; }
      const withControls = suites.filter((s) => s.controls);
      if (!withControls.length) throw new UsageError("that suite has no free controls");
      io.out(controlsReport(await Promise.all(withControls.map((s) => s.controls()))));
      return 0;
    }

    let ref = cmd, rest = argv.slice(1);
    if (cmd === "run") { ref = argv[1]; rest = argv.slice(2); if (!ref || ref.startsWith("--")) throw new UsageError("run needs a suite: argentic-check run <suite> --cap-usd N. See: argentic-check list"); }
    const suite = await resolveSuite(ref);
    if (!suite) throw new UsageError(`unknown command ${ref}. Try: argentic-check help`);

    const spec = { ...COMMON, [suite.size.flag]: "val", ...(suite.flags ?? {}) };
    const flags = parseArgs(rest, spec);
    if (flags.help) { io.out(helpText()); return 0; }
    if (flags["cap-usd"] === undefined) throw new UsageError("--cap-usd is required: it is the most this run will spend, in total. A run without a cap does not start.");
    const cap = num(flags, "cap-usd"), model = resolveModel(flags, env);
    const armNames = Object.keys(suite.arms), arms = (flags.arms ?? armNames.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
    if (!arms.length || arms.some((a) => !armNames.includes(a))) throw new UsageError(`--arms is ${armNames.join(", ")} (comma-separated)`);
    const modelKey = env.MODEL_KEY ?? env.ANTHROPIC_API_KEY, apiKey = env.ARGENTIC_API_KEY, baseUrl = (flags["base-url"] ?? env.ARGENTIC_BASE_URL ?? "https://api.getargentic.com").replace(/\/+$/, "");
    if (!modelKey) throw new UsageError("MODEL_KEY (or ANTHROPIC_API_KEY) is not set. It is your Anthropic key; every arm calls the model with it.");
    const needsArgentic = arms.filter((a) => suite.arms[a].argentic);
    if (needsArgentic.length && !apiKey) throw new UsageError("ARGENTIC_API_KEY is not set (get one at https://getargentic.com/platform), or run --arms plain.");
    if (flags[suite.size.flag] !== undefined && flags.size !== undefined) throw new UsageError(`give --${suite.size.flag} or --size, not both`);
    const size = Math.round(num(flags, flags[suite.size.flag] !== undefined ? suite.size.flag : "size", suite.size.default));
    suite.validate?.(size, flags);
    const seed = flags.seed !== undefined ? Math.round(num(flags, "seed")) : suite.seed;
    const est = arms.map((a) => { const e = suite.arms[a].estimate(size); return { arm: suite.arms[a].label, usd: e.usd, minutes: Math.max(1, Math.round(e.minutes ?? 0)) }; });

    io.out(`${suite.describe(size, seed)}, model ${model.id}, arms: ${arms.join(" and ")}.`);
    io.out(estimateText(est, cap));
    io.out(needsArgentic.length
      ? "Your Anthropic key goes to Anthropic, and (Argentic arm) in a header to Argentic, which does not store it. Nothing is sent anywhere else."
      : "Your Anthropic key goes to Anthropic. Nothing is sent anywhere else.");
    if (!(await confirm(flags))) { io.err("Not started: pass --yes to go ahead."); return 2; }

    if (needsArgentic.length) await preflight(baseUrl, apiKey);
    const out = resolve(flags.out ?? "check-runs"), stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19), root = mk(join(out, `${suite.id}-${stamp}`));
    const upstream = (env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, ""), perArm = cap / arms.length, results = [], engine = needsArgentic.length ? await engineBuild(baseUrl) : null;
    const meta = { suite: suite.id, size, [suite.size.unit]: size, seed, model: model.id, date: new Date().toISOString().slice(0, 10), engine };
    for (const arm of arms) {
      io.out(`\n== ${suite.arms[arm].label} (cap ${usd(perArm)}) ==`);
      results.push(await suite.arms[arm].run({ root, size, seed, capUsd: perArm, model, modelKey, apiKey, baseUrl, upstream, log: io.out, flags, num: (k, d) => num(flags, k, d) }));
    }
    writeFileSync(join(root, "result.json"), JSON.stringify({ meta, results }, null, 2));
    io.out("\n" + suite.report(results, meta));
    io.out(`\nRun files: ${root}`);
    return results.every((r) => r.complete) ? 0 : 3;
  } catch (e) {
    if (e instanceof UsageError) { io.err(`argentic-check: ${e.message}`); return 2; }
    io.err(`argentic-check: ${e?.stack ?? e}`); return 1;
  }
}
