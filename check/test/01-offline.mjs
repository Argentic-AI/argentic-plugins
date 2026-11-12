// Free checks: the copied lab files, the scorers on scripted agents, and the command line's refusals. Exits 0 only if every check passes.
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
let r = await run(["help"]); check("help exits 0", r.code === 0 && /argentic-check controls/.test(r.out));
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
r = await run(["controls"]); check("controls runs with no keys", r.code === 0 && /perfect/.test(r.out) && /Coordinator day/.test(r.out));
r = await run(["verify"]); check("verify exits 0 on the shipped files", r.code === 0);
finish();
