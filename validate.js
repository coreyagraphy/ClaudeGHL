// Dry-run validation: synthesize a Session 1 result, feed it through the
// Session 2 orchestrator's pre-API logic, and verify input/output shapes
// without making any Claude API calls.

import { MENTAL_VISION_CONTEXT } from "./src/context.js";
import {
  scoreProspect,
  calculateConfidenceScore,
  assignOffer,
  scoreLabel,
} from "./src/scoring.js";
import { angleForScore, offerSnapshot, brandSnapshot } from "./src/content/_shared.js";

const errors = [];
const warnings = [];
const ok = [];

function check(label, condition, detail = "") {
  if (condition) ok.push(label);
  else errors.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

// ---- Scoring boundary tests ----

const buckets = [
  { score: 0, label: "Invisible", offer: "sprint" },
  { score: 39, label: "Invisible", offer: "sprint" },
  { score: 40, label: "Thin Presence", offer: "sprint" },
  { score: 54, label: "Thin Presence", offer: "sprint" },
  { score: 55, label: "Thin Presence", offer: "stay_found" },
  { score: 59, label: "Thin Presence", offer: "stay_found" },
  { score: 60, label: "Building", offer: "stay_found" },
  { score: 79, label: "Building", offer: "stay_found" },
  { score: 80, label: "AI-Ready", offer: "foundation" },
  { score: 100, label: "AI-Ready", offer: "foundation" },
];

for (const b of buckets) {
  const lbl = scoreLabel(b.score);
  check(
    `scoreLabel(${b.score}) → ${b.label}`,
    lbl.label === b.label,
    `got ${lbl.label}`,
  );
  const offer = assignOffer(b.score, MENTAL_VISION_CONTEXT.tiers);
  check(
    `assignOffer(${b.score}) → ${b.offer}`,
    offer.tier === b.offer,
    `got ${offer.tier}`,
  );
}

// ---- Angle for score mapping ----

const angles = [
  { score: 0, expect: "invisible_urgency" },
  { score: 39, expect: "invisible_urgency" },
  { score: 40, expect: "thin_cost_of_inaction" },
  { score: 59, expect: "thin_cost_of_inaction" },
  { score: 60, expect: "building_partial_visibility" },
  { score: 79, expect: "building_partial_visibility" },
  { score: 80, expect: "strong_ceiling_and_competitor" },
  { score: 100, expect: "strong_ceiling_and_competitor" },
];
for (const a of angles) {
  check(
    `angleForScore(${a.score}) → ${a.expect}`,
    angleForScore(a.score) === a.expect,
    `got ${angleForScore(a.score)}`,
  );
}

// ---- Confidence edge cases ----

check(
  "confidence: empty research → 0",
  calculateConfidenceScore({}) === 0,
);
check(
  "confidence: site_scrape email + verified owner + verified domain → 100",
  calculateConfidenceScore({
    email: "x@y.com",
    email_source: "site_scrape",
    owner_first: "Jane",
    rating: 4.5,
    review_count: 50,
    domain_verified: true,
  }) === 100,
);
check(
  "confidence: form-only email is +10 not +30",
  calculateConfidenceScore({
    email: "x@y.com",
    email_source: "form_only",
  }) === 10,
);
check(
  "confidence: just under thresholds (4.2 rating, 29 reviews) → 0",
  calculateConfidenceScore({ rating: 4.2, review_count: 29 }) === 0,
);

// ---- Offer snapshot for both shapes ----

const sprintOffer = assignOffer(50, MENTAL_VISION_CONTEXT.tiers);
const stayFoundOffer = assignOffer(70, MENTAL_VISION_CONTEXT.tiers);
const foundationOffer = assignOffer(90, MENTAL_VISION_CONTEXT.tiers);

check(
  "offerSnapshot(sprint) includes $997",
  offerSnapshot(sprintOffer).includes("$997"),
);
check(
  "offerSnapshot(stay_found) uses monthly + 90-day intro",
  offerSnapshot(stayFoundOffer).includes("$497/mo") &&
    offerSnapshot(stayFoundOffer).includes("$397/mo"),
);
check(
  "offerSnapshot(foundation) includes $2500",
  offerSnapshot(foundationOffer).includes("$2500"),
);

// ---- Brand snapshot contains required elements ----

const snap = brandSnapshot(MENTAL_VISION_CONTEXT);
check("brandSnapshot includes business name", snap.includes("Mental Vision Corp"));
check("brandSnapshot includes owner", snap.includes("Corey Ellis"));
check("brandSnapshot includes master line", snap.includes("visible to AI"));

// ---- Session 1 → Session 2 input shape simulation ----

// Build a synthetic Session 1 result and verify every field Session 2 reads
// is present and the right type.
const synthetic = {
  research_object: {
    company_name: "Acme Test HVAC",
    domain: "acmetest.com",
    domain_verified: true,
    owner_first: "Jane",
    owner_name: "Jane Doe",
    email: "jane@acmetest.com",
    email_source: "site_scrape",
    phone: "317-555-0100",
    city: "Indianapolis",
    rating: 4.6,
    review_count: 142,
    years_in_business: 18,
    employee_count: 24,
    schema_types_present: ["LocalBusiness", "Service"],
    ai_bots_blocked: "some_blocked",
    llms_txt_present: false,
    gbp_complete: "complete",
    social_platforms_active: 2,
    content_freshness_months: 7,
    last_content_date: "2025-10-01",
    research_notes: "Notes here.",
    niche: "HVAC",
    researched_at: new Date().toISOString(),
    buyer_query_coverage: [
      { query: "urgent HVAC Indianapolis", intent: "emergency", status: "partial", evidence: "directory" },
      { query: "best HVAC Indianapolis", intent: "comparison", status: "not_cited", evidence: "n/a" },
      { query: "HVAC reviews Indianapolis", intent: "trust", status: "cited", evidence: "GBP cited" },
      { query: "affordable HVAC Indianapolis", intent: "price", status: "not_cited", evidence: "n/a" },
    ],
  },
};
synthetic.score = scoreProspect(synthetic.research_object);
synthetic.confidence = calculateConfidenceScore(synthetic.research_object);
synthetic.assigned_offer = assignOffer(synthetic.score.total, MENTAL_VISION_CONTEXT.tiers);
synthetic.pain_points = [
  { pain: "AI bots partially blocked in robots.txt", evidence_field: "ai_bots_blocked" },
  { pain: "No llms.txt file", evidence_field: "llms_txt_present" },
];
synthetic.first_fix_priority = "Unblock GPTBot/ClaudeBot in robots.txt";
synthetic.first_fix_rationale = "AI bots can't index → no citations possible.";
synthetic.research_status = "qualified";
synthetic.content_eligible = true;

// Verify every field the 6 generators read is present
const need = [
  ["research_object", synthetic.research_object],
  ["research_object.company_name", synthetic.research_object?.company_name],
  ["research_object.city", synthetic.research_object?.city],
  ["research_object.niche", synthetic.research_object?.niche],
  ["score.total", synthetic.score?.total],
  ["score.label", synthetic.score?.label],
  ["score.machine_trust", synthetic.score?.machine_trust],
  ["score.breakdown", synthetic.score?.breakdown],
  ["assigned_offer.name", synthetic.assigned_offer?.name],
  ["pain_points[0].pain", synthetic.pain_points[0]?.pain],
  ["first_fix_priority", synthetic.first_fix_priority],
  ["first_fix_rationale", synthetic.first_fix_rationale],
];
for (const [label, val] of need) {
  check(`s1→s2: ${label} present`, val !== undefined && val !== null);
}

// Verify the buyer_query_coverage actually contributes to scoring
check(
  "scoring uses buyer_query_coverage (trust cited contributes to category)",
  synthetic.score.breakdown.buyer_query_coverage === 1,
  `got ${synthetic.score.breakdown.buyer_query_coverage}`,
);

// Score sanity
check(
  "synthetic scores in expected mid-range (40-79)",
  synthetic.score.total >= 40 && synthetic.score.total < 80,
  `got ${synthetic.score.total}`,
);

// ---- Content orchestrator early-return on ineligible ----

const { generateContentForProspect } = await import("./src/content/index.js");
const skip = await generateContentForProspect({
  session1Result: { content_eligible: false, research_status: "low_confidence", confidence: 35 },
  campaignId: "validation-test",
});
check("orchestrator skips when content_eligible=false", skip.skipped === true);
check("orchestrator skip reason includes status", skip.reason?.includes("low_confidence"));

// ---- Schema sanity: every JSON schema uses additionalProperties:false on objects ----

import { readFileSync } from "node:fs";
function fileHasAdditionalPropsFalse(file) {
  const src = readFileSync(file, "utf8");
  const schemaMatches = src.match(/SCHEMA\s*=\s*\{[\s\S]*?\n\};/g) || [];
  if (schemaMatches.length === 0) return null;
  return schemaMatches.every((s) =>
    s.includes("additionalProperties: false") ||
    !s.includes('type: "object"'),
  );
}
const schemaFiles = [
  "./src/research/prospect.js",
  "./src/research/buyer-queries.js",
  "./src/research/pain-points.js",
  "./src/research/first-fix.js",
  "./src/content/buyer-journey.js",
  "./src/content/email.js",
  "./src/content/meta-ads.js",
  "./src/content/social-posts.js",
];
for (const f of schemaFiles) {
  const r = fileHasAdditionalPropsFalse(f);
  if (r === null) warnings.push(`schema check: ${f} — no SCHEMA found (skipped)`);
  else check(`schema ${f}: additionalProperties:false present`, r);
}

// ---- Final report ----

console.log(`\n=== Validation report ===`);
console.log(`OK:       ${ok.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Errors:   ${errors.length}`);
if (warnings.length) {
  console.log(`\nWarnings:`);
  warnings.forEach((w) => console.log(`  - ${w}`));
}
if (errors.length) {
  console.log(`\nErrors:`);
  errors.forEach((e) => console.log(`  - ${e}`));
  process.exit(1);
}
console.log(`\nAll checks passed.`);
