# Saved and scheduled hunts, and events kept on a case

These images show what this change adds to Security Events: Hunts (searches over security events
saved with a name, opened again in one click or run on a schedule that tells people when they find
something) and keeping events on a case's Evidence page. Each one is the real production page
rendered offline by a Playwright fixture in `packages/E2E`, on synthetic data for a made-up "Acme
Commerce" workspace: every name, domain and address is fabricated, and each fixture's header marks
the workspace as synthetic. Captured at 2x, with the fixtures' own clocks.

## Before and after

The `-before` images are master's code, the `-after` images this branch's, on the same fixture,
page, size and data.

- `events-before.png` / `events-after.png`: Security Events → Events with one event (the empty
  states fixture, `?events=one`). After: Hunts in the side menu under Events, the toolbar's Hunts
  list beside the search (where Traces and Metrics keep their saved views), and a box on each row
  and Select all, for Bulk Actions → Add to Case.
- `event-panel-before.png` / `event-panel-after.png`: the same event opened. After: Add to Case
  beside Open Case.
- `events-390-before.png` / `events-390-after.png`: the Events page on a phone. The Hunts list
  wraps with the time range.
- `case-evidence-before.png` / `case-evidence-after.png`: CASE-138's Evidence page. After: an
  event kept on the case as it was read, with when it happened, its severity, kind and source,
  "Found by the hunt Encoded PowerShell" linking the hunt, and View Event.

## New pages and dialogs

- `hunts-list-1440.png`: Security Events → Events → Hunts: each hunt's search, how often it runs,
  who it tells, when it runs next and what its last run found - in red when it could not run, and
  why. Rows open the hunt's page (View); a hunt is edited there.
- `hunts-list-390.png`: the list on a phone: each hunt's schedule and last find under its name.
- `hunts-menu-1440.png`: the Events toolbar's Hunts list open: the project's hunts with their
  schedules, and + Save as Hunt locked, saying why, while nothing is searched.
- `hunts-save-as-hunt-1440.png`: Save as Hunt on `user:svc-backup`: what it saves (the search,
  its filters and its window) over the name, the schedule and who it tells, the saver already
  under Notify.
- `hunt-1440.png`: a hunt's page: what it is, how often it runs, who it tells and when it runs
  next, what its last run found with Show them, over the Events explorer on its search.
- `hunt-changed-1440.png`: the same with its search changed: Save Changes and Discard Changes.
- `hunt-390.png`: a hunt's page on a phone.
- `hunt-fa-1440.png`: a hunt's page in Persian, right to left; the hunt's own English words read
  as written.
- `hunts-add-to-case-1440.png`: Bulk Actions → Add to Case on two of a hunt's events: the open
  cases by number and title, CASE-138 picked.
- `hunts-view-event-1440.png`: View Event on a kept event: the event as OneUptime read it when it
  was kept.

Made by:

- `cd packages/E2E && CI=1 npm run test-security-operations-ui -- SecurityOperations/Hunts.spec.ts`
  (the new pages and dialogs: `output/playwright/security-operations-ui/hunts-*-synthetic.png`);
- the before and after pairs: master's `packages/` (from `git archive origin/master`) and this
  branch's, each serving `SecurityOperations/Fixture/server.js` and
  `SecurityEventsEmptyStates/Fixture/server.js`, shot at the same URL, size and clock by one
  Playwright script.
