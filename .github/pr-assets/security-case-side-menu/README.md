# A security case's side menu

Before and after frames for "When I open the case, can I have a side menu (on
the similar lines that we do for incidents / alerts / scheduled maintenance)":
a security case, CASE-142, under Security Events > Security Cases.

Rendered from the real case pages in headless Chromium at a 2x device pixel
ratio, from the Security Operations offline fixture
(`packages/E2E/SecurityOperations`), with the Dashboard's Tailwind build,
`Theme.css` and Inter, at production widths (the fixture's own 1440px wrapper
taken off, so 1280 is a 1280px window). The "before" frames are master's
bundle at 197a5d0c0a. Every record in them is made up.

| File | Shows |
| --- | --- |
| `case-1280-before.png` | The case as one long page, about 3,800px tall: the header and figures, then the AI card, Detections, Playbook Runs and the Timeline down the left, and Entities, ATT&CK and Private notes in a narrower column on the right; no menu beside it, and the crumb reading View Case. |
| `case-390-top-before.png` | The same on a phone: each header button on a row of its own, and the ⋯ alone on a row after them. |
| `case-overview-1280-after.png` | The case's Overview, under a side menu of its own (Overview, Timeline; Investigation: Detections, Entities, Playbook Runs with its count of runs waiting; Notes: Private Notes; Advanced folded). The header in full, the actions on the title's line, then the figures, OneUptime AI's read and ATT&CK. The crumb names the case, CASE-142. |
| `case-overview-1280-dark-after.png` | The same in the dark theme. |
| `case-overview-390-top-after.png` | The Overview on a phone: the menu folded into Navigate to, the ⋯ in the header's corner, two buttons to a row and Close Case under them. |
| `case-more-menu-1280-after.png` | The header's ⋯: Set priority with the current one checked, then Edit Case and Delete Case. |
| `case-entities-1280-after.png` | The Entities page: the header compact (no description or status steps), every action still on it, and the entities table with its six columns. |
| `case-entities-390-after.png` | The same on a phone: two columns, the type and when under the value, the worst severity under the count, nothing left to scroll to sideways. |
| `case-playbook-runs-1280-after.png` | The Playbook Runs page, the held run with Approve and Reject, and the 1 beside its menu entry. |
| `case-side-menu-390-after.png` | A phone with the case's menu open on the Entities page. |
| `case-delete-1280-after.png` | Delete Case under Advanced: what deleting takes with it, and to close it with a verdict instead. |
