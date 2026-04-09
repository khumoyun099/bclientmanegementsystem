// Shared Supabase client factories for the Pulse edge functions.
//
// Two clients, two roles:
//
//   createUserClient(req) — uses the caller's JWT so RLS applies. Use
//   for reading data the user should be allowed to see (pulse_signals,
//   leads they own, their own rate-limit window on pulse_insights).
//
//   createServiceClient() — uses the service_role key and bypasses RLS.
//   Use ONLY for writes to pulse_insights that need to happen regardless
//   of the user's own INSERT policy, and for reading the global
//   pulse_playbook active row.
//
// The service_role key is only available via Deno.env.get — never
// exposed to the client.

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export function createUserClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/**
 * Get the authenticated user's id from the incoming request. Returns
 * null if the JWT is missing/invalid. Edge functions should reject
 * unauthenticated requests before calling Anthropic.
 */
export async function getAuthUserId(req: Request): Promise<string | null> {
  const client = createUserClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}
