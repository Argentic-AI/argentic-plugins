// Refund bookkeeping that world.mjs does not do (world.mjs is deliberately left byte-identical to the Oct 27 file).
//   attempt = a refund call the agent made (one per distinct call key: Argentic seq, LangChain tool_call_id, ...). A call re-run after a kill has the same key and counts once.
//   applied = a refund the world executed (an entry in world.json actions).
// The attempt log is written by a wrapper around the refund tool, which looks at the world's action log at call time: `already_paid` = the order already had a refund applied.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function makeAttemptLog(dir) {
  const file = join(dir, "refund-attempts.jsonl"), seen = new Set();
  if (!existsSync(file)) writeFileSync(file, "");          // exists from the start, so "no refund attempts" is distinguishable from "no attempt log" (an older run)
  else for (const l of readFileSync(file, "utf8").split("\n")) { if (!l) continue; try { seen.add(JSON.parse(l).key); } catch {} }
  return {
    file,
    // key: stable id of the agent's call; world: ctx.world (load()); returns the row, or null when this key was already logged (call re-run after a kill)
    record(key, args, world) {
      if (seen.has(key)) return null; seen.add(key);
      const refunds = world.load().actions.filter((a) => a.tool === "refund" && a.args?.order_id === args?.order_id);
      const row = { t: new Date().toISOString(), key, order_id: args?.order_id ?? null, amount_cents: args?.amount_cents ?? null, already_paid: refunds.length > 0, applied_before: refunds.length };
      appendFileSync(file, JSON.stringify(row) + "\n"); return row;
    },
  };
}

// Wrap the tools list (as makeWorld returns it): the refund tool logs an attempt before running. keyOf(args, callCtx) -> stable key string.
export function withRefundAttempts(tools, ctx, log, keyOf, onAttempt = () => {}) {
  return tools.map((t) => (t.name !== "refund" ? t : { ...t, execute: async (args, c = {}) => { const row = log.record(keyOf(args, c), args, ctx.world); if (row) onAttempt(row); return t.execute(args, c); } }));
}

// Counters for grade-summary.json. worldActions: world.json actions; attemptRows: refund-attempts.jsonl rows or null (older runs).
export function refundCounters(worldActions, attemptRows) {
  const applied = {}; for (const a of worldActions) if (a.tool === "refund") applied[a.args.order_id] = (applied[a.args.order_id] ?? 0) + 1;
  const refunds_applied_dup = Object.values(applied).reduce((s, n) => s + Math.max(0, n - 1), 0);          // extra applications beyond the first, summed over orders
  if (attemptRows) return { refund_attempts_dup: attemptRows.filter((r) => r.already_paid).length, refunds_applied_dup, refund_counters_source: "refund-attempts.jsonl" };
  return { refund_attempts_dup: refunds_applied_dup, refunds_applied_dup, refund_counters_source: "action-log (no attempt log: only executed refunds are visible, so attempts = applications)" };
}
export const readAttempts = (dir) => { const f = join(dir, "refund-attempts.jsonl"); return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : null; };
