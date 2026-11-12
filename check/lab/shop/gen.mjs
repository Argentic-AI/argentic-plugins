// Seeded scenario for the ops run: "Kestrel Supply", a small online shop. generate(N, seed) -> { events, config }.
// Facts (preferences, promises, price changes, policy changes) are stated once; probes ask for them later at a set distance in events.
// Expected answers come from one simulation pass over the finished timeline, so they follow whatever rule was active at the probe.
export const rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const FIRST = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Ethan", "Ivy", "Lucas", "Ella", "Mason", "Ruby", "Jack", "Chloe", "Oscar", "Grace", "Leo", "Hannah", "Max", "Isla", "Finn"];
const LAST = ["Nguyen", "Smith", "Patel", "Brown", "Wilson", "Taylor", "Evans", "Clarke", "Singh", "Walker", "Young", "King", "Wright", "Hall", "Scott", "Green"];
const SKU_NAMES = ["canvas tote", "steel bottle", "desk lamp", "wool beanie", "ceramic mug", "notebook set", "phone stand", "yoga mat", "cable organiser", "travel pillow", "herbal tea box", "bamboo tray"];
export const TRACKED = ["S10", "S11", "S12"];                 // running stock is asked about for these
export const TIERS = { control: [5, 15], near: [80, 160], mid: [250, 400], far: [450, 650], vfar: [700, 850] };
export const BASE_WINDOW_DAYS = 30;
export const EVENTS_PER_DAY = 40;

export function config() {
  const skus = SKU_NAMES.map((name, i) => ({ id: `S${String(i + 1).padStart(2, "0")}`, name, price_cents: 1200 + i * 350, stock: TRACKED.includes(`S${i + 1}`) ? 150 : 250 }));
  const customers = []; for (let i = 0; i < 160; i++) { const f = FIRST[i % FIRST.length], l = LAST[(i * 7 + (i >> 4)) % LAST.length]; customers.push({ id: `C${String(i + 1).padStart(3, "0")}`, name: `${f} ${l}`, email: `${f}.${l}${i + 1}@example.test`.toLowerCase() }); }
  return { skus, customers };
}
const dayOf = (i) => Math.floor(i / EVENTS_PER_DAY);
export const dateOf = (i) => new Date(Date.UTC(2026, 10, 2) + dayOf(i) * 86400000).toISOString().slice(0, 10);

export function generate(N, seed = 20261028) {
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)], int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  const { skus, customers } = config(); const sku = Object.fromEntries(skus.map((s) => [s.id, s]));
  const slot = new Array(N).fill(null);
  const free = (i) => { for (let k = 0; k < N; k++) for (const j of [i + k, i - k]) if (j >= 0 && j < N && !slot[j]) return j; return -1; };
  const put = (i, ev) => { const j = free(Math.max(0, Math.min(N - 1, i))); if (j < 0) throw new Error("no free slot"); slot[j] = ev; return j; };
  const prefCust = customers.slice(100), noiseCust = customers.slice(0, 100);
  let prefNext = 0, ord = 1000, req = 0;
  const counts = { PREF: { control: 4, near: 8, mid: 8, far: 8, vfar: 8 }, PROMISE: { control: 4, near: 4, mid: 4, far: 4, vfar: 4 }, QUOTE: { control: 4, near: 5, mid: 5, far: 5, vfar: 5 } };
  const scale = N / 900;          // a shorter run keeps the same mix, fewer probes per tier
  const n = (c) => Math.max(0, Math.round(c * (N >= 600 ? 1 : scale * 1.4)));
  const place = (family, tier, make) => { const [lo, hi] = TIERS[tier]; const d = int(lo, hi); if (d >= N - 2) return false; const a = int(0, N - 1 - d); return make(a, d); };

  // PREF: a customer states how they want orders shipped; a later order from them is the probe.
  for (const [tier, c] of Object.entries(counts.PREF)) for (let k = 0; k < n(c); k++) place("PREF", tier, (a, d) => {
    const cu = prefCust[prefNext++ % prefCust.length]; const alt = `billing.${cu.id.toLowerCase()}@example.test`;
    put(a, { type: "email", customer: cu.id, text: `Hi, it's ${cu.name}. From now on please pack my orders in plain packaging with no logo, and send my invoices to ${alt} instead of my usual address.`, fact: { kind: "pref", customer: cu.id, packaging: "plain", invoice_email: alt } });
    put(a + d, { type: "order", customer: cu.id, email: cu.email, order_id: `O${++ord}`, sku: pick(skus.slice(0, 9)).id, qty: int(1, 3), probe: { family: "PREF", tier } }); return true; });

  // PROMISE: the CEO says to refund a customer when the next delivery of a SKU lands; that delivery is the probe. One open promise per SKU at a time.
  const busy = {}; const promiseSkus = skus.slice(0, 9).map((s) => s.id);
  for (const [tier, c] of Object.entries(counts.PROMISE)) for (let k = 0; k < n(c); k++) place("PROMISE", tier, (a, d) => {
    const s = promiseSkus.find((x) => !(busy[x] ?? []).some(([p, q]) => a <= q + 3 && a + d + 3 >= p)); if (!s) return false;
    const cu = pick(noiseCust), oid = `O${++ord}`, amt = int(4, 19) * 100 + 500;
    (busy[s] ??= []).push([a, a + d]);
    put(a, { type: "directive", from: "CEO", text: `Order ${oid} for ${cu.name} (${cu.id}) went out late and damaged. I promised ${cu.name} a ${(amt / 100).toFixed(2)} dollar refund. Do not pay it yet: pay it as a refund the moment the next delivery of ${s} (${sku[s].name}) arrives, and not before.`, fact: { kind: "promise", sku: s, order_id: oid, amount_cents: amt } });
    put(a + d, { type: "delivery", delivery_id: `D${++req}`, sku: s, qty: int(40, 80), probe: { family: "PROMISE", tier } }); return true; });

  // QUOTE: a price change notice, then a customer asks what that SKU costs.
  for (const [tier, c] of Object.entries(counts.QUOTE)) for (let k = 0; k < n(c); k++) place("QUOTE", tier, (a, d) => {
    const s = pick(skus.slice(0, 9)), np = s.price_cents + int(-3, 6) * 100 || s.price_cents + 100;
    put(a, { type: "directive", from: "Purchasing", text: `Supplier notice: ${s.id} (${s.name}) has a new list price of ${(np / 100).toFixed(2)} dollars, effective immediately for all quotes and orders.`, fact: { kind: "price", sku: s.id, price_cents: np } });
    put(a + d, { type: "quote", request_id: `Q${++req}`, customer: pick(noiseCust).id, sku: s.id, probe: { family: "QUOTE", tier } }); return true; });

  // WINDOW: the refund window changes (base 30 days is in the prompt); refund requests with an age between the old and new window are probes.
  const flips = [Math.round(N * 0.04), Math.round(N * 0.34), Math.round(N * 0.64)], windows = [14, 45, 10]; let prevW = BASE_WINDOW_DAYS;
  flips.forEach((f, k) => {
    const w = windows[k], at = put(f, { type: "directive", from: "CEO", text: `Policy change: the refund window is now ${w} days from the order date (it was ${prevW}). Applies to every refund request from now on.`, fact: { kind: "window", days: w } });
    const next = flips[k + 1] ?? N;
    for (const tier of ["control", "near", "mid"]) for (let r = 0; r < n(tier === "control" ? 2 : 2); r++) { const [lo, hi] = TIERS[tier]; const d = int(lo, hi); if (at + d >= next - 2) continue;
      put(at + d, { type: "refund", request_id: `R${++req}`, order_id: `O${++ord}`, customer: pick(noiseCust).id, age_days: Math.round((prevW + w) / 2), probe: { family: "WINDOW", tier } }); }
    prevW = w; });

  // Noise first fixes the mix; tracked-SKU deliveries and CEO stock questions come next, noise fills what is left.
  for (let i = 60; i < N - 20; i += int(110, 140)) put(i, { type: "delivery", delivery_id: `D${++req}`, sku: pick(TRACKED), qty: 50, background: true });
  for (let i = 40; i < N - 3; i += int(55, 75)) put(i, { type: "order", customer: pick(noiseCust).id, order_id: `O${++ord}`, sku: pick(TRACKED), qty: int(2, 6), tracked_order: true });
for (let i = 25; i < N - 3; i += int(24, 40)) put(i, { type: "stock_q", question_id: `K${++req}`, sku: pick(TRACKED), probe: { family: "STOCK", tier: "state" } });
  for (let i = 0; i < N; i++) if (!slot[i]) { const r = R();
    slot[i] = r < 0.55 ? { type: "order", customer: pick(noiseCust).id, order_id: `O${++ord}`, sku: pick(skus.filter((x) => !TRACKED.includes(x.id))).id, qty: int(1, 4), noise: true }
      : r < 0.8 ? { type: "newsletter", text: pick(["Weekly trade digest: ten packaging trends.", "Invoice reminder from your accounting software subscription.", "Webinar invite: scaling a small shop.", "Courier rate card update for next quarter.", "Unsubscribe confirmation from a marketing list."]), noise: true }
      : { type: "customer_msg", customer: pick(noiseCust).id, text: pick(["Thanks, my parcel arrived fine.", "Do you have a gift wrap option?", "Can you confirm you got my last email?", "Just saying hi, love the products."]), noise: true }; }

  // One pass over the timeline: attach the expected action to every probe and the distance (in events) to the fact it depends on.
  const price = Object.fromEntries(skus.map((s) => [s.id, s.price_cents])), pref = {}, stock = Object.fromEntries(skus.map((s) => [s.id, s.stock])); let window = BASE_WINDOW_DAYS; const open = {}, factAt = {};
  const events = slot.map((e, i) => ({ i, id: `E${String(i + 1).padStart(4, "0")}`, date: dateOf(i), ...e }));
  const byCust = Object.fromEntries(customers.map((c) => [c.id, c]));
  for (const e of events) {
    if (e.fact) { const f = e.fact; if (f.kind === "pref") { pref[f.customer] = f; factAt[`pref:${f.customer}`] = e.i; } if (f.kind === "price") { price[f.sku] = f.price_cents; factAt[`price:${f.sku}`] = e.i; } if (f.kind === "window") { window = f.days; factAt.window = e.i; } if (f.kind === "promise") { (open[f.sku] ??= []).push({ ...f, at: e.i }); } }
    if (e.type === "order") { const p = pref[e.customer]; if (e.probe) { e.expect = { tool: "ship_order", order_id: e.order_id, packaging: p.packaging, invoice_email: p.invoice_email }; e.probe.fact_distance = e.i - factAt[`pref:${e.customer}`]; } else e.expect = { tool: "ship_order", order_id: e.order_id, packaging: "standard", invoice_email: byCust[e.customer].email }; stock[e.sku] -= e.qty; }
    if (e.type === "delivery") { stock[e.sku] += e.qty; const pr = open[e.sku] ?? []; if (e.probe) { e.expect = { tool: "receive_stock", delivery_id: e.delivery_id, sku: e.sku, qty: e.qty, refunds: pr.map((x) => ({ order_id: x.order_id, amount_cents: x.amount_cents })) }; e.probe.fact_distance = e.i - Math.min(...pr.map((x) => x.at)); } else e.expect = { tool: "receive_stock", delivery_id: e.delivery_id, sku: e.sku, qty: e.qty, refunds: [] }; open[e.sku] = []; }
    if (e.type === "quote") { e.expect = { tool: "answer", price_cents: price[e.sku] }; e.probe.fact_distance = e.i - (factAt[`price:${e.sku}`] ?? -1); }
    if (e.type === "refund") { e.expect = { tool: "decide_refund", request_id: e.request_id, decision: e.age_days <= window ? "approve" : "deny" }; e.probe.fact_distance = e.i - factAt.window; }
    if (e.type === "stock_q") { e.expect = { tool: "answer", units: stock[e.sku] }; e.probe.fact_distance = null; }
    if (e.type === "directive") e.expect = { tool: "answer" };
    if (e.type === "newsletter") e.expect = { tool: "answer" };
    if (e.type === "customer_msg" || e.type === "email") e.expect = { tool: "answer" };
    if (e.probe) { const d = e.probe.fact_distance; e.probe.bucket = e.probe.family === "STOCK" ? "state" : d == null ? "unknown" : d <= 20 ? "control" : d < 200 ? "near" : d < 420 ? "mid" : d < 680 ? "far" : "vfar"; }
  }
  return { events, config: { skus, customers, base_window_days: BASE_WINDOW_DAYS, tracked: TRACKED }, seed, N };
}
