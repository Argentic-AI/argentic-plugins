// Plain tables for the reports. Nothing here is a verdict: it prints counts. Each suite words its own report (see suites/).
export const pad = (s, n) => String(s).padEnd(n);
export function table(head, rows) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => pad(c, w[i])).join("  ").trimEnd();
  return [line(head), line(w.map((n) => "-".repeat(n))), ...rows.map(line)].join("\n");
}
export const state = (s) => (s.complete ? "finished" : `INCOMPLETE (${s.stopReason ?? s.stop_reason ?? "stopped early"})`);

// Free scorer checks: each suite supplies its own scripted agents; the legend is shared.
export function controlsReport(blocks) {
  return ["Free scorer checks: no model, no keys, no network.", "", ...blocks.flatMap((b, i) => (i ? ["", ...b] : b)),
    "", "perfect reads the world's own bookkeeping, so it shows the scorer can reach 100%. forgetful loses what it was told earlier. repeats pays every refund twice (shop) or starts a worker per message (day). idle answers nothing."].join("\n");
}
