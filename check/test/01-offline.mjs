// Free checks: the copied lab files, the scorers on scripted agents, and the command line's refusals. Exits 0 only if every check passes.
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyLab } from "../src/lab.mjs";
import { shopControl, dayControl } from "../src/controls.mjs";
import { main } from "../src/cli.mjs";
import { check, finish } from "./lib.mjs";

const v = verifyLab();
check("lab files are byte-identical to the lab's", v.ok, v.lines.filter((l) => /CHANGED/.test(l)).join(" | "));

const perfect = await shopControl("perfect"), forgetful = await shopControl("forgetful"), repeats = await shopControl("repeats"), idle = await shopControl("idle");
check("shop scorer reaches 100% on a perfect agent", perfect.earlier[0] === perfect.earlier[1] && perfect.stock[0] === perfect.stock[1] && perfect.oldPrices === 0 && perfect.refundedTwice === 0 && perfect.complete, JSON.stringify(perfect));
check("shop scorer: a forgetful agent loses facts and stock", forgetful.earlier[0] < forgetful.earlier[1] && forgetful.stock[0] === 0, JSON.stringify(forgetful));
check("shop scorer: paying refunds twice is counted", repeats.refundedTwice > 0 && perfect.refundedTwice === 0, JSON.stringify(repeats));
check("shop scorer: an idle agent scores nothing", idle.earlier[0] === 0 && idle.stock[0] === 0, JSON.stringify(idle));
check("shop denominators come from the scenario, not the run", perfect.earlier[1] === idle.earlier[1] && perfect.stock[1] === idle.stock[1]);

const dp = dayControl("perfect"), df = dayControl("forgetful"), dr = dayControl("repeats"), di = dayControl("idle");
check("day scorer reaches 100% on a perfect solver", ["R1_routing", "R2_lost_or_doubled", "R3_rules", "R4_recall"].every((k) => dp[k].pass === dp[k].n) && dp.R6_status.mean_f1 === 1);
check("day scorer: a forgetful agent breaks rules and routing", df.R3_rules.pass < df.R3_rules.n && df.R1_routing.pass < df.R1_routing.n);
check("day scorer: a worker per message doubles work", dr.R2_lost_or_doubled.pass < dr.R2_lost_or_doubled.n);
check("day scorer: an idle agent starts nothing", di.R2_lost_or_doubled.pass === 0);

// command line
const run = async (argv, env = {}) => { const out = [], err = []; const code = await main(argv, env, { out: (s) => out.push(s), err: (s) => err.push(s) }); return { code, out: out.join("\n"), err: err.join("\n") }; };
const keys = { MODEL_KEY: "sk-test", ARGENTIC_API_KEY: "aek_test" };
let r = await run(["help"]); check("help exits 0", r.code === 0 && /argentic-check run <suite>/.test(r.out) && /argentic-check shop/.test(r.out));
r = await run(["shop"], keys); check("refuses to start without --cap-usd", r.code === 2 && /--cap-usd is required/.test(r.err));
r = await run(["shop", "--cap-usd", "0"], keys); check("refuses a zero cap", r.code === 2);
r = await run(["shop", "--cap-usd", "1"], {}); check("refuses without a model key", r.code === 2 && /MODEL_KEY/.test(r.err));
r = await run(["shop", "--cap-usd", "1"], { MODEL_KEY: "x" }); check("refuses the Argentic arm without an Argentic key", r.code === 2 && /ARGENTIC_API_KEY/.test(r.err));
r = await run(["shop", "--cap-usd", "1", "--model", "claude-mystery-9"], keys); check("refuses a model with no price table", r.code === 2 && /--prices/.test(r.err));
r = await run(["shop", "--cap-usd", "1", "--arms", "magic"], keys); check("refuses unknown arms", r.code === 2);
r = await run(["shop", "--cap-usd", "1", "--bogus"], keys); check("refuses unknown flags", r.code === 2 && /unknown flag/.test(r.err));
r = await run(["shop", "--cap-usd", "0.5", "--events", "300"], keys);
check("prints an estimate and the cap, then waits for --yes", r.code === 2 && /Estimated spend/.test(r.out) && /Hard cap: \$0\.50 in total/.test(r.out) && /pass --yes/.test(r.err), r.out + r.err);
r = await run(["day", "--cap-usd", "0.6"], keys); check("day shows its estimate too", /Coordinator day: 18 asks/.test(r.out) && /Estimated spend/.test(r.out) && r.code === 2);
r = await run(["controls", "longshift"]); check("longshift controls: perfect solver 100%, idle 0%", r.code === 0 && /perfect\s+all 100%/.test(r.out) && /idle\s+all 0%/.test(r.out), r.out);
r = await run(["longshift", "--cap-usd", "1", "--hours", "2"], keys); check("longshift refuses a shift under 3 hours", r.code === 2 && /whole number from 3 to 48/.test(r.err), r.err);
r = await run(["longshift", "--cap-usd", "1", "--plain-variant", "weird"], keys); check("longshift refuses an unknown plain variant", r.code === 2 && /compact or keep/.test(r.err));
r = await run(["longshift", "--cap-usd", "1"], keys); check("longshift prints an estimate and waits for --yes", r.code === 2 && /Longshift: 6-hour shift/.test(r.out) && /Estimated spend/.test(r.out));
r = await run(["controls"]); check("controls runs with no keys", r.code === 0 && /perfect/.test(r.out) && /Coordinator day/.test(r.out));
r = await run(["verify"]); check("verify exits 0 on the shipped files", r.code === 0);

// the harness is scenario-agnostic: suites are a registry, `run <suite>` and the short form are the same, and a suite can be a file of your own
r = await run(["list"]); check("list names every suite with its length flag", r.code === 0 && /shop /.test(r.out) && /--events N \(default 300\)/.test(r.out) && /day /.test(r.out) && /--asks N \(default 18\)/.test(r.out));
r = await run(["run", "shop", "--cap-usd", "0.5", "--size", "120"], keys); check("run <suite> accepts the generic --size", r.code === 2 && /Shop shift: 120 events/.test(r.out), r.out + r.err);
r = await run(["run", "day", "--cap-usd", "0.5", "--asks", "30"], keys); check("run <suite> accepts the suite's own length flag", /Coordinator day: 30 asks/.test(r.out));
r = await run(["run", "shop", "--cap-usd", "1", "--events", "10", "--size", "10"], keys); check("refuses both --events and --size", r.code === 2 && /not both/.test(r.err));
r = await run(["run"], keys); check("run without a suite says so", r.code === 2 && /run needs a suite/.test(r.err));
r = await run(["run", "nonesuch", "--cap-usd", "1"], keys); check("an unknown suite is refused", r.code === 2 && /unknown command nonesuch/.test(r.err));
r = await run(["controls", "shop"]); check("controls can be limited to one suite", r.code === 0 && /Shop shift/.test(r.out) && !/Coordinator day/.test(r.out));
r = await run(["shop", "--cap-usd", "1", "--arms", "argentic"], { MODEL_KEY: "x" }); check("a suite's argentic arm still needs the Argentic key", r.code === 2 && /ARGENTIC_API_KEY/.test(r.err));

const dir = mkdtempSync(join(tmpdir(), "check-suite-"));
const suiteFile = join(dir, "toy.mjs");
writeFileSync(suiteFile, `export default { id: "toy", title: "Toy", blurb: "a suite of our own", size: { flag: "rounds", unit: "rounds", default: 4 }, seed: 7, flags: {},
  arms: { mine: { label: "my agent", estimate: (n) => ({ usd: 0.001 * n, minutes: 1 }), run: async (c) => ({ arm: "mine", spent_usd: 0.002, complete: true, size: c.size, seed: c.seed, capUsd: c.capUsd }) } },
  describe: (n, seed) => \`Toy: \${n} rounds, seed \${seed}\`, report: (results, meta) => \`toy report: \${results.length} arm, \${meta.rounds} rounds\` };`);
r = await run([suiteFile, "--cap-usd", "0.5", "--yes", "--out", dir], { MODEL_KEY: "sk-test" });
check("a suite file of your own runs through the same harness (no Argentic key needed when it has no Argentic arm)", r.code === 0 && /Toy: 4 rounds, seed 7/.test(r.out) && /toy report: 1 arm, 4 rounds/.test(r.out), r.out + r.err);
const written = readdirSync(dir).find((d) => d.startsWith("toy-")), saved = written && JSON.parse(readFileSync(join(dir, written, "result.json"), "utf8"));
check("the run writes result.json with the suite id in meta", saved?.meta.suite === "toy" && saved.results[0].capUsd === 0.5, JSON.stringify(saved));
writeFileSync(join(dir, "bad.mjs"), "export default { id: 'Bad Id' };");
r = await run(["run", join(dir, "bad.mjs"), "--cap-usd", "1"], { MODEL_KEY: "x" }); check("a malformed suite file is refused with a reason", r.code === 2 && /not a valid suite/.test(r.err), r.err);
r = await run(["run", join(dir, "missing.mjs"), "--cap-usd", "1"], { MODEL_KEY: "x" }); check("a missing suite file is refused", r.code === 2 && /could not load suite file/.test(r.err));
finish();
