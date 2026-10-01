# New projects start with every AI feature on

How these were made: a running stack (the App run natively from the checkout, with Postgres,
Valkey, ClickHouse and nginx in containers, Community Edition, billing off). A brand-new user
signs up and creates a project in the dashboard's Create Project modal, and headless Chromium
opens that project's AI settings pages. Each image is the settings cards of one page, at 1280px
wide, 2x. Nothing was edited on the pages: they show what a new project starts with.

Every `before-*` image is master at 56228c9a5a; every `after-*` image is this branch. Each used
its own fresh database.

- `before-ai-insights-settings.png` / `after-ai-insights-settings.png`: AI → Insights → Settings.
  Before, all three switches read No. After, all three read Yes.
- `before-incident-ai-settings.png` / `after-incident-ai-settings.png`: Incidents → AI →
  Investigation. Automatic investigation was already on for new projects. Instrumentation PRs,
  automatic code fixes and the postmortem draft go from No to Yes.
- `before-alert-ai-settings.png` / `after-alert-ai-settings.png`: Alerts → AI → Investigation.
  Instrumentation PRs and automatic code fixes go from No to Yes.
