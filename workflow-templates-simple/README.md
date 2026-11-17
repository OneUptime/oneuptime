# Simpler workflow templates: before and after

Screenshots for the pull request "Workflows: every template in five steps
or fewer, and who to page asked when it is created". They are drawn by the
repository's offline workflow builder fixture (`packages/E2E/WorkflowBuilder`)
- the real Create a workflow dialog and the real Builder page over fixture
data, with Theme.css and the Inter font - at 1x. The fixture was built once
from master (`*-before.png`) and once from the branch (`*-after.png`), with
the Dashboard's own i18n set up first for `?lang=de|fa`.

- `builder-zabbix-1280-before` / `builder-zabbix-1280-after`: the workflow
  "Declare an incident for each Zabbix problem" creates, opened in the
  Builder. Master: 48 steps, a Switch / Case with a path for each event and
  a Log on every Error output, too big to fit, and "1 error" - its Page step
  waiting for who to page. After: five steps, top to bottom - Webhook, Check
  With JavaScript, Incident From Another Tool, If / Else, Page an On-Call
  Policy - with the on-call policy picked in the dialog, and no error.
- `builder-zabbix-nobody-picked-1280-after`: the same template with nobody
  picked: who to page is optional for it, so the Page step and the If / Else
  only it needs are left out, and nothing waits to be set up.
- `builder-huntress-1280-before` / `builder-huntress-1280-after`: "Open an
  incident for each Huntress incident report". 33 steps and "1 error", then
  four. `builder-huntress-fa-dark-1280-after`: the same in Persian, dark.
- `picker-zabbix-details-1280-before` / `-after`: the template's details in
  the picker. Master listed 12 kinds of step and "An on-call policy to page.
  You pick it in the Builder."; after, its five steps and, under What you'll
  need, who to page (optional).
- `zabbix-settings-1280-before` / `-after`: the dialog's last step. Master
  asked for the Zabbix URL alone; after, who to page too, kept on the Page
  step. `zabbix-settings-fa-dark-390-after`: on a phone, in Persian, dark.
- `picker-paging-details-1280-after`: "Page whoever is on call when a
  critical incident is created", whose who to page is required.
- `who-to-page-required-1280-after`, `-de-1280-after`, `-fa-1280-after`,
  `-de-dark-390-after`: its last step after Create Workflow was pressed with
  nobody picked: "Pick who to page." under the question, and nothing
  created.

The template's own words (names, descriptions, the who-to-page question)
are catalog content, written in English in every language, as the other
template text is.

## UI review

Taken the same way after the UI review, from the review branch. The Persian
ones load production's reading-direction script after the Tailwind runtime
(Common/UI/Styles/TailwindReadingDirection.js), as every index.ejs does and
as the fixture now does, so left and right follow the page; the `review-*-before`
Persian shots are the builder's version drawn the same way.

- `who-to-page-required-*-after`, `zabbix-settings-*-after`: retaken. The
  step's sentence is now one sentence for every template that pages, with no
  template name in it ("Pick who this workflow pages. You can change it later
  on its Page step in the Builder."), the picker sits a field's gap under its
  help, and on a Persian page the question's English help reads left to right
  with its full stop at its end.
- `review-who-to-page-1280-before` / `who-to-page-required-1280-after`, and
  `review-zabbix-settings-1280-before` / `zabbix-settings-1280-after`: the
  builder's version of the step, then the reviewed one.
- `review-picker-fa-1280-before` / `-after`: the template picker on a Persian
  page. Before, the English rows were laid out right to left: full stops at
  the start of a line and one-line rows cut at their start; after, each reads
  left to right, lined up on the right.
- `review-who-to-page-fa-390-before` / `-after`: the paging step on a phone,
  in Persian: no English template name inside the Persian sentence, and the
  help's full stop at its end.
