// V5 scoring — 9 categories, pure functions.

export function scoreLLMPresence(buyerQueryCoverage) {
  // buyerQueryCoverage: array of { query, intent, status: 'cited' | 'partial' | 'not_cited' }
  const cited = buyerQueryCoverage.filter((q) => q.status === "cited").length;
  if (cited >= 3) return 30;
  if (cited >= 1) return 15;
  return 0;
}

export function scoreSchemaMarkup(schemaTypesPresent) {
  if (!schemaTypesPresent || schemaTypesPresent.length === 0) return 0;
  return Math.min(15, schemaTypesPresent.length * 2);
}

export function scoreReviewAuthority(rating, reviewCount) {
  if (!rating || !reviewCount || reviewCount <= 0) return 0;
  // rating * log10(review_count + 1), normalized so 5.0 rating with 1000 reviews → 15
  const raw = rating * Math.log10(reviewCount + 1);
  const max = 5.0 * Math.log10(1001);
  return Math.round(Math.min(15, (raw / max) * 15));
}

export function scoreSocialPresence(activePlatformCount) {
  if (activePlatformCount >= 3) return 10;
  if (activePlatformCount === 2) return 7;
  if (activePlatformCount === 1) return 4;
  return 0;
}

export function scoreContentFreshness(monthsSinceLastContent) {
  if (monthsSinceLastContent == null) return 0;
  if (monthsSinceLastContent < 3) return 8;
  if (monthsSinceLastContent < 6) return 5;
  if (monthsSinceLastContent < 12) return 3;
  return 1;
}

export function scoreAIBotAccess(aiBotsBlocked) {
  switch (aiBotsBlocked) {
    case "all_allowed":
      return 10;
    case "some_blocked":
      return 5;
    case "all_blocked":
      return 0;
    default:
      return 0;
  }
}

export function scoreLlmsTxt(llmsTxtPresent) {
  return llmsTxtPresent ? 5 : 0;
}

export function scoreGBPCompleteness(gbpStatus) {
  switch (gbpStatus) {
    case "complete":
      return 4;
    case "partial":
      return 2;
    default:
      return 0;
  }
}

export function scoreBuyerQueryCoverage(buyerQueryCoverage) {
  // +1 per intent type with at least one cited query (max 3 from emergency/comparison/trust)
  const buckets = new Set();
  for (const q of buyerQueryCoverage) {
    if (q.status === "cited" && ["emergency", "comparison", "trust"].includes(q.intent)) {
      buckets.add(q.intent);
    }
  }
  return buckets.size;
}

export function scoreLabel(total) {
  if (total >= 80) return { label: "AI-Ready", machine_trust: "Strong" };
  if (total >= 60) return { label: "Building", machine_trust: "Building" };
  if (total >= 40) return { label: "Thin Presence", machine_trust: "Thin" };
  return { label: "Invisible", machine_trust: "Broken" };
}

export function scoreProspect(research) {
  const breakdown = {
    llm_presence: scoreLLMPresence(research.buyer_query_coverage || []),
    schema_markup: scoreSchemaMarkup(research.schema_types_present || []),
    review_authority: scoreReviewAuthority(research.rating, research.review_count),
    social_presence: scoreSocialPresence(research.social_platforms_active || 0),
    content_freshness: scoreContentFreshness(research.content_freshness_months),
    ai_bot_access: scoreAIBotAccess(research.ai_bots_blocked),
    llms_txt: scoreLlmsTxt(research.llms_txt_present),
    gbp_completeness: scoreGBPCompleteness(research.gbp_complete),
    buyer_query_coverage: scoreBuyerQueryCoverage(research.buyer_query_coverage || []),
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown, ...scoreLabel(total) };
}

export function calculateConfidenceScore(research) {
  let score = 0;
  if (research.email && research.email_source === "site_scrape") score += 30;
  else if (research.email && research.email_source === "form_only") score += 10;
  if (research.owner_first) score += 20;
  if (research.rating && research.rating >= 4.3) score += 15;
  if (research.review_count && research.review_count >= 30) score += 15;
  if (research.domain_verified) score += 20;
  return score;
}

export function assignOffer(scoreTotal, tiers) {
  if (scoreTotal >= 80) return { tier: "foundation", ...tiers.foundation };
  if (scoreTotal >= 55) return { tier: "stay_found", ...tiers.stay_found };
  return { tier: "sprint", ...tiers.sprint };
}
