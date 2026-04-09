// pulse-generate-insight
// ---------------------------------------------------------------------------
// Called from the client (via supabase.functions.invoke) after the Pulse
// feed loads. Takes the list of flagged leads the client wants narrated,
// drops any that already have a fresh cached insight, batches the rest
// into a single Anthropic Haiku 4.5 call, and writes the results back
// into pulse_insights so subsequent loads get cache hits.
//
// Guardrails:
//   * Auth required. Unauth calls get 401.
//   * Rate limit: max 30 insight rows per agent per rolling hour. The
//     limit applies per-agent, so admins viewing the whole team can
//     still bump into it — acceptable for v1.
//   * AI_ENABLED env var acts as a global kill switch. Set to 'false'
//     and the function returns any cached rows it has without calling
//     Anthropic.
//   * AI never writes to leads, notes, or activity_logs — only to
//     pulse_insights. Enforced by using the service client with an
//     explicit table allowlist in this file.
//
// Response shape (always 200 on non-auth errors — the client has a
// deterministic fallback so we never want to cascade a 500 into a
// broken dashboard):
//
//   {
//     "insights": [ { lead_id, title, body, expires_at, kind, category } ],
//     "generated": <number of new rows inserted>,
//     "cached":    <number of rows served from cache>,
//     "skipped":   <number rate-limited>,
//     "ai_enabled": <boolean>
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
import { buildInsightPrompt, type InsightLeadContext } from '../_shared/prompts.ts';
import { callAnthropic, extractText, extractJson } from '../_shared/anthropic.ts';

// ---- tuning ---------------------------------------------------------------

const TTL_MINUTES = 60;                    // normal insight lifespan
const TTL_MINUTES_PROMISED = 15;           // time-sensitive categories refresh faster
const RATE_LIMIT_PER_HOUR = 30;            // max NEW inserts per agent per rolling hour
const MAX_BATCH = 12;                       // max leads per Anthropic call — bounds cost + token count
const KIND = 'next_action';                // the only insight kind in Pulse-2

// ---- request body ---------------------------------------------------------

interface RequestBody {
  leads: InsightLeadContext[];
  agent_id: string;           // agent the insights are FOR (may differ from caller when admin)
  agent_name?: string;
}

// ---- main handler ---------------------------------------------------------

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const callerId = await getAuthUserId(req);
    if (!callerId) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400);
    }

    if (!body?.leads || !Array.isArray(body.leads) || body.leads.length === 0) {
      return jsonResponse({
        insights: [],
        generated: 0,
        cached: 0,
        skipped: 0,
        ai_enabled: aiEnabled(),
      });
    }
    if (!body.agent_id || typeof body.agent_id !== 'string') {
      return jsonResponse({ error: 'agent_id is required' }, 400);
    }

    // Trim payload to a sane ceiling so one runaway caller can't spike cost.
    const requestedLeads = body.leads.slice(0, MAX_BATCH);
    const requestedIds = requestedLeads.map(l => l.lead_id);

    const userClient = createUserClient(req);
    const serviceClient = createServiceClient();

    // -----------------------------------------------------------------------
    // Step 1: cache lookup — find existing non-expired insights for these
    // leads + kind. Anything found is returned as-is; anything missing is
    // a candidate for generation.
    // -----------------------------------------------------------------------
    const { data: cachedRows, error: cacheErr } = await userClient
      .from('pulse_insights')
      .select('id,lead_id,title,body,category,expires_at')
      .in('lead_id', requestedIds)
      .eq('kind', KIND)
      .is('dismissed_at', null)
      .gt('expires_at', new Date().toISOString());

    if (cacheErr) {
      console.warn('pulse-generate-insight cache lookup failed:', cacheErr.message);
    }

    const cachedByLeadId = new Map<string, { title: string; body: string; category: string; expires_at: string }>();
    for (const row of cachedRows ?? []) {
      cachedByLeadId.set(row.lead_id, {
        title: row.title,
        body: row.body,
        category: row.category,
        expires_at: row.expires_at,
      });
    }

    const missing = requestedLeads.filter(l => !cachedByLeadId.has(l.lead_id));

    // -----------------------------------------------------------------------
    // Step 2: short-circuit when everything is cached OR the kill switch is off.
    // -----------------------------------------------------------------------
    if (missing.length === 0) {
      return jsonResponse({
        insights: Array.from(cachedByLeadId.entries()).map(([lead_id, v]) => ({
          lead_id,
          kind: KIND,
          ...v,
        })),
        generated: 0,
        cached: cachedByLeadId.size,
        skipped: 0,
        ai_enabled: aiEnabled(),
      });
    }

    if (!aiEnabled()) {
      return jsonResponse({
        insights: Array.from(cachedByLeadId.entries()).map(([lead_id, v]) => ({
          lead_id,
          kind: KIND,
          ...v,
        })),
        generated: 0,
        cached: cachedByLeadId.size,
        skipped: missing.length,
        ai_enabled: false,
      });
    }

    // -----------------------------------------------------------------------
    // Step 3: rate limit check. Count insights CREATED in the last hour for
    // the *agent the insights are for*. Uses the user client so RLS applies.
    // -----------------------------------------------------------------------
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount, error: rateErr } = await userClient
      .from('pulse_insights')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', body.agent_id)
      .gte('created_at', hourAgo);

    if (rateErr) {
      console.warn('pulse-generate-insight rate check failed:', rateErr.message);
    }

    const remaining = Math.max(0, RATE_LIMIT_PER_HOUR - (recentCount ?? 0));
    if (remaining === 0) {
      console.log('Rate limit hit for agent', body.agent_id);
      return jsonResponse({
        insights: Array.from(cachedByLeadId.entries()).map(([lead_id, v]) => ({
          lead_id,
          kind: KIND,
          ...v,
        })),
        generated: 0,
        cached: cachedByLeadId.size,
        skipped: missing.length,
        ai_enabled: true,
        rate_limited: true,
      });
    }

    const toGenerate = missing.slice(0, remaining);

    // -----------------------------------------------------------------------
    // Step 4: call Anthropic (one batched call for all missing leads).
    // -----------------------------------------------------------------------
    const { system, user } = await buildInsightPrompt({
      client: serviceClient,
      agentName: body.agent_name ?? 'the agent',
      leads: toGenerate,
    });

    let parsed: Array<{ lead_id: string; title: string; body: string }> = [];
    try {
      const resp = await callAnthropic({
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = extractText(resp);
      parsed = extractJson<Array<{ lead_id: string; title: string; body: string }>>(text);
      console.log(
        `Anthropic ok: ${toGenerate.length} leads → ${parsed.length} insights, tokens in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}`,
      );
    } catch (err) {
      console.error('Anthropic call failed:', err instanceof Error ? err.message : err);
      // Degrade gracefully — return only what we had cached.
      return jsonResponse({
        insights: Array.from(cachedByLeadId.entries()).map(([lead_id, v]) => ({
          lead_id,
          kind: KIND,
          ...v,
        })),
        generated: 0,
        cached: cachedByLeadId.size,
        skipped: toGenerate.length,
        ai_enabled: true,
        ai_error: true,
      });
    }

    // -----------------------------------------------------------------------
    // Step 5: persist generated insights. Use service client to bypass the
    // client RLS INSERT policy (caller may be admin viewing another agent).
    // Always insert under the TARGET agent_id so future cache lookups for
    // that agent find the row.
    // -----------------------------------------------------------------------

    // Map lead_id -> source lead so we can pick TTL + category per insight
    const leadById = new Map<string, InsightLeadContext>();
    for (const l of toGenerate) leadById.set(l.lead_id, l);

    const now = new Date();
    const rowsToInsert = parsed
      .filter(p => leadById.has(p.lead_id))
      .map(p => {
        const src = leadById.get(p.lead_id)!;
        const ttlMin = src.category === 'promised' ? TTL_MINUTES_PROMISED : TTL_MINUTES;
        const expiresAt = new Date(now.getTime() + ttlMin * 60 * 1000);
        return {
          lead_id: p.lead_id,
          agent_id: body.agent_id,
          kind: KIND,
          title: truncate(p.title, 120),
          body: truncate(p.body, 500),
          category: src.category,
          priority: 50,
          meta: {
            signal: {
              silence_score: src.silence_score,
              days_overdue: src.days_overdue,
              days_since_last_touch: src.days_since_last_touch,
              reschedule_streak: src.reschedule_streak,
              every_days: src.every_days,
            },
          },
          expires_at: expiresAt.toISOString(),
        };
      });

    let insertedRows: Array<{ lead_id: string; title: string; body: string; category: string; expires_at: string }> = [];
    if (rowsToInsert.length > 0) {
      const { data: inserted, error: insertErr } = await serviceClient
        .from('pulse_insights')
        .insert(rowsToInsert)
        .select('lead_id,title,body,category,expires_at');
      if (insertErr) {
        console.error('pulse_insights insert failed:', insertErr.message);
      } else {
        insertedRows = inserted ?? [];
      }
    }

    // -----------------------------------------------------------------------
    // Step 6: build the unified response (cache hits + new generations).
    // -----------------------------------------------------------------------
    const combined = [
      ...Array.from(cachedByLeadId.entries()).map(([lead_id, v]) => ({
        lead_id,
        kind: KIND,
        ...v,
      })),
      ...insertedRows.map(r => ({ lead_id: r.lead_id, kind: KIND, ...r })),
    ];

    return jsonResponse({
      insights: combined,
      generated: insertedRows.length,
      cached: cachedByLeadId.size,
      skipped: Math.max(0, missing.length - insertedRows.length),
      ai_enabled: true,
    });
  } catch (err) {
    console.error('pulse-generate-insight unexpected error:', err);
    return jsonResponse(
      { error: 'internal error', insights: [], generated: 0, cached: 0, skipped: 0 },
      200, // we never want to cascade into a UI failure
    );
  }
});

// ---- helpers --------------------------------------------------------------

function aiEnabled(): boolean {
  const flag = Deno.env.get('AI_ENABLED');
  // default ON unless explicitly 'false'
  return flag === undefined || flag.toLowerCase() !== 'false';
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
