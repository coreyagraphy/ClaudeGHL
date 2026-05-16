import { routeModel } from "../models.js";
import { generateJSON } from "../anthropic-client.js";
import {
  CREDIBILITY_GUARDRAILS,
  brandSnapshot,
  offerSnapshot,
} from "./_shared.js";

const SYSTEM = (context) => `You write Meta ad copy (Facebook / Instagram) for a Mental Vision prospect.

OUTPUT: 5 headline variants + 3 primary text variants + 1 description.

Constraints:
- Headlines: 5 words max each. No emoji. No exclamation marks. No ALL CAPS.
- Primary text variants: 1–2 sentences. ≤ 125 characters each (Meta truncation point on mobile).
- Description (the link description under the headline): 1 sentence, ≤ 30 characters.
- CTA button label: pick one of "Learn More" / "Book Now" / "Sign Up" — only those three.
- Voice: ${context.luna_persona.tone}

${CREDIBILITY_GUARDRAILS}

${brandSnapshot(context)}`;

const SCHEMA = {
  type: "object",
  properties: {
    headlines: {
      type: "array",
      items: { type: "string" },
    },
    primary_texts: {
      type: "array",
      items: { type: "string" },
    },
    description: { type: "string" },
    cta_button: {
      type: "string",
      enum: ["Learn More", "Book Now", "Sign Up"],
    },
  },
  required: ["headlines", "primary_texts", "description", "cta_button"],
  additionalProperties: false,
};

export async function generateMetaAdCopy({ researchObject, score, assignedOffer, painPoints, context }) {
  const model = routeModel("meta_ad_copy");

  const userPrompt = `research_object summary:
- Company: ${researchObject.company_name}
- City: ${researchObject.city}
- Niche: ${researchObject.niche}
- Score: ${score.total}/100 (${score.label})
- Top pain: ${painPoints[0]?.pain || "n/a"}

${offerSnapshot(assignedOffer)}

Write the Meta ad copy.`;

  return generateJSON({
    model,
    systemPrompt: SYSTEM(context),
    userPrompt,
    schema: SCHEMA,
    maxTokens: 2000,
  });
}
