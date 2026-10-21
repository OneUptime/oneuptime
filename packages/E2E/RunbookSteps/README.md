# Runbook Steps fixture

An offline harness for a runbook's Steps page
(`packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx`) and a
run's execution page (`Pages/Runbook/View/ExecutionView.tsx`), where a step
asks for approval before it runs and every step's options are folded under
More fields. It bundles the production pages with esbuild, replaces only the
`ModelAPI` / `API` data boundary and the synthetic user's permissions, and
serves them on `127.0.0.1:4389` (`RUNBOOK_STEPS_FIXTURE_PORT` to change it;
`RUNBOOK_STEPS_FIXTURE_OUTPUT` builds somewhere else). No Docker, no database,
no sign-in.

```sh
cd packages/E2E
npm run test-runbook-steps-ui
```

The suite drives the pages the way a person does:

- one step of every type a runbook author adds - Manual, JavaScript, HTTP
  request, Bash, SSH, kubectl and AI: what each card shows, and what its More
  fields fold, "Require approval before running this step" and "Continue on
  failure" first;
- a Manual step's instructions, on the card, with nothing folded;
- the step that needs approval says so on its header; turning the switch on
  another step says so there, the folded line says "Require approval: On",
  and Save sends `requireApprovalBeforeRunning` - never the old
  `requireApproval`;
- an HTTP request shows its body only for a method that sends one;
- a runbook a client still saves the old way (`?legacy=1`, the approval after
  a step) reads as it runs - the approval on the step it held back, one after
  the last step as "Approve the result" - and Save writes it the new way;
- a run that waits for approval before a step (`?page=execution&wait=approval`)
  names it, and "Approve and run" runs it - the run goes on to its next stop -
  while Skip keeps it from running; a run started before approvals moved
  (`wait=legacy`) waits after the step that ran and "Approve & continue" goes
  on; a finished run (`wait=approved`) says who approved;
- a phone (the step's type is read out but not drawn, so a title takes up
  to two lines; the lock shows where the run stops; the waiting step's
  buttons fill the card under its words, Skip centred under the one that
  moves the run on - in German at 390 and 320 too, inside the card), a
  tablet or a card the side menu narrows (the buttons wrap under the
  step's words at the card's right edge, after when it started; beside
  them at 1280), the run's card (what it waits on runs under its name and
  buttons; its four tiles go two by two below 1280), dark mode
  (`?theme=dark`) and German (`?lang=de`);
- the HTTP request's timeout at half the width, as every step's timeouts
  are, and an AI step's provider - always set - neither optional nor
  cleared.

`Fixture/Fixture.js` records every save (`updates`, with the model, the id and
the data) and every step route the execution page calls (`posts`) on
`window.__fixture`. The step routes answer as the server does: the step rules
decide (`decideRunbookStepAction`), the person's decision is written as the
routes write it (`applyRunbookStepAction`), and the run goes on to its next
stop. Screenshots of each state are written to
`output/playwright/runbook-steps-ui/`.
