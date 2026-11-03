# Hunts: run history, the Hunt Library, Slack and Teams posts, filters in Edit - UI review

These images show the UI review of the hunts follow-ups (PR #5680). Each one is the real
production page rendered offline by the Security Operations fixture in `packages/E2E`, on synthetic
data for a made-up "Acme Commerce" workspace: every name, domain and address is fabricated, and the
fixture's header marks the workspace as synthetic. Captured at 1x with the fixture's clock
(2026-10-14 12:00 UTC), in Inter, as production draws it.

## Before and after

The `-before` images are the branch before the review, the `-after` images after it, on the same
page, size and data.

- `hunt-failed-390-before.png` / `-after.png`: a hunt whose last run failed, on a phone. Before,
  Run history stood alone on a line under a "·" that ended the line above. After, it follows the
  sentence's last word and wraps under its words.
- `hunt-de-390-after.png`: a hunt in German on a phone. Who it tells and when it runs next take a
  line each with no dot left at a line's end, and Show them and Run history go under what was found
  together.
- `run-history-1280-before.png` / `-after.png` and `run-history-390-before.png` / `-after.png`:
  Run History. Each moment is written as every list writes a date ("Oct 14, 10:00 AM", the whole
  date under the pointer) instead of "Oct 14 2026, 10:00 AM GMT" three times a row; the panel's
  description is one short sentence; a phone's card no longer labels the result "Result".
- `library-1280-before.png` / `-after.png` and `library-768-before.png` / `-after.png`: the Hunt
  Library. Before, Try it and Add were two outlined buttons of different widths stacked at every
  width. After, Try it is a link (it goes to Events and saves nothing) and Add the one button, on
  one line from a laptop's width; an added starter reads Open, then Added in Add's place, so every
  row ends on the same edge. In a narrow column the link sits over the button, on the name's line.
- `edit-filters-before.png` / `-after.png`: Edit Hunt. The Filters field no longer says
  "(Optional)": its chips are taken off, there is nothing to fill in.

## New in the browser suite

- `slack-rules-1280.png`: Security Events → Workspace → Slack, now mounted in the fixture with a
  Security Case rule and a Hunt rule: Security Case Rules, then Hunt Rules, each card with its own
  rules and Create.
- `channel-posts.png`: what a hunt's find posts in Slack and Microsoft Teams (built by the product's
  own `SlackUtil` and `MicrosoftTeamsUtil` from the scheduler's markdown, drawn with a small Block
  Kit renderer and the `adaptivecards` package), beside a security case's post.
