// The two arms of each command against fake Anthropic and Argentic servers on 127.0.0.1. Spends nothing. Exits 0 only if every check passes.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODELS } from "../src/common.mjs";
import { runShopArgentic, runShopPlain } from "../src/shop.mjs";
import { main } from "../src/cli.mjs";
import { check, finish, shopOracle, idleDay, fakeAnthropic, fakeArgentic } from "./lib.mjs";

const N = 80, seed = 20261028, model = { provider: "anthropic", id: "claude-haiku-5-5", prices: MODELS["claude-haiku-5-5"] }, quiet = () => {};
const tmp = () => mkdtempSync(join(tmpdir(), "check-arms-"));

// ---- shop, plain loop
{
  const log = [], a = await fakeAnthropic({ decide: shopOracle(N, seed), log });
  const s = await runShopPlain({ out: tmp(), events: N, seed, capUsd: 5, model, apiKey: "sk-test", upstream: a.url, log: quiet });
  check("plain arm finishes the shift and scores every probe", s.complete && s.earlier[0] === s.earlier[1] && s.stock[0] === s.stock[1] && s.refundedTwice === 0, JSON.stringify(s));
  check("plain arm sends the key and model it was given", log.every((l) => l.key === "sk-test" && l.model === "claude-haiku-5-5") && log.length > N);
  check("plain arm spend is counted from usage at the price sheet", s.spent_usd > 0 && Math.abs(s.spent_usd - s.model_calls * (200 * 0.1 + 3000 * 0.01 + 60 * 0.5) / 1e6) < 1e-4, String(s.spent_usd));
  await a.close();
}
{
  const a = await fakeAnthropic({ decide: shopOracle(N, seed, "forgetful") });
  const s = await runShopPlain({ out: tmp(), events: N, seed, capUsd: 5, model, apiKey: "sk-test", upstream: a.url, log: quiet });
  check("a forgetful model scores lower through the same path", s.complete && (s.earlier[0] < s.earlier[1] || s.stock[0] < s.stock[1]), JSON.stringify(s));
  await a.close();
}
{
  const a = await fakeAnthropic({ decide: shopOracle(300, seed), inputTokens: 400_000 / 20 });   // each call costs about $0.0002 + cache reads
  const s = await runShopPlain({ out: tmp(), events: 300, seed, capUsd: 0.01, model, apiKey: "sk-test", upstream: a.url, log: quiet });
  check("plain arm stops at its cap and says the run is incomplete", !s.complete && /spend cap/.test(s.stopReason) && s.spent_usd >= 0.01 && s.spent_usd < 0.02, JSON.stringify(s));
  check("a stopped run still reports full-scenario denominators", s.earlier[1] > 0 && s.stock[1] > 0 && s.earlier[0] < s.earlier[1]);
  await a.close();
}

// ---- shop, Argentic arm, through the real @argentic-ai/client
{
  const log = [], g = await fakeArgentic({ decide: shopOracle(N, seed), log }), out = tmp();
  const s = await runShopArgentic({ out, events: N, seed, capUsd: 5, model, apiKey: "aek_test", modelKey: "sk-test", baseUrl: g.url, log: quiet });
  check("Argentic arm finishes and scores every probe", s.complete && s.earlier[0] === s.earlier[1] && s.stock[0] === s.stock[1] && s.refundedTwice === 0, JSON.stringify(s));
  check("Argentic arm sends the Argentic key, the model key header and a refund guard", log.every((l) => l.auth === "Bearer aek_test" && l.model_key === "sk-test") && log[0].tools.find((t) => t.name === "refund")?.once_per === "refund:{order_id}");
  check("Argentic arm spend is the engine's own per-wake number", Math.abs(s.spent_usd - log.length * 0.0004) < 1e-6, `${s.spent_usd} vs ${log.length * 0.0004}`);
  await g.close();
}
{
  // cap, then resume under a bigger cap: the same run picks up, nothing is repeated
  const log = [], g = await fakeArgentic({ decide: shopOracle(N, seed), log, spentPerWake: 0.002 }), out = tmp();
  const first = await runShopArgentic({ out, name: "r", events: N, seed, capUsd: 0.05, model, apiKey: "aek_test", modelKey: "sk-test", baseUrl: g.url, log: quiet });
  check("Argentic arm stops at its cap", !first.complete && /spend cap/.test(first.stopReason) && first.spent_usd >= 0.05, JSON.stringify(first));
  const second = await runShopArgentic({ out, name: "r", events: N, seed, capUsd: 5, model, apiKey: "aek_test", modelKey: "sk-test", baseUrl: g.url, log: quiet });
  check("the same run resumes, finishes and repeats no refund", second.complete && second.earlier[0] === second.earlier[1] && second.refundedTwice === 0 && second.refundsAppliedTwice === 0, JSON.stringify(second));
  await g.close();
}

// ---- coordinator day, both arms, an agent that only reads (this checks the plumbing and the cap, the scorer is checked in 01)
{
  const a = await fakeAnthropic({ decide: idleDay }), g = await fakeArgentic({ decide: idleDay }), out = tmp();
  const env = { MODEL_KEY: "sk-test", ARGENTIC_API_KEY: "aek_test", ANTHROPIC_BASE_URL: a.url }, lines = [], errs = [];
  const code = await main(["day", "--cap-usd", "2", "--asks", "6", "--yes", "--out", out, "--base-url", g.url], env, { out: (s) => lines.push(s), err: (s) => errs.push(s) });
  const text = lines.join("\n");
  check("day command runs both arms and prints one table", (code === 0 || code === 3) && /Coordinator day: 6 asks/.test(text) && /plain loop/.test(text) && /Argentic/.test(text) && /asks started once/.test(text), `${code} ${errs.join(" ")} ${text.slice(-400)}`);
  check("day report names the engine build", /engine build fake-build/.test(text));
  await a.close(); await g.close();
}

// ---- the whole command for the shop, one arm each way
{
  const a = await fakeAnthropic({ decide: shopOracle(60, seed) }), g = await fakeArgentic({ decide: shopOracle(60, seed) }), out = tmp();
  const env = { MODEL_KEY: "sk-test", ARGENTIC_API_KEY: "aek_test", ANTHROPIC_BASE_URL: a.url }, lines = [];
  const code = await main(["shop", "--cap-usd", "3", "--events", "60", "--yes", "--out", out, "--base-url", g.url], env, { out: (s) => lines.push(s), err: (s) => lines.push(s) });
  const text = lines.join("\n");
  check("shop command prints both arms with the research page's rows", code === 0 && /earlier facts/.test(text) && /refunded twice/.test(text) && /plain loop/.test(text) && /Argentic /.test(text), `${code} ${text.slice(-600)}`);
  const dirs = text.match(/Run files: (.*)/)?.[1];
  check("run files include result.json", !!dirs && existsSync(join(dirs, "result.json")) && JSON.parse(readFileSync(join(dirs, "result.json"), "utf8")).results.length === 2);
  await a.close(); await g.close();
}
finish();
