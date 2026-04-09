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
