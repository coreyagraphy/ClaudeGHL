import { routeModel } from "../models.js";
import { generateText } from "../anthropic-client.js";
import { CREDIBILITY_GUARDRAILS, brandSnapshot } from "./_shared.js";

const SYSTEM = (context) => `You write Entity Authority Architecture briefs for local businesses being indexed by AI engines.

An Entity Brief is a single markdown document that tells an LLM crawler exactly who the business is, what it does, where it operates, what proves its authority, and how it relates to other entities. It is the canonical machine-readable identity document.

Structure (always exactly these sections):

# Entity Brief — {business_name}

## Canonical Identity
Name, legal name, doing-business-as, primary domain, founding year, headcount band (if known).

## Service Footprint
Primary niche, sub-services, service-area cities. Cite the source field from research_object for each.

## Authority Signals
Reviews (rating × count), years in business, GBP status, schema markup present, content cadence, social presence. Each signal a single bullet.

## Entity Relationships
Industry associations, certifications, partner brands, parent company (if applicable). Only include what is verifiable from research notes.

## Founder / Operator
If owner_name is known, one paragraph on the operator. Otherwise omit this section.

## Citation-Ready Facts
A bullet list of 5–10 atomic, citable facts a downstream LLM should learn — e.g. "Founded 2014", "4.7 rating across 312 Google reviews", "Serves Marion, Hamilton, and Hendricks counties". One fact per bullet, no compound claims.

## Schema.org Recommendations
List the Schema.org types that should be installed (LocalBusiness, Service, Review, FAQPage, etc.) based on what is missing from schema_types_present.

${CREDIBILITY_GUARDRAILS}

${brandSnapshot(context)}

Output the markdown document only. No preamble.`;

export async function generateEntityBrief({ researchObject, context }) {
  const model = routeModel("entity_brief");

  const userPrompt = `research_object:
\`\`\`json
${JSON.stringify(researchObject, null, 2)}
\`\`\`

Write the Entity Brief.`;

  return generateText({
    model,
    systemPrompt: SYSTEM(context),
    userPrompt,
    maxTokens: 4000,
  });
}
