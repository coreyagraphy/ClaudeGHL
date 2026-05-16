import { routeModel } from "../models.js";
import { generateJSON } from "../anthropic-client.js";
import {
  CREDIBILITY_GUARDRAILS,
  brandSnapshot,
  offerSnapshot,
  angleForScore,
} from "./_shared.js";

const SYSTEM = (context) => `You write 4 cold email variants for Mental Vision Corp, each playing a different angle, and pick the strongest for the prospect's score band.

The 4 angles (always exactly these, always in this order):

1. invisible_urgency — for scores 0–39. The prospect is invisible to AI. Subject is a direct number. Body opens with the specific gap, ends with "20 minutes, free, here's the calendar".
2. thin_cost_of_inaction — for scores 40–59. The prospect has scraps but is being skipped. Body quantifies what partial visibility costs: AI sends the buyer to a competitor's name first.
3. building_partial_visibility — for scores 60–79. The prospect appears in some queries but not the high-intent ones. Body shows the gap between "found" and "recommended".
4. strong_ceiling_and_competitor — for scores 80–100. The prospect is well-positioned. Body is the ceiling argument: the gap between being recommended and being THE recommendation, with one named competitor moving fast.

Constraints for every variant:
- Subject line: 5–9 words, no clickbait, no emoji, no exclamation marks, no "Re:" fakery
- Body: 80–140 words. 3 short paragraphs max. One specific fact from the research_object in the first paragraph. CTA is the Free 20-Minute AI Visibility Audit.
- Sign-off: "— ${context.owner}, ${context.business}"
- Plain text. No HTML. No markdown.

After writing all 4, set "recommended_angle" to the variant whose ID matches the prospect's score band — but evaluate each variant on its own merits.

${CREDIBILITY_GUARDRAILS}

${brandSnapshot(context)}`;

const SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          angle: {
            type: "string",
            enum: [
              "invisible_urgency",
              "thin_cost_of_inaction",
              "building_partial_visibility",
              "strong_ceiling_and_competitor",
            ],
          },
          subject: { type: "string" },
          body: { type: "string" },
          hook: { type: "string" },
        },
        required: ["angle", "subject", "body", "hook"],
        additionalProperties: false,
      },
    },
    recommended_angle: {
      type: "string",
      enum: [
        "invisible_urgency",
        "thin_cost_of_inaction",
        "building_partial_visibility",
        "strong_ceiling_and_competitor",
      ],
    },
    recommendation_rationale: { type: "string" },
  },
  required: ["variants", "recommended_angle", "recommendation_rationale"],
  additionalProperties: false,
};

export async function generateEmailCopy({ researchObject, score, assignedOffer, painPoints, firstFix, context }) {
  const model = routeModel("prospect_email_copy");
  const expectedAngle = angleForScore(score.total);

  const userPrompt = `research_object:
\`\`\`json
${JSON.stringify(researchObject, null, 2)}
\`\`\`

score: ${score.total}/100 (${score.label}, Machine Trust: ${score.machine_trust})
${offerSnapshot(assignedOffer)}
first_fix_priority: ${firstFix}
top_pains: ${painPoints.slice(0, 3).map((p) => p.pain).join(" | ")}

Score band aligns with angle: ${expectedAngle}

Write all 4 variants. Pick the recommended one.`;

  return generateJSON({
    model,
    systemPrompt: SYSTEM(context),
    userPrompt,
    schema: SCHEMA,
    maxTokens: 6000,
  });
}
