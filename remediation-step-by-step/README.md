# The Remediation step, step by step (issue #5598)

How these were made: the real incident page (`Pages/Incidents/View/{Layout,Index}`) rendered by the
offline Event Overview fixture (`packages/E2E/EventOverview/Fixture`) and captured by its Playwright
suite, with the browser clock pinned to the fixture's 18:20 UTC and the locale en-US, so times read
"6:04 PM". Every record is synthetic. They are not screenshots of a running stack. The "before" is
the screenshot attached to issue #5598.

- `after-rolled-back.png`: the issue's case (`?fixes=rolled-back`). A kubectl fix OneUptime AI ran
  on its own, after which the incident did not recover, so the change was rolled back; a runbook
  search that found none; and a second round that found no safe fix. Each fix reads as the steps
  it went through, oldest fix first, each with when it happened and why or what went wrong.
- `after-rolled-back-open.png`: the same, with the first fix's steps open. The plan shows the
  reasoning and the command with its risk, why, what it should do and its undo. The run shows the
  command and what it printed, as a terminal does, with its exit code. The rollback shows the undo
  as it ran.
- `after-rolled-back-open-dark-1280.png`, `after-rolled-back-open-fa-390.png`: open, in the dark
  theme at 1280px, and in Persian at 390px. The steps read right to left, the commands and their
  output left to right.
- `after-busy-incident-1280.png`, `after-busy-incident-390.png`: `?fixes=many`. A runbook someone
  approved, verified fixed; a fix through MCP servers whose second change failed (the error under
  the step, "1 failed" in red beside the fix); and a kubectl fix that waits, whose Review and
  approve opens its plan with Approve & Run under it.
