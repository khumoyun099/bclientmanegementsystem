// Helpers for loading the active Pulse Playbook and building the
// system prompt that every AI insight call uses.
//
// Falls back to a bundled default if no playbook row exists or if the
// fetch fails for any reason — the AI should never crash because of a
// missing doctrine.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const FALLBACK_DOCTRINE = `# Sales Doctrine — Emergency Fallback

## Lead Status Meanings
- HOT: ready to book within 7 days. Follow up daily.
- WARM: interested but evaluating. Follow up every 3-5 days.
- PROGRESSIVE: wants to buy but not urgent. Follow up every 7-10 days.
- COLD: unresponsive. 4 check-ins over 4 days before closing.
- SOLD: deal closed.
- CLOSED: lost / not interested / wrong fit.

## Coaching Style
- Direct, supportive, never preachy. Max 60 words per insight.
- Always reference the lead by name. Never invent facts.
- If the data is thin, say so and recommend the agent add a note.`;

export async function loadActivePlaybook(client: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await client
      .from('pulse_playbook')
      .select('content_md')
      .eq('active', true)
      .maybeSingle();
    if (error) {
      console.warn('loadActivePlaybook: query error, using fallback', error.message);
      return FALLBACK_DOCTRINE;
    }
    return data?.content_md ?? FALLBACK_DOCTRINE;
  } catch (err) {
    console.warn('loadActivePlaybook: caught error, using fallback', err);
    return FALLBACK_DOCTRINE;
  }
}
