// pulse-admin-users — BUNDLED single-file edition for Supabase dashboard deploys.
//
// Admin-only edge function for managing team members. Uses the service
// role (available to edge functions only) to call Supabase's Admin API
// for inviting users. Other actions (soft-delete, reactivate, change
// role) are plain UPDATE statements on the profiles table, but we do
// them here anyway to centralize the admin check and keep the client
// bundle free of any service_role surface.
//
// Actions (POST body, JSON):
//
//   { action: "invite", email, name?, role?  }
//     → Sends an invite email via supabase.auth.admin.inviteUserByEmail.
//       If a profiles row doesn't exist yet for that email, creates a
//       pending one with active=true and the requested role.
//
//   { action: "deactivate", user_id }
//     → Sets profiles.active = false. Caller must reassign leads first
//       (enforced in the client UI). Never touches auth.users.
//
//   { action: "reactivate", user_id }
//     → Sets profiles.active = true. Safe and reversible.
//
//   { action: "set_role", user_id, role }
//     → Updates profiles.role for any user. Convenience wrapper over the
//       existing updateProfileRole client method but centralized here.
//
// All actions require the caller to be an admin (is_admin() via the
// profiles lookup) — 401 otherwise.

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

async function isCallerAdmin(req: Request): Promise<boolean> {
  const uid = await getAuthUserId(req);
  if (!uid) return false;
  const service = createServiceClient();
  const { data } = await service
    .from('profiles')
    .select('role')
    .eq('id', uid)
    .maybeSingle();
  return data?.role === 'admin';
}

// ============================================================================
// Action handlers
// ============================================================================

type Role = 'agent' | 'admin';

async function handleInvite(
  service: SupabaseClient,
  body: { email: string; name?: string; role?: Role },
): Promise<Response> {
  if (!body.email) return jsonResponse({ error: 'email is required' }, 400);
  const role: Role = body.role === 'admin' ? 'admin' : 'agent';

  // Send the invite email via the Admin API. This creates an auth.users
  // row in the "invited" state. When the user clicks the link they'll be
  // prompted to set a password and will land authenticated.
  const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(
    body.email,
    { data: { name: body.name ?? body.email.split('@')[0], role } },
  );
  if (inviteErr) {
    console.error('inviteUserByEmail failed:', inviteErr.message);
    return jsonResponse({ error: inviteErr.message }, 400);
  }

  const newAuthUserId = invited?.user?.id;
  if (!newAuthUserId) {
    return jsonResponse({ error: 'invite succeeded but no user returned' }, 500);
  }

  // Upsert a matching profiles row so the invited user shows up in the
  // team list immediately (with active=true). On first login
  // getCurrentProfile will find it and use it instead of creating a new
  // one with wrong defaults.
  const { error: profileErr } = await service
    .from('profiles')
    .upsert(
      {
        id: newAuthUserId,
        email: body.email,
        name: body.name ?? body.email.split('@')[0] ?? 'User',
        role,
        active: true,
      },
      { onConflict: 'id' },
    );

  if (profileErr) {
    console.warn('profiles upsert after invite failed:', profileErr.message);
  }

  return jsonResponse({ ok: true, user_id: newAuthUserId, email: body.email });
}

async function handleDeactivate(
  service: SupabaseClient,
  callerId: string,
  body: { user_id: string },
): Promise<Response> {
  if (!body.user_id) return jsonResponse({ error: 'user_id is required' }, 400);
  if (body.user_id === callerId) {
    return jsonResponse({ error: 'You cannot deactivate your own account' }, 400);
  }

  const { error } = await service
    .from('profiles')
    .update({ active: false })
    .eq('id', body.user_id);
  if (error) {
    console.error('deactivate failed:', error.message);
    return jsonResponse({ error: error.message }, 500);
  }
  return jsonResponse({ ok: true });
}

async function handleReactivate(
  service: SupabaseClient,
  body: { user_id: string },
): Promise<Response> {
  if (!body.user_id) return jsonResponse({ error: 'user_id is required' }, 400);
  const { error } = await service
    .from('profiles')
    .update({ active: true })
    .eq('id', body.user_id);
  if (error) {
    console.error('reactivate failed:', error.message);
    return jsonResponse({ error: error.message }, 500);
  }
  return jsonResponse({ ok: true });
}

async function handleSetRole(
  service: SupabaseClient,
  body: { user_id: string; role: Role },
): Promise<Response> {
  if (!body.user_id) return jsonResponse({ error: 'user_id is required' }, 400);
  if (body.role !== 'agent' && body.role !== 'admin') {
    return jsonResponse({ error: 'role must be agent or admin' }, 400);
  }
  const { error } = await service
    .from('profiles')
    .update({ role: body.role })
    .eq('id', body.user_id);
  if (error) {
    console.error('set_role failed:', error.message);
    return jsonResponse({ error: error.message }, 500);
  }
  return jsonResponse({ ok: true });
}

// ============================================================================
// Main handler
// ============================================================================
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const callerId = await getAuthUserId(req);
    if (!callerId) return jsonResponse({ error: 'unauthorized' }, 401);

    if (!(await isCallerAdmin(req))) {
      return jsonResponse({ error: 'admin only' }, 403);
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400);
    }

    const service = createServiceClient();

    switch (body?.action) {
      case 'invite':
        return await handleInvite(service, body);
      case 'deactivate':
        return await handleDeactivate(service, callerId, body);
      case 'reactivate':
        return await handleReactivate(service, body);
      case 'set_role':
        return await handleSetRole(service, body);
      default:
        return jsonResponse({ error: `unknown action: ${body?.action}` }, 400);
    }
  } catch (err) {
    console.error('pulse-admin-users unexpected error:', err);
    return jsonResponse({ error: 'internal error' }, 500);
  }
});
