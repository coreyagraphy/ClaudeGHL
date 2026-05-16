import { routeModel } from "../models.js";
import { generateText } from "../anthropic-client.js";

const SYSTEM = `You are a senior CRM architect and conversation designer producing a complete GoHighLevel Ask AI prompt that will build an entire AI Business Operating System in one pass.

Your output is the FINAL prompt that the user will paste directly into GHL Ask AI. It must:
- Build Luna (chatbot + voice agent), the CRM, calendar, and pipeline in a single coherent system
- Be operationally ready, copy-paste with zero additional editing
- Specify EVERY custom field, tag, pipeline stage, and behavior explicitly (GHL Ask AI builds literally what is described)
- Encode Luna's persona, knowledge base, escalation rules, and qualification flow precisely
- Be structured so GHL can construct the system correctly without follow-up clarification

Do NOT include preamble or meta-commentary. Output only the prompt body.`;

export async function generateBusinessOSPrompt(context) {
  const model = routeModel("ghl_business_os_prompt");

  const luna = context.luna_persona;
  const stages = context.pipeline_stages.join(" → ");

  const userPrompt = `Generate a complete GoHighLevel AI Business Operating System prompt for ${context.business}.

This prompt is pasted into GHL Ask AI. It must build Luna (chatbot + voice agent), the full CRM structure, calendar system, and pipeline in one pass.

LUNA — CHATBOT:
Name: ${luna.name}
Channels: website chat, SMS, email, Facebook, Instagram
Persona: ${luna.tone}
NOT: ${luna.not}
She knows: ${luna.knowledge_base.join("; ")}.
She escalates to ${context.owner} when: lead scores under 40 (Invisible), AI bots are confirmed blocked, lead asks for ${context.owner.split(" ")[0]} directly, or the conversation signals immediate buying intent.
She qualifies with: What's your business name and website? What city are you in? Have you ever searched for your own service on ChatGPT or Perplexity?
She never: says "I'm just an AI", uses filler phrases, offers discounts unprompted, or answers questions outside her knowledge base.

LUNA — VOICE AGENT:
Same name, same persona. Answers calls naturally. Greets: "${context.business.split(" ")[0]} ${context.business.split(" ").slice(1).join(" ")}, this is ${luna.name}."
Handles: FAQs, service explanations, audit booking, lead qualification.
Books directly into ${context.owner}'s calendar. Confirms availability. Avoids double-booking.
Escalates: hot leads, urgent requests, complex situations.
Updates CRM and pipeline stage after every call.

CALENDAR:
Event: ${context.primary_offer}
Duration: 20 minutes
Buffer: 10 minutes between appointments
Availability: Monday–Friday 9am–6pm Eastern
Confirmation: immediate SMS + email with Calendly-style details
Reminders: 24 hours before (SMS + email) + 1 hour before (SMS)
No-show follow-up: triggers within 15 minutes of missed appointment

PIPELINE STAGES:
${stages}

CRM CUSTOM FIELDS (create all of these exactly):
AI Visibility Score (Number), Score Label (Text), Machine Trust Status (Dropdown: Broken/Thin/Building/Strong), First Fix Priority (Text), Assigned Offer (Text), Offer Price (Number), Email Subject (Text), Email Hook (Text), Full Email Body (Multiline), Landing Page URL (URL), Visual Asset URL (URL), UGC Video Job ID (Text), UGC Video URL (URL), Schema Types Missing (Multiline), AI Bots Blocked (Text), llms.txt Missing (Checkbox), Social Presence Score (Text), LLM Presence Score (Number), Buyer Query Coverage (Multiline), Research Confidence Score (Number), Entity Brief Generated (Checkbox), Campaign ID (Text), Niche (Text), Market (Text), Research Date (Date), Owner Name (Text), Email Source (Dropdown: Direct/Form Only/Not Found), Pain Points (Multiline), Research Status (Dropdown: Qualified/Form Only/No Email/Disqualified/Low Confidence), Content Status (Dropdown: Generating/Ready/Sent/Viewed/Responded/Converted), Andromeda Eligible (Checkbox), Meta Ad Variants (Multiline), Reactivation Eligible (Checkbox)

SMART TAGS: score label, machine trust status, niche, market, campaign ID, assigned offer, andromeda-eligible, hot-lead, form-only, low-confidence

OFFERS LUNA UNDERSTANDS:
- ${context.tiers.diagnostic.name} ($${context.tiers.diagnostic.price}) — ${context.tiers.diagnostic.notes}
- ${context.tiers.sprint.name} ($${context.tiers.sprint.price}) — score range ${context.tiers.sprint.score_range[0]}–${context.tiers.sprint.score_range[1]}
- ${context.tiers.stay_found.name} ($${context.tiers.stay_found.price_monthly}/mo, $${context.tiers.stay_found.price_90day}/mo first 90 days) — score range ${context.tiers.stay_found.score_range[0]}–${context.tiers.stay_found.score_range[1]}
- ${context.tiers.foundation.name} ($${context.tiers.foundation.price}) — score range ${context.tiers.foundation.score_range[0]}–${context.tiers.foundation.score_range[1]}

PRIMARY HOOK Luna can reference: ${context.frameworks.primary_hook}
METAPHOR: ${context.frameworks.metaphor}

Generate the complete, operationally ready GHL Ask AI prompt now. Copy-paste ready. No additional editing required.`;

  return generateText({
    model,
    systemPrompt: SYSTEM,
    userPrompt,
    maxTokens: 32000,
    thinking: { type: "adaptive" },
  });
}
