# One more pass at Security Events

Before and after frames for "go through it page by page and improve the UI and
make it a lot better for people to understand and use": the Security Events
pages under Products → Security Events, outside a case's own pages.

Rendered from the real pages in headless Chromium at a 1x device pixel ratio,
from the Security Operations offline fixture (`packages/E2E/SecurityOperations`),
with the Dashboard's Tailwind build, `Theme.css` and Inter, at production widths
(the fixture's own 1440px wrapper taken off, so 1280 is a 1280px window). The
"before" frames are master's bundle at 5ecd7f745c; the "after" frames are this
branch, the ones the UI review changed shot again after it. Every record in them is made up.

| File | Shows |
| --- | --- |
| `attack-1280-before.png` | ATT&CK Coverage as the whole matrix: 15 columns of some 200 technique cells, their names cut short and most of them greyed out, running past the card's right edge; nothing said which tactic the rules covered best or what to add next. |
| `attack-1280-after.png` | ATT&CK Coverage opens on the tactics, in attack order: each a row with what the tactic is for, how many of its techniques the enabled rules cover, and how many more the Rule Library has rules for. Above them, a box says the Rule Library covers 25 techniques the rules do not, and opens the rules not added. By tactic / Matrix switches the view. |
| `attack-tactic-open-1280-after.png` | A tactic opened (Credential Access, as the Overview's tactic bar opens it with `?tactic=TA0006`): its techniques under a heading per state - covered by an enabled rule, available in the Rule Library, not covered - each with how many, and a covered tile saying how many rules name it ("4 rules"). The legend stays with the matrix. |
| `attack-matrix-1280-after.png` | Matrix (`?view=matrix`): the old matrix, a switch away, with Only covered. |
| `attack-390-before.png`, `attack-390-after.png` | A phone: the matrix scrolled sideways in its card; the tactic rows read down the page. |
| `attack-dark-after.png` | The tactics in the dark theme. |
| `playbooks-1280-before.png` | Playbooks: a card of the three templates above the list, offered again though the project had a playbook of each; the list's button Create Security Playbook, its count security playbooks, Disabled grey. |
| `playbooks-1280-after.png` | The list leads the page, named Playbooks; Create from Template sits in the card's ⋯, and Disabled reads red as in every other list. |
| `playbooks-templates-1280-after.png` | Create from Template: the three templates across the dialog, each the project already has marked Added with View to open its playbook; the dialog closes with Close. |
| `playbooks-empty-1280-after.png` | A project with no playbooks: the templates are the empty list (Start from a template), with Create a blank playbook under them. |
| `playbook-1280-before.png`, `playbook-1280-after.png` | A playbook's page: the trail said View Playbook, the settings repeated the name the title says, and Latest Runs drew every step of both runs. Now the trail and the tab name the playbook, the settings add Last Run, and the runs fold to a line each, named by the case each ran on, the one waiting for approval open with Approve and Reject on its title's line. |
| `runs-all-1280-before.png`, `runs-all-1280-after.png` | Playbook Runs: every step of every run, drawn whole; now each run is a line of how far it got (3 of 3 steps done, or Stopped at step 2: Look up entity activity in red) with Show steps, and the run waiting for approval open, its Approve and Reject on its title's line at the card's right (a long case title had pushed them onto a row of their own). |
| `runs-all-390-before.png`, `runs-all-390-after.png` | The same on a phone: a run's buttons drop under its words, at the card's right, Cancel Run as Approve and Reject. |
| `entities-1280-before.png` | Entities: the lookup first, then Riskiest Entities in a table of its own, its rows leading nowhere. |
| `entities-1280-after.png` | Riskiest Entities first, in the product's table: each row opens the entity in Correlate (Open in Correlate on the row too), the window a 1 day / 7 days / 30 days switch, ten a page with the foot every list has; the lookup under it, its box and Look Up one height. |
| `entities-390-before.png`, `entities-390-after.png` | A phone: the table scrolled sideways; now each entity is a card with its severity, findings, rules and when it was last seen, the list's foot under them. |
| `entities-dark-after.png` | Entities in the dark theme. |
| `detection-rules-1280-before.png` | Detection Rules: the 650px How it works card above the list on every visit, and Create Monitor as each row's button, cutting off Last Match. |
| `detection-rules-1280-after.png` | The card folded once the list has rows (the reader's choice is kept), Edit as the row's button and Create Monitor in its ⋯; Last Match reads how long ago (the date under the pointer) and Last Evaluated waits in Customize Columns, so the table fits its card at 1280. |
| `detection-rules-empty-1280-after.png` | A project with no rules: the card open over an empty list that says how to start, with Open the Rule Library. |
| `threat-intel-1280-before.png`, `threat-intel-1280-after.png` | Threat Intel: the same for feeds, the card folded over a list that has feeds; Edit is the row's button, Create Monitor and Update Credentials in its ⋯. The feeds table still scrolls inside its card at 1280 (Last Match), as before. |
| `overview-1280-before.png`, `overview-1280-after.png` | The Overview: the cards of each row now share its height, so the rows read straight. |
