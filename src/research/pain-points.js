import { routeModel } from "../models.js";
import { generateJSON } from "../anthropic-client.js";

const SYSTEM = `You convert a structured research object into a list of factual pain points for outbound copy.

Rules:
- Each pain must be tied to a specific observable fact in the research_object
- No invented metrics, no fabricated benchmarks
- No "could be" or "might be" language — only what is currently true
- Short, declarative, 1 sentence each
- Maximum 6 pains, ranked by leverage (biggest first)`;

const SCHEMA = {
  type: "object",
  properties: {
    pain_points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pain: { type: "string" },
          evidence_field: { type: "string" },
        },
        required: ["pain", "evidence_field"],
        additionalProperties: false,
      },
    },
  },
  required: ["pain_points"],
  additionalProperties: false,
};

export async function compilePainPoints(researchObject) {
  const userPrompt = `Research object:
\`\`\`json
${JSON.stringify(researchObject, null, 2)}
\`\`\`

Compile the pain points list per the system prompt.`;

  const result = await generateJSON({
    model: routeModel("pain_point_compile"),
    systemPrompt: SYSTEM,
    userPrompt,
    schema: SCHEMA,
    maxTokens: 2000,
  });

  return {
    pain_points: result.data.pain_points,
    usage: result.usage,
  };
}
