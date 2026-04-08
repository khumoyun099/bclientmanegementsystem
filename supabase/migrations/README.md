# Supabase migrations

Versioned SQL migrations for the Follow-up CRM database. Each file is
idempotent (safe to re-run) and carries an in-file ROLLBACK block.

## Apply order

Always run them in numeric order.

| # | File | Risk | Effect |
|---|---|---|---|
| 0001 | `0001_initial_baseline.sql` | none | Reference snapshot of the schema already shipped by `components/DatabaseSetup.tsx`. No-op on an existing project. |
| 0002 | `0002_rls_tightening.sql` | **medium** | Replaces permissive `FOR ALL` policies with role-aware ones. Agents see only their own leads. Admins see everything. |
| 0003 | `0003_indexes_and_constraints.sql` | low | Adds performance indexes + enum CHECK constraints (as NOT VALID — see file). |
| 0004 | `0004_audit_triggers.sql` | low | Adds a trigger that writes `activity_logs` on every meaningful UPDATE/DELETE of leads. Also relaxes the `activity_logs.lead_id` FK to `ON DELETE SET NULL` so the audit trail survives deletions. |
| 0005 | `0005_award_points_rpc.sql` | none | Adds `award_points` and `process_payout_request` RPCs. The client already prefers these and falls back to the legacy path if missing. |

## Pre-flight for 0002 (RLS tightening)

Read the top of `0002_rls_tightening.sql` first. The safe rollout is:

1. Apply 0001 → 0005 to a **Supabase branch** or a staging project.
2. Smoke-test as an agent account and as an admin account.
3. Verify:
   - Agent sees only their own leads in the CRM page.
   - Admin sees everyone via the Accountability dashboard.
   - `addLead`, `updateLead`, reassign, and bulk delete all succeed.
   - Notes and activity_logs read/write correctly.
4. Only then apply to production, ideally during low traffic.

## Cleaning up legacy data before validating CHECK constraints

`0003` adds the CHECK constraints as `NOT VALID` so the migration can't
fail on legacy rows. To promote them to fully enforced:

```sql
-- Find offending rows first:
select id, status from public.leads
 where status not in ('hot','warm','cold','progressive','sold','closed');

select id, todo from public.leads
 where todo not in ('new','followup','callback','sale');

select id, role from public.profiles
 where role not in ('agent','admin');

-- Fix with lower() or targeted UPDATEs, then:
alter table public.leads validate constraint leads_status_check;
alter table public.leads validate constraint leads_todo_check;
alter table public.profiles validate constraint profiles_role_check;
alter table public.payout_requests validate constraint payout_requests_status_check;
```

## Rollback

Every migration file ends with a commented-out ROLLBACK block. To revert,
uncomment and run in a SQL editor. Rollbacks are ordered: revert the
highest-numbered migration you applied first.
