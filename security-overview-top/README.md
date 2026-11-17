# Security Events Overview: the top of the page

Before and after frames for "Please improve this UI" - the four status cards
(Sources, Detections, Security Cases, Playbooks) joined by chevrons, and the
All quiet banner with Send a test attack, at the top of Security Events >
Overview.

Rendered from the real Overview page in headless Chromium at a 2x device pixel
ratio, from the Security Operations offline fixture
(`packages/E2E/SecurityOperations`), with the Dashboard's Tailwind build,
`Theme.css` and Inter, at production widths (the fixture's own 1440px wrapper
taken off, so 1280 is a 1280px window beside the side menu). The "before"
frames are master's bundle at ce9fa0d8d6. The "after" frames were shot again
after the UI review (20px padding lined up with the cells, the band stacked
below lg, the new wording). Every record in them is made up.

| File | Shows |
| --- | --- |
| `maintainers-project-1280-before.png` | The maintainer's project (your logs, 3 rules on, no playbook, Get started put away): four bordered cards, a chevron in each 12px gap, the amber Not set up card beside a green banner that promises "your playbooks run on it", its button ~900px from its words. |
| `maintainers-project-1280-after.png` | One card: All quiet with its test attack beside it, saying nothing about playbooks; the four parts on one hairline grid with a chevron on each line; Not set up in grey with "Add a playbook". |
| `maintainers-project-390-before.png` / `-after.png` | The same on a phone. |
| `needs-attention-1280-before.png` | Something waits: three rows of three box styles - the stage cards, three coloured tiles whose words wrap, and (under the frame) the figures bar. |
| `needs-attention-1280-after.png` | Needs attention: each count a link to the page that lists it, read top down; the pipeline under it, the playbooks cell saying a step waits. |
| `needs-attention-1280-dark-before.png` / `-after.png` | The same in the dark theme. |
| `needs-attention-390-before.png` / `-after.png` | The same on a phone. |
| `quiet-1280-dark-before.png` / `-after.png` | A project set up and quiet, dark. |
| `quiet-768-before.png` | A tablet beside the side menu: four squeezed cards whose figures wrap, and the banner's words in a column beside its button. |
| `quiet-768-after.png` | The same: the cells two by two, and the band's words keep its width, its button under them at the right edge. |
| `sources-silent-1280-before.png` | Sources that sent nothing for three days: "No events in 24 hours" in grey, under a green All quiet. |
| `sources-silent-1280-after.png` | All quiet says when the last security event came, and the Sources cell says it in amber. |
| `not-watched-1280-after.png` | Nothing can open a case (no connection, and no rule or threat intel feed reading your logs), Get started put away: "Nothing is being watched for threats yet" in grey with Set up Security, never All quiet. |
| `connection-only-1280-after.png` | A connected product (its alerts open cases from High up by default) and no rule of OneUptime's: watched, so All quiet; Detections offers its rules in grey. |
| `in-hand-1280-after.png` | Cases open, every one someone else's: "Every open case is picked up", in indigo. |
| `status-failed-1280-after.png` | The set-up figures cannot be read: the pipeline's place says so, with Try again (before: the strip was silently left out). |
| `overview-failed-390-after.png` | The overview cannot be read: the product's sentence and Try again (before: a raw "Server Error"). |
| `loading-1280-after.png` | The first reads in flight: the card's shape. |
