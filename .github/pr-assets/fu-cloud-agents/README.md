# fu-cloud-agents: screenshots

#5367's Cloud agent follow-ups, drawn by the offline Cloud Connect fixture
(`packages/E2E/CloudConnect`): the real Dashboard pages, with the API calls
answered in the page.

- `before-*`: master's code (`c62e937bde1`) with the same fixture, so the
  same data: a change the Cloud AI agent made reads as anyone's, the AI Logs
  page's older sentences are English in German and Persian, and Google
  Cloud's agent runs on Cloud Run for about $45 a month.
- `after-*`: this branch. `after-changes-*` and `after-ai-logs-*` at 2x from
  `?state=connected&changes=ai` (Changes) and `?state=connected&ai=connected`
  (AI Logs); `after-changes-dark-390`, `after-changes-de-1280`,
  `after-changes-fa-390`, `after-ai-logs-linked-fix-1280` and
  `after-gcp-more-fields-390` from the suite's own run (`CI=1 npx playwright
  test --config playwright.cloud-connect-ui.config.ts`).
- `review-*`: after the UI review, from the same fixture at 2x (Inter
  loaded): an account's Changes at 1280 (English, German, dark) and 390
  (English, Persian) - who made a change and who approved it in By, what it
  was for and its AI Logs under what changed, a rollback with no approver -
  and Google Cloud's dialog with Cloud Run picked (its cost line says
  project). `review-remediation-agent-not-connected` is the Event Overview
  fixture's Remediation step at `?state=created&fixing=cluster-agent-not-connected`
  (`CI=1 npx playwright test --config playwright.event-overview-ui.config.ts
  -g cluster-agent-not-connected`).
