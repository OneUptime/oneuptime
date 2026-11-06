# fu-cloud-agents-next (PR #5715): UI review images

Screenshots of the cloud agent follow-ups (#5519, part 1), taken during the UI review.

- **Dashboard surfaces** come from the offline Event Overview fixture (`packages/E2E/EventOverview`): `?impact=on`,
  `?fixes=runbook`, `?fail=dismiss`, `?cloudfix=would-run`, `?linked=cloud`, with `?lang=`, `?dir=auto` and
  `?theme=dark`. The browser clock is pinned to the fixture's 2026-09-14 18:20 UTC. Headless Chromium, device scale 2,
  Inter as production serves it.
- **AI Insights** comes from a small esbuild harness that renders the real `AiActivityInsightsView` with the Common
  test fixture `AiActivityInsightsFixtures.makeInsights` and fix outcomes approved in Slack, Microsoft Teams and the
  card.
- **Slack and Microsoft Teams** images draw the exact payloads the server builds (`RemediationChatMessage`,
  `SlackUtil.getBlocksFromWorkspaceMessagePayload`, `MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks`,
  `MicrosoftTeamsRemediationActions.buildApprovalCard`): Teams cards through the `adaptivecards` library, Slack Block
  Kit through a small renderer that follows Slack's layout.
- **Before** images render master's Dashboard components with the same fixture data.

| File | What it shows |
| --- | --- |
| `investigation-impact-1280.png` | The full report: Impact right under the Summary, a line each for the users, the services and the SLOs |
| `investigation-impact-390-fa-dark.png` | The same on a Persian phone in dark mode: each English line reads left to right |
| `remediation-runbook-1280.png` | A runbook's record over Approve & Run, Dismiss fix, and "Approved by Maya Chen in Slack" |
| `remediation-runbook-390-de-dark-before.png` | Master: the runbook's Dismiss read "Ausblenden" (Hide) in German, and no record |
| `remediation-runbook-390-de-dark-after.png` | After: the record, "Korrektur verwerfen", and a refused Dismiss fix headed "Die Korrektur wurde nicht verworfen" |
| `ai-insights-fixes-1280.png` | AI Insights' Fixes section: Where fixes were approved |
| `ai-insights-fixes-390-fa-before.png` | Master: the verification line in English on a Persian page |
| `ai-insights-fixes-390-fa-after.png` | After: the verification line in Persian with Persian digits, over the places |
| `activity-cloud-environment-390.png` | The run's activity naming an App Platforms environment as a Cloud environment |
| `chat-runbook-message.png` | A waiting runbook's Slack and Teams message: its record, with each earlier incident and alert linked |
| `chat-runbook-message-390-dark.png` | The same on a phone in dark mode |
| `chat-runbook-dialog.png` | Review and approve's dialog: Slack's modal and Teams' card |
