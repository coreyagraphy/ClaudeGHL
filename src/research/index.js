import { researchProspect } from "./prospect.js";
import { buyerQueryMapping } from "./buyer-queries.js";
import { compilePainPoints } from "./pain-points.js";
import { determineFirstFixPriority } from "./first-fix.js";
import {
  scoreProspect,
  calculateConfidenceScore,
  assignOffer,
} from "../scoring.js";
import { MENTAL_VISION_CONTEXT } from "../context.js";

// End-to-end Session 1 pipeline for a single prospect.
//
// Steps:
//   1. researchProspect (Sonnet + web_search → Haiku extract)
//   2. buyerQueryMapping (Sonnet + web_search → Haiku extract)
//   3. scoreProspect (pure)
//   4. calculateConfidenceScore (pure)
//   5. If confidence >= threshold:
//        - compilePainPoints (Haiku)
//        - determineFirstFixPriority (Haiku)
//        - assignOffer (pure, based on score)
//      else: return early with research_status="low_confidence"
//
// Returns a single object suitable for handing to Session 2 (content gen).
export async function runProspectResearch({
  company,
  domain,
  city,
  state,
  niche,
  confidenceThreshold = 60,
  tiers = MENTAL_VISION_CONTEXT.tiers,
}) {
  const usage = {};

  // 1. Research
  const research = await researchProspect({ company, domain, city, niche });
  usage.research = research.usage;

  // 2. Buyer queries
  const buyerQueries = await buyerQueryMapping({
    company,
    domain: research.research_object.domain || domain,
    niche,
    city,
    state,
  });
  usage.buyer_queries = buyerQueries.usage;

  // Merge buyer query coverage into research object
  const researchObject = {
    ...research.research_object,
    buyer_query_coverage: buyerQueries.buyer_query_coverage,
  };

  // 3. Score
  const score = scoreProspect(researchObject);

  // 4. Confidence
  const confidence = calculateConfidenceScore(researchObject);

  const baseResult = {
    research_object: researchObject,
    score,
    confidence,
    raw_notes: {
      research: research.raw_notes,
      buyer_queries: buyerQueries.raw_notes,
    },
    usage,
  };

  if (confidence < confidenceThreshold) {
    return {
      ...baseResult,
      research_status: "low_confidence",
      content_eligible: false,
    };
  }

  // 5. Pains + first fix + offer
  const [pains, firstFix] = await Promise.all([
    compilePainPoints(researchObject),
    determineFirstFixPriority(researchObject),
  ]);
  usage.pain_points = pains.usage;
  usage.first_fix = firstFix.usage;

  const offer = assignOffer(score.total, tiers);

  return {
    ...baseResult,
    research_status: research.research_object.email_source === "form_only"
      ? "form_only"
      : research.research_object.email
        ? "qualified"
        : "no_email",
    content_eligible: true,
    pain_points: pains.pain_points,
    first_fix_priority: firstFix.first_fix_priority,
    first_fix_rationale: firstFix.rationale,
    assigned_offer: offer,
  };
}
