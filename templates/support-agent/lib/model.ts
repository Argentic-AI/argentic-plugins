import { modelFromEnv, type ModelSpec } from '@argentic-ai/client'

/**
 * There is no default model. The page names one (a provider name or an https address, the model's id, its prices), or the deployer pins one with
 * ARGENTIC_MODEL_ID plus ARGENTIC_MODEL_PROVIDER or ARGENTIC_MODEL_BASE_URL. Anything else is refused with a sentence that says what is missing.
 */
export type Picked = { ok: true; model: ModelSpec } | { ok: false; error: string }

const ID = /^[A-Za-z0-9._:/@+-]{1,128}$/
const price = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1000 ? Number(v) : null

/** The model the page's form sent: `endpoint` is a provider name (openai) or an https address, `id` the model's id at that endpoint. */
export function modelFromBody(body: unknown): Picked {
  const b = (body && typeof body === 'object' ? (body as { model?: Record<string, unknown> }).model : null) ?? null
  if (!b) return { ok: false, error: 'Name the model first: its provider (or https address), its id and its prices.' }
  const endpoint = String(b.endpoint ?? '').trim()
  const id = String(b.id ?? '').trim()
  if (!endpoint) return { ok: false, error: 'Give the model’s provider name (for example openai) or the https address of its endpoint.' }
  if (!ID.test(id)) return { ok: false, error: 'Give the model’s id exactly as your provider writes it.' }
  const pin = price(b.priceIn), pout = price(b.priceOut)
  if (pin === null || pout === null) return { ok: false, error: 'Give both prices in dollars per million tokens, from 0 to 1000. A free model is 0.' }
  const where = /^https:\/\//i.test(endpoint) ? { base_url: endpoint } : { provider: endpoint }
  return { ok: true, model: { ...where, id, prices: { in: pin, out: pout } } }
}

/** The model the deployer pinned in the environment, null when they did not, or why it is incomplete. */
export function pinnedModel(env: NodeJS.ProcessEnv = process.env): Picked | null {
  if (!env.ARGENTIC_MODEL_ID && !env.ARGENTIC_MODEL_PROVIDER && !env.ARGENTIC_MODEL_BASE_URL) return null
  try {
    return { ok: true, model: modelFromEnv(env) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
