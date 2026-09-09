# GitHub integration validation

The integration combines verified GitHub webhooks, durable delivery processing, project-scoped workflow triggers, and native GitHub actions. No new database columns or migrations are required. Existing installations must approve additional GitHub App permissions; the App owner configures the event subscriptions described in the [setup guide](../../../App/FeatureSet/Docs/Content/en/self-hosted/github-integration.md).

## Targeted automated coverage

| Area                  | Coverage                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP admission        | Exact-byte HMAC verification, Unicode and whitespace, tampering, missing headers/raw body, malformed payloads, ping, unsupported events, queue failure, acknowledgment timing                                                      |
| Delivery storage      | Stable installation/delivery identity, concurrent redelivery, retained completion markers, retryable failures, exhausted-job redelivery, Redis and lock failures                                                                   |
| Installation routing  | Authoritative project ownership, connected repository matching, suspension, uninstall, repository changes, partial failures, cross-project isolation                                                                               |
| Event trigger         | All 11 event families, action/repository/branch/label/sender filters, issue versus PR comments, command boundaries, edited comments, bots, current collaborator access, variable resolution, invalid filters, manual sample values |
| Workflow scheduling   | Deterministic persisted run IDs, partial enqueue recovery, terminal and running logs, billing/usage gates, unchanged ordinary workflow scheduling                                                                                  |
| GitHub actions        | Every request method, URL and payload; issue/PR updates; empty body and array values; labels; assignees/reviewers; Enterprise Managed Users; response mapping; error ports                                                         |
| API authorization     | Project/repository/installation binding, narrowly scoped tokens, encoded path segments, request deadlines, rate limits, transient errors, revoked access, token/error redaction                                                    |
| Template safety       | Untrusted comments containing variable/loop syntax remain literal, JSON escaping, typed values, nested authored loops, existing substitution regressions                                                                           |
| Setup UI              | Starter cards, direct wizard entry, required configuration, disabled creation, variable creation, template graph validity and component registry parity                                                                            |
| Persisted integration | Signed HTTP requests through the running app, actual Redis/BullMQ and PostgreSQL, workflow execution, duplicate deliveries, invalid signatures and routing exclusions                                                              |
| Browser               | Account/project onboarding, GitHub setup panel, configuration validation, template creation and persisted disabled workflow graph                                                                                                  |

The Common suites live under `Common/Tests/{Utils/CodeRepository,Server/API,Server/Utils,Server/Types/Workflow/Components,Types/Workflow,App/Dashboard}`. The workflow-runner tests live under `App/Tests/FeatureSet/Workflow`. Test only these relevant suites when iterating; the repository-wide suite runs in CI.

Use the repository's supported Node version and dependencies, including the matching `isolated-vm` native module. Run `npm run fix` at the root, then `npm run compile` in `Common`, `App`, `App/FeatureSet/Dashboard`, and `E2E`.

## Real queue and database test

Use a disposable running OneUptime environment with its own PostgreSQL database and Redis. Enable the Workflow service and queue workers. Set a local webhook secret; live GitHub credentials are not needed for this suite. Supply the same database, Redis and application environment to the test process as the server.

From `App`:

```sh
GITHUB_WEBHOOK_INTEGRATION=true \
GITHUB_WEBHOOK_INTEGRATION_BASE_URL=http://localhost:3002 \
node --no-node-snapshot node_modules/jest/bin/jest.js \
  --runInBand --runTestsByPath \
  Tests/FeatureSet/Workflow/GitHubWebhookIntegration.test.ts
```

The suite is opt-in, generates a uniquely identified project, and cleans up its own fixtures. It exercises the running HTTP handler and workers without replacing the database or queues with mocks, including signed comments creating actual incidents, concurrent redelivery, case-insensitive repository matching, and uninstall cleanup. Reconnection tests use the real repository importer and database with a controlled GitHub repository-list response, then verify that signed comments execute again using the retained repository record. Its comment fixture explicitly disables the current-writer check to avoid requiring a live GitHub installation. Native outgoing GitHub requests and collaborator authorization are covered separately with controlled GitHub API responses; this suite does not modify a real GitHub repository.

## Browser test and screenshots

Build the Accounts and Dashboard frontends, start the application, and wait for its status endpoint to become ready. The example below assumes the application uses `HOST=localhost:18180`, `HTTP_PROTOCOL=http`, and `BILLING_ENABLED=false`; use matching settings for the server, frontends, and test. From `E2E`, point the test at that environment:

```sh
HOST=localhost:18180 HTTP_PROTOCOL=http BILLING_ENABLED=false \
node node_modules/@playwright/test/cli.js test \
  --config playwright.github.config.ts
```

The browser test registers a test user and creates a project. It validates configuration, observes real variable-create requests, and reads the saved workflow graph and variable metadata through the authenticated API. Variable content and the internal denormalized trigger columns are intentionally unavailable to browser reads. It saves screenshots to `output/playwright/github` at the repository root and retains a trace on failure. Set `GITHUB_SCREENSHOT_DIR` to change the screenshot destination. The screenshots checked into this directory are captured from that running application.

## Live GitHub acceptance

For an installed GitHub App with the documented permissions, enable a configured comment-to-incident starter. Post a new `@oneuptime incident <title>` comment as a repository collaborator with write access. Confirm an incident and a GitHub acknowledgment. Redeliver the same delivery from GitHub's Recent Deliveries page and confirm it does not create another incident. Check issue comments, PR conversation comments and inline review comments using matching trigger event settings.

Also verify that comments from a user without write access, bot comments, edited comments and unconnected repositories do not activate the default starter. Revoke repository access and confirm native actions take their Error port. A local signed-delivery test cannot replace this final check of a specific GitHub App's installed permissions and public webhook reachability.
