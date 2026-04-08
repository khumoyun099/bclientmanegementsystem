# Pulse — AI Coaching Layer

Isolated vertical-slice feature. Everything Pulse-related lives in this
folder. The rest of the app only touches Pulse through the barrel export
at `features/pulse/index.ts`.

## What it does

Watches every active lead and surfaces the ones that need attention today,
ranked by neglect risk against each lead's own rhythm. Replaces the
generic stat-card Dashboard with a Pulse-centric one that works for both
agents and admins.

Built in phases:

- **Pulse-0** — database schema + deterministic signals + client plumbing
- **Pulse-1** — Dashboard rewrite with KPI strip + Pulse feed + Playbook
  editor. Rules only, no AI narration yet. **← first PR**
- **Pulse-2** — `pulse-generate-insight` edge function adds AI one-liners
  to each Pulse item (reads the active playbook from Pulse-0).
- **Pulse-3** — `pulse-generate-briefing` edge function writes a daily
  morning briefing per agent. Cron at 06:00 local.
- **Pulse-4** — Admin filter + team health section + regenerate button.
- **Pulse-5** — Thumbs up/down feedback loop for prompt tuning.

## Folder layout

```
features/pulse/
├── README.md                   ← this file
├── index.ts                    ← PUBLIC API (only symbols external code imports)
│
├── components/                 ← React UI, all internal
│   ├── PulseDashboard.tsx      (exported via barrel)
│   ├── PlaybookEditor.tsx      (exported via barrel)
│   ├── KpiStrip.tsx
│   ├── PulseFeed.tsx
│   ├── PulseSection.tsx
│   ├── PulseItem.tsx
│   ├── MorningBriefing.tsx     (Pulse-3 stub)
│   └── AdminAgentFilter.tsx
│
├── hooks/
│   ├── usePulseFeed.ts
│   ├── usePlaybook.ts
│   └── usePulseBriefing.ts     (Pulse-3 stub)
│
├── services/
│   └── pulseApi.ts             ← all Supabase reads; never leaks outside
│
├── lib/
│   ├── leadRules.ts            ← extracted from AccountabilityDashboard
│   └── categorize.ts           ← rule → category (mirrors SQL)
│
├── types/
│   └── pulse.types.ts
│
├── prompts/                    ← canonical source; synced to supabase/functions/
│   ├── playbook.default.md     ← seeded by migration
│   ├── briefing.system.md      (Pulse-3)
│   ├── briefing.user.md        (Pulse-3)
│   ├── insight.system.md       (Pulse-2)
│   └── insight.user.md         (Pulse-2)
│
├── db/
│   └── 0006_pulse.sql          ← canonical; sync to supabase/migrations/0006_pulse.sql
│
└── functions/                  ← canonical; sync to supabase/functions/
    └── (populated in Pulse-2)
```

## Public API rule

Only `features/pulse/index.ts` may be imported from outside the feature.
**Do not** `import { foo } from 'features/pulse/hooks/usePulseFeed'` from
`App.tsx` or any file outside `features/pulse/`. Go through the barrel.

## Source-of-truth split (Supabase)

Supabase CLI expects migrations in `supabase/migrations/` and edge
functions in `supabase/functions/`. The canonical source lives here;
copies in `supabase/` are kept in sync manually for the first PR. A
build script (`scripts/sync-pulse-supabase.mjs`) will automate this
in a later phase.

## Deleting Pulse

To remove the feature entirely:
1. Drop the `pulse_*` tables and functions (see rollback in
   `supabase/migrations/0006_pulse.sql`)
2. Remove `features/pulse/`
3. Restore the original `components/Dashboard.tsx`
4. Remove `@pulse` aliases from `vite.config.ts` and `tsconfig.json`

No other files in the app will break — the barrel export contains the
blast radius.
