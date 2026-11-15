// The adapter contract: how any system plugs into longshift. An adapter decides only what the model sees each step. It never touches the world, the scenario or the grader:
// every tool call goes through tools[i].execute, every model request is announced with budget.beforeCall(), and every request is reported with budget.report().
//
//   export default {
//     name: "my-system",                         // letters, digits, - and _
//     version: () => "1.2.3",                    // printed in the run's config
//     async run({ tools, system, task, nudge, budget, model, log, event, finished }) { ... },
//   };
//
//   tools    [{ name, description, input_schema, execute(args) -> Promise<string> }]   the same 12 tools for every entry
//   system   the one neutral brief            task: the first user message            nudge({ status }): the message to send if a reply ended without a tool call
//   budget   { capUsd, spent(), add(usd), beforeCall(), report({promptTokens, outputTokens, usd, cacheRead, cacheWrite, compacted}), window(promptTokens) }
//              beforeCall() before EVERY model request (throws Stop at the cap, the clock or the end of the shift; let it propagate).
//              report() after every request, with the prompt size the provider counted: it feeds the prompt-size curve. add() is implied by report({usd}).
//              window(promptTokens) throws ContextOverflow when the run has a window condition and the prompt is over it. Call it with the provider's own count before you accept the response,
//              or let the metering proxy refuse the request (tools/meter-proxy.mjs --max-context).
//   model    { id, apiKey, baseUrl, maxContext }   baseUrl points at the meter proxy for anyone who can route through it, otherwise at the provider
//   finished() true once the shift was closed with finish; run() should return then
import { setupRun, Stop, ContextOverflow } from "./drive-core.mjs";
import { system_ls, task_ls, nudge_ls } from "./prompt.mjs";
export { Stop, ContextOverflow };

export async function runAdapter({ adapter, name, root, seed = 20261201, hours = 12, dense = false, pack = null, capUsd, maxMs, maxCalls, maxContext = null, modelId = process.env.MODEL_ID ?? "claude-haiku-5-5", apiKey = process.env.MODEL_KEY ?? process.env.ANTHROPIC_API_KEY, baseUrl = process.env.UPSTREAM ?? "https://api.anthropic.com", quiet = false }) {
  if (!adapter || typeof adapter.run !== "function" || !/^[A-Za-z0-9_-]{1,40}$/.test(adapter.name ?? "")) throw new Error("an adapter needs a name (letters, digits, - and _) and a run() function");
  let spentUsd = 0, version = "unknown"; try { version = String((await adapter.version?.()) ?? "unknown"); } catch { /* keep unknown */ }
  const run = setupRun({ root, name, seed, hours, dense, pack, entry: adapter.name, capUsd, maxMs, maxCalls, maxContext, spent: () => spentUsd, quiet, config: { adapter: adapter.name, adapter_version: version, model_id: modelId } });
  const tools = run.world.schemas().map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, execute: async (args) => run.exec(t.name, args) }));
  const budget = { capUsd, spent: () => spentUsd, add: (usd) => { if (Number.isFinite(usd) && usd > 0) spentUsd += usd; }, beforeCall: () => { run.beforeCall(); run.noteModelCall(); },
    report: (u = {}) => { if (Number.isFinite(u.usd) && u.usd > 0) spentUsd += u.usd; run.recordUsage(u); }, window: (n) => run.checkWindow(n) };
  let stopReason = null;
  try {
    await adapter.run({ tools, system: system_ls(), task: task_ls, nudge: nudge_ls, budget, model: { id: modelId, apiKey, baseUrl, maxContext }, log: run.logLine, event: run.event, finished: () => run.state.finished !== null });
    stopReason = run.state.finished !== null ? "finish" : "the adapter returned before the shift was closed";
  } catch (e) {
    if (e instanceof Stop) stopReason = e.reason;
    else if (e instanceof ContextOverflow) stopReason = `context window exceeded (${e.tokens} > ${e.cap})`;
    else { run.event({ type: "error", error: String(e?.stack ?? e).slice(0, 800) }); run.logLine(`ERROR ${String(e?.message ?? e)}`); stopReason = `error: ${String(e?.message ?? e).slice(0, 160)}`; process.exitCode = 1; }
  }
  return { ...run.finalize({ stopReason }), dir: run.dir };
}
