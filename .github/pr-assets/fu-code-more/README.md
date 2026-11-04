# Code, more: a turn's steps reach the page as they happen (#5696, UI review)

How these were made: the real Code route group (a task's conversation and its Log) bundled by
`packages/E2E/Code/Fixture/server.js`'s recipe over the fixture's in-memory Code server, drawn in
headless Chromium with the Dashboard's Tailwind runtime, its reading-direction script and the Inter
font. `?live=1` stands in for the Dashboard's live connection: the fixture's AI takes a step only
when the shot says, and announces it as the server does. `?ai=long` ends a turn with a long reply.
Persian is the Dashboard's `fa.json` loaded over the fixture, with `dir="rtl"` as the Dashboard
sets it. Every record is made up: task #13 "Write tests for the coupon validator" keeps working,
task #12 is done and gets a reply.

`before-*` is master before this PR. `builder-*` is this PR before its UI review
(origin/claude/fu-code-more at 91559bf267), drawn with the same fixture. `after-*` is this PR
after the UI review.

- `before-log-1280` / `after-log-1280` (and `after-log-de-1280`): a turn's Log said it updates
  every 5 seconds; it now says new steps show as they happen, and a step announced a moment ago
  is already there.
- `after-live-1280`, `-1024`, `-768`, `-390`, `after-live-dark-1280`, `-dark-390`,
  `after-live-de-390`, `after-live-fa-390`: a working task after two steps were announced - the
  latest six steps, one earlier step folded, "Working on it…" where the next will appear. Each
  arriving step rises into place (Ask AI's rise); a still picture cannot show it.
- `builder-quiet-1280` / `after-quiet-1280`: four minutes of a long test run with no step. The
  page now reads only what is new, so nothing drew the turn again and its time stood still at
  "2 minutes so far". After: it counts on its own clock, "6 minutes so far".
- `builder-queued-long-1280` / `after-queued-long-1280`: six minutes with no Runner picking the
  turn up. Before, the line that says what to check never came; after, it comes on its own.
- `builder-long-reply-1280` / `after-long-reply-1280` (and `-390`): a long reply ends the turn
  while the reader watches at the end of the page. Before, the page followed to its very end: the
  pull request, with the reply's first words scrolled away above. After, the reply is read from
  its first line, just under the top of the window.
- `builder-byline-390` / `after-byline-390`: on a phone the byline's duration and Log wrap
  together, never "Log" alone on a line.
- `builder-fa-request-1280` / `after-fa-request-1280`: an English request on a Persian page put
  its full stop at its start; it now keeps the direction it was written in.
- `builder-log-fa-1280` / `after-log-fa-1280`: on a Persian page the Log's step `isExpired(` read
  `)isExpired`; the Runner's words are now isolated, as the conversation's are.
