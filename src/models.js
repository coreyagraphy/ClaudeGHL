export const MODELS = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};

const ROUTING = {
  // OPUS — complex architecture and reasoning
  ghl_automation_prompt: MODELS.opus,
  ghl_business_os_prompt: MODELS.opus,

  // SONNET — balanced generation (default)
  ghl_website_prompt: MODELS.sonnet,
  prospect_email_copy: MODELS.sonnet,
  prospect_landing_page: MODELS.sonnet,
  entity_brief: MODELS.sonnet,
  buyer_journey_map: MODELS.sonnet,
  research_scoring: MODELS.sonnet,

  // HAIKU — fast, cheap, structured
  meta_ad_copy: MODELS.haiku,
  social_posts: MODELS.haiku,
  campaign_report: MODELS.haiku,
  pain_point_compile: MODELS.haiku,
  dedup_check: MODELS.haiku,
  data_transform: MODELS.haiku,
  first_fix_priority: MODELS.haiku,
};

export function routeModel(taskType) {
  return ROUTING[taskType] || MODELS.sonnet;
}
