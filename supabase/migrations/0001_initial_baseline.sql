-- ============================================================================
-- 0001_initial_baseline.sql
-- ----------------------------------------------------------------------------
-- This migration is a REFERENCE SNAPSHOT of the schema that `components/
-- DatabaseSetup.tsx` already ships. It is safe to run on a fresh project and
-- a no-op on an existing one (every statement uses IF NOT EXISTS / IF EXISTS).
--
-- Do NOT run this on production if the app has been live — it is here so
-- future migrations (0002+) have a known starting point in version control.
-- ============================================================================

-- ---- tables ----------------------------------------------------------------

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  name text,
  role text default 'agent',
  points integer default 0,
  theme_preference text default 'dark',
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.personal_tasks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  text text not null,
  completed boolean default false,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.leads (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  link text,
  status text not null,
  todo text not null,
  every text,
  follow_up_date text not null,
  assigned_agent_id uuid references auth.users on delete set null,
  assigned_agent_name text,
  "deletionRequest" jsonb,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  close_reason text,
  cold_status text,
  cold_start_date text,
  cold_check_history text[] default array[]::text[]
);

create table if not exists public.notes (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.leads on delete cascade not null,
  text text not null,
  author_id uuid references auth.users on delete set null,
  author_name text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.activity_logs (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.leads on delete cascade,
  agent_id uuid references auth.users on delete set null,
  action text not null,
  details text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.points_history (
  id uuid default gen_random_uuid() primary key,
  agent_id uuid references auth.users on delete cascade not null,
  agent_name text,
  amount integer not null,
  reason text not null,
  lead_id uuid references public.leads on delete set null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create table if not exists public.payout_requests (
  id uuid default gen_random_uuid() primary key,
  agent_id uuid references auth.users on delete cascade not null,
  agent_name text not null,
  points_requested integer not null,
  dollar_value numeric(10,2) not null,
  status text default 'pending' not null,
  admin_note text,
  requested_at timestamptz default timezone('utc'::text, now()) not null,
  processed_at timestamptz,
  processed_by uuid references auth.users on delete set null
);

create table if not exists public.agent_targets (
  id uuid default gen_random_uuid() primary key,
  agent_id uuid references auth.users on delete cascade not null,
  agent_name text not null,
  month date not null,
  gp_target numeric default 0,
  sales_target integer default 0,
  manual_new_gp numeric default 0,
  manual_return_gp numeric default 0,
  manual_sales_num integer default 0,
  manual_tp_gp numeric default 0,
  manual_tp_num integer default 0,
  manual_created_leads integer default 0,
  manual_taken_leads integer default 0,
  manual_total_leads integer default 0,
  manual_week1 numeric default 0,
  manual_week2 numeric default 0,
  manual_week3 numeric default 0,
  manual_week4 numeric default 0,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  unique(agent_id, month)
);

create table if not exists public.agent_strategies (
  id uuid default gen_random_uuid() primary key,
  agent_id uuid references auth.users on delete cascade not null,
  type text not null,
  content text not null,
  color text,
  checked boolean default false,
  "order" integer default 0,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- Added later in production but missing from DatabaseSetup.tsx. If your
-- project already has this table, these statements are a no-op.
create table if not exists public.useful_links (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  url text not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- ---- RLS -------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.personal_tasks  enable row level security;
alter table public.leads           enable row level security;
alter table public.notes           enable row level security;
alter table public.activity_logs   enable row level security;
alter table public.points_history  enable row level security;
alter table public.payout_requests enable row level security;
alter table public.agent_targets   enable row level security;
alter table public.agent_strategies enable row level security;
alter table public.useful_links    enable row level security;

grant all on public.profiles        to authenticated;
grant all on public.personal_tasks  to authenticated;
grant all on public.leads           to authenticated;
grant all on public.notes           to authenticated;
grant all on public.activity_logs   to authenticated;
grant all on public.points_history  to authenticated;
grant all on public.payout_requests to authenticated;
grant all on public.agent_targets   to authenticated;
grant all on public.agent_strategies to authenticated;
grant all on public.useful_links    to authenticated;

-- Baseline permissive policies (these are REPLACED in 0002_rls_tightening.sql)
do $$ begin
  drop policy if exists "Auth all" on public.personal_tasks;
  drop policy if exists "Auth all" on public.leads;
  drop policy if exists "Auth all" on public.notes;
  drop policy if exists "Auth all" on public.activity_logs;
  drop policy if exists "Auth all" on public.points_history;
  drop policy if exists "Auth all" on public.payout_requests;
  drop policy if exists "Auth all" on public.agent_targets;
  drop policy if exists "Auth all" on public.agent_strategies;
  drop policy if exists "Auth all" on public.useful_links;
end $$;

create policy "Auth all" on public.personal_tasks   for all using (auth.role() = 'authenticated');
create policy "Auth all" on public.leads            for all using (auth.role() = 'authenticated');
create policy "Auth all" on public.notes            for all using (auth.role() = 'authenticated');
create policy "Auth all" on public.activity_logs    for all using (auth.role() = 'authenticated');
create policy "Auth all" on public.points_history   for all using (auth.role() = 'authenticated');
create policy "Auth all" on public.payout_requests  for all using (auth.role() = 'authenticated');
create policy "Auth all" on public.agent_targets    for all using (auth.role() = 'authenticated');
create policy "Auth all" on public.agent_strategies for all using (auth.role() = 'authenticated');
create policy "Auth all" on public.useful_links     for all using (auth.role() = 'authenticated');

-- profiles has its own trio of policies (owner-only write)
do $$ begin
  drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
  drop policy if exists "Users can insert their own profile." on public.profiles;
  drop policy if exists "Users can update own profile." on public.profiles;
end $$;

create policy "Profiles are viewable by authenticated users" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "Users can insert their own profile."          on public.profiles
  for insert with check (auth.uid() = id);
create policy "Users can update own profile."                on public.profiles
  for update using (auth.uid() = id);
