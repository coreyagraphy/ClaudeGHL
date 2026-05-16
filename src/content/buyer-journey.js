import { routeModel } from "../models.js";
import { generateJSON } from "../anthropic-client.js";
import { CREDIBILITY_GUARDRAILS, brandSnapshot } from "./_shared.js";

const SYSTEM = (context) => `You map an AI buyer journey for a specific local business across 4 intent types: emergency, comparison, trust, price.

For each intent type, describe:
- What the buyer is actually asking (the query shape)
- What AI engines look for to surface a recommendation
- Where this specific prospect stands today (cited / partial / not_cited — pulled from buyer_query_coverage)
- The single shift that would move them from current state to "recommended"

Be concrete. Tie the "current state" assessment to the buyer_query_coverage data in the research_object. No vague "improve SEO" advice.

${CREDIBILITY_GUARDRAILS}

${brandSnapshot(context)}`;

const SCHEMA = {
  type: "object",
  properties: {
    journey: {
      type: "array",
      items: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: ["emergency", "comparison", "trust", "price"],
          },
          buyer_query_shape: { type: "string" },
          ai_engine_signals: { type: "string" },
          current_state: {
            type: "string",
            enum: ["cited", "partial", "not_cited", "mixed"],
          },
          state_evidence: { type: "string" },
          shift_required: { type: "string" },
        },
        required: [
          "intent",
          "buyer_query_shape",
          "ai_engine_signals",
          "current_state",
          "state_evidence",
          "shift_required",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["journey"],
  additionalProperties: false,
};

export async function generateBuyerJourneyMap({ researchObject, context }) {
  const model = routeModel("buyer_journey_map");

  const userPrompt = `research_object:
\`\`\`json
${JSON.stringify(researchObject, null, 2)}
\`\`\`

Map the AI buyer journey across all 4 intent types.`;

  return generateJSON({
    model,
    systemPrompt: SYSTEM(context),
    userPrompt,
    schema: SCHEMA,
    maxTokens: 4000,
  });
}
