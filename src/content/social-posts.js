import { routeModel } from "../models.js";
import { generateJSON } from "../anthropic-client.js";
import { CREDIBILITY_GUARDRAILS, brandSnapshot } from "./_shared.js";

const SYSTEM = (context) => `You write 5 social posts about a Mental Vision prospect's AI visibility audit — one per platform, each tuned to platform norms.

PLATFORMS + RULES:
- linkedin: 1200–1500 chars. Professional, peer-level. 1 industry insight + 1 specific finding. End with a single question.
- x: ≤ 280 chars. Punchy. One specific number or fact. No hashtags.
- instagram_caption: 800–1200 chars. Storytelling open, scannable middle, single clear CTA. Up to 5 hashtags at the end, none in the body.
- threads: ≤ 500 chars. Conversational. One specific fact. No hashtags.
- facebook: 600–900 chars. Local voice. One specific finding + CTA.

No emoji unless the platform's voice genuinely requires one (instagram_caption may use ≤ 2). No "🚀 EXCITING NEWS" energy.

Voice: ${context.luna_persona.tone}

${CREDIBILITY_GUARDRAILS}

${brandSnapshot(context)}`;

const SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["linkedin", "x", "instagram_caption", "threads", "facebook"],
          },
          body: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
        },
        required: ["platform", "body", "hashtags"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts"],
  additionalProperties: false,
};

export async function generateSocialPosts({ researchObject, score, painPoints, context }) {
  const model = routeModel("social_posts");

  const userPrompt = `Prospect: ${researchObject.company_name} (${researchObject.city}, ${researchObject.niche})
Score: ${score.total}/100 (${score.label}, Machine Trust: ${score.machine_trust})
Top finding: ${painPoints[0]?.pain || "n/a"}

Write one post per platform (5 posts total).`;

  return generateJSON({
    model,
    systemPrompt: SYSTEM(context),
    userPrompt,
    schema: SCHEMA,
    maxTokens: 3000,
  });
}
