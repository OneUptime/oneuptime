# Connected Signals, next: the UI review

Before and after images of the UI review of #5522 (In your logs and traces under Connected
Signals, and the records above it). Each one is the real production component rendered offline
by the Security Operations fixture in `packages/E2E/SecurityOperations`, on synthetic data for a
made-up "Acme Commerce" workspace: every name, domain and address is fabricated (documentation
addresses, example domains). Captured at 2x, in Inter, with the fixture's clock pinned.

`before-*` is the branch as the builder left it, `after-*` the same view after the review.

- `entity-ip-1280.png`, `entity-ip-390-dark.png`: an entity's page for `203.0.113.47`, which no
  record holds and the logs name 1,344 times. Before, a page's large empty state, the same
  address again under No matching record, then the logs and traces far below; after, one
  entry of the list (its icon, its sentence, the address under it) and the logs and traces
  right under it.
- `entity-file-hash-1280.png`: a file hash, which no record is keyed by. Before, "Only hosts,
  addresses and users with an email can be found in OneUptime"; after, what a record is found
  by - a URL and a cloud resource ID among them.
- `case-telemetry-1280.png`, `case-telemetry-de-1280.png`, `case-telemetry-fa-390.png`: the
  spray case's In your logs and traces, in English, German and Persian on a phone. A sender's
  count now says what it counts ("1,284 lines", "312 spans"); the section's sentence reads
  "Where the values it names appear in your logs and traces from ... to ..."; in Persian the
  long email that wraps keeps its lines at the page's start, in the monospace face.
- `case-failed-1280.png`: a search that failed. Before, the app's large centred "Server Error"
  and Refresh? under the heading; after, one line, as a signal that could not be searched is
  said, then why, then Try again.
- `case-searching-1280.png`: while the search runs (`?telemetry=slow`). Before, the heading over
  a blank band with a loader bar (a heading that vanishes when nothing is searched for); after,
  one quiet line under the records.
- `case-partly-read-1280.png`: a role that cannot read users and clusters that could not be
  read: the no-record entry, then what the role keeps from it and Try again.
- `reviewed-serverless-function-card-fa-1280.png`, `reviewed-inventory-item-card-fa-390.png`:
  two of the Security cards the review looked at and left as they were (a serverless
  function's Overview in Persian; an Inventory item's own page in Persian on a phone, its case
  number first).

How they were made: `shoot.js <port> <dir> "name|path|width|opts"` against
`node SecurityOperations/Fixture/server.js --watch` (Playwright's Chromium, clock pinned to the
fixture's 2026-10-14T12:00Z, network fenced to the fixture), once with the review's
components and once with the builder's checked out in their place.
