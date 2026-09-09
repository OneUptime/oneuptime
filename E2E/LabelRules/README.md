# Label rule import and export integration tests

Run against a running OneUptime development server with billing disabled:

```bash
cd E2E
HOST=localhost:18081 HTTP_PROTOCOL=http BILLING_ENABLED=false npx playwright test --config playwright.label-rules.config.ts
```

The suite registers a fresh user and creates isolated projects through the real
Accounts and Dashboard interfaces and CRUD APIs. It exercises the production
label rule pages, downloads the actual JSON files, and reads persisted rules back
through the API. Existing projects are not modified. The tests clean up their own
projects after the suite.

Only the deliberate partial failure and denied-create cases intercept requests;
all other scenarios use the live server and database. The partial failure test
proves that retry files contain only unsuccessful rows, so already imported rules
are not duplicated on retry.

Screenshots are saved under `output/playwright/label-rule-import-export/` at the
repository root. Set `LABEL_RULE_SCREENSHOTS=true` to capture the review images.
