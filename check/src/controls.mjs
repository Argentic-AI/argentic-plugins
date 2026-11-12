// Free checks of the scorers. No model, no keys, no network: scripted agents drive the real tools and the real graders.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeWorld } from "../lab/shop/world.mjs";
import { generate as genDay } from "../lab/day/gen.mjs";
import { runControl } from "../lab/day/controls.mjs";
import { scoreShop, SHOP_SEED } from "./shop.mjs";

// perfect: always right. forgetful: forgets any fact older than 60 events. repeats: pays every promised refund twice. idle: calls next_event only.
export async function shopControl(mode, N = 300, seed = SHOP_SEED) {
  const dir = mkdtempSync(join(tmpdir(), "check-shop-")), ctx = { stateDir: dir, N, seed, paceMs: 0, t0: Date.now(), event() {}, onFinish() {}, hooks: { beforeTool() {}, afterTool() {} } };
  try {
    const tools = Object.fromEntries(makeWorld(ctx).map((t) => [t.name, t])); let seq = 0; const call = (name, args) => tools[name].execute(args, { seq: ++seq });
    const { events: ev, cfg } = ctx.world, K = 60;
    for (let n = 0; n < N + 5; n++) {
      const txt = await call("next_event", {}); if (/shift is over/.test(txt)) break;
      if (mode === "idle") continue;
      const e = ev.find((x) => txt.replace(/^\(still waiting[^\n]*\n/, "").startsWith(x.id)); if (!e) throw new Error("no event for: " + txt.slice(0, 120));
      const x = e.expect, far = mode === "forgetful" && e.probe && e.probe.fact_distance != null && e.probe.fact_distance > K, base = cfg.skus.find((s) => s.id === e.sku);
      if (x.tool === "ship_order") await call("ship_order", far ? { order_id: x.order_id, packaging: "standard", invoice_email: e.email } : x);
      else if (x.tool === "receive_stock") { await call("receive_stock", { delivery_id: x.delivery_id, sku: x.sku, qty: x.qty }); if (!far) for (const r of x.refunds) { await call("refund", r); if (mode === "repeats") await call("refund", r); } }
      else if (x.price_cents !== undefined) await call("answer", { event_id: e.id, price_cents: far ? base.price_cents : x.price_cents });
      else if (x.tool === "decide_refund") await call("decide_refund", { request_id: x.request_id, decision: far ? (e.age_days <= 30 ? "approve" : "deny") : x.decision });
      else if (x.units !== undefined) await call("answer", { event_id: e.id, units: x.units - (mode === "forgetful" ? 7 : 0) });
      else await call("answer", { event_id: e.id, text: "ok" });
    }
    return scoreShop(dir, { events: N, seed });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const DAY_NAMES = { perfect: "solver", forgetful: "amnesiac", repeats: "perMsg", idle: "idle" };
export function dayControl(mode, asks = 18, seed = 20261106) {
  const { grade } = runControl(DAY_NAMES[mode], genDay(asks, seed)); const { items_detail, ...rows } = grade; return rows;
}

export async function allControls({ events = 300, asks = 18 } = {}) {
  const shop = {}, day = {};
  for (const m of ["perfect", "forgetful", "repeats", "idle"]) { shop[m] = await shopControl(m, events); day[m] = dayControl(m, asks); }
  return { shop, day };
}
