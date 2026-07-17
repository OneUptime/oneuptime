---
name: verify
description: Drive the local OneUptime dev stack end-to-end (login, dashboard UI) to verify changes at runtime.
---

# Verifying changes against the local dev stack

## Stack layout

- The dev stack runs in docker compose: `oneuptime-app-1` (all FeatureSets,
  `npm run dev` with host source mounted — edits hot-restart via nodemon),
  `oneuptime-postgres-1`, `oneuptime-clickhouse-1`, `oneuptime-ingress-1`
  (nginx on host port 80).
- App URL: `http://localhost/dashboard/` (302→200 when up, 502 while the app
  boots). Accounts app: `http://localhost/accounts/login`.
- **Gotcha:** the app container restart-loops every few minutes ("restarting
  due to changes" with no source edits) and each boot takes 1–3 min. Wrap UI
  runs in a wait-for-200 loop and retry page loads; a container restart also
  invalidates browser sessions, so **log in fresh in every script run**.

## Login

- Seeded master admin: `verify@example.com` / `VerifyPass123!` (its password
  hash in Postgres `"User"` equals sha256(ENCRYPTION_SECRET + password) with
  the default `please-change-this-to-random-value` secret from `config.env`).
- Login button is `button:has-text("Login")` (not `[type=submit]`).

## Driving the UI

- Playwright lives in `E2E/node_modules`; run scripts with
  `cd E2E && NODE_PATH=node_modules node <script>`.
- Test project: "Verify Project" `7e9fbac9-1027-4171-892c-726268ed9202`.
- Dashboards: list page `/dashboard/<projectId>/dashboards`, open with
  `button:has-text("View Dashboard")`. Edit mode:
  `button[title="More dashboard options"]` → `text=Edit Dashboard`. Widgets:
  `Add Widget` → search → click the card (settings modal opens automatically
  with a live preview). Dropdowns are react-select: fill
  `input[id$="-input"]` and press Enter.
- The dashboard time-range picker only renders in view mode when the
  dashboard has components.

## Telemetry test data

- ClickHouse tables: `oneuptime.SpanItemV3`, `LogItemV3`, `MetricItemV3…`.
  Query via `docker exec oneuptime-clickhouse-1 clickhouse-client -q "…"`.
- The seeded spans are old/nameless; INSERT fresh rows (projectId,
  primaryEntityId 'OpenTelemetry', name, statusCode, isRootSpan=true, recent
  startTime + matching UnixNano columns, retentionDate) so charts show data
  in the default "Past 1 Hour" range.
