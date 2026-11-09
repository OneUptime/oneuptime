# fu-cloud-agent-two-person (PR #6226): UI review images

Screenshots of "Two people approve a riskier fix", taken during the UI review.

- **AI card** images come from the offline Event Overview fixture (`packages/E2E/EventOverview`) with
  `?fixes=many&approvals=on|first|mine`, plus `?lang=`, `?dir=auto` and `?theme=dark`. A refused press is the reader's
  own first approval given from another tab (the fixture's `callApi`), then Approve pressed on the open card.
- **Settings** images come from the offline AI context fixture (`packages/E2E/AiContext`, `?layout=page`) with the
  project's `requireTwoApprovalsForRiskierFixes` set.
- **Slack and Microsoft Teams** images render the payloads the server builds (`RemediationChatMessage`,
  `WorkspaceRemediationActions`, `SlackUtil.getModalBlock`, `MicrosoftTeamsRemediationActions.buildApprovalCard`):
  Slack's Block Kit by a small renderer that follows Slack's layout, Teams cards with the `adaptivecards` package.
- **Before** images render the branch as the builder left it, with the same fixture data. Headless Chromium, device
  scale 2, Inter as production serves it.

| File | What it shows |
| --- | --- |
| `card-first-press-1280-before.png` | Before: over the first approval's press, "Your approval is recorded" - before anyone pressed |
| `card-first-press-1280-after.png` | After: what the press does, read before it - "Your approval alone runs nothing" |
| `card-after-first-approval-1280.png` | After the first approval: who gave it, "Needs a second approval", no Approve for its giver |
| `card-second-approval-1280.png` | Someone else approved first (in Slack): the reader's Approve & Run runs it |
| `card-first-approver-390-fa-dark.png` | The first approver on a Persian phone in dark |
| `card-refused-press-1280-before.png` | Before: a first approver's stale press - the step's sentence again, in red, twice |
| `card-refused-press-1280-after.png` | After: one calm line, "You already approved this fix" |
| `card-refused-press-1280-de-before.png` | The same before, in German |
| `card-refused-press-1280-de-after.png` | The same after, in German |
| `card-refused-press-390-dark-after.png` | The same after, on a phone in dark |
| `settings-fix-approvals-1280-before.png` | Before: the switch's sentence ended "here or in Slack or Microsoft Teams" on Project Settings |
| `settings-fix-approvals-1280-after.png` | After: what the switch changes, and nothing of where approvals are made |
| `settings-fix-approvals-390-fa-dark.png` | More settings with Fix approvals on a Persian phone in dark |
| `slack-answers-before.png` | Before: Slack's answers - the first approver's was one long sentence |
| `slack-answers-after.png` | After: "You approved this fix first. It holds a riskier change, so it runs once someone else approves it too.", then the feed lines both approvals post |
| `slack-dialogs-one-first-second.png` | Slack's approval dialog: one approval, the first of two ("Approve"), the second (names the first approver) |
| `teams-fix-message.png` | The fix's Microsoft Teams message: one approval, then two ("Nothing runs until two people approve it.") |
