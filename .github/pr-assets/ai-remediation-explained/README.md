# The Remediation step says what a round of an AI fix did

Screenshots of the Remediation step of the OneUptime AI card on an incident's
overview page (`packages/App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep.tsx`,
`RemediationRoundDetails.tsx`), for issues #6436 and #6487.

They come from the offline suite `packages/E2E/EventOverview`
(`npm run test-event-overview-ui`). Its fixture replaces only the data
boundary. Incident #1042 holds one AI kubectl fix on the cluster
"prod-eu-west-1", and the step reads its round through
`POST /auto-remediation/round`. The workspace, its cluster and its commands
are made up.

- `after-did-not-finish-folded-1440.png` (`?fixes=unfinished&state=ongoing`):
  the round gave up after three attempts because the AI provider did not
  answer within 120 seconds. The plan step says "Stopped before it found a
  fix", never "Found no safe fix", and Try again is in sight while the step
  is folded.
- `after-did-not-finish-1440.png`: the same step opened. It shows why it
  stopped, how often it tried and what to do, with Try again, the LLM
  Providers page and the provider's own error under Details. Below that are
  the two kubectl commands it checked with, each at the time it ran, and
  that no fix ran and nobody was asked to approve one. Try again shows once:
  the one under the step goes while the step is open.
- `after-try-again-refused-1440.png` (`&fail=round-try-again`): Try again
  is refused, in the server's words, on a line under the button.
- `after-tried-again-1440.png`: after Try again, the fix is being worked
  out again with a new run, and the step shows when that run started.
- `after-no-safe-fix-1440.png` (`?fixes=no-fix`): the round found no safe
  fix and said why. Opened, the step leads with the reason. Below it are
  the three fixes it ruled out (each with why not and the command it would
  have run; the rollback was not safe), the four commands it checked with
  and when (kubectl refused one), its other telemetry queries, and that
  nobody was asked to approve anything.
- `after-no-safe-fix-full-reasoning-1440.png`: the AI's whole answer,
  opened with Show full reasoning under the reason.
- `after-no-safe-fix-390.png` and `after-no-safe-fix-1280-dark.png`: the
  same, on a phone and in the dark theme. On a narrow card a check's time
  goes under its command.
- `after-did-not-finish-persian-390.png`: the round that stopped, in
  Persian at 390px. The words read right to left, and the commands read
  left to right.

The number in each name is the width of the browser window. Before this
change, the fix in `after-did-not-finish-1440.png` read "Found no safe fix",
with the sweep's sentence "AI planning did not produce a proposal — the
planning run failed. No runbook was proposed; you can still start one
manually from the Runbooks card". That is what the screenshot in #6436
shows.
