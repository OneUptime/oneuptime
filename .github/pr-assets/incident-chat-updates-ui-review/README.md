# Notification rules' Updates step and card row: UI review

How these were made: the real `WorkspaceNotificationRulesTable` (an incident's Slack notification
rules), bundled with the Dashboard's own esbuild settings and drawn in headless Chromium with
Inter, at 1280 px, at the side menu's 768 px width and at 390 px. Only the API is stood in for: a
project with five incident rules: one on Key updates only, two with boxes of their own, one with
every box cleared, and one saved before the step, which posts every update and shows no row.

"Before" is the branch as it was built; "after" is the branch after the review, merged with main.

- `cards-before.png`, `cards-after.png`: the rules list. A rule that ticked its own boxes read
  "Chosen updates" over its list; now the row is just what it posts. A rule with every box
  cleared read "Only the first message"; now it says when it still posts: "Only when an incident
  is declared or a video call starts".
- `cards-de-768-before.png`, `cards-de-768-after.png`: the same list in German, at the side
  menu's 768 px width. Before, the list broke inside an update ("Änderungen des /
  Schweregrads", "KI-Analysen und - / Korrekturen") and began lines with a dot. Now each update
  stays whole on its line, with the dot after it.
- `step-none-before.png`, `step-none-after.png`: the rule form's Updates step with every box
  cleared. The note under the boxes says when the rule still posts, in the card's words.
- `cards-maintenance-after.png`: maintenance event rules; the Updates row says "Only when a
  maintenance event is created", the record's name on screen.
- `step-choose-dark.png`, `step-choose-phone.png`: the step on Choose updates, in dark mode and
  on a phone.
- `cards-ar-phone.png`: the rules list in Arabic, on a phone.
