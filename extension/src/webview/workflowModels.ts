/** Fallback models for the workflow dropdown when CDP hasn't refreshed yet.
 *
 *  Prefer the live Cursor picker via **Refresh Models** (runs `cdp.py --models`
 *  / `list_models.js`). Labels must match picker rows or spawn silently keeps
 *  the current model.
 */
export const FALLBACK_WORKFLOW_MODELS = [
  "Auto",
  "Composer 2.5 Fast",
  "Opus 4.8 1M Extra High Fast",
  "GPT-5.5 Extra High Fast",
  "Fable 5 1M High",
  "GLM 5.2 High",
] as const;

/** @deprecated Use FALLBACK_WORKFLOW_MODELS — kept for older imports. */
export const WORKFLOW_MODELS = FALLBACK_WORKFLOW_MODELS;

export type WorkflowModel = string;

export const DEFAULT_WORKFLOW_MODEL = "Opus 4.8 1M Extra High Fast";

/** Ensure the dropdown always has at least the fallback set + current selection. */
export function mergeWorkflowModels(
  live: string[] | undefined,
  current?: string,
): string[] {
  const base =
    live && live.length > 0
      ? live.map((m) => m.trim()).filter(Boolean)
      : [...FALLBACK_WORKFLOW_MODELS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of base) {
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  const cur = (current || "").trim();
  if (cur && !seen.has(cur)) out.unshift(cur);
  // Keep Auto first when present.
  const autoIdx = out.findIndex((m) => /^auto$/i.test(m));
  if (autoIdx > 0) {
    const [auto] = out.splice(autoIdx, 1);
    out.unshift(auto);
  }
  return out;
}

/** Migrate legacy persisted pool model labels. */
export function normalizePoolModel(
  model: string | undefined,
  available?: readonly string[],
): string {
  const m = (model || "").trim();
  if (/^Opus 4\.5/i.test(m)) return DEFAULT_WORKFLOW_MODEL;
  if (!m) return DEFAULT_WORKFLOW_MODEL;
  if (available && available.length > 0 && !available.includes(m)) {
    return available.includes(DEFAULT_WORKFLOW_MODEL)
      ? DEFAULT_WORKFLOW_MODEL
      : available[0]!;
  }
  return m;
}
