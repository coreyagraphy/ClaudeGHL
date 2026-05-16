// Maps Session 1 (research + scoring) + Session 2 (content bundle) + Session 3
// (visuals manifest) outputs into a single GHL contact + opportunity payload.
//
// Custom field keys here use GHL's "field_key" form (snake_case names).
// In production a user maps these to actual custom field IDs in their location
// via src/ghl/config.js. The names mirror the 35-field schema in the brief.

// Tier names here must match the keys in MENTAL_VISION_CONTEXT.tiers in
// src/context.js — they're used to look up the assigned offer, the GHL
// pipeline stage, and the GHL workflow. The 80+ tier is "foundation"
// (the $2500 offer), NOT "diagnostic" — diagnostic is a separate $297
// lead-in offer with no score band.
function bandFromScore(total) {
  if (total <= 54) return { band: "0-54", tier: "sprint", label: "Foundation" };
  if (total <= 79) return { band: "55-79", tier: "stay_found", label: "Building" };
  return { band: "80-100", tier: "foundation", label: "Optimized" };
}

function offerPrice(assignedOffer) {
  if (!assignedOffer) return null;
  if (assignedOffer.price) return assignedOffer.price;
  if (assignedOffer.price_monthly) return assignedOffer.price_monthly;
  if (assignedOffer.price_90day) return assignedOffer.price_90day;
  return null;
}

// String(undefined) === "undefined" — which the cf helper would happily push
// to GHL as a custom field with the literal text "undefined". Use this for
// boolean-ish fields where we want null (omit) for missing data.
function boolToString(v) {
  if (v === undefined || v === null) return null;
  return String(v);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinPainPoints(painPoints) {
  if (!Array.isArray(painPoints)) return "";
  return painPoints
    .map((p, i) => `${i + 1}. ${typeof p === "string" ? p : p.headline || p.title || JSON.stringify(p)}`)
    .join("\n");
}

// Build the customFields array for the contact upsert.
// Each entry is { key, field_value } — GHL maps by key when configured to.
function buildCustomFields({ research, score, assignedOffer, painPoints, firstFix, firstFixRationale, contentBundle, visualsManifest, campaignId }) {
  const band = bandFromScore(score.total);
  const cf = (key, value) => (value === undefined || value === null || value === "" ? null : { key, field_value: value });

  const entries = [
    // --- Visibility scoring ---
    cf("ai_visibility_score", score.total),
    cf("ai_visibility_band", band.band),
    cf("ai_visibility_label", band.label),
    cf("score_breakdown_json", JSON.stringify(score.breakdown || {})),
    cf("research_confidence", research.confidence ?? null),
    cf("research_status", research.research_status ?? null),

    // --- Identity / firmographic ---
    cf("company_domain", research.research_object?.domain),
    cf("domain_verified", boolToString(research.research_object?.domain_verified)),
    cf("owner_first_name", research.research_object?.owner_first),
    cf("owner_full_name", research.research_object?.owner_name),
    cf("primary_email_source", research.research_object?.email_source),
    cf("gbp_rating", research.research_object?.rating),
    cf("gbp_review_count", research.research_object?.review_count),
    cf("years_in_business", research.research_object?.years_in_business),
    cf("employee_count", research.research_object?.employee_count),
    cf("gbp_completeness", research.research_object?.gbp_complete),

    // --- AI infrastructure signals ---
    cf("schema_types_present", (research.research_object?.schema_types_present || []).join(",")),
    cf("ai_bots_blocked", research.research_object?.ai_bots_blocked),
    cf("llms_txt_present", boolToString(research.research_object?.llms_txt_present)),
    cf("social_platforms_active", research.research_object?.social_platforms_active),
    cf("content_freshness_months", research.research_object?.content_freshness_months),
    cf("last_content_date", research.research_object?.last_content_date),

    // --- Pain + first fix ---
    cf("pain_points_summary", joinPainPoints(painPoints)),
    cf("first_fix_priority", firstFix),
    cf("first_fix_rationale", firstFixRationale),

    // --- Offer routing ---
    cf("assigned_offer_name", assignedOffer?.name),
    cf("assigned_offer_tier", band.tier),
    cf("assigned_offer_price", offerPrice(assignedOffer)),

    // --- Content artifacts ---
    cf("selected_email_angle", contentBundle?.selected_email_angle),
    cf("selected_email_subject", contentBundle?.selected_email_subject),
    cf("landing_page_url", contentBundle?.landing_page_url),
    cf("landing_page_local_path", contentBundle?.landing_page_local_path),

    // --- Visual artifacts ---
    cf("hero_image_url", visualsManifest?.image?.url),
    cf("hero_image_local_path", visualsManifest?.image?.local_path),
    cf("ugc_video_url", visualsManifest?.video?.url),
    cf("ugc_video_job_id", visualsManifest?.video?.job_id),

    // --- Campaign tracking ---
    cf("campaign_id", campaignId),
    cf("research_notes", research.research_object?.research_notes),
  ];

  return entries.filter(Boolean);
}

function buildTags({ research, score, campaignId }) {
  const band = bandFromScore(score.total);
  const tags = [
    `campaign:${campaignId}`,
    `band:${band.band}`,
    `tier:${band.tier}`,
    `score:${score.total}`,
  ];
  const niche = research.input?.niche || research.research_object?.niche;
  if (niche) tags.push(`niche:${String(niche).toLowerCase().replace(/\s+/g, "-")}`);
  const city = research.research_object?.city;
  if (city) tags.push(`city:${String(city).toLowerCase().replace(/\s+/g, "-")}`);
  if (research.research_object?.ai_bots_blocked === "all_blocked") tags.push("alert:bots-blocked");
  if (research.research_object?.email_source === "form_only") tags.push("contact:form-only");
  if (research.research_object?.email_source === "not_found") tags.push("contact:no-email");
  return tags;
}

export function buildContactPayload({ research, score, assignedOffer, painPoints, firstFix, firstFixRationale, contentBundle, visualsManifest, campaignId }) {
  const ro = research.research_object;
  if (!ro) throw new Error("research.research_object is required");

  const tags = buildTags({ research, score, campaignId });
  const customFields = buildCustomFields({
    research,
    score,
    assignedOffer,
    painPoints,
    firstFix,
    firstFixRationale,
    contentBundle,
    visualsManifest,
    campaignId,
  });

  const payload = {
    firstName: ro.owner_first || undefined,
    lastName: ro.owner_name && ro.owner_first
      ? ro.owner_name.replace(new RegExp(`^${escapeRegex(ro.owner_first)}\\s*`, "i"), "").trim() || undefined
      : undefined,
    name: ro.owner_name || ro.company_name,
    companyName: ro.company_name,
    email: ro.email || undefined,
    phone: ro.phone || undefined,
    address1: undefined,
    city: ro.city || undefined,
    website: ro.domain ? (ro.domain.startsWith("http") ? ro.domain : `https://${ro.domain}`) : undefined,
    tags,
    customFields,
    source: `mental-vision:${campaignId}`,
  };

  // Strip undefined to keep payload clean
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  return payload;
}

export function buildOpportunityPayload({ contactId, research, score, assignedOffer, campaignId, pipelineConfig }) {
  const band = bandFromScore(score.total);
  const tierStage = pipelineConfig?.stages?.[band.tier];
  return {
    pipelineId: pipelineConfig?.pipelineId,
    pipelineStageId: tierStage,
    name: `${research.research_object.company_name} — ${assignedOffer?.name || band.label}`,
    status: "open",
    contactId,
    monetaryValue: offerPrice(assignedOffer) || 0,
    source: `mental-vision:${campaignId}`,
  };
}

export function selectWorkflowId({ score, workflows }) {
  if (!workflows) return null;
  const band = bandFromScore(score.total);
  return workflows[band.tier] || workflows.default || null;
}

export { bandFromScore };
