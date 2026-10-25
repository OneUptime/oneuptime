# A security case's side menu

Before and after frames for "When I open the case, can I have a side menu (on
the similar lines that we do for incidents / alerts / scheduled maintenance)":
a security case, CASE-142, under Security Events > Security Cases.

Rendered from the real case pages in headless Chromium at a 2x device pixel
ratio, from the Security Operations offline fixture
(`packages/E2E/SecurityOperations`), with the Dashboard's Tailwind build,
`Theme.css` and Inter, at production widths (the fixture's own 1440px wrapper
taken off, so 1280 is a 1280px window). The "before" frames are master's
bundle at 197a5d0c0a; the "review-before" frames are this branch before its
UI review (c620f91016). Every record in them is made up.

| File | Shows |
| --- | --- |
| `case-1280-before.png` | The case as one long page, about 3,800px tall: the header and figures, then the AI card, Detections, Playbook Runs and the Timeline down the left, and Entities, ATT&CK and Private notes in a narrower column on the right; no menu beside it, and the crumb reading View Case. |
| `case-390-top-before.png` | The same on a phone: each header button on a row of its own, and the ⋯ alone on a row after them. |
| `case-overview-1280-after.png` | The case's Overview, under a side menu of its own (Overview, Timeline; Investigation: Detections, Entities, Playbook Runs with its count of runs waiting; Notes: Private Notes; Advanced folded). The header in full: the number, pills and actions on its first row, the title across the header under them, then the status steps and who has it; the figures, OneUptime AI's read and ATT&CK. The crumb names the case, CASE-142. |
| `case-overview-1280-dark-after.png` | The same in the dark theme. |
| `case-overview-390-top-after.png` | The Overview on a phone: the menu folded into Navigate to, the ⋯ in the header's corner, two buttons to a row and Close Case under them, the status steps two to a row. |
| `case-more-menu-1280-after.png` | The header's ⋯: Set priority with the current one checked, then Edit Case and Delete Case. |
| `case-entities-1280-after.png` | The Entities page: the header compact (no description or status steps), every action still on it, and the entities table with its six columns. |
| `case-entities-390-after.png` | The same on a phone: two columns, the type and when under the value, the worst severity under the count, nothing left to scroll to sideways. |
| `case-playbook-runs-1280-after.png` | The Playbook Runs page, the held run with Approve and Reject, and the 1 beside its menu entry. |
| `case-notes-1280-after.png` | Private Notes, saying what a case's notes are for (not that they never reach a status page, which a case has none of). |
| `case-side-menu-390-after.png` | A phone with the case's menu open on the Entities page. |
| `case-delete-1280-after.png` | Delete Case under Advanced: what deleting takes with it, the case named by its number, and to close it with a verdict instead. |
| `case-overview-long-title-1280-review-before.png` | Review, before: a long title kept half the header beside the actions and took five lines; the labels one to a line. |
| `case-overview-long-title-1280-after.png` | Review, after: the actions share the pills' row and the title runs across the header in two lines; the labels side by side. |
| `case-overview-1024-review-before.png` | Review, before: at a 1024px window the four figures in one row wrapped TIME TO ACKNOWLEDGE and pushed two figures a line down, and the names and dates broke onto two lines. |
| `case-overview-1024-after.png` | Review, after: the figures two to a row and the facts three to a row, each label and value on one line. |
| `case-overview-768-review-before.png` | Review, before: at a 768px window four status steps in one row broke "Investigating" into "Investi" and "gating". |
| `case-overview-768-after.png` | Review, after: the steps two to a row, every name whole. |
| `case-overview-four-buttons-1024-after.png` | Review: a case nobody has taken (four buttons) at a 1024px window - the buttons on one row under the title, the ⋯ in the header's corner rather than alone on a second row. |
