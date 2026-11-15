// Suite: the shop shift (Kestrel Supply). The scenario, world and scorer are the lab's; the runners are in ../shop.mjs.
import { ratio, usd } from "../common.mjs";
import { table, state } from "../report.mjs";
import { runShopArgentic, runShopPlain, SHOP_EVENTS, SHOP_SEED } from "../shop.mjs";
import { shopControl } from "../controls.mjs";

const ENGINE = (m) => (m.engine ? `, engine build ${m.engine.build ?? "?"} (commit ${String(m.engine.commit ?? "?").slice(0, 10)})` : "");

export default {
  id: "shop",
  title: "Shop shift",
  blurb: "An agent runs a small online shop through hundreds of events; code scores what it remembers, whether stock is exact, and refunds paid twice.",
  size: { flag: "events", unit: "events", default: SHOP_EVENTS },
  seed: SHOP_SEED,
  flags: { "window-tokens": "val" },
  arms: {
    plain: { label: "plain loop", estimate: (n) => ({ usd: 0.0008 * n, minutes: (n / 100) * 8 }),
      run: (c) => runShopPlain({ out: c.root, events: c.size, seed: c.seed, capUsd: c.capUsd, model: c.model, apiKey: c.modelKey, upstream: c.upstream, windowTokens: c.num("window-tokens", 40000), log: c.log }) },
    argentic: { label: "Argentic", argentic: true, estimate: (n) => ({ usd: 0.00055 * n, minutes: (n / 100) * 20 }),
      run: (c) => runShopArgentic({ out: c.root, events: c.size, seed: c.seed, capUsd: c.capUsd, model: c.model, apiKey: c.apiKey, modelKey: c.modelKey, baseUrl: c.baseUrl, log: c.log }) },
  },
  describe: (size, seed) => `Shop shift: ${size} events, seed ${seed}`,
  report(results, meta) {
    const rows = results.map((s) => [s.arm === "argentic" ? "Argentic" : "plain loop", ratio(s.earlier), ratio(s.stock), s.oldPrices, s.refundedTwice, `${s.answered}/${s.events}`, usd(s.spent_usd), state(s)]);
    return [
      `Shop shift: ${meta.events} events, seed ${meta.seed}, ${meta.model}, ${meta.date}${ENGINE(meta)}`,
      "",
      table(["arm", "earlier facts", "stock exact", "old prices", "refunded twice", "answered", "spend", "run"], rows),
      "",
      "Earlier facts: questions about preferences, promised refunds, price changes and the refund window. Stock exact: the CEO's stock-count questions answered with the exact number.",
      "Old prices: quote questions answered with a price that had since changed. Refunded twice: refund calls made for an order that was already refunded.",
      "One scenario, one seed, one model: read this as a spot check of your own setup, not a benchmark. The plain loop is a simple windowed loop we wrote, not your agent.",
    ].join("\n");
  },
  controls: async (size = SHOP_EVENTS) => {
    const lines = ["Shop shift (scripted agents, not language models):"];
    for (const m of ["perfect", "forgetful", "repeats", "idle"]) {
      const s = await shopControl(m, size);
      lines.push(`  ${m.padEnd(10)} earlier ${ratio(s.earlier)}, stock ${ratio(s.stock)}, old prices ${s.oldPrices}, refunded twice ${s.refundedTwice}`);
    }
    lines.push("  perfect reads the world's own bookkeeping, so it shows the scorer can reach 100%. forgetful loses what it was told earlier. repeats pays every refund twice. idle answers nothing.");
    return lines;
  },
};
