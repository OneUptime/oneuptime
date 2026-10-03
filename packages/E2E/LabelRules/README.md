# Label rule import and export browser coverage

The production-page browser suite runs without a OneUptime server:

```bash
cd packages/E2E
npm run test-label-rule-transfer-ui
```

It renders the actual Network Device and Monitor Label Rules pages, their tables,
and the import/export components. Only ModelAPI data access and the user's
permission snapshot are replaced. It covers paste and upload, validation before
writes, destination label mapping, 501-row export pagination, preview editing,
partial failures and retry downloads, permissions, and file-size limits.

Screenshots are saved under `output/playwright/label-rule-import-export/` at the
repository root. Every fixture image displays **Demo workspace · Synthetic data**
to distinguish it from a live deployment. These screenshots verify the production
UI; they do not demonstrate database persistence.

## Live Dashboard and API integration

Run the separate live suite against a running OneUptime development server with
billing disabled:

```bash
cd packages/E2E
HOST=localhost:18081 HTTP_PROTOCOL=http BILLING_ENABLED=false npm run test-label-rule-transfer
```

This suite registers a fresh user, creates isolated projects, exercises the actual
Dashboard and CRUD APIs, downloads JSON, and reads persisted records back through
the API. Existing projects are not modified, and the suite deletes its own
projects after it finishes. Only the deliberately failed-create and denied-create
cases intercept browser requests.

The live suite must run behind the normal OneUptime ingress routes. When using a
standalone App container directly, the ingress must map `/identity/*` to
`/api/identity/*` as the development ingress does.

CI runs it in `test-release.yaml`'s `test-e2e-test-self-hosted` job, once per
run: shard 1 runs it after its own share of the default suite, against the
self-hosted stack it booted (billing off), from the e2e image with
`docker compose ... run --rm e2e npm run test-label-rule-transfer`. Failure
traces go to `packages/E2E/test-results/label-rule-transfer/`, inside the
directory the e2e container mounts, so the job's failure artifact carries them.
