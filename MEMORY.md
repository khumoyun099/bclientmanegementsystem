# Follow-Up CRM — System Memory

This document is a complete reference for the Follow-Up CRM system. Use it to understand the architecture, features, and codebase before adding or modifying anything.

---

## What This System Is

A **React 19 + Supabase lead management CRM** built for a travel/airline sales team. Agents use it to track client leads, schedule follow-ups, and log interactions. Admins use it to monitor agent performance, enforce cold lead compliance rules, and manage team strategy.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19.2.3, TypeScript 5.8.2 |
| Build Tool | Vite 6.2.0 (port 3000) |
| Backend / DB | Supabase (PostgreSQL + Auth + RLS) |
| Icons | Lucide React 0.561.0 |
| Styling | Tailwind CSS (dark theme, custom utility classes) |
| Deployment | Vercel (frontend), Supabase cloud (backend) |

**Environment variables required:**
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxx...
```

---

## File Structure

```
bclientmanegementsystem/
├── App.tsx                         # Root component — all top-level state, routing, filters
├── index.tsx                       # React entry point
├── types.ts                        # All TypeScript interfaces and enums
├── vite.config.ts                  # Vite config (port 3000, path alias @/*)
├── package.json
├── services/
│   ├── supabase.ts                 # Supabase client init (reads env vars)
│   └── db.ts                       # DBService class — all DB queries and business logic
└── components/
    ├── Layout.tsx                  # App shell: header, nav, footer
    ├── Auth.tsx                    # Login/signup page with hero landing
    ├── Dashboard.tsx               # Stats cards, growth metrics, points dashboard
    ├── LeadTable.tsx               # Main table with resizable columns, inline editing
    ├── LeadDetailModal.tsx         # Full lead editor modal
    ├── AddLeadModal.tsx            # New lead creation form
    ├── FollowUpCalendar.tsx        # Monthly calendar with drag-to-reschedule
    ├── MyTasks.tsx                 # Personal task sidebar (left panel)
    ├── PointsDashboard.tsx         # Points balance + transaction history
    ├── AccountabilityDashboard.tsx # Admin: violation tracking, team management
    ├── TeamStatsPage.tsx           # Admin: monthly performance tables (editable)
    ├── StrategyModal.tsx           # Notion-style roadmap editor per agent
    ├── Badge.tsx                   # TodoBadge, StatusBadge, FrequencyBadge
    └── DatabaseSetup.tsx           # Schema health check + SQL copy tool
```

---

## Database Schema (Supabase / PostgreSQL)

All tables have RLS enabled. Authenticated users have full access in current policy setup.

### `profiles`
Extends Supabase `auth.users`. Created automatically on first login.
```
id            UUID PK (references auth.users)
email         text
name          text
role          'agent' | 'admin'   (default: 'agent')
points        integer              (default: 0)
theme_preference  'system' | 'dark' | 'light'  (default: 'dark')
created_at    timestamp
```
> Role is auto-assigned on signup: if email contains "admin" → ADMIN, else → AGENT.

### `leads`
Core entity. Each lead is a client/prospect.
```
id                UUID PK
name              text (required)
link              text (optional CRM URL for the client record)
status            'hot' | 'warm' | 'cold' | 'progressive' | 'sold' | 'closed'
todo              'new' | 'followup' | 'callback' | 'sale'
every             '5'|'6'|'7'|'8'|'10'|'12' | null  (follow-up frequency in days)
follow_up_date    text (YYYY-MM-DD)
assigned_agent_id UUID (FK → auth.users)
assigned_agent_name text
deletionRequest   JSONB { status, requestedBy, requestedAt }
deal_value        numeric
customer_type     'new' | 'return' | null
tp_sold           boolean
tp_value          numeric
lead_source       'created' | 'taken'
close_reason      text
cold_status       'Unreached' | 'Unresponsive'
cold_start_date   text (YYYY-MM-DD)
cold_check_history  text[]  (array of dates agent checked in)
created_at        timestamp
updated_at        timestamp
locked            boolean
```

### `notes`
Activity thread per lead.
```
id          UUID PK
lead_id     UUID FK → leads (cascade delete)
text        text
author_id   UUID FK → auth.users
author_name text
created_at  timestamp
```

### `activity_logs`
Admin-only audit trail.
```
id        UUID PK
lead_id   UUID FK → leads (cascade delete)  [also used as agent_id for admin_warning entries]
agent_id  UUID FK → auth.users
action    'note_added' | 'date_changed' | 'status_changed' | 'created' | 'rule_violation' | 'reassigned' | 'admin_warning'
details   text
created_at timestamp
```
> `admin_warning` entries: lead_id = target agent's user id, agent_id = admin who issued it

### `useful_links`
Per-user bookmarks (migrated from localStorage to Supabase).
```
id          UUID PK default gen_random_uuid()
user_id     UUID FK → auth.users (cascade delete)
name        text
url         text
created_at  timestamptz default now()
```
> RLS: users can only see/manage their own links. SQL: `create policy "Users manage own links" on useful_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`

### `personal_tasks`
Per-user task list (left sidebar).
```
id          UUID PK
user_id     UUID FK → auth.users
text        text
completed   boolean (default false)
created_at  timestamp
```

### `points_history`
Transaction log for the gamification system.
```
id          UUID PK
agent_id    UUID FK → auth.users (cascade delete)
agent_name  text
amount      integer (positive = credit, negative = payout deduction)
reason      text
lead_id     UUID FK → leads (optional)
created_at  timestamp
```

### `payout_requests`
Agent requests to convert points to USD.
```
id                UUID PK
agent_id          UUID FK → auth.users
agent_name        text
points_requested  integer
dollar_value      numeric(10,2)
status            'pending' | 'approved' | 'denied'
admin_note        text
requested_at      timestamp
processed_at      timestamp
processed_by      UUID
```

### `agent_targets`
Monthly performance targets set by admin.
```
id               UUID PK
agent_id         UUID FK → auth.users
agent_name       text
month            date (YYYY-MM-DD, 1st of month)
gp_target        numeric
sales_target     integer
tp_target        numeric
tp_number_target integer
manual_new_gp, manual_return_gp, manual_sales_num   numeric/integer
manual_tp_gp, manual_tp_num                         numeric/integer
manual_created_leads, manual_taken_leads, manual_total_leads  integer
manual_week1/2/3/4  numeric
created_at       timestamp
UNIQUE(agent_id, month)
```

### `agent_strategies`
Notion-style blocks for agent growth roadmap.
```
id          UUID PK
agent_id    UUID FK → auth.users
type        'h1'|'h2'|'bullet'|'number'|'todo'|'quote'|'divider'|'sticker'
content     text
color       text (for sticker blocks)
checked     boolean (for todo blocks)
order       integer (drag-to-reorder; may be missing — handle gracefully)
created_at  timestamp
```

---

## User Roles

### AGENT
- Sees only their own leads
- Can create leads, edit status/dates/todo/notes/frequency
- Cannot edit lead name or link (locked)
- Can request lead deletion (soft delete, admin must approve)
- Has personal tasks sidebar
- Sees own points and history
- No access to Supervisor dashboard

### ADMIN
- Sees all agents' leads
- Can filter leads by agent (dropdown)
- Can directly delete leads
- Can edit all lead fields
- Has Supervisor tab with:
  - Accountability Dashboard (violations, overdue tracking)
  - Team Stats (editable monthly performance tables)
  - Team management (role changes)
  - Strategy Portal (edit any agent's roadmap)

---

## Application Pages (Routing)

Routing is state-based — no React Router. `activePage` state in `App.tsx` controls which view renders.

| `activePage` value | Who can see | What it shows |
|---|---|---|
| `'dashboard'` | Both | Stats cards, growth metrics, points dashboard |
| `'crm'` | Both | My Space — lead table, calendar, tasks |
| `'supervisor'` | ADMIN only | Accountability, team stats, strategy portal |
| `'setup'` | Both | SQL schema, table health check, admin promotion |

---

## CRM Portal (My Space) — Detailed

This is the main view. Layout: `lg:grid-cols-5` — MyTasks (col-span-1 left) + MySpace (col-span-4 right).

### Filter Bar (Admin)
- **Agent dropdown**: Fixed `w-40`, filters leads by `assigned_agent_id`
- **Date range**: From/To date pickers filtering by `lead.created_at` date (YYYY-MM-DD prefix match, inclusive)
- **Useful Links dropdown**: Stored in localStorage, accessible to all

### Filter Bar (Agent)
- **Date range**: Same From/To pickers as above
- **Useful Links dropdown**: Same

### Search Bar
- Single text input, real-time filtering
- Matches: `lead.name` (case-insensitive) OR `lead.link` (case-insensitive)
- Appears above the status tabs

### Status Tabs
HOT | WARM | COLD | PROGRESSIVE | SOLD | CLOSED — counts shown per tab

### Lead Table Columns (vary by tab)
| Column | HOT | WARM | COLD | PROGRESSIVE | SOLD | CLOSED |
|---|---|---|---|---|---|---|
| Name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Link (CRM button) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Priority (status) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| To-Do | ✓ | ✓ | — | ✓ | — | — |
| Frequency | — | ✓ | — | ✓ | — | — |
| Follow-Up Date | ✓ | ✓ | — | ✓ | — | — |
| Cold Status | — | — | ✓ | — | — | — |
| 4-Day Checkboxes | — | — | ✓ | — | — | — |
| Notes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Agent (admin only) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Logs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Columns are **Notion-style resizable** via drag handles. `LeadRow` is memoized for performance.

### Scheduled Leads (Hidden Until Date)
Leads with `todo === 'followup'` AND `follow_up_date > today` are hidden from HOT/WARM/COLD/PROGRESSIVE tabs until their follow-up date arrives.

### Sorting Logic
- PROGRESSIVE tab: sorted by frequency (ascending, "MANUAL" = 0)
- Admin view (no agent filter): sorted alphabetically by `assigned_agent_name`
- Default: ordered by `follow_up_date` ascending (from DB query)

---

## Lead Statuses — Business Logic

| Status | Purpose | Special Rules |
|---|---|---|
| HOT | Immediate priority | Shown at top, counts in "Priority Hot" stat |
| WARM | Ongoing relationship | Needs follow-up frequency set |
| COLD | Long-term prospect | Cold compliance rules enforced (see below) |
| PROGRESSIVE | Scheduled cadence | Sorted by frequency, requires `every` field |
| SOLD | Completed deal | Hidden from calendar |
| CLOSED | Archived / lost | Requires `close_reason`, hidden from calendar |

### Cold Compliance Rule
- Agent must record check-ins in `cold_check_history` (one per day)
- System checks: `cold_check_history.length >= min(4, elapsedDays + 1)` since `cold_start_date`
- If insufficient: flagged as a **violation** in the Accountability Dashboard
- Admin sees violation count per agent on their card

---

## Data Flow

### Filter Pipeline
```
leads[] (from Supabase)
  → filter by selectedAgentFilter (admin only, by assigned_agent_id)
  → filter by dateFrom (created_at >= dateFrom)
  → filter by dateTo (created_at <= dateTo)
  → filter by searchQuery (name or link contains query)
  → [agentFilteredLeads — used for tab counts and calendar]
  → filter by activeTab (status === tab)
  → filter scheduled leads (hide future followups)
  → sort (by frequency / agent name / default)
  → [tableLeads — passed to LeadTable]
```

### Optimistic Update Pattern (used throughout)
1. Call `patchLeadLocally(leadId, changes)` → updates `leads` state immediately (instant UI)
2. Call `db.updateLead(leadId, changes, user)` → async DB write
3. Call `refreshData()` after 600ms delay → syncs state with DB
4. On error → immediate `refreshData()` to revert

### New Lead Creation
1. AddLeadModal submits → `db.addLead()` → inserts to `leads`
2. Optional initial note → `db.addNote()`
3. `refreshData()` → reloads all leads

---

## Services Layer (db.ts)

All DB access goes through `DBService` class exported as `db`.

**Key methods:**
```typescript
// Profiles
db.getCurrentProfile()                           → User
db.getAllProfiles()                               → User[]
db.promoteToAdmin(userId)
db.updateThemePreference(userId, theme)

// Leads
db.getLeads(user)                                → Lead[]   (filters by agent if not admin)
db.addLead(data, user)                           → Lead
db.updateLead(leadId, updates, user)
db.deleteLead(leadId)
db.requestDeletion(leadId, user)
db.handleDeletionRequest(leadId, approve)

// Notes & Logs
db.addNote(leadId, text, user)
db.logActivity(leadId, agentId, action, details)
db.getActivityLogs()                             → ActivityLog[]  (last 100)

// Points
db.awardPoints(agentId, agentName, amount, reason, leadId?)
db.getPointsHistory(agentId)                     → PointsHistory[]

// Payouts
db.getPayoutRequests(admin)                      → PayoutRequest[]
db.processPayoutRequest(requestId, action, adminId, note?)

// Tasks
db.getPersonalTasks(userId)                      → PersonalTask[]
db.addPersonalTask(userId, text)
db.completePersonalTask(taskId)

// Targets
db.setAgentTarget(target)

// Useful Links
db.getUsefulLinks(userId)                        → UsefulLink[]
db.addUsefulLink(userId, name, url)              → UsefulLink
db.deleteUsefulLink(id)

// Accountability / Admin
db.bulkReassignLeads(leadIds, newAgentId, newAgentName, adminId, oldAgentName)
db.logAdminWarning(agentId, warningText, adminId)
db.getAgentWarnings(agentId)                     → number
db.getFullActivityLogs()                         → ActivityLog[]  (last 5000)
db.getActivityLogs()                             → ActivityLog[]  (last 100, used in App.tsx)
db.bulkReassignLeads(ids, newId, newName, adminId, oldName)  → groups by source in handleReassign

// Utilities
db.checkTableExists(tableName)                   → boolean
getTodayString()                                 → 'YYYY-MM-DD'
```

---

## State in App.tsx

All top-level state lives in `App.tsx`. Key state variables:

```typescript
currentUser: User | null          // Logged-in user profile
allUsers: User[]                  // All team profiles (admin only)
session: Session | null           // Supabase auth session
loading: boolean                  // Initial auth/data load
dbError: string | null            // 'SCHEMA_MISSING' triggers setup page
activePage: string                // 'dashboard' | 'crm' | 'supervisor' | 'setup'
theme: string                     // 'dark' | 'light' | 'system'
leads: Lead[]                     // All leads visible to current user
isAddModalOpen: boolean
selectedLeadId: string | null     // Controls LeadDetailModal
activeTab: LeadStatus             // Current CRM status tab
selectedAgentFilter: string|null  // Admin filter by agent ID
dateFrom: string                  // Date range filter start (YYYY-MM-DD)
dateTo: string                    // Date range filter end (YYYY-MM-DD)
searchQuery: string               // Search bar text
usefulLinks: UsefulLink[]         // Stored in localStorage
showUsefulLinksDropdown: boolean
showAddLinkModal: boolean
```

**Key computed values (useMemo):**
- `agentFilteredLeads` — leads after all filters (agent, date range, search)
- `tableLeads` — further filtered by tab + scheduled lead rules + sorted
- `currentSelectedLead` — lead matching `selectedLeadId`

---

## TypeScript Types (types.ts)

```typescript
enum Role { AGENT = 'agent', ADMIN = 'admin' }

enum LeadStatus { HOT='hot', WARM='warm', COLD='cold', PROGRESSIVE='progressive', SOLD='sold', CLOSED='closed' }

enum TodoStatus { NEW='new', FOLLOWUP='followup', CALLBACK='callback', SALE='sale' }

type EveryFreq = '5'|'6'|'7'|'8'|'10'|'12'

interface User { id, email, name, role: Role, points, theme_preference, created_at }

interface Lead {
  id, name, link?, notes: Note[], status: LeadStatus, todo: TodoStatus,
  every?: EveryFreq | null, follow_up_date: string,
  assigned_agent_id, assigned_agent_name?,
  created_at, updated_at, locked: boolean,
  deletionRequest?, deal_value?, customer_type?, tp_sold?, tp_value?,
  lead_source?, close_reason?, cold_status?, cold_days?, cold_start_date?,
  cold_check_history?
}

interface Note { id, text, created_at, author_id, author_name }

interface ActivityLog { id, lead_id, agent_id, action, details, created_at }

interface PointsHistory { id, agent_id, agent_name, amount, reason, lead_id?, created_at }

interface PayoutRequest { id, agent_id, agent_name, points_requested, dollar_value, status, admin_note?, requested_at, processed_at?, processed_by? }

interface AgentTarget { id, agent_id, agent_name, month, gp_target, sales_target, tp_target, tp_number_target, manual_new_gp, manual_return_gp, manual_sales_num, manual_tp_gp, manual_tp_num, manual_created_leads, manual_taken_leads, manual_total_leads, manual_week1/2/3/4, created_at }

interface StrategyItem { id, agent_id, type: StrategyItemType, content, checked?, color?, order, created_at? }
```

---

## Styling Conventions

- **Dark theme by default** — all backgrounds are dark (`#111`, `#202020`, `bg-white/5`, etc.)
- **Light mode support** — toggled via HTML class, Tailwind `dark:` prefix used
- **Brand color** — `brand-500` (orange accent)
- **Custom CSS classes:**
  - `.glass` — frosted glass card (backdrop-blur + semi-transparent border)
  - `.mesh-bg` — gradient background (auth page)
  - `.dashboard-card` — standard card styling
  - `.custom-scrollbar` — dark-styled scrollbars
  - `.animate-fade-in`, `.animate-scale-in`, `.animate-slide-up` — entrance animations
  - `.transition-standard` — consistent hover transitions
- **Layout max-width:** `max-w-[1920px]` with `px-4` padding

---

## Authentication Flow

1. **Supabase email/password auth** — `supabase.auth.signInWithPassword()`
2. `onAuthStateChange` listener in `App.tsx` detects session
3. `getCurrentProfile()` fetches or creates profile from `profiles` table
4. If no profile: auto-creates with role based on email (`"admin"` in email → ADMIN)
5. Logout: `supabase.auth.signOut()` → session cleared → shows Auth page

---

## Points & Gamification System

- **Award**: Admin (or system) calls `db.awardPoints()` → inserts `points_history` + increments `profiles.points`
- **Balance**: Shown in header (coin icon) and `PointsDashboard`
- **Value**: `points / 10` = estimated USD value (display only)
- **Tiers**: >1000 points = "Pro", else "Rookie"
- **Payout**: Agent submits request → admin approves/denies → if approved, negative `points_history` entry inserted + balance deducted

---

## Useful Links

- Stored in **Supabase** (`useful_links` table) — migrated from localStorage
- Each link: `{ id, user_id, name, url, created_at }`
- Loaded on login via `db.getUsefulLinks(userId)`, added via `db.addUsefulLink()`, deleted via `db.deleteUsefulLink()`
- Shown in dropdown in filter bar (both admin and agent views)
- Auto-prefixes `https://` if no protocol detected
- Delete on hover (X button)
- Per-user (RLS enforced)

---

## Calendar

- Monthly grid view (`FollowUpCalendar.tsx`)
- Groups leads by `follow_up_date` (YYYY-MM-DD)
- **Excludes** cold, closed, and sold leads
- Color coding: hot=red, warm=orange, progressive=purple, others=gray
- Drag-to-reschedule: updates `follow_up_date` via `db.updateLead()`
- Navigate with prev/next month buttons + "Today" reset
- Today's date highlighted in red

---

## Accountability Dashboard (Admin Only)

### Agent Cards (2-column grid)
- Color-coded border: **red** = has violations, **yellow** = at-risk (follow-up due within 2 days), **green** = clean
- Pulsing status dot + agent name/email + warning count badge
- 4 metric badges: Overdue | Stale | Rescheduled | Missing Freq
- Action buttons per card: Strategy Portal, View Problem Leads, Add Warning

### Violation Detection (all skip sold/closed leads)
- **Overdue**: `follow_up_date < today`
- **Stale**: no note (or lead created) in 10+ days
- **Rescheduled**: 3+ consecutive `date_changed` logs with no `note_added` between them
- **Missing Freq**: warm/progressive lead with `every` not set
- **Cold violation**: `cold_check_history.length < min(4, elapsedDays+1)`

### Cold Rule Violation Detection
```
elapsedDays = today - cold_start_date
expectedChecks = min(4, elapsedDays + 1)
actualChecks = cold_check_history.length
violated = actualChecks < expectedChecks
```

### Problem Leads Expansion Table (inline below card, multiple cards expandable)
- State: `expandedAgentIds: Set<string>` (allows multiple open at once)
- Columns: checkbox | Lead | Violation tags | Inactive For | Last Note | Follow-up
- "Inactive For": days since last note, color-coded (0-5=yellow, 6-10=orange, 11+=red bold)
- Checkboxes: `w-5 h-5 accent-orange-500 cursor-pointer`

### Cross-Agent Bulk Reassignment (floating bottom bar)
- Appears when any lead is checked: `fixed bottom-0 z-50 bg-gray-900 animate-slide-up`
- Bar: lead count | agent dropdown | Reassign button | Clear selection
- `handleReassign` groups by `assigned_agent_name`, calls `db.bulkReassignLeads()` per group
- Works across multiple agent cards simultaneously

### Admin Warning System
- "Add Warning" → modal with textarea → logs `activity_logs` with `action='admin_warning'`, `lead_id=agentId`
- Warning counts fetched via `db.getAgentWarnings(agentId)` on mount

### Preserved features
- **"Strategy Portal"** button → opens `StrategyModal` for that agent
- **"Manage Team"** toggle → user list with role-change buttons
- Click card → shows `LeadTable` with agent's violated/ignored leads

---

## Strategy Modal (Notion-Style Editor)

- Per-agent document with block-based editing
- **Block types:** h1, h2, bullet, number, todo (checkbox), quote, divider, sticker (colored tag)
- Slash command (`/`) opens block-type picker with arrow key navigation
- Drag-to-reorder (requires `order` column in `agent_strategies`)
- If `order` column missing: shows warning banner with SQL fix, falls back to `created_at` sort
- Auto-saves to Supabase on each change

---

## Team Stats Page (Admin Only)

- Month picker
- 4 sections:
  1. **Monthly Performance Actuals** — click blue cells to inline-edit
  2. **Weekly GP Tracking** — week1 through week4 per agent
  3. **Targets & Progress** — target values vs. % accomplished
  4. **Team Total** — aggregate row (highlighted)
- All manual input values saved to `agent_targets` table

---

## Dashboard Metrics

- **Active Leads**: Total non-closed, non-sold leads
- **Priority Hot**: Count of HOT leads
- **Pipeline Due**: Leads with `follow_up_date <= today`
- **Conversion**: Sold / (Sold + Closed) percentage
- **Growth Metrics**: Leads created Today / Last 3 days / Last 6 days / Last 10 days (using `created_at`)
- **Points Dashboard**: Balance, estimated value, recent transaction feed

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Missing DB tables | `checkTableExists()` returns false → shows `DatabaseSetup` page |
| Missing `order` column in strategies | Warning banner shown, drag disabled, sorts by `created_at` |
| `personal_tasks` table missing | MyTasks shows "DATABASE OFFLINE…" placeholder |
| RLS / network failure | Alert shown, immediate `refreshData()` to revert optimistic update |
| Missing Supabase env vars | `isSupabaseConfigured = false`, shows setup prompt |
| Component crash | `<ErrorBoundary>` wraps Dashboard, LeadTable, FollowUpCalendar, AccountabilityDashboard, TeamStatsPage — shows "Something went wrong" with Refresh button |

## Notifications

- `react-hot-toast` is installed and used throughout
- `<Toaster position="top-right" />` rendered inside `<Layout>` in App.tsx
- Use `toast.success(...)` and `toast.error(...)` for all user-facing feedback

## Testing

- **Framework**: Vitest + @testing-library/react + @testing-library/jest-dom
- **Config**: `vite.config.ts` has `test: { environment: 'jsdom', globals: true, setupFiles: ['./tests/setup.ts'] }`
- **Scripts**: `npm run test` (single run), `npm run test:watch`
- **Test files** in `tests/`:
  - `coldCompliance.test.ts` — 6 tests for cold day tracking logic
  - `optimisticUpdate.test.ts` — 2 tests for optimistic update + rollback pattern
- Run tests before pushing features that touch `cold_check_history` or `patchLeadLocally`

---

## Important Conventions When Adding Features

1. **New DB queries** → add method to `DBService` in `services/db.ts`
2. **New types/interfaces** → add to `types.ts`
3. **Optimistic updates** → always update local state before DB write, refresh on error
4. **Admin-only UI** → gate with `currentUser.role === Role.ADMIN`
5. **New filters** → apply in `agentFilteredLeads` useMemo in `App.tsx`
6. **New columns in LeadTable** → check which tabs need it, update `LeadTable.tsx` column logic
7. **Date format** → always YYYY-MM-DD strings, use `getTodayString()` for today
8. **New state** → add `useState` in `App.tsx`, pass as props to children
9. **Useful links** → localStorage only (not Supabase)
10. **No direct commits to `main`** — always use a feature branch
