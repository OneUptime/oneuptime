# A new person's first hour

Screenshots of the real Dashboard, taken in headless Chromium against a local Community Edition
stack (the App run natively, with Postgres, Valkey, ClickHouse and nginx), signed in as someone who
had just signed up and created their first project. Every `before-*` image is the same page on the
build before this change (master at 83484649c6), taken the same way with a different newcomer.

- `policy-dialog-1280-after.png`, `policy-dialog-1280-dark-after.png`,
  `policy-dialog-390-de-after.png`, `policy-dialog-390-fa-dark-after.png`: On-Call Duty > Policies >
  Create On-Call Policy in a project with no policy and no on-call rule yet. The new switch, "Page it
  for every new incident and alert", starts on and says why: a policy pages nobody until a rule or a
  monitor names it. It is not shown once the project has a policy or an on-call rule, or to someone
  who may not create on-call rules. Before this change the dialog had no such switch (the rest of it
  is unchanged).
- `incident-on-call-rules-after.png`: Incidents > Rules > On-Call Rules after creating that first
  policy with the switch on: one rule, "Page Beta on-call for every incident", matching all
  incidents. Alerts > Rules > On-Call Rules gets the same rule for alerts.
- `my-on-call-rules-before.png` / `my-on-call-rules-after.png`: User Settings > On-Call Rules of
  the person who created the project. Before, Critical Incident had the same email rule twice: the
  sign-up and the job that backfills rules for new severities both added it within the same
  minute. After, one rule per severity.
- `setup-checklist-before.png` / `setup-checklist-after.png`: User Settings > Setup Checklist of a
  new member who changed nothing. Before: "A few things still need setting up" and "You switched on
  Push, but have no verified method there" - push starts on, beside email, and they had no phone or
  browser registered for push. After: "You are all set", and "You are on call in this project" once
  the first policy names them.
- `home-first-steps-before.png` / `home-first-steps-after.png`: Home's Welcome card. The on-call
  step now says who is told until a policy exists: "Page the right person when an incident or alert
  opens. Until then, the project's owners get an email."
- `create-monitor-before.png` / `create-monitor-after.png`: Monitors > Create Monitor. The card
  now ends with what happens when the monitor fails: "When something goes wrong, OneUptime opens an
  incident or alert and emails the project's owners."
- `incident-feed-before.png` / `incident-feed-after.png`: the first incident's feed in a project
  with no on-call policy. Before: "Owners were notified that this incident was created." beside an
  Owners field that reads "Add". After: "The project's owners were notified that this incident was
  created, as it has no owners yet."
