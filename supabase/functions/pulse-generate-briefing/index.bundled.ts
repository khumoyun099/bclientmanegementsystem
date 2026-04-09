// pulse-generate-briefing — BUNDLED single-file edition for Supabase
// dashboard deploys (no sibling _shared imports).
//
// The modular source lives in supabase/functions/_shared/ + index.ts
// and is the canonical version for CLI-based deploys. This file is
// the flattened copy you paste into the dashboard editor.

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
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: params.model ?? DEFAULT_MODEL,
      max_tokens: params.maxTokens ?? 2500,
      temperature: params.temperature ?? 0.3,
      system: params.system,
      messages: params.messages,
    }),
  });

  if (!res.ok) {
    let errBody: unknown = null;
    try { errBody = await res.json(); } catch { /* ignore */ }
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
  if (!text) throw new Error('Anthropic response contained no text block');
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
// Playbook loader
// ============================================================================
const FALLBACK_DOCTRINE = `# Sales Doctrine — Emergency Fallback

HOT: ready to book within 7 days. Follow up daily.
WARM: interested but evaluating. Follow up every 3-5 days.
PROGRESSIVE: wants to buy but not urgent. Follow up every 7-10 days.
COLD: unresponsive. 4 check-ins over 4 days before closing.

Tone: direct, supportive, never preachy. Max 80 words per briefing.
Always reference the agent by first name. Never invent facts.`;

async function loadActivePlaybook(client: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await client
      .from('pulse_playbook')
      .select('content_md')
      .eq('active', true)
      .maybeSingle();
    if (error) {
      console.warn('loadActivePlaybook error, using fallback:', error.message);
      return FALLBACK_DOCTRINE;
    }
    return data?.content_md ?? FALLBACK_DOCTRINE;
  } catch (err) {
    console.warn('loadActivePlaybook threw:', err);
    return FALLBACK_DOCTRINE;
  }
}

// ============================================================================
// Briefing prompt builder
// ============================================================================
interface BriefingLeadContext {
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

async function buildBriefingPrompt(params: {
  client: SupabaseClient;
  agentName: string;
  today: string;
  activeCount: number;
  urgentCount: number;
  leads: BriefingLeadContext[];
}): Promise<{ system: string; user: string }> {
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

// ============================================================================
// Main handler
// ============================================================================
const MAX_LEADS_IN_BRIEFING = 5;

interface RequestBody {
  agent_id: string;
  agent_name?: string;
}

interface BriefingJson {
  body_md: string;
  priority_lead_ids: string[];
}

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
    const today = new Date().toISOString().slice(0, 10);

    // Cache lookup
    const { data: cached, error: cacheErr } = await userClient
      .from('pulse_briefings')
      .select('id, for_date, body_md, priority_lead_ids, created_at, read_at, meta')
      .eq('agent_id', body.agent_id)
      .eq('for_date', today)
      .maybeSingle();

    if (cacheErr) console.warn('briefing cache lookup failed:', cacheErr.message);

    if (cached) {
      return jsonResponse({
        briefing: cached,
        generated: false,
        cached: true,
        ai_enabled: aiEnabled(),
      });
    }

    if (!aiEnabled()) {
      return jsonResponse({
        briefing: null,
        generated: false,
        cached: false,
        ai_enabled: false,
      });
    }

    // Context gathering
    const { data: feedRows, error: feedErr } = await serviceClient.rpc(
      'get_pulse_feed',
      { p_agent_id: body.agent_id },
    );
    if (feedErr) console.warn('get_pulse_feed failed:', feedErr.message);

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

    // Clean day fallback — no urgent leads, skip AI, use a canned positive message
    if (topLeads.length === 0) {
      const body_md = `Morning ${firstName(body.agent_name ?? 'friend')} — clean slate today. ${activeCount} active leads, nothing urgent flagged by Pulse. Use the quiet to add notes on leads that don't have recent ones, or push a Progressive lead forward before they go silent.`;
      const { data: inserted, error: insertErr } = await serviceClient
        .from('pulse_briefings')
        .upsert(
          {
            agent_id: body.agent_id,
            for_date: today,
            body_md,
            priority_lead_ids: [],
            meta: {
              generated_via: 'canned_clean_day',
              active_count: activeCount,
              urgent_count: 0,
            },
          },
          { onConflict: 'agent_id,for_date' },
        )
        .select()
        .single();
      if (insertErr) console.error('clean-day briefing insert failed:', insertErr.message);
      return jsonResponse({
        briefing: inserted,
        generated: true,
        cached: false,
        ai_enabled: true,
      });
    }

    // Anthropic call
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
        maxTokens: 600,
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
