# Runbooks menu without AI Access

Screenshots of the production Runbooks route group (`Routes/RunbookRoutes.tsx`:
the Runbooks layout, its side menu and the real Runners page), taken in
Chromium by the offline suite `packages/E2E/RunbooksMenu`
(`npm run test-runbooks-menu-ui`). The project and its empty lists are
synthetic: the fixture replaces only the data boundary and the signed-in user.

- `runbooks-menu-laptop.png`: 1280 pixels, on Runbooks → Runners. The menu's
  first section lists Runbooks, Executions and Runners; the Runners section and
  its AI Access entry are gone, and Settings stays folded.
- `runbooks-menu-phone.png`: 390 pixels (the screen only, at twice the
  pixels), the phone menu opened on Runbooks: the same three entries, nothing
  running off the screen.

## What runbook credentials left behind (UI review)

Taken in Chromium at twice the pixels, over synthetic records:

- `runbook-steps-no-longer-run.png`: 1280 pixels, a runbook's Steps page in the
  offline suite `packages/E2E/RunbookVariables` (`?legacy=1`). Two steps
  written with a runbook credential through the API carry **No longer runs**
  beside their titles, folded or open; the open one says why and what is left
  to do, with **Turn into a script step** under the sentence.
- `remediation-plan-cant-be-approved.png`: the real remediation card
  (`Components/AutoRemediation/RemediationSuggestionCard.tsx`) with a plan
  composed before the removal that holds an SSH command: **Can't be
  approved**, the SSH command marked **no longer runs**, no other command
  asked for approval, and **Dismiss** in place of **Approve & Run**.
