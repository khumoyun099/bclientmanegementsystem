// pulse-generate-insight — BUNDLED single-file edition for Supabase
// dashboard deploys (no sibling _shared imports).
//
// The modular source lives in supabase/functions/_shared/ + index.ts
// and is the canonical version for CLI-based deploys. This file is
// the flattened copy you paste into the dashboard editor.
//
// If you change anything in the modular source, re-flatten by running:
//   pbcopy < supabase/functions/pulse-generate-insight/index.bundled.ts
// and pasting into the dashboard.

// deno-lint-ignore-file no-explicit-any

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ============================================================================
// CORS
// ============================================================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function handleCorsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// Supabase client helpers
// ============================================================================
function createUserClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

async function getAuthUserId(req: Request): Promise<string | null> {
  const client = createUserClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

// ============================================================================
// Anthropic API wrapper
// ============================================================================
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CallAnthropicParams {
  system: string;
  messages: AnthropicMessage[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

interface AnthropicResponse {
  id: string;
  model: string;
  role: string;
  stop_reason: string;
  stop_sequence: string | null;
  type: string;
  usage: { input_tokens: number; output_tokens: number };
  content: Array<{ type: string; text: string }>;
}

async function callAnthropic(params: CallAnthropicParams): Promise<AnthropicResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on this edge function');
  }

  const body = {
    model: params.model ?? DEFAULT_MODEL,
    // 2500 is enough for ~12 insights × 50 words each including JSON overhead.
    // If we raise MAX_BATCH, raise this too proportionally.
    max_tokens: params.maxTokens ?? 2500,
    temperature: params.temperature ?? 0.3,
    system: params.system,
    messages: params.messages,
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errBody: unknown = null;
    try {
      errBody = await res.json();
    } catch {
      // ignore
    }
    const errType =
      typeof errBody === 'object' && errBody !== null && 'error' in errBody
        ? (errBody as { error?: { type?: string; message?: string } }).error
        : null;
    console.error(`Anthropic API error ${res.status}:`, errType);
    throw new Error(`Anthropic API returned ${res.status}: ${errType?.type ?? 'unknown'}`);
  }

  return (await res.json()) as AnthropicResponse;
}

function extractText(resp: AnthropicResponse): string {
  const text = resp.content.find(c => c.type === 'text')?.text;
  if (!text) {
    throw new Error('Anthropic response contained no text block');
  }
  return text;
}

function extractJson<T>(raw: string): T {
  let s = raw.trim();
  if (s.startsWith('```')) {
    const firstNewline = s.indexOf('\n');
    if (firstNewline !== -1) s = s.slice(firstNewline + 1);
    if (s.endsWith('```')) s = s.slice(0, -3);
    s = s.trim();
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    const firstBrace = s.search(/[\[{]/);
    if (firstBrace === -1) throw new Error('No JSON object/array found in model output');
    const open = s[firstBrace];
    const close = open === '[' ? ']' : '}';
    const lastClose = s.lastIndexOf(close);
    if (lastClose === -1 || lastClose < firstBrace) {
      throw new Error('Unbalanced JSON in model output');
    }
    return JSON.parse(s.slice(firstBrace, lastClose + 1)) as T;
  }
}

// ============================================================================
// Playbook loader (graceful fallback)
// ============================================================================
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

async function loadActivePlaybook(client: SupabaseClient): Promise<string> {
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

// ============================================================================
// Prompt builder
// ============================================================================
interface InsightLeadContext {
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

async function buildInsightPrompt(params: {
  client: SupabaseClient;
  agentName: string;
  leads: InsightLeadContext[];
}): Promise<{ system: string; user: string }> {
  const playbookMd = await loadActivePlaybook(params.client);
  const system = INSIGHT_SYSTEM_TEMPLATE.replace('{{playbook_md}}', playbookMd);
  const leadsJson = JSON.stringify(params.leads, null, 2);
  const user = INSIGHT_USER_TEMPLATE
    .replace('{{count}}', String(params.leads.length))
    .replace('{{agent_name}}', params.agentName || 'the agent')
    .replace('{{leads_json}}', leadsJson);
  return { system, user };
}

// ============================================================================
// Main handler
// ============================================================================
const TTL_MINUTES = 60;
const TTL_MINUTES_PROMISED = 15;
const RATE_LIMIT_PER_HOUR = 30;
const MAX_BATCH = 12;
const KIND = 'next_action';

interface RequestBody {
  leads: InsightLeadContext[];
  agent_id: string;
  agent_name?: string;
}

function aiEnabled(): boolean {
  const flag = Deno.env.get('AI_ENABLED');
  return flag === undefined || flag.toLowerCase() !== 'false';
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
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

    const requestedLeads = body.leads.slice(0, MAX_BATCH);
    const requestedIds = requestedLeads.map(l => l.lead_id);

    const userClient = createUserClient(req);
    const serviceClient = createServiceClient();

    // Cache lookup
    const { data: cachedRows, error: cacheErr } = await userClient
      .from('pulse_insights')
      .select('id,lead_id,title,body,category,expires_at')
      .in('lead_id', requestedIds)
      .eq('kind', KIND)
      .is('dismissed_at', null)
      .gt('expires_at', new Date().toISOString());

    if (cacheErr) console.warn('cache lookup failed:', cacheErr.message);

    const cachedByLeadId = new Map<
      string,
      { title: string; body: string; category: string; expires_at: string }
    >();
    for (const row of cachedRows ?? []) {
      cachedByLeadId.set(row.lead_id, {
        title: row.title,
        body: row.body,
        category: row.category,
        expires_at: row.expires_at,
      });
    }

    const missing = requestedLeads.filter(l => !cachedByLeadId.has(l.lead_id));

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

    // Rate limit check
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount, error: rateErr } = await userClient
      .from('pulse_insights')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', body.agent_id)
      .gte('created_at', hourAgo);

    if (rateErr) console.warn('rate check failed:', rateErr.message);

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

    // Anthropic call
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
      try {
        parsed = extractJson<Array<{ lead_id: string; title: string; body: string }>>(text);
      } catch (parseErr) {
        // Log the raw text so we can see exactly what Claude returned
        // when the JSON parser fails. Truncate to 1500 chars so a
        // runaway response doesn't spam the logs.
        console.error(
          'extractJson failed. Raw model output (first 1500 chars):',
          text.slice(0, 1500),
        );
        console.error(
          `Response metadata: stop_reason=${resp.stop_reason}, tokens in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}`,
        );
        throw parseErr;
      }
      console.log(
        `Anthropic ok: ${toGenerate.length} leads → ${parsed.length} insights, tokens in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}, stop=${resp.stop_reason}`,
      );
    } catch (err) {
      console.error('Anthropic call failed:', err instanceof Error ? err.message : err);
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

    // Persist
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

    let insertedRows: Array<{
      lead_id: string;
      title: string;
      body: string;
      category: string;
      expires_at: string;
    }> = [];
    if (rowsToInsert.length > 0) {
      const { data: inserted, error: insertErr } = await serviceClient
        .from('pulse_insights')
        .insert(rowsToInsert)
        .select('lead_id,title,body,category,expires_at');
      if (insertErr) console.error('pulse_insights insert failed:', insertErr.message);
      else insertedRows = inserted ?? [];
    }

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
      200,
    );
  }
});
