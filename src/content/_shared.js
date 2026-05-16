// Shared copy guardrails injected into every Session 2 generator's system prompt.
// Enforces the credibility rules from MENTAL_VISION_CLAUDE_CODE_BRIEF.md.
export const CREDIBILITY_GUARDRAILS = `CREDIBILITY GUARDRAILS (non-negotiable):
- NEVER claim a guaranteed citation, ranking, or outcome ("we'll get you cited in ChatGPT", "guaranteed #1 in Perplexity", etc.). Frame around signals, structure, and authority — the conditions that make citation likely, not the outcome itself.
- Tie every claim to an observable fact in the research_object. No fabricated metrics, no invented benchmarks, no "studies show".
- No urgency theater ("only 2 spots left", fake countdowns). Urgency must come from the actual market shift (AI bots indexing now, competitors moving) not from manufactured scarcity.
- No corporate filler ("leverage synergies", "best-in-class solutions"). Mental Vision voice is direct, intelligent, peer-level — never agency-speak.
- No emoji unless the user explicitly asked for them.`;

export function brandSnapshot(context) {
  return `BRAND: ${context.business} | Owner: ${context.owner} | ${context.location}
Voice: ${context.luna_persona.tone}
NOT: ${context.luna_persona.not}
Master line: "${context.master_line}"
Primary hook: ${context.frameworks.primary_hook}
Metaphor available: ${context.frameworks.metaphor}
Proof points: ${context.proof_points.slice(0, 3).join("; ")}`;
}

export function offerSnapshot(assignedOffer) {
  if (!assignedOffer) return "";
  const priceLine = assignedOffer.price_monthly
    ? `$${assignedOffer.price_monthly}/mo (first 90 days at $${assignedOffer.price_90day}/mo)`
    : `$${assignedOffer.price}`;
  return `ASSIGNED OFFER: ${assignedOffer.name} — ${priceLine}`;
}

export function angleForScore(scoreTotal) {
  if (scoreTotal < 40) return "invisible_urgency";
  if (scoreTotal < 60) return "thin_cost_of_inaction";
  if (scoreTotal < 80) return "building_partial_visibility";
  return "strong_ceiling_and_competitor";
}
