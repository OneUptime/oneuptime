# Cloud accounts PR: handoff

Working notes so another session can finish this PR. **Delete this file before the PR is merged.**

## The ask

Build every phase of the cloud plan: Cloud Accounts with a full inventory, organization-wide connect, changes and health in AI SRE, recommended monitors, topology and auto-linking, an AWS fix agent, cost and right-sizing, and streaming. The user also asked for:

- extensive tests;
- a PR to `master`;
- once done, merging the PR **without waiting for CI** (the user authorized this).

Still run compile, lint and the relevant tests locally first, as AGENTS.md requires.

## Where things stand

- **Branch:** `cloud/cloud-accounts`, cut from master `fe7a4839d1b`. A **draft PR** to master is open for it (`gh pr view cloud/cloud-accounts`). Keep committing to this branch so the PR follows; the user asked for exactly that.
- **Original worktree:** `.claude/worktrees/github-issue-5259-25a0f6`. A new session can check out the branch, or cut its own branch from it.
- **Commits:**
  - `caec7686f4e`: phase 1 (server side).
  - `21d3ca872e9`: phase 2, the changes and health lanes.
  - `5e1b0b2b301`: phase 2, links and AI tools.
- **No database migration exists yet.** Generate a single one at the very end, after every model change (see step 8).

### Done: phase 1, server side (`caec7686f4e`)

- **Inventory types**
  - `Types/Cloud/CloudInventory.ts` holds relationships (runs-in, part-of, routes-to, protected-by, attached-to, dead-letters-to), tags, properties, endpoints and their bounds.
  - `Types/Cloud/CloudAccountSummary.ts` summarizes an account's resources.
- **The `CloudAccount` model, service and API**
  - Files: `Models/DatabaseModels/CloudAccount.ts`, `Server/Services/CloudAccountService.ts` (extends ProjectReferencesService), `Server/API/CloudAccountAPI.ts`. The API is registered in BaseAPI and in the model and service indexes.
  - The unique key is (projectId, provider, accountId).
  - Columns already exist for later phases: `costSummary`, `costReadAt`, `labels` (join table CloudAccountLabel).
- **New `CloudResource` columns, all read-only:** `cloudTags`, `cloudProperties`, `cloudRelationships`, `cloudEndpoints`, `inventoriedAt`.
- **Inventory readers**
  - AWS: Cloud Control `ListResources`. See `Aws/AwsCloudControl.ts`, `AwsInventoryCatalog.ts` (about 22 types, identity taken from the CloudWatch dimensions) and `AwsInventory.ts`.
  - Azure: Resource Graph (`Azure/AzureInventory.ts`).
  - GCP: Cloud Asset (`Gcp/GcpInventory.ts`).
  - Every item resolves through `resolveCloudMonitoredResource`, so an inventory row and a metric row are the same row.
- **Lanes**
  - `CloudConnectionLanes.runInventory` runs every 30 minutes with its own budget and the read deadline. `keepAccounts` keeps the CloudAccount rows.
  - `CloudConnectionPullRunner` runs them after the metrics.
  - `CloudConnectionResourceSync.syncInventory` re-runs the label and owner rules when a resource's tags change.
- **Organizations**
  - AWS reads all accounts through the same role in each one: StackSet, `organizations:ListAccounts`, at most 50 accounts.
  - GCP reads an organization's projects through `searchProjects`, at most 50.
  - The `readScope` field and `CloudConnectionSetupScope` choose between one account and the organization.
- **Setup commands** (`Types/CloudConnection/CloudConnectionSetupCommands.ts`, rewritten)
  - AWS action groups now include CloudTrail, Health, Cost Explorer, Organizations and Cloud Control.
  - GCP gets four roles, including `roles/servicehealth.viewer`.
  - Azure gets a cost reader.
  - The Azure command prints `endDateTime`, and secret expiry is a hidden config field (`AZURE_SECRET_EXPIRES_AT_KEY`). A 30-day expiry warning and an "expired secret" explanation were added.
- **Tag rules:** `cloudTagPattern` on `CloudResourceLabelRule` and `CloudResourceOwnerRule`, plus the dashboard "Cloud Tag" field.

### Done: phase 2 (`21d3ca872e9`, `5e1b0b2b301`)

- **Changes and health lanes**
  - Readers: `Aws/AwsChanges.ts` (CloudTrail LookupEvents, AWS Health), `Azure/AzureChanges.ts` (Activity Log: Administrative, ServiceHealth, ResourceHealth) and `Gcp/GcpChanges.ts` (Admin Activity audit log, Service Health).
  - `readChanges` on each connector, and `CloudConnectionLanes.runChanges` runs it every read, after the inventory.
  - `CloudChangeWindow.ts` handles cursors per place, a 20-minute overlap, remembering events already seen, and forgetting stale places.
  - `CloudChangeRecorder.ts` writes the results as ChangeEvent rows: project-wide, tied to the CloudResource (`oneuptime.resource.type`/`.id`) and the CloudAccount (`oneuptime.cloud_account.id`), with a hashed dedup token.
  - Vocabulary in `Utils/Telemetry/ChangeEventFields.ts`: type `provider-event`, sources `cloud` and `cloud-health`, `cloud.*` and `oneuptime.cloud.*` keys.
- **Investigations**
  - `RecentChangesContext` reads cloud changes separately (MAX_CLOUD_CHANGES_READ), so a busy cloud account can't crowd out a deploy.
  - It groups one resource's calls into a single change.
  - `FixProductionVerifier` now reads only changes that name a commit.
- **Links**
  - Monitor, Incident and Alert have a `cloudResources` relation (join tables MonitorCloudResource, IncidentCloudResource, AlertCloudResource).
  - Server-side wiring: `AffectedResourceRelations`, `LinkedAffectedResources` (type CloudResource, route `cloud`, after databaseServers), `SeriesResourceLinker` (`cloudResourceIds`, filled only from the monitor's Linked Resources), `MonitorResourceContext` and `LinkedInfrastructureContext`.
  - ScheduledMaintenance deliberately does **not** have this relation yet: it would not silence monitors.
- **AI tools**
  - `Toolbox/CloudTools.ts` adds `query_cloud_resource` (inventory, relationships in both directions) and `query_cloud_accounts`.
  - `recent_changes` gained `cloudResourceId` and `cloudAccountId` filters and reads cloud changes in a separate pass.
  - Prompt guidance (`ObservabilityChatPrompt.ts`) and dashboard `TOOL_DESCRIPTIONS` (`Utils/InvestigationEvidenceFormat.ts`) are updated.
- **Fixes found along the way**
  - `EntraTokenClient` now keeps the error's `responseBody`. Without it, the expired-Azure-secret explanation could never trigger.
  - An AWS Region the account has not opted into no longer fails the change read.

### Known failing tests (expected)

- `Tests/Server/Utils/AffectedResources/LinkedAffectedResources.test.ts`, test "covers the categories the dashboard's Affected Resources cards render, in their order". It passes once the dashboard wiring (step 1a) adds `cloudResources` to `AffectedResourcesDisplay.tsx`.
- `Tests/Server/Utils/Monitor/MonitorMetricUtilCriteriaFilterMatches.test.ts`, test "keeps the rows as long…". It depends on the date (a daylight-saving change falls within 30 days) and also fails on master.
- `InvestigationSummaryLinearTime` and `TldrBlockMarkersLinearTime` are timing tests. They fail only when they run inside a huge parallel jest run, and pass on their own.

## Remaining work, in order

### 1. Finish phase 2

**a. Dashboard wiring for `cloudResources`.** This is the next task; it was stopped before any files changed. Wire the relation everywhere `databaseServers` and `storageArrays` are wired for incidents, alerts and monitors, but not scheduled maintenance. Keep the server order: … iotFleets, databaseServers, **cloudResources**, networkSites, services, serviceLevelObjectives.

- **Files**
  - `Components/AffectedResources/`: `AffectedResourcesDisplay.tsx` (the props list order is parsed by the server test above; add a `hideCloudResources` flag), `AffectedResourcesPicker.tsx`, `AffectedResourcesCell.tsx`, `AffectedResourceNames.ts`, `MonitorLinkedResourcesPrefillRules.ts`, `MonitorLinkedResourcesPrefill.tsx` and `buildAffectedResourcesFacet.ts`.
  - `Components/Incident/`: `IncidentsTable.tsx`, `IncidentAffectedResourcesFormFields.tsx`.
  - `Components/Alert/AlertsTable.tsx`.
  - `Components/Monitor/`: `MonitorLinkedResourcesFormFields.tsx`, `Overview/MonitorLinkedResourcesCard.tsx`.
  - `Components/CreateFromRecord/CreateFromRecord.ts` and `Components/ResourceActivity/ResourceActivityCards.tsx`.
  - `Pages/Incidents/{Create,View/Index}.tsx` and `Pages/Alerts/{Create,View/Index}.tsx`.
- **New element:** create `Components/Cloud/CloudResourceElement.tsx`, modelled on `DatabaseServer/DatabaseServerElement.tsx`. It should link to `PageMap.CLOUD_RESOURCE_VIEW`.
- **Tests to update:** the files under `packages/Common/Tests/App/Dashboard/` named `AffectedResources*`, `AlertsTableAffectedResources`, `MonitorLinkedResources*`, `EventOverlayScope*`, `EventOverviewPages`, `*MonitorsApart`, plus `packages/App/Tests/Dashboard/AffectedResourcesFacet.test.ts`.
- User-visible text must go through `translationKey`, `useTranslator` or `TranslatedSentence`. Hardcoded-string guard tests check this.

**b. A cloud resource's own Incidents and Alerts tabs.** Copy `Pages/StorageArray/View/{Incidents,Alerts}.tsx` and its side menu entries. This adds PageMap, RouteMap, `Routes/CloudResourceRoutes.tsx`, `Utils/Breadcrumbs/CloudBreadcrumbs.ts` and `PageSearchIndex` entries (see the guards in the conventions section).

**c. On-demand change read when an investigation starts.** Not started. Here is the design.

1. **Record each event once, whoever reads it.** In `CloudChangeRecorder.record`, claim each change with `GlobalCache.setStringIfNotExists("cloud-change-recorded", "<projectId>:<provider>:<accountId>:<eventId>", "1", { expiresInSeconds: 3 days })`.
   - Skip a change that is already claimed.
   - If the cache throws (Redis down), write anyway.
   - Tests mock `GlobalCache`, as `OwnChangeRecorder.test.ts` does.
2. **Add `Server/Utils/CloudConnection/CloudChangeLookBack.ts`.** Given the linked CloudResource ids:
   - Load each one's provider, account, region and `cloudConnectionId`, as root and pinned to the project.
   - For each connection, look up the connector with `CloudConnectorRegistry.getConnector`, and the settings with `CloudConnectionService.getConnectorSettings`.
   - Call `readChanges` with: `since` = subject creation time minus `CHANGE_LOOKBACK_MINUTES`; `only` = those accounts and Regions; a **copy** of `pullState`; a small budget (about 60 requests, 20 s); and the same transport PullRunner uses.
   - Pass the results to `CloudChangeRecorder.record`.
   - It never throws.
3. **Call it** in `IncidentInvestigationRunner` (just before `RecentChangesContext.read`, around line 625) and in `AlertInvestigationRunner` (around line 388), only when `linked.resources` includes a CloudResource.

**d. Chart markers** (`Components/Metrics/Utils/EventOverlayScope.ts`).

- Support `cloudResourceId`, which is in `UNSUPPORTED_RESOURCE_KEYS` today. Incidents and alerts match through the `cloudResources` relation. Change events match with `attributes["oneuptime.resource.id"]` = the CloudResource id.
- For unscoped charts, consider leaving cloud changes out (`attributeKeys` IncludesNone `cloud.provider`) so a busy account doesn't flood every chart. `EventOverlayScope.test.ts` currently expects `changeEventQueries: [{}]` for unscoped charts.

**e. Topology.** Add a cloud account (or cloud resource) topology to `Components/ResourceTopology`, built from `cloudRelationships`.

- Entry points:
  - `ResourceTopologyPage.tsx`: `load()` returns arrangements.
  - `ResourceTopologyModel.ts`: `buildResourceTopologyGraph({rootId, nodes, relations, issues})`.
  - `ResourceTopologyKinds.ts`: add cloud kinds.
- Use the loaders and builders in `Loaders/InventoryTopologyLoaders.ts` and `Builders/StorageArrayTopology.ts` as models.
- Nodes are the account's resources. Parents come from RunsIn and PartOf. Relations come from RoutesTo, ProtectedBy, AttachedTo and DeadLettersTo.
- The name and id matching lives in `CloudResourceIndex`, in `Server/Utils/CloudConnection/CloudChangeRecorder.ts`. Move it into `Common/Utils` or `Common/Types` so the dashboard can use it too, and keep the "same type only" rule from `Toolbox/CloudTools.ts`.

**f. DNS-based auto-linking.** Match the hosts of website, API, SSL and ping monitors, and service endpoints, against `CloudResource.cloudEndpoints`: load balancer DNS names, CloudFront, API Gateway, Cloud Run, App Service. `normalizeCloudHost` is in `CloudInventory.ts`.

- Then add or suggest a link in the monitor's `cloudResources`.
- It runs as a worker job, or after `syncInventory`, scoped to the project.
- Prefer "suggested link" over silently linking. Add tests.

### 2. Cloud Accounts dashboard pages (phase 1 UI)

- **List page and view pages.**
  - View tabs: Overview (summary by type and Region, last read, last full listing, connection), Resources (filtered CloudResource table), Topology (1e), Changes (ChangeEvent rows with `oneuptime.cloud_account.id` = account row id, or `cloud.account.id`), Recommendations (step 3), AI (step 4), Costs (step 5), Settings, Delete.
  - A Developer section is required, or an exemption: `getDeveloperSideMenuSection`, `DeveloperDocsPages.ts`, `DEVELOPER_DOCS_PROFILES` in `Common/Utils/DeveloperDocs/ResourceProfiles.ts`.
  - The model route is `/cloud-account`.
- **Wiring.** Add PageMap, RouteMap (`CloudRoutePath` around line 552, absolute routes around 5516), `Routes/CloudResourceRoutes.tsx`, `Utils/Breadcrumbs/CloudBreadcrumbs.ts`, `Pages/Cloud/SideMenu.tsx`, `NavigationItems.tsx` (Cloud entries around line 612) and `CommandPalette/PageSearchIndex.ts`. Also mount the routes in `App.tsx`.
- **Connect form**
  - Add a scope toggle for `readScope` (AWS role only, Azure and GCP). See `CloudConnectionCatalog` `READ_SCOPE_FIELD_KEY` and `isHidden`.
  - The form must keep hidden config fields (the Azure secret expiry) when saving.
  - Show the expiry warning.
- **Text fix.** `Components/Cloud/Connect/CloudConnectionWords.ts` says "Resources show up once they report metrics". That is no longer true, because the inventory lists resources directly. Show `changesRecorded` from the read summary as well.
- **Cloud resource view.** Add tags, properties, relationships and endpoints, read from the new columns.

### 3. Recommended monitors for cloud resources

- Add a cloud resource type to `MonitorRecommendationResourceType`, plus `Types/Monitor/CloudResourceAlertTemplates.ts`: per type, CPU, errors, latency, throttles, queue age, 5xx and so on.
- Use metric names from `getAwsStoredMetricName`, `getAzureStoredMetricName` and the GCP metric types (0–1 ratios). Filter on the resource's `telemetryAttributes`.
- `DatabaseAlertTemplates.ts` is the closest model.
- Register it in `Types/Monitor/Recommendation/*`, `MonitorRecommendationCatalog.ts`, the dashboard `Components/Recommendations/RecommendationResourceRegistry.ts`, and a Recommendations tab on the cloud resource and account views (copy `Pages/Database/View/Recommendations.tsx`).
- Fingerprint identity: `MonitorRecommendationUtil.getAttributeScopedResourceIdentifier`.
- **Monitors created from a recommendation must set the monitor's Linked Resources (`cloudResources`) to the resource.** That is how incidents get linked: `MonitorRecommendationCreateUtil.buildMonitor`.
- Tests: `Tests/Types/Monitor/Recommendation/*`, `MonitorRecommendationCatalog.test.ts` (its expected table), and the dashboard recommendation tests.

### 4. Phase 3: AWS fix agent

- Add AI columns to CloudAccount, as on `Host.ts`: `isAiInvestigationEnabled`, `aiRemediationMode`, `aiCommandAllowlist`, `aiAccessLast*`.
- Add an `aws` AiResourceType (`Common/Types/ResourceAiAgent/AiResourceType.ts`: enum, priority list, info) and a typed operation catalog and policy in `Common/Utils/AiRemediation/Resource/`.
  - Model it on `DatabaseDiagnosticCatalog.ts` and `DatabaseCommandPolicy.ts`, registered in `ResourceCommandPolicy.ts` `TOOL_POLICY_BY_TYPE`.
  - The code must be import-closed: relative imports only, no Node built-ins. It is copied into the agent through `agents/ResourceAIAgent/Scripts/CommonCopies.json`; run `npm run sync-common` and `npm run check-common`.
- Agent executor in `agents/ResourceAIAgent/Executors/`, modelled on `ProxmoxExecutor` (HTTP and an injectable transport):
  - its own SigV4 and credential chain;
  - assume a write role per job, with a session name tied to the incident;
  - register it in `ExecutorFactory`.
  - Agent tests use `node:test`: `cd agents/ResourceAIAgent && npm run compile && node --test build/dist/Tests/X.test.js`.
- Server bindings: `ResourceAiAgentService` binding switch (around line 398), `ResourceAiAccessService` `MODEL_SPECS`, and `RunnerJobService.enqueueAiResourceCommand`. Jobs need the incident id or number for the session name.
- Dashboard: `Components/ResourceAiAgent/{ResourceAiAgentDescriptors,ResourceAiAgentInstall,ResourceAiAgentStatus}.ts`, plus the account's AI pages (pattern: `Pages/Host/View/AI/*`).
- Docs: `infrastructure-ai-agents.md`.
- Helm: a toggle in a separate template file. `values.schema.json` sets `additionalProperties: false`.
- Many tables pin every type: `AiResourceType.test.ts`, `ResourceCommandPolicy.test.ts`, `ResourceAiAgentModel.test.ts`, `ResourceAiAccessAPI.test.ts`, `ResourceAiDeleteCleanup.test.ts`, `ResourceAiAgentStatus.test.ts`, `ResourceAiAgentInstall.test.ts`, `ExecutorFactory.test.ts`, `InfrastructureAiAgentsDocs.test.ts`, `ObservabilityChatPrompt.test.ts`, `AddResourceAiAgentsMigration.test.ts`.

### 5. Phase 4: cost, right-sizing, streaming

- **Cost readers as a new lane** (`readCost`; `costReadAt` is already in PullState):
  - AWS: Cost Explorer `GetCostAndUsage`; `ce:` is already in the read-only policy.
  - Azure: Cost Management query; the cost reader role is in the setup command.
  - GCP: BigQuery billing export, with the table set in config.
  - Write the metric `cloud.cost.daily` (finished days written once) and keep `CloudAccount.costSummary` and `costReadAt` up to date.
- **Right-sizing:** a pure function that turns CPU and memory metrics into a recommendation (model: `Common/Types/Kubernetes/KubernetesRightSizing.ts`), shown as a card.
- **Native Firehose endpoint:**
  - accept CloudWatch metric streams (OTLP 1.0) and CloudWatch Logs subscriptions;
  - follow the pattern of `Telemetry/API/VercelLogDrain.ts`, plus the StartServer raw-body bypass, the `TelemetryIngestSurface` enum and `TelemetryIngestSurfaceWiring.test.ts`;
  - decode OTLP with `OtelPayloadDecoder` (`MetricsData.decode`);
  - map the ingest key to a project with `TelemetryIngest.forSurface` and `TelemetryIngestionKeyService`.
- **A streaming CloudFormation template** in the setup commands, plus docs.

### 6. Docs and translations

- **Rules for every page**
  - Every English page must exist in all 16 other languages with the same shape (`DocsContentRules`).
  - Cloud docs (`CloudDocsPages.ts`) must also pass `CloudDocsTranslations`: translations differ from English, keep the line-for-line shape, and keep the same code, diagrams and numbers. Bold labels must equal dashboard labels.
- **Pages to update or add**
  - `cloud-accounts.md` must match the new setup commands word for word, including the exact AWS action list and GCP roles (`CloudConnectDocsFacts`).
  - `cloud-resources.md`: tables equal the catalog (`CloudResourcesDocs`).
  - `change-events.md`: cloud sources, `provider-event`, `cloud.*` keys.
  - `infrastructure-ai-agents.md`.
- **Nav order:** troubleshooting, cloud-accounts, cloud-resources, consecutively. Edit `Utils/Nav.ts` and `navLinks` in all 17 `Docs/Locales/*.json`.
- Subagents work well for translations: one per language, each given the English diff.

### 7. Dashboard i18n

Run `cd packages/App/FeatureSet/Dashboard && npm run i18n:extract && npm run i18n:check`. English-only values are fine. Commit the 17 locale files. New keys so far include "Cloud health" from `UseEventTimeReferenceLines.ts`.

### 8. Migration (once, after all model changes)

1. **Collect the model changes:**
   - the CloudAccount table and the CloudAccountLabel join table;
   - CloudResource: `cloudTags`, `cloudProperties`, `cloudRelationships`, `cloudEndpoints`, `inventoriedAt`;
   - `cloudTagPattern` on CloudResourceLabelRule and CloudResourceOwnerRule;
   - the MonitorCloudResource, IncidentCloudResource and AlertCloudResource join tables;
   - anything added in phases 3 and 4.
2. **Get a throwaway Postgres 14** on port 5401. The old one was session-local:
   - `initdb -D <dir>`
   - `pg_ctl -D <dir> -o "-p 5401 -c unix_socket_directories=''" -l pg.log start`. The empty socket dir avoids a "socket path too long" error.
   - Create the database and user from `config.env`, which must be copied from the main checkout (it is gitignored).
3. **Use an env wrapper** that runs commands from the worktree root with `config.env` loaded and `DATABASE_MIGRATIONS_HOST=localhost DATABASE_MIGRATIONS_PORT=5401`. The `envrun.sh` used here:
   ```bash
   #!/usr/bin/env bash
   set -uo pipefail
   R=<worktree root>
   cd "$R"
   while IFS='=' read -r key value; do
     if [ -z "${!key:-}" ]; then export "${key}"="${value}"; fi
   done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$R/config.env")
   export DATABASE_MIGRATIONS_HOST=localhost
   export DATABASE_MIGRATIONS_PORT=5401
   exec "$@"
   ```
4. **Run** every existing migration (`migration:run`).
5. **Generate:**
   `envrun.sh node --require ts-node/register ./node_modules/typeorm/cli.js migration:generate ./packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/<Name> -d ./packages/Common/Server/Infrastructure/Postgres/LocalMigrationGenerationDataSource.ts`
6. **Make it pass the guards:**
   - Renumber it above `1807840000000` (for example `1807850000000-AddCloudAccounts`), add a comment header, and register it last in `SchemaMigrations/Index.ts` (`SchemaMigrationsOrdering`).
   - Indexes and foreign keys on **existing** tables (the Monitor, Incident and Alert join tables reference existing tables) go in a separate `transaction = false` migration that uses the OnlineDdl helper (`SchemaMigrationsOnlineDdl`).
   - Don't change the CloudConnection model: `AddCloudConnectionMigration.test` pins its columns.
7. **Run a schema drift check:** generate again and expect no changes.

### 9. Verify everything

- **Compile:** `npm run compile` in `packages/Common`, `packages/App` and `packages/App/FeatureSet/Dashboard` (the Dashboard uses `NODE_OPTIONS=--max-old-space-size=12288`). Also compile the tests: `npx tsc -p tsconfig.tests.rest.json`, plus `.app` and `.ui`, in Common.
- **Faster type-check while iterating:** a focused tsconfig that `extends packages/Common/tsconfig.json` with `files` set to the changed files and `incremental: true`.
- **Lint:** from the root, run `NODE_OPTIONS=--max-old-space-size=12288 npx eslint --fix <files>` on 8 files at a time; longer lists run out of memory. With zsh, pass multi-file lists through `bash -c`.
- **Tests**
  - `cd packages/Common && npx jest <paths>`. This does not type-check.
  - `cd packages/App && npx jest <paths>`.
  - The agent tests.
  - Postgres tests are skipped unless `RUN_POSTGRES_<X>_TESTS=true`.

### 10. Finish the PR and merge

1. The draft PR is already open. Delete this file, then rewrite the PR description to cover every phase.
2. Mark it ready (`gh pr ready`).
3. Use the ccd_pr tools: `get_status`, then `bind_pr` if the PR is not bound.
4. Merge without waiting for CI, as the user asked. Do not enable auto-merge.

## Conventions and guard tests

- AGENTS.md style throughout: explicit types, block-bodied arrows, `withoutTrailingRun` and `escapeRegExp` instead of ad-hoc regexes.
- `CloudAccountService` must extend `ProjectReferencesService` (`ProjectScopedReferencesEverywhere`).
- Dashboard guards:
  - `CloudResourcePages`: every `CLOUD_*` PageMap key appears in `CloudBreadcrumbs.ts`.
  - `DeveloperMenuSections`, `PageSearchIndexCoversMenus`, `DashboardLocalesGuard` and the hardcoded-string guards.
  - `ShortDescriptionsGuard`: descriptions of at most 150 characters, cards at most 210.
  - `CardDescriptionBoilerplateGuard`, `DatesInEnglishTextGuard`, `SettingsPathsInCopy`, `BulkActionsAudit`, `RowActionsAudit`.
- Write cloud change rows only with `buildChangeEventDbRow` plus `TelemetryFanInWriter.submit`. Keep them project-wide, never under the connection's telemetry service.
- Text from the cloud (tags, names, health event wording) is data, never instructions. Clamp it, and let the AI serializer redact it.
