# Paging from an incident's own Slack or Teams channel: the UI review

How these were made: every message and form built by the product's own code (the `before-*` shots
from the builder's branch, the `after-*` shots from the reviewed one), drawn the way a person in
the channel sees it: Slack Block Kit with a renderer that follows Slack's layout, Microsoft Teams
Adaptive Cards with the `adaptivecards` package and Teams' light and dark host configs, at 1280 px
and 390 px. The grey line under each message is what its notification says.

- `before-team-of-six.png`, `after-team-of-six.png`: Jane pages Platform, six people, from
  INC-42's channel. Each person's line said "(member of Platform)". Now the first line says whom
  the page is paging, once: "Jane Doe is paging Platform for Incident INC-42".
- `before-run-phone-dark.png`, `after-run-phone-dark.png`: the same message on a phone, in dark
  mode. Each person's line no longer wraps to two.
- `before-nobody-answered.png`, `after-nobody-answered.png`: the page ended with nobody answering
  while somebody else was on the incident: "Nobody in Platform answered the page from Jane Doe".
- `before-answered.png`, `after-answered.png`: Nitin answered. He acknowledged the page; the
  incident may have been acknowledged by somebody else an hour before.
- `before-policy-level.png`, `after-policy-level.png`: an on-call policy's level that pages one
  team lists its people as it did before the branch, without "(member of Platform)" on each line.
- `before-form-phone.png`, `after-form-phone.png`: `/oneuptime page` in an incident's channel, on a
  phone. Slack writes "(optional)" after the label, so the hint under it no longer starts with
  "Optional." too.
- `after-late-acknowledge.png`: Nitin, paged into an incident Bob had acknowledged, presses the
  incident's Acknowledge in its channel. It answers his page, and says so first; somebody with no
  page of theirs gets the answer they always did.
