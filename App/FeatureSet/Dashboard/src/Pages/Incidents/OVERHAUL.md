# Incident / Alert / Scheduled-Maintenance — Linear-like Overhaul

Tracking doc for the redesign that makes the incident, alert, and scheduled-maintenance
pages world-class and Linear-like. Full design rationale, wireframes and the diagnosis
live in the design proposal; this file tracks the **engineering** rollout and what has
actually landed on the `feature/incident-pages-linear-overhaul` branch.

## Thesis

**Replace the shell, not the engine.** The data layer (`BaseModelTable` with saved views,
URL-persisted facets, bulk actions, `/`-to-search; `EventStatusPanel`; `Realtime.ts`) is
strong. The problem is the card-and-modal, one-route-per-facet **shell**. We keep the
engine and rebuild the shell around it.

---

## Shipped in this branch (Phase 0 + interaction foundation)

- **Command palette (⌘K)** — `Components/CommandPalette/CommandPalette.tsx`, mounted in
  `App.tsx`. Fuzzy-search navigation across the product plus **Create** actions (Declare
  incident, Create alert); ↑↓ to move, ↵ to open, esc to close. `⌘K` was reclaimed from
  the NavBar product switcher, which now opens on `⌘/`
  (`Common/UI/Components/Navbar/NavBar.tsx`). Other components can open the palette by
  dispatching `OPEN_COMMAND_PALETTE_EVENT`.
- **"Go to" navigation chords** — `g` then a key jumps (`g i` incidents, `g a` alerts,
  `g m` maintenance, `g o` on-call, `g h` home). Fire only on page chrome, never while
  typing.
- **Keyboard shortcut cheat-sheet (`?`)** — bundled in the command palette component.
- **Inline title editing on all three detail pages** — the record title is an
  `InlineEditField` at the top of the incident, alert and scheduled-maintenance overviews
  (`Pages/Incidents/View/Index.tsx`, `Pages/Alerts/View/Index.tsx`,
  `Pages/ScheduledMaintenanceEvents/View/Index.tsx`): click to rename, optimistic save via
  `ModelAPI.updateById`, rollback + toast on failure. No modal, no Save button.
- **`EventDetailLayout`** — `Components/EventView/EventDetailLayout.tsx`. The shared header
  chassis (state/action panel + full-width eyebrow + inline title + actions slot), adopted
  by all three event detail pages. First step of the one-page detail; grows to own the
  body + right rail next.
- **Investigation content inline on the incident overview** — Description, Root Cause
  (with its metric chart) and Remediation now render as editable cards on
  `Pages/Incidents/View/Index.tsx` instead of three separate routes.
- **Sidebar teardown (started) + deep-link redirects** — the Description, Root Cause and
  Remediation items are removed from the incident detail sidebar
  (`Pages/Incidents/View/SideMenu.tsx`), and their route components now render
  `<Navigate replace>` to the overview (`View/Description.tsx`, `View/RootCause.tsx`,
  `View/Remediation.tsx`), so old bookmarks / Slack links / breadcrumbs land on the
  content in its new inline home. This establishes the redirect pattern to extend to the
  rest of the 18-item sidebar.
- **Dense triage list + PeekView (incidents & alerts)** — a keyboard-first triage lane at
  `/incidents/triage` and `/alerts/triage`, reachable from each side menu and the command
  palette. Compact one-line rows (severity dot · number · title · state pill · age);
  selecting a row peeks its detail beside the list via the reusable
  `Components/EventView/PeekView.tsx` instead of navigating away. Keyboard: `j/k` move,
  `a` acknowledge, `r` resolve, `↵` open full, `esc` close. Additive — the existing
  All/Active tables are untouched.
- **`EventTriage` (shared, config-driven)** — `Components/EventView/EventTriage.tsx` holds
  all the triage logic once; `Components/Incident/IncidentTriage.tsx` and
  `Components/Alert/AlertTriage.tsx` are thin adapters that map their model's fields onto
  the config. This is the unification pattern the overhaul is built on (one component,
  many event types) applied for real.
- **Bulk Acknowledge / Resolve** — first-class one-click triage verbs on the incident and
  alert tables (`Components/Incident/IncidentsTable.tsx`,
  `Components/Alert/AlertsTable.tsx`), shown only when the project defines an acknowledged
  / resolved state.
- **Faster, idempotent bulk state change** — the old sequential `getItem → create` loop
  (O(2N) round-trips) now runs in parallel via `Promise.all`, and an item already at or
  past the target state is a **success no-op** instead of a "Skipped" failure.
- **`InlineEditField`** — `Common/UI/Components/InlineEdit/InlineEditField.tsx`. The
  click-to-edit, optimistic, no-Save-button primitive the new detail header will use.
  Commits optimistically, rolls back on failure with a loud error toast.
- **Copy fix** — "before the event is begins" → "before the event begins" (3 files).

---

## Next phases (not yet built)

**Phase 1 — finish the interaction layer**
- Central `useHotkeys` registry with a focus-scope contract (single keys fire only on
  list/record chrome, never in a text field) and `Undo` toasts on every mutation.
- Extend the command palette to server-search incidents/alerts and expose actions
  (assign, change state, post update). Note: there is no client store, so palette entity
  search is server-backed, not instant-in-memory.

**Phase 2 — shared Event core**
- Generic `ChangeEventState`, `EventFeed`, and a config-driven `EventTable` collapsing
  `IncidentsTable` + `AlertsTable` behind a capability registry
  (`hasStatusPage`, `hasPostmortem`, `hasRoles`, `hasSla`, `hasSeverity`, `isTimeboxed`).
- Dense list `ShowAs` mode + a de-modalized `PeekView` wired to list selection.

**Phase 3 — the headline: one-page detail**
- `EventDetailLayout` = sticky header (inline-editable severity/status/owners + one
  stateful primary action) + composer + unified activity timeline + right rail +
  collapsible sections. Retire the 18-item `View/SideMenu.tsx`, `Sla.tsx`, and the
  markdown subpages **behind deep-link redirects + section-level permission gating**.
- Point Alerts and Maintenance at the same layout via capability flags; delete the
  `Pages/Alerts/View/*` clone.

**Phase 4 — maintenance authoring + depth**
- Single-screen maintenance authoring with live banner preview, timezone selector,
  duration presets, native recurrence, merged status-page control, per-state comms
  composer, and alert-suppression tied to the window.
- Live telemetry rendered **inside** the incident (failing chart, deploy marker, error
  logs) — the differentiator no competitor can copy.

**Foundational tracks (run in parallel)**
- Realtime: add `enableRealtimeEventsOn` + per-room read-permissions to the
  ScheduledMaintenance model and every timeline/feed/note model.
- Optimistic cache: a small client mutation/rollback layer keyed off realtime deltas.
- Tokens + dark mode: replace the un-configured Tailwind CDN build with a real build that
  supports `darkMode` + CSS-var tokens.

## Risk to respect

`ModelTable` is imported by ~254 files and `CardModelDetail` by ~110. **Extend** them
(new `ShowAs`, an editable `Detail` sibling) — do not rip them out.
