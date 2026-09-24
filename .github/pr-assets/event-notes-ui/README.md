# Event notes: public and private notes redesign

These images show the public and private note pages of an incident, rendered by the offline
Playwright fixture in `packages/E2E/EventNotes/Fixture`. The before/after page images were
taken with the browser clock pinned to 2026-09-14 18:20 UTC; the two composer close-ups with
the real clock. Every incident, person and note in them is fabricated for the fixture's
"Acme Commerce" workspace; no customer data appears.

The "before" images are the same fixture and data with the note pages from `master`
(the `ModelTable` list with a create modal); the "after" images are this branch
(`Components/EventNotes`).

- `before-public-desktop.png` / `after-public-desktop.png`: Incidents > View > Public
  Notes at 1440px.
- `before-private-desktop.png` / `after-private-desktop.png`: Private Notes at 1440px.
- `before-public-phone.png` / `after-public-phone.png`: Public Notes at 390px.
- `after-composer-templates.png`: the inline composer with a draft and the template menu
  open.
- `after-edit-inline.png`: a public note being edited in place, with its attachments and
  the "Notify subscribers about this update" choice.

`cd packages/E2E && npm run test-event-notes-ui` regenerates the "after" page images under
`output/playwright/event-notes-ui/`.
