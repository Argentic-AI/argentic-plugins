// The suite registry. A suite is one scripted scenario plus its scorer; the harness (../cli.mjs) knows nothing about any scenario.
// Contract (see suites/README in check/README.md, "Add a suite"):
//   id, title, blurb          what it is called and one plain sentence about it
//   size { flag, unit, default }   the one length knob (--events, --asks, ...); --size works for every suite
//   seed                      default scenario seed
//   flags                     extra flags the suite accepts, e.g. { "window-tokens": "val" }
//   arms { name: { label, argentic?, estimate(size) -> {usd, minutes}, run(ctx) -> summary } }
//                             argentic: true marks an arm that needs ARGENTIC_API_KEY. run() must stop itself at ctx.capUsd
//                             and return a summary with `complete` (false if it stopped early) and `spent_usd`.
//   describe(size, seed)      the header line
//   report(results, meta)     the table, as a string
//   controls?(size)           free scripted-agent checks, as lines
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { UsageError } from "../common.mjs";
import shop from "./shop.mjs";
import day from "./day.mjs";

export const SUITES = [shop, day];

export function assertSuite(s, where = "suite") {
  const bad = (why) => { throw new UsageError(`${where} is not a valid suite: ${why}`); };
  if (!s || typeof s !== "object") bad("it must default-export an object");
  if (!/^[a-z][a-z0-9-]*$/.test(s.id ?? "")) bad("id must be lower-case letters, digits and dashes");
  if (!s.title || !s.size?.flag || !(s.size.default > 0) || !Number.isFinite(s.seed)) bad("needs title, size { flag, default } and a numeric seed");
  if (typeof s.describe !== "function" || typeof s.report !== "function") bad("needs describe() and report()");
  const arms = Object.entries(s.arms ?? {});
  if (!arms.length) bad("needs at least one arm");
  for (const [name, a] of arms) if (typeof a.run !== "function" || typeof a.estimate !== "function" || !a.label) bad(`arm ${name} needs label, estimate() and run()`);
  return s;
}

// A registered id, or a path to a suite file ("./my-suite.mjs"). A suite file is code that runs with your keys in its environment: read it first.
export async function resolveSuite(ref) {
  const found = SUITES.find((s) => s.id === ref);
  if (found) return found;
  if (/^(\.{0,2}\/|[A-Za-z]:[\\/])/.test(ref) || /\.(mjs|js)$/.test(ref)) {
    let mod; try { mod = await import(pathToFileURL(resolve(ref)).href); } catch (e) { throw new UsageError(`could not load suite file ${ref}: ${e.message}`); }
    return assertSuite(mod.default, ref);
  }
  return null;
}
