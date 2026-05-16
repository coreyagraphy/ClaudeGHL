import { routeModel } from "../models.js";
import { generateJSON } from "../anthropic-client.js";

const SYSTEM = `You pick the single highest-leverage AI-visibility fix for a prospect.

Leverage hierarchy (apply in order):
1. AI bots blocked in robots.txt — unblock first; nothing else matters if bots can't read the site
2. No schema markup → install LocalBusiness + Service schema
3. llms.txt missing → publish llms.txt
4. GBP missing or incomplete → claim and fully populate
5. Zero LLM citations across buyer queries → install Entity Authority Architecture
6. Thin review authority (under 30 reviews or under 4.0 rating) → review acquisition system
7. Stale content (over 12 months) → content cadence + cornerstone refresh
8. Weak social presence (under 2 active platforms) → presence on Instagram + LinkedIn at minimum

Output exactly one fix — the highest-leverage one for this prospect.`;

const SCHEMA = {
  type: "object",
  properties: {
    first_fix_priority: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["first_fix_priority", "rationale"],
  additionalProperties: false,
};

export async function determineFirstFixPriority(researchObject) {
  const userPrompt = `Research object:
\`\`\`json
${JSON.stringify(researchObject, null, 2)}
\`\`\`

Pick the single first fix.`;

  const result = await generateJSON({
    model: routeModel("first_fix_priority"),
    systemPrompt: SYSTEM,
    userPrompt,
    schema: SCHEMA,
    maxTokens: 1000,
  });

  return {
    first_fix_priority: result.data.first_fix_priority,
    rationale: result.data.rationale,
    usage: result.usage,
  };
}
