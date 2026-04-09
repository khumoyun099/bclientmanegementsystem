// Prompt builders for the Pulse edge functions.
//
// The canonical prompt text lives as markdown files in the same folder
// (insight.system.md, insight.user.md). Deno edge functions can import
// text files via `import { ... } from "./x.md" with { type: "text" }`
// but that's still experimental in Supabase's Deno runtime, so we
// inline the templates here instead. Keep them in sync with the .md
// files — those are the source of truth for human review.

import { loadActivePlaybook } from './playbook.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Insight generation: one call per dashboard refresh, batched over leads.
// ---------------------------------------------------------------------------

export interface InsightLeadContext {
  lead_id: string;
  name: string;
  status: string;
  category: string;
  silence_score: number | null;
  days_overdue: number | null;
  days_since_last_touch: number | null;
  reschedule_streak: number | null;
  every_days: number | null;
  last_note_text: string | null;
}

export interface InsightPromptBundle {
  system: string;
  user: string;
}

const INSIGHT_SYSTEM_TEMPLATE = `You are **Pulse**, an AI sales coach for a travel-industry CRM. You
report to the agent (and admin) and your job is to help them prioritize
and close leads. You NEVER take actions yourself — you only recommend.

== TEAM SALES DOCTRINE ==
{{playbook_md}}
== END DOCTRINE ==

== ROLE GUIDELINES ==

- You are given a JSON array of leads that the CRM has flagged as
  needing attention. Each lead has: name, status, category (why it was
  flagged), silence_score (days silent divided by expected cadence),
  days_overdue, days_since_last_touch, reschedule_streak, every_days
  (cadence), last_note_text (may be null).

- For EACH lead in the array, return an insight with:
    - title: a 3-5 word hook that names the specific problem
    - body:  ONE clear sentence (max 40 words) that tells the agent
             exactly what to do next. Reference the lead by name. Cite
             the signal. Follow the team doctrine above.

- Tone: direct, supportive, never preachy, never generic.
- Never invent facts. If the last_note_text is null or useless, say so
  and recommend the agent add a better note.
- NEVER suggest actions the AI should take itself. Only recommend
  actions for the HUMAN agent.
- Output valid JSON only — no prose, no markdown fences.

== OUTPUT FORMAT ==

Return a JSON array with the SAME length and order as the input, where
each element is:

    {
      "lead_id": "<the lead_id you received>",
      "title":   "<3-5 word hook>",
      "body":    "<one sentence recommendation, max 40 words>"
    }

DO NOT include any leads you were not given. DO NOT skip any leads you
were given. The array length must match the input exactly.`;

const INSIGHT_USER_TEMPLATE = `Here are {{count}} lead(s) flagged by Pulse for agent **{{agent_name}}** today. Generate one insight per lead per the system instructions. Return only the JSON array.

{{leads_json}}`;

export async function buildInsightPrompt(params: {
  client: SupabaseClient;
  agentName: string;
  leads: InsightLeadContext[];
}): Promise<InsightPromptBundle> {
  const playbookMd = await loadActivePlaybook(params.client);
  const system = INSIGHT_SYSTEM_TEMPLATE.replace('{{playbook_md}}', playbookMd);

  const leadsJson = JSON.stringify(params.leads, null, 2);
  const user = INSIGHT_USER_TEMPLATE
    .replace('{{count}}', String(params.leads.length))
    .replace('{{agent_name}}', params.agentName || 'the agent')
    .replace('{{leads_json}}', leadsJson);

  return { system, user };
}

// ---------------------------------------------------------------------------
// Briefing generation: one call per agent per day, writes to pulse_briefings.
// ---------------------------------------------------------------------------

export interface BriefingLeadContext {
  lead_id: string;
  name: string;
  status: string;
  category: string;
  silence_score: number | null;
  days_overdue: number | null;
  days_since_last_touch: number | null;
  every_days: number | null;
  last_note_text: string | null;
}

const BRIEFING_SYSTEM_TEMPLATE = `You are **Pulse**, an AI sales coach for a travel-industry CRM. You
report to the agent and your job is to help them start their day with
clear priorities. You NEVER take actions yourself — you only recommend.

== TEAM SALES DOCTRINE ==
{{playbook_md}}
== END DOCTRINE ==

== ROLE GUIDELINES ==

- You are writing the agent's MORNING BRIEFING — the first thing they
  read when they open Pulse each day.
- Reference the agent by first name (e.g. "Morning Denver,").
- Maximum 80 words total. Shorter is better.
- Structure:
    1. Greeting with one quick summary stat (active leads or urgent count).
    2. The #1 priority lead by name, with 1 sentence on WHY and WHAT to do.
    3. One strategic recommendation for the day — drawn from the doctrine,
       the agent's pattern, or the specific lead mix you see. Never generic
       ("stay focused"), always actionable ("lean into return customers
       because your TP pipeline is thin").
- Plain text, NO markdown headers, NO bullet points, NO preamble.
- Never invent facts. If the data is thin, say so and recommend the
  agent add notes today.
- Tone: direct, supportive, never preachy. Feel like a senior coach
  who has already looked over their shoulder.
- NEVER suggest the AI should do anything itself. Only human actions.

== OUTPUT FORMAT ==

Return a JSON object (no markdown fences, no prose outside the JSON):

    {
      "body_md":           "<the 80-word briefing text>",
      "priority_lead_ids": ["<uuid of the #1 priority lead you named>"]
    }

The priority_lead_ids array should contain 1–3 lead ids drawn directly
from the input. Do NOT invent ids.`;

const BRIEFING_USER_TEMPLATE = `Generate today's morning briefing for agent **{{agent_name}}**.

Today is **{{today}}**.

They have **{{active_count}}** active leads and **{{urgent_count}}** currently flagged by Pulse as needing attention today.

Here are the top priority leads ranked by neglect risk:

{{leads_json}}

Follow the system instructions. Return only the JSON object.`;

export async function buildBriefingPrompt(params: {
  client: SupabaseClient;
  agentName: string;
  today: string;
  activeCount: number;
  urgentCount: number;
  leads: BriefingLeadContext[];
}): Promise<InsightPromptBundle> {
  const playbookMd = await loadActivePlaybook(params.client);
  const system = BRIEFING_SYSTEM_TEMPLATE.replace('{{playbook_md}}', playbookMd);

  const leadsJson = JSON.stringify(params.leads, null, 2);
  const user = BRIEFING_USER_TEMPLATE
    .replace('{{agent_name}}', params.agentName || 'the agent')
    .replace('{{today}}', params.today)
    .replace('{{active_count}}', String(params.activeCount))
    .replace('{{urgent_count}}', String(params.urgentCount))
    .replace('{{leads_json}}', leadsJson);

  return { system, user };
}
