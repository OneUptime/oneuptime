# A level with nobody to page is passed at once: screenshots (#5390)

How these were made: the real On-Call Duty route group of the Dashboard (its layout, side menu and
pages), bundled with the Dashboard's own esbuild config and drawn in headless Chromium with the
Dashboard's Tailwind runtime and the Inter font. Only the API is stood in for, answering from a small
in-memory project: policy `sg - irm` (Level 1 has no responders and waits 4 min, Level 2 pages one
person), `Payments on-call` (Level 1 a schedule with nobody on call, Level 2 no responders, Level 3 a
team and a person) and `Database escalation` (no level has responders). People are fictional. The
Slack and Microsoft Teams pictures render the exact payloads OneUptime sent in the end-to-end test
world (QuietChannelsWorld): Slack Block Kit through a small renderer that follows Slack's layout, the
Teams card through the `adaptivecards` package. They are not screenshots of a running stack.

`*-before` is master at e7266f1cc0 (the feature's before). `*-review-before` is the builder's branch
before the UI review, and `*-review-after` / `*-after` the reviewed branch. 1280px wide unless the name
says otherwise.

- `escalation-rules-before.png` / `escalation-rules-after.png`: the maintainer's policy. Before, Level 2
  was paged "After 4 min" and the step from Level 1 waited 4 minutes for nobody. After, Level 1 is
  "Skipped at once" in the summary and on its card, the step says the next level is paged at once, and
  the final level comes "Instant".
- `rule-card-review-before.png` / `rule-card-review-after.png`: the empty level's card. The builder's
  card said "Escalates after 4 min" over a notice that the level is skipped without waiting; the card
  now says "Skipped at once", like the summary, and the notice keeps to what to fix.
- `summary-every-level-empty-review-before.png` / `-review-after.png`: no level has responders. The
  ladder ended "repeats up to 1 more time" - a pass that pages nobody is never repeated. It now ends
  "This policy will not page anyone when it is triggered."
- `policy-at-a-glance-no-responders-review-before.png` / `-review-after.png`: the Overview's summary of
  that policy no longer tells a timeline and repeats that never happen; the notice under it says the rest.
- `escalation-rules-three-levels-after.png`, `escalation-rules-after-dark.png`,
  `escalation-rules-after-fa.png`, `escalation-rules-after-390-de.png`: a level with nobody between two
  that page, in the dark theme, in Persian (the arrows point the way the words run) and in German on a
  phone.
- `timeline-before.png` / `timeline-after.png` / `timeline-after-de.png`: the run's Execution Timeline.
  Before, the empty level's row said nothing and Level 2 was paged four minutes later; after, each
  level that paged nobody says why, with "Moved on at once" under it, all in the same minute.
- `feed-before.png` / `feed-after.png`: the incident's feed, unfolded: "...this escalation rule has no
  responders, so the next level was paged at once", and the next level's page the same minute.
- `chat-run-message-review-before.png` / `-review-after.png`: the run's Slack and Teams message, the
  alarm it would raise, the new messages the channel got and the feed. The builder's first post (often
  made while the run moves on) said "Level 1 of 2: if nobody acknowledges by 17:19, Level 2 of 2 is
  next" over "Level 1 of 2: nobody to page, so Level 2 of 2 was paged at once"; it now says Level 2,
  with its own wait.
- `chat-every-level-empty-after.png`, `chat-run-message-after-390.png`: a run with no level able to
  page anybody, and the run message on a phone.
- `logs-nobody-paged-hover-after.png`: what a run that reached nobody says on hover in the execution
  logs, now that empty levels, nobody on call and people away all end a run that way.
