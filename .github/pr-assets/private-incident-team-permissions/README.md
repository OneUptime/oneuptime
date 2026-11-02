# A private incident's owning team decides what its members may do (block 33)

How these were made: the production incident overview page (its layout, header, AI card,
feed and cards), bundled by `packages/E2E/EventOverview/Fixture/server.js` and drawn in
headless Chromium with the Dashboard's Tailwind runtime and the Inter font, 1280 pixels wide
unless named a phone (390 pixels, 2x). The fixture replaces only the API and the signed-in
person: `?private=1&role=view-only-owner&state=created` is the maintainer's case. Maya Chen is
on Incident Response, which may change every incident (Project Member), and on Checkout SRE,
which owns private incident #1042 and may only view (Viewer). `?role=editor-owner` gives
Checkout SRE Incident Member as well.

`before-*` is master at b261a1d991, built the same way with this PR's fixture (for its
`view-only-owner` role): the page offered every change, and the server took them through
Incident Response's permission. `after-*` is this PR after its UI review.

- `before-incident-1280.png` / `after-incident-1280.png`: the maintainer's page. Before:
  Acknowledge, Resolve, Add owner and every Edit offered. After: Acknowledge and Resolve
  locked, saying why ("This incident is private, so it is changed only with the permissions of
  the teams that own it, and Checkout SRE, your team that owns it, may not do this."), the
  Edits locked the same way, and no Add owner.
- `before-feed-actions.png` / `after-feed-actions.png`: the feed's Actions. Before: Add Public
  Note locked with "Use a private note." over an Add Private Note the server refused. After:
  both locked, and Add Public Note says only why - it points to no private note the reader
  cannot add.
- `before-ai-card.png` / `after-ai-card.png`: the AI card. Before: Try again and "Acknowledge
  this incident" offered, both refused by the server for this reader. After: the questions only.
- `after-roles.png`: Incident Roles, Reassign / Assign / remove locked, saying why.
- `after-editor-owner-1280.png`: the same page once Checkout SRE may change incidents:
  everything is offered again.
- `after-phone-de-tap.png`, `after-phone-dark-en-tap.png`: Acknowledge tapped on a phone, in
  German and in the dark theme; the reason stays until the next tap.
- `after-fa-dark-1280.png`: Persian, right to left, dark.
