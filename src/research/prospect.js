import { routeModel, MODELS } from "../models.js";
import { generateWithWebSearch, generateJSON } from "../anthropic-client.js";

const RESEARCH_SYSTEM = `You are a research analyst for Mental Vision Corp. Your job: gather AI-visibility-relevant data on a target local business and report observable facts.

Use web_search to investigate. Look for:
- Official website + verifiable contact details (email on the site beats a contact form)
- Owner/operator name (look in About / Team / leadership pages)
- Google Business Profile signals: rating, review count, completeness
- Years in business, employee count if obvious
- Schema.org markup present on the site (use view-source-style hints from search snippets, schema validators, or referenced rich results)
- AI bot access (robots.txt — is GPTBot / ClaudeBot / PerplexityBot blocked?)
- llms.txt file presence
- Social presence: which platforms have active accounts with recent posts?
- Content freshness: when was the most recent blog post or news item published?
- Any LLM citations or AI-engine mentions for the business

Be honest about what you can and cannot verify. Use "unknown" or null rather than guessing.

Output a numbered list of observations followed by a "GAPS" section listing anything you couldn't verify.`;

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string" },
    domain: { type: "string" },
    domain_verified: { type: "boolean" },
    owner_first: { type: ["string", "null"] },
    owner_name: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    email_source: {
      type: "string",
      enum: ["site_scrape", "form_only", "not_found"],
    },
    phone: { type: ["string", "null"] },
    city: { type: "string" },
    rating: { type: ["number", "null"] },
    review_count: { type: ["integer", "null"] },
    years_in_business: { type: ["integer", "null"] },
    employee_count: { type: ["integer", "null"] },
    schema_types_present: { type: "array", items: { type: "string" } },
    ai_bots_blocked: {
      type: "string",
      enum: ["all_allowed", "some_blocked", "all_blocked", "unknown"],
    },
    llms_txt_present: { type: "boolean" },
    gbp_complete: { type: "string", enum: ["complete", "partial", "missing"] },
    social_platforms_active: { type: "integer" },
    content_freshness_months: { type: ["integer", "null"] },
    last_content_date: { type: ["string", "null"] },
    research_notes: { type: "string" },
  },
  required: [
    "company_name",
    "domain",
    "domain_verified",
    "owner_first",
    "owner_name",
    "email",
    "email_source",
    "phone",
    "city",
    "rating",
    "review_count",
    "years_in_business",
    "employee_count",
    "schema_types_present",
    "ai_bots_blocked",
    "llms_txt_present",
    "gbp_complete",
    "social_platforms_active",
    "content_freshness_months",
    "last_content_date",
    "research_notes",
  ],
  additionalProperties: false,
};

const EXTRACT_SYSTEM = `You convert raw research notes into a structured research object. Stay faithful to the notes — if a field isn't mentioned, use null / false / "unknown" / 0 as appropriate to the schema. Never invent data.`;

export async function researchProspect({ company, domain, city, niche }) {
  // Phase 1: Sonnet + web_search produces research notes
  const searchModel = routeModel("research_scoring");
  const searchPrompt = `Research this local business for AI visibility analysis:

Company: ${company}
Domain: ${domain}
City: ${city}
Niche: ${niche}

Investigate the items in the system prompt and report observations.`;

  const research = await generateWithWebSearch({
    model: searchModel,
    systemPrompt: RESEARCH_SYSTEM,
    userPrompt: searchPrompt,
    maxTokens: 8000,
  });

  // Phase 2: Haiku extracts structured fields from notes
  const extractModel = MODELS.haiku;
  const extractPrompt = `Source company: ${company}
Source domain: ${domain}
Source city: ${city}

Raw research notes:
---
${research.text}
---

Extract the structured research object. Use the schema strictly.`;

  const structured = await generateJSON({
    model: extractModel,
    systemPrompt: EXTRACT_SYSTEM,
    userPrompt: extractPrompt,
    schema: RESEARCH_SCHEMA,
    maxTokens: 4000,
  });

  return {
    research_object: {
      ...structured.data,
      niche,
      researched_at: new Date().toISOString(),
    },
    raw_notes: research.text,
    usage: {
      research: research.usage,
      extract: structured.usage,
    },
  };
}
