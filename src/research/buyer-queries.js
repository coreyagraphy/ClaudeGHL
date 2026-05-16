import { MODELS, routeModel } from "../models.js";
import { generateWithWebSearch, generateJSON } from "../anthropic-client.js";

export const QUERY_INTENT_MAP = {
  emergency: ["urgent {niche} {city}", "emergency {niche} near me {city}"],
  comparison: ["best {niche} company {city}", "top rated {niche} {city} {state}"],
  trust: ["{niche} reviews {city}", "trusted {niche} {city}"],
  price: ["affordable {niche} {city}", "{niche} cost {city}"],
};

function buildQueries({ niche, city, state }) {
  const queries = [];
  for (const [intent, templates] of Object.entries(QUERY_INTENT_MAP)) {
    for (const t of templates) {
      const query = t
        .replaceAll("{niche}", niche)
        .replaceAll("{city}", city)
        .replaceAll("{state}", state || "")
        .replace(/\s+/g, " ")
        .trim();
      queries.push({ intent, query });
    }
  }
  return queries;
}

const SYSTEM = `You run buyer-intent queries to test whether a target local business shows up in AI answer engines.

For each query I give you, use web_search and report whether the target prospect appears in the top-ranking results:
- "cited" = the target's name or domain appears in the top results
- "partial" = a parent brand, location page, or directory listing referencing the target appears, but not the primary site
- "not_cited" = the target does not appear in the top results

Report concisely. Do not speculate — base the call on what web_search returns.`;

const STATUS_SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          intent: { type: "string", enum: ["emergency", "comparison", "trust", "price"] },
          status: { type: "string", enum: ["cited", "partial", "not_cited"] },
          evidence: { type: "string" },
        },
        required: ["query", "intent", "status", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["queries"],
  additionalProperties: false,
};

export async function buyerQueryMapping({ company, domain, niche, city, state }) {
  const queries = buildQueries({ niche, city, state });

  const userPrompt = `Target prospect:
Company: ${company}
Domain: ${domain}
City: ${city}

Run these 8 queries and report for each whether the target appears:

${queries.map((q, i) => `${i + 1}. [${q.intent}] ${q.query}`).join("\n")}

After running all 8, give me a numbered list of {query, intent, status, evidence} observations.`;

  const research = await generateWithWebSearch({
    model: routeModel("buyer_journey_map"),
    systemPrompt: SYSTEM,
    userPrompt,
    maxTokens: 12000,
    maxContinuations: 10,
  });

  // Haiku extracts the structured array from the notes
  const extractPrompt = `Source company: ${company}
Source domain: ${domain}

Raw observations:
---
${research.text}
---

Return the 8 queries in the schema-defined shape.`;

  const structured = await generateJSON({
    model: MODELS.haiku,
    systemPrompt:
      "You convert research observations about buyer-intent queries into a structured array. Stay faithful to the source — do not invent statuses not in the notes.",
    userPrompt: extractPrompt,
    schema: STATUS_SCHEMA,
    maxTokens: 2000,
  });

  return {
    buyer_query_coverage: structured.data.queries,
    raw_notes: research.text,
    usage: {
      search: research.usage,
      extract: structured.usage,
    },
  };
}
