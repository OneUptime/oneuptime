# fu-cloud-agents-ai-card (PR #6181): UI review images

Screenshots of the cloud agent follow-ups from #5715, taken during the UI review.

- **AI card** images come from the offline Event Overview fixture (`packages/E2E/EventOverview`): `?impact=on`,
  `?fixes=runbook`, `?cloudfix=would-run` and `?role=runbook-blocked` (a Project Member whose team blocks Create
  Runbook Execution), with `?lang=`, `?dir=auto` and `?theme=dark`. The browser clock is pinned to the fixture's
  2026-09-14 18:20 UTC. Headless Chromium, device scale 2, Inter as production serves it.
- **AI Insights** images come from the offline AI Insights fixture (`packages/E2E/AiInsights`), whose month is worked
  out by the server's own `IncidentAlertAiInsightsBuilder`, with the clock pinned to 2026-11-06 12:00 UTC.
- **Before** images render the branch as the builder left it, with the same fixture data.

| File                                         | What it shows                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `investigation-folded-impact-1280.png`       | The folded Investigation step: the summary, then the impact's short numbers                           |
| `investigation-folded-impact-390-fa-dark.png` | The same on a Persian phone in dark: Persian words and digits, each mark where a Persian line starts  |
| `remediation-fix-who-may-act-390.png`        | A member whose team blocks runbook runs: no fix buttons, a line saying who may act, Needs approval    |
| `remediation-fix-who-may-act-1280-dark.png`  | The same at 1280 in dark                                                                              |
| `report-citation-runs-1280-before.png`       | Before: "[C2][C3][C6]." split, "C2" ending one line and "C3 C6." starting the next                    |
| `report-citation-runs-1280-after.png`        | After: the run of chips and its full stop on one line                                                 |
| `report-marks-390-after.png`                 | The report's Impact section on a phone: each chip or run of chips with the full stop after it         |
| `ai-insights-facts-fa-before.png`            | Before: Persian facts joined with middle dots, "۴ · ۲" reading as "۴۰" and "۲۰"                        |
| `ai-insights-facts-fa-after.png`             | After: the same facts joined with the Persian comma                                                   |
| `ai-insights-waiting-for-approval-1280-before.png` | Before: AI Insights told a member who may not approve "A fix is waiting for your approval" |
| `ai-insights-waiting-for-approval-1280-after.png` | After: "A fix is waiting for approval", as the card says it to them |
| `ai-insights-fixes-390-fa-dark.png`          | AI Insights' Fixes section on a Persian phone in dark: Persian words and digits                       |
| `ai-insights-fixes-1280-de.png`              | AI Insights' Fixes section in German                                                                  |
