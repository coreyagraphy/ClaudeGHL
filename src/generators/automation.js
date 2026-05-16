import { routeModel } from "../models.js";
import { generateText } from "../anthropic-client.js";

const SYSTEM = `You are a senior marketing automation architect producing a complete GoHighLevel Automation Builder prompt for a unified master automation system.

Your output is the FINAL prompt that the user will paste directly into GHL's Automation Builder. It must:
- Specify ONE unified master automation (not 11 separate workflows) with branching logic GHL can build correctly
- Encode every trigger, every branch, every wait step, every send, every internal notification
- Use exact custom field merge tokens ({{contact.field_name}}) as specified
- Be operationally ready, copy-paste with zero additional editing
- Be structured so GHL can construct the automation tree without follow-up clarification

Do NOT include preamble or meta-commentary. Output only the prompt body.`;

export async function generateAutomationPrompt(context) {
  const model = routeModel("ghl_automation_prompt");

  const luna = context.luna_persona.name;
  const ownerFirst = context.owner.split(" ")[0];

  const userPrompt = `Generate a complete GoHighLevel Master Automation System prompt for ${context.business}.

This is ONE unified automation — not 11 separate workflows. Structure it as a single master system with branching logic that GHL can build and manage correctly.

LEAD CAPTURE TRIGGERS:
- Form submitted (website or landing page)
- Calendar booking received
- Inbound SMS or web chat message
- Inbound call received (including missed call)

ON ANY TRIGGER:
1. Create/update contact with all available data
2. Assign tags: niche, market, campaign ID, score label, machine trust status
3. Update pipeline to "New Lead"
4. Fire instant response within 60 seconds

INSTANT RESPONSE (all channels):
SMS: "Hey [First Name], this is ${luna} from ${context.business}. We just received your info — I pulled your AI Visibility data and it's ready. Want me to walk you through what we found? Reply YES and I'll send it over."
Email: Subject line from custom field {{contact.email_subject}} | Body from {{contact.full_email_body}} | Visual asset embedded

BRANCHING LOGIC BY SCORE:

SCORE 0–39 (Invisible — Maximum Urgency):
- Tag: invisible, urgent, hot-lead
- Pipeline: Hot Prospects
- Wait: 0 minutes (immediate)
- Send email + SMS simultaneously
- SMS ${ownerFirst}: "INVISIBLE PROSPECT: {{contact.companyName}} | Score: {{contact.ai_visibility_score}} | {{contact.assigned_offer}} | Machine Trust: BROKEN"
- Create task: "HOT — Call {{contact.companyName}} within 2 hours"
- Day 2: Follow-up SMS if no reply
- Day 5: Final email — urgency angle
- Day 7: SMS ${ownerFirst} — "Final touch needed: {{contact.companyName}}"

SCORE 40–59 (Thin Presence):
- Tag: thin-presence
- Pipeline: Hot Prospects
- Wait: 2 hours
- Send email
- Day 3: Follow-up email — cost of inaction angle
- Day 6: Final email — sprint offer
- Day 8: SMS to prospect
- Day 9: Task for ${ownerFirst} — call or close

SCORE 60–79 (Building — Stay Found angle):
- Tag: building, stay-found-candidate
- Pipeline: Nurture
- Wait: 6 hours
- Send email
- Day 4: Follow-up — partial visibility cost
- Day 8: Final email — monthly retainer pitch
- Day 10: SMS to prospect
- Day 11: Task for ${ownerFirst}

SCORE 80–100 (Strong — Foundation upsell):
- Tag: strong, foundation-candidate
- Pipeline: Nurture
- Wait: 24 hours
- Send email — "you're ahead of most, here's the ceiling" angle
- Day 5: Follow-up — competitor catching up
- Day 10: Final email — last note
- Day 12: Task for ${ownerFirst}

FORM ONLY (no direct email):
- Tag: form-only
- Pipeline: Manual Outreach
- SMS ${ownerFirst} immediately: "Call needed: {{contact.companyName}} at {{contact.phone}} — ask for {{contact.owner_name}}"
- Create task: "Call {{contact.companyName}} — no direct email found"

LOW CONFIDENCE (Research Confidence Score under 60):
- Tag: low-confidence
- Pipeline: Manual Review
- SMS ${ownerFirst}: "Low confidence data: {{contact.companyName}} — manual review needed before outreach"
- Hold all automated sends until ${ownerFirst} approves

CONTENT VIEWED (Landing Page URL opened):
- Wait: 20 minutes
- Send follow-up email: "Saw you looked at the {{contact.companyName}} audit. What stood out? Worth 20 minutes to talk through the fix?"
- SMS ${ownerFirst}: "{{contact.companyName}} viewed the landing page — move now. Score: {{contact.ai_visibility_score}}"
- Create high-priority task

MISSED CALL:
- Trigger ${luna} SMS within 60 seconds: "Hey, this is ${luna} from ${context.business} — sorry we missed your call. I can help you right now over text or get something on ${ownerFirst}'s calendar. What works for you?"

APPOINTMENT BOOKED:
- Confirmation SMS + email immediately
- Reminder SMS 24 hours before
- Reminder SMS 1 hour before
- Update pipeline to "Audit Booked"
- SMS ${ownerFirst}: "Audit booked: {{contact.companyName}} | {{appointment_date_time}}"

APPOINTMENT NO-SHOW:
- Wait 15 minutes past scheduled time
- SMS: "Hey [First Name] — looks like we missed each other. Want to reschedule? Here's the link: [calendar link]"
- Update pipeline to "Follow-Up"
- Create task for ${ownerFirst}

REACTIVATION (no engagement after day 14):
- Tag: reactivation-eligible
- SMS: "Hey [First Name] — ${ownerFirst} from ${context.business}. Checked in on {{contact.companyName}}'s AI visibility recently. Still seeing the same gaps. Things have shifted in the last two weeks. Worth a quick look?"
- Email: Reactivation angle — market has moved, window closing
- Move pipeline to "Reactivation"

POST-CLOSE — SPRINT TO STAY FOUND CONVERSION:
- At day 8 of Sprint delivery
- Email: "Your Sprint is wrapping up. Here's what changed in 7 days — and here's what needs monthly attention to hold it."
- Offer: ${context.tiers.stay_found.name} at $${context.tiers.stay_found.price_90day}/month for first 90 days
- Update pipeline to "Proposal Sent" if not already closed to ${context.tiers.stay_found.name}

EMAIL SEQUENCES:

${context.tiers.foundation.name} Sequence ($${context.tiers.foundation.price} — scores ${context.tiers.foundation.score_range[0]}–${context.tiers.foundation.score_range[1]}):
Email 1 (Day 0): Subject + body from custom fields
Email 2 (Day 4 if no open): "The ceiling for {{contact.companyName}} in AI search"
Email 3 (Day 9 if no click): "Last note from ${context.business}"
SMS (Day 11): Short check-in
Task (Day 12): Final touch or close

${context.tiers.stay_found.name} Sequence ($${context.tiers.stay_found.price_monthly}/mo — scores ${context.tiers.stay_found.score_range[0]}–${context.tiers.stay_found.score_range[1]}):
Email 1 (Day 0): Subject + body from custom fields
Email 2 (Day 5 if no open): "What partial visibility costs {{contact.companyName}} per month"
Email 3 (Day 9 if no click): "One more thing about {{contact.companyName}}"
SMS (Day 11): Short check-in
Task (Day 12): Final touch or close

${context.tiers.sprint.name} Sequence ($${context.tiers.sprint.price} — scores ${context.tiers.sprint.score_range[0]}–${context.tiers.sprint.score_range[1]}):
Email 1 (Day 0): Subject + body from custom fields
Email 2 (Day 2 if no open): "{{contact.companyName}} scored {{contact.ai_visibility_score}}/100"
Email 3 (Day 5 if no click): "The fix is 7 days — not months"
SMS (Day 7): Direct ask
Task (Day 8): Final touch or close

INTERNAL NOTIFICATIONS to ${ownerFirst} for:
- Any new lead with score under 40
- Any prospect who views the landing page
- Any booked appointment
- Any missed call
- Any reactivation trigger
- Any prospect who replies to an email

Generate ONE complete, centralized GHL Automation Builder prompt. Structured for GHL to build correctly. Copy-paste ready. No additional editing required.`;

  return generateText({
    model,
    systemPrompt: SYSTEM,
    userPrompt,
    maxTokens: 32000,
    thinking: { type: "adaptive" },
  });
}
