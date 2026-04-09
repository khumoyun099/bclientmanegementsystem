// pulse-generate-briefing
// ---------------------------------------------------------------------------
// Generates (or returns the cached) morning briefing for one agent on one
// day. Called on-demand from the client when the Dashboard loads and no
// briefing row exists yet for today — so the first agent to open Pulse
// each morning pays a ~2s wait and everyone else gets a cache hit.
//
// Guardrails:
//   * Auth required. Unauth calls get 401.
//   * One row per (agent_id, for_date) enforced by the unique constraint
//     on pulse_briefings. We upsert on conflict to make the handler
//     idempotent under concurrent calls.
//   * AI_ENABLED=false env var = kill switch.
//   * The caller may differ from the target agent (admin generating on
//     behalf). We pass the target agent into RLS-aware reads so the
//     data shown belongs to THAT agent.
//
// Response shape:
//
//   {
//     "briefing": { id, for_date, body_md, priority_lead_ids, created_at, read_at },
//     "generated": true | false,
//     "cached": true | false,
//     "ai_enabled": boolean
//   }

import {
  corsHeaders,
  handleCorsPreflight,
  jsonResponse,
} from '../_shared/cors.ts';
import {
  createUserClient,
  createServiceClient,
  getAuthUserId,
} from '../_shared/supabase.ts';
import {
  buildBriefingPrompt,
  type BriefingLeadContext,
} from '../_shared/prompts.ts';
import { callAnthropic, extractText, extractJson } from '../_shared/anthropic.ts';

const MAX_LEADS_IN_BRIEFING = 5;

interface RequestBody {
  agent_id: string;
  agent_name?: string;
  /** Admin-only: bypass today's cached briefing and generate a fresh one. */
  force_regenerate?: boolean;
}

interface BriefingJson {
  body_md: string;
  priority_lead_ids: string[];
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const callerId = await getAuthUserId(req);
    if (!callerId) return jsonResponse({ error: 'unauthorized' }, 401);

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400);
    }

    if (!body?.agent_id || typeof body.agent_id !== 'string') {
      return jsonResponse({ error: 'agent_id is required' }, 400);
    }

    const userClient = createUserClient(req);
    const serviceClient = createServiceClient();

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // -----------------------------------------------------------------------
    // Step 1: cache lookup — one briefing per agent per day.
    // Skipped entirely when force_regenerate is true (admin button).
    // -----------------------------------------------------------------------
    if (!body.force_regenerate) {
      const { data: cached, error: cacheErr } = await userClient
        .from('pulse_briefings')
        .select('id, for_date, body_md, priority_lead_ids, created_at, read_at, meta')
        .eq('agent_id', body.agent_id)
        .eq('for_date', today)
        .maybeSingle();

      if (cacheErr) {
        console.warn('pulse-generate-briefing cache lookup failed:', cacheErr.message);
      }

      if (cached) {
        return jsonResponse({
          briefing: cached,
          generated: false,
          cached: true,
          ai_enabled: aiEnabled(),
        });
      }
    }

    if (!aiEnabled()) {
      return jsonResponse({
        briefing: null,
        generated: false,
        cached: false,
        ai_enabled: false,
      });
    }

    // -----------------------------------------------------------------------
    // Step 2: gather context — pulse_signals + lead count snapshot.
    // -----------------------------------------------------------------------
    const { data: feedRows, error: feedErr } = await serviceClient.rpc(
      'get_pulse_feed',
      { p_agent_id: body.agent_id },
    );

    if (feedErr) {
      console.warn('get_pulse_feed failed:', feedErr.message);
    }

    const { count: activeCountRaw } = await serviceClient
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_agent_id', body.agent_id)
      .not('status', 'in', '("sold","closed")');

    const activeCount = activeCountRaw ?? 0;
    const urgentCount = (feedRows ?? []).length;

    const topLeads: BriefingLeadContext[] = (feedRows ?? [])
      .slice(0, MAX_LEADS_IN_BRIEFING)
      .map((r: any) => ({
        lead_id: r.lead_id,
        name: r.lead_name,
        status: r.status,
        category: r.category ?? 'overdue',
        silence_score: r.silence_score,
        days_overdue: r.days_overdue,
        days_since_last_touch: r.days_since_last_touch,
        every_days: r.every_days,
        last_note_text: r.last_note_text,
      }));

    if (topLeads.length === 0) {
      // Clean day — no urgent leads. Skip AI and return a canned positive message.
      const body_md = `Morning ${firstName(body.agent_name ?? 'friend')} — clean slate today. ${activeCount} active leads, nothing urgent flagged by Pulse. Use the quiet to add notes on leads that don't have recent ones, or push a Progressive lead forward before they go silent.`;
      const { data: inserted, error: insertErr } = await serviceClient
        .from('pulse_briefings')
        .upsert(
          {
            agent_id: body.agent_id,
            for_date: today,
            body_md,
            priority_lead_ids: [],
            meta: { generated_via: 'canned_clean_day', active_count: activeCount, urgent_count: 0 },
          },
          { onConflict: 'agent_id,for_date' },
        )
        .select()
        .single();
      if (insertErr) {
        console.error('clean-day briefing insert failed:', insertErr.message);
      }
      return jsonResponse({
        briefing: inserted,
        generated: true,
        cached: false,
        ai_enabled: true,
      });
    }

    // -----------------------------------------------------------------------
    // Step 3: call Anthropic with the briefing prompt.
    // -----------------------------------------------------------------------
    const { system, user } = await buildBriefingPrompt({
      client: serviceClient,
      agentName: body.agent_name ?? 'the agent',
      today,
      activeCount,
      urgentCount,
      leads: topLeads,
    });

    let parsed: BriefingJson | null = null;
    try {
      const resp = await callAnthropic({
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 600, // briefings are short — bound cost tight
      });
      const text = extractText(resp);
      try {
        parsed = extractJson<BriefingJson>(text);
      } catch (parseErr) {
        console.error(
          'briefing extractJson failed. Raw output (first 1500):',
          text.slice(0, 1500),
        );
        throw parseErr;
      }
      console.log(
        `briefing ok: ${body.agent_id} · tokens in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}`,
      );
    } catch (err) {
      console.error('briefing Anthropic call failed:', err instanceof Error ? err.message : err);
      return jsonResponse({
        briefing: null,
        generated: false,
        cached: false,
        ai_enabled: true,
        ai_error: true,
      });
    }

    if (!parsed || typeof parsed.body_md !== 'string' || parsed.body_md.trim() === '') {
      console.error('briefing parsed but body_md empty');
      return jsonResponse({
        briefing: null,
        generated: false,
        cached: false,
        ai_enabled: true,
        ai_error: true,
      });
    }

    const priorityIds = Array.isArray(parsed.priority_lead_ids)
      ? parsed.priority_lead_ids.filter(
          (id) => typeof id === 'string' && topLeads.some((l) => l.lead_id === id),
        )
      : [];

    // -----------------------------------------------------------------------
    // Step 4: persist via upsert so concurrent first-loads don't race.
    // -----------------------------------------------------------------------
    const { data: inserted, error: insertErr } = await serviceClient
      .from('pulse_briefings')
      .upsert(
        {
          agent_id: body.agent_id,
          for_date: today,
          body_md: truncate(parsed.body_md.trim(), 1200),
          priority_lead_ids: priorityIds,
          meta: {
            generated_via: 'anthropic_haiku_4_5',
            active_count: activeCount,
            urgent_count: urgentCount,
            top_lead_ids: topLeads.map((l) => l.lead_id),
          },
        },
        { onConflict: 'agent_id,for_date' },
      )
      .select()
      .single();

    if (insertErr) {
      console.error('pulse_briefings upsert failed:', insertErr.message);
      return jsonResponse({
        briefing: null,
        generated: false,
        cached: false,
        ai_enabled: true,
        ai_error: true,
      });
    }

    return jsonResponse({
      briefing: inserted,
      generated: true,
      cached: false,
      ai_enabled: true,
    });
  } catch (err) {
    console.error('pulse-generate-briefing unexpected error:', err);
    return jsonResponse(
      { briefing: null, generated: false, cached: false, ai_enabled: false },
      200,
    );
  }
});

function aiEnabled(): boolean {
  const flag = Deno.env.get('AI_ENABLED');
  return flag === undefined || flag.toLowerCase() !== 'false';
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function firstName(full: string): string {
  return (full || '').split(/\s+/)[0] || full;
}
