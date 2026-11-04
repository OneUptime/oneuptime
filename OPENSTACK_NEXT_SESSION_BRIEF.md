# OpenStack epic: brief for the next session

Written 2026-11-04, when the last session stopped because the user's weekly usage limit was close. This file is on the draft PR's branch only. Delete it before that PR merges. The same text is a comment on [epic #5676](https://github.com/OneUptime/oneuptime/issues/5676).

## The job

Build OneUptime's full OpenStack product, as specced in [epic #5676](https://github.com/OneUptime/oneuptime/issues/5676) and its 34 sub-issues. The issue bodies are the spec. Each has a "Done when".

What the user has asked for, in their words where it matters:

- "Lots of customers are requesting for it." All phases, not a v1. "Lets make this world class." "Please write extenisve tests."
- "Keep merging your PRs to master, do not wait for CI." Repeated several times. They'd rather have things on master than held for a big merge.
- **"Please pause after you finish phase 4. Please make sure the issues are updated and PR's are merged to master."** So do not start Phases 5, 6 or 7 until told. That instruction hasn't been met yet, and meeting it is your job.
- "Commit, PR all your work" and "update the issues about any leftovers" when usage runs short.

Standing rules: read `AGENTS.md` at the repo root first, as it binds everything, including how to write. No attribution lines in commits or PRs. PR titles look like `feat(openstack): ...`, because release notes are generated from them. PR bodies say `Closes #N` only when that issue's "Done when" is really met, otherwise `Part of #5676`.

## Where things stand

**On master:**

| PR | What it holds |
|---|---|
| #5754 | The test rig (closes #5717) |
| #5789 | Model, ingest, agent, access, dashboard shell, monitor type, most of Phase 2's pages, the probe backend (closes #5718) |
| #5793 | The migration #5789 forgot (the probe's columns and table) |
| #5798 | Compute, network and storage pages, guard test fixes, `Host.openStackCloudId`, `instanceMetricsOptions`, rig steps for logs, VM metrics and the control plane |
| #5804 | Index for list sorting, traces rig, a guard fix |

**Not on master:** [draft PR #5805](https://github.com/OneUptime/oneuptime/pull/5805), branch `claude/openstack-oneuptime-integration-f314c0`, at `b140af90ee2` plus this file. GitHub says it merges cleanly, and it was 14 commits behind master when written. **It is a raw snapshot of six workers stopped mid-task. Don't merge it as it stands:**

- The dashboard doesn't bundle: `Pages/OpenStack/View/ControlPlaneDependency.tsx:9` has an import that doesn't resolve.
- Nothing on it has been type-checked or tested as a whole.
- It has no uncommitted model or migration changes, so it needs no new migration so far.

**Closed:** #5717, #5718. Every other issue is open, each with a comment saying what's merged and what's left.

**Side sessions, both merged:** #5790 (grouped alerts that never recover when all series vanish) and #5801 (VMware Test connection's missing API route). Neither needs anything from you.

**Rig runs, as last seen:**

| Run | What | State |
|---|---|---|
| [41895167517](https://github.com/OneUptime/oneuptime/actions/runs/41895167517) | Full: drills, `service-logs/`, `instance-metrics/`, access matrix | In progress, but its `control plane clusters` job **failed** at "Break each one, and record what it says" |
| [41895155742](https://github.com/OneUptime/oneuptime/actions/runs/41895155742) | Control plane only | **Cancelled** partway through that same step at 20:26 UTC, cause unknown. An earlier handoff comment points at this run as if it were good: it isn't |
| [41897569884](https://github.com/OneUptime/oneuptime/actions/runs/41897569884) | Traces only, Hibiscus and Flamingo | Queued |

So there are probably no good control plane recordings yet: read that failure and fix it first for #5734. Artifacts last 30 days.

## What to do first

1. Read `AGENTS.md`, this file and the description of #5805.
2. Work on that branch, and merge master in.
3. Fix the broken import and get the dashboard bundling (see "Checks" below).
4. Run a Common type check. Fix what's new. Expected old errors are listed below.
5. Merge what compiles to master in small PRs, as the user wants. Don't let half-written pages through: use the checks.
6. Fix master's red tests (list below). Translation is most of it.
7. Finish the issues below. When Phase 4 is done, update every issue and tell the user: that's the pause they asked for.

## Status by issue

Merged means on master. Nothing has run against a live cloud from OneUptime: everything is proven on recordings of real DevStacks or on made-up rows.

**Phase 1**

- **#5719 agent.** Merged. Left: run the install on a clean Linux machine against the test cloud, with and without Docker. No Docker daemon was available. Systemd units have never run. `start-agent.sh`'s `chmod a+r` means the rig never exercises the uid 65532 path.
- **#5721 access.** Merged, proven on five setups. Left: translated docs, and checking each page's "This credential can't list..." message end to end.
- **#5722 shell.** Merged. Left: walks for Clouds, Archived, rule pages, owners, labels, archive and delete, custom-role grants, and linking to an incident, alert and maintenance event.

**Phase 2**

- **#5723 Overview and health.** Merged. 147 of 148 walks on the last full run; the failure (a fading tooltip) was fixed and passes alone. Left: the AI agent card waits for #5746. Region doesn't narrow Topology, Metrics, Logs or the activity pages.
- **#5724 Services.** Merged, proven on recorded drills on OVS and OVN. Left: `forced_down` isn't shown, because neither the exporter nor the scan reports it. It's only in the raw `nova-services.json`.
- **#5725 compute.** Merged. Left: an instance's image isn't collected. Addresses are empty from the exporter, and the probe reads `accessIPv4/6` rather than `addresses`, so they stay empty: fix the probe. No recording holds an aggregate.
- **#5726 network.** Merged. Left: a full external network and a stopped router agent are proven on rows, not drilled. DHCP agents' networks aren't collected. A router whose agents were all removed keeps its old `l3Agents`.
- **#5727 storage.** Merged. Left: no source says which pool a volume is on. `os-vol-host-attr:host` in the probe's `toCinderVolume` would probably fix it, unverified. No alert template for stuck images.
- **#5728 projects.** Merged. Left: the quota parser has never met real output, because the agent leaves those series off. A slower quota scrape for agent clouds isn't built (it needs a second exporter). Rules by project match a marker in the alert description, not a schema.
- **#5729 monitor.** Merged, 112 series and 30 templates. Left: drill a stopped `nova-compute` opening and closing one incident on the test cloud. Docs translations.
- **#5730 topology.** Merged. Left: `InfrastructureTopologyScale` failed three timing tests under load, unverified on a quiet machine. Instance to network and volume to pool can't be drawn from the agent's data.

**Phase 3**

- **#5731 probe.** Backend merged, 811 tests on recordings. Left, on #5805: the dashboard half, partway written: Data Collection card, connect form, Test connection panel, Trust this certificate, the switch between agent and probe, the Settings mount (the worker was about to mount this). `packages/E2E/OpenStackPages/OpenStackDataCollection.spec.ts` exists. `OpenStackConnectionFormModal.tsx` must become two modals, each with a literal `formType`, for `ResourceDetailsOnePlaceGuard`. Its `collectProjectLimits` option needs UI, because the Projects page already tells probe clouds to turn it on.
- **#5732 scale.** Index merged. Left, on #5805: `bulkUpsert` skipping unchanged rows (313 to 11 MiB of write-ahead log on 200,000 rows), a keyset read, a mock API being written. **Check the skip before trusting it:** the stale window's minimum is 5 minutes (`MINIMUM_STALE_MINUTES`) and the skip can leave `lastSeenAt` up to 5 minutes behind, so a live part could be deleted. I asked the worker to fix this but it was stopped, so verify. Probably not built: load budgets, summary mode, volume calculator, sharding, database exporter path, soak test. Assert request counts exactly, since they don't depend on the machine.
- **#5733 guides.** On #5805, not compiled: `OpenStackDeploymentGuides.ts`, `DocumentationMarkdown.ts`, `DocumentationCard.tsx`, `InstallScripts.ts`. `control-plane-targets.py` has a known bug: it reads Alertmanager's target into the last scrape job. HelmChart files also changed: check why. Kolla runs the exporter in single-cloud mode with no `/probe`, so a job was added (`OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS`). Each guide must say plainly what it was checked against, because none has been followed on a real deployment.

**Phase 4**

- **#5734 dependencies.** Rig merged, no good recording yet (see above). On #5805: `ControlPlaneDependency.tsx` (the broken import), installer and doctor tests partway. Write templates' queries from real recordings. A `sqlquery` receiver for Galera was planned for the Database Agent's mysql config. Use the existing dependency suppression (search `MonitorDependency`) so one failure opens one incident.
- **#5735 VM metrics.** Column and rig merged. On #5805: normaliser, route and pages partway, tests unfinished. Correct them from `instance-metrics/` in run 41895167517. From source, to confirm: Ceilometer's `cpu.delay` is absent on 2025.1 and 2025.2; `libvirt_domain_info_memory_usage_bytes` is the balloon size, not usage; Ceilometer's values change once per polling cycle, so a plain per-scrape rate is wrong.
- **#5736 links.** Column merged. On #5805: partway. A name matching two parts must link to neither.
- **#5737 logs, #5738 events, #5739 audit.** Rig and agent profiles merged (`logs-record.sh`, `install-logs.sh`, two collector configs). On #5805: parsers and pages partway, docs just started. Check formats against `service-logs/` in run 41895167517. Prefer Hibiscus, Flamingo and Epoxy, because control plane drills take Gazpacho's clouds down before that step. Test parsers on long hostile input, per `AGENTS.md`. The two new collector configs haven't been validated by a real collector yet.
- **#5740 traces.** Rig merged. On #5805: parser, pages and guide partway. Predicted from source, unconfirmed: Placement exports nothing, because its config never registers `[profiler_otlp]`, which would make "across Nova, Neutron and Placement" need a small upstream fix. Scheduled traces wait for #5749.

**Not started:** Phases 5 (#5741 to #5744), 6 (#5745 to #5750) and 7 (#5751).

## Red tests on master

- `DocsTranslations`, `DocsNavSections`, `DocsEnglishAnchors`: `telemetry/openstack`, `telemetry/openstack-agentless`, `monitor/openstack-monitor` are English only.
- `InfrastructureTileTitlesInLocale` (16), and probably `DashboardLocalesGuard` and `FeedOptionsLocales`: dashboard strings are English placeholders.
- `TerraformDocsFacts`: `terraform/monitor-steps.md` must name `openstack_monitor` in all 17 languages.
- `ScheduledMaintenanceDocsFacts`: its list lacks the `OpenStackCloud` kind.
- `MonitorRecommendationRoutes`: 7 tests fail with `window.addEventListener is not a function`, raised in `Common/UI/Utils/NewVersion/ChunkLoadError.ts` against the test's stub `window`. Nobody has established whether this work caused it.
- `ResourceDetailsOnePlaceGuard`: fails once the probe's form lands, see #5731.
- `MetricCatalogNamesInLocale`: add OpenStack after translation. In the one-place guard, set `overviewPage` to `"Index.tsx"` if #5723 adds a details card.
- Not ours, not investigated: `UserAttributionColumns` on `feedbackByUserId` in `DataAlert.ts`.
- Speed budgets missed under load, recheck on a quiet machine: `MarkdownConverters`, `InfrastructureTopologyScale`. Never raise a budget to pass.

## Translation

**Dashboard:** about 1,000 strings in `packages/App/FeatureSet/Dashboard/src/Locales/*.json`, 16 languages. Read `src/Locales/README.md`. From `packages/App/FeatureSet/Dashboard`, use `i18n:export` and `i18n:apply`. Run extract last, because workers were told not to run it. "OpenStack" is already in `i18n/SameAsEnglish.json`. `vCPUs` and `L3 agents` may belong there too.

**Docs:** the three pages above, line for line, in de, fr, es, it, pt, nl, da, no, sv, ru, ja, ko, zh-CN, zh-TW, hi, fa: about 106 KB of English per language, and more once #5805's sections land, so translate after the English settles. Each `Docs/Locales/<lang>.json` needs three `navLinks`: OpenStack Agent, OpenStack Monitor, OpenStack Without an Agent. Then add the pages to `AgentInstallDocsServed`, `InfrastructureAgentDocsTranslations` and `TemplatingAndAgentMonitorDocsTranslations`. Read `Docs/README.md`'s content rules: never add to `DocsKnownFailures.ts`. The access table in `telemetry/openstack.md` is generated by `Tests/Ops/openstack-e2e/access-table.py` and pinned by `OpenStackAgentAccessTable.test.js`: don't hand-edit it.

## Code map

- **Model:** `packages/Common/Models/DatabaseModels/OpenStackCloud.ts` and its Feed, LabelRule, OwnerRule, OwnerTeam, OwnerUser, `OpenStackCloudConnectionTest`, `OpenStackResource`. Cloned from Proxmox.
- **Scan:** `Common/Server/Utils/Telemetry/OpenStackSnapshotScan.ts`. `bufferOpenStackSnapshotMetric` folds a datapoint, `finishOpenStackBatch` joins a batch's rows. Called from `App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts`, `flushOpenStackSnapshotBuffers`.
- **Inventory:** `Common/Server/Services/OpenStackResourceService.ts` (`bulkUpsert`, `getInventorySummary`, `getAttentionRows`, `getCounts`, `getBlastRadius`, `deleteStaleForCloud`, project and topology reads). API: `Common/Server/API/OpenStackResourceAPI.ts`.
- **Rules:** `Common/Types/OpenStack/` (`OpenStackHealthRules`, `OpenStackBlastRadius`, `OpenStackQuota`, `OpenStackResourceKind`, `OpenStackCounts`...) and `Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth.ts`. One set of lines for pages and alerts.
- **Pages:** `Dashboard/src/Pages/OpenStack/View/*`, `Components/OpenStack/*`, shared pieces in `Components/OpenStack/Part/`, `Routes/OpenStackRoutes.tsx`.
- **Monitors:** `Common/Types/Monitor/OpenStackMetricCatalog.ts`, `OpenStackAlertTemplates.ts`, `MonitorStepOpenStackMonitor.ts`.
- **Probe:** `packages/Probe/Utils/OpenStack/`, `Jobs/OpenStack/FetchOpenStackWork.ts`, `Common/Server/Utils/OpenStack/`, `App/FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection.ts`.
- **Agent:** `agents/OpenStackAgent/` (`install.sh`, `troubleshoot.sh`, collector configs, `access/`).
- **Rig:** `Tests/Ops/openstack-e2e/`, `.github/workflows/test.openstack-e2e.yaml`.
- **Fixtures:** `Common/Tests/Fixtures/OpenStack/<release>/`. Replay test: `Common/Tests/Server/Utils/Telemetry/OpenStackSnapshotScanRecordings.test.ts`.
- **Browser walks:** `packages/E2E/OpenStackPages/` (read its README), `npm run test-openstack-pages-ui`.

AI access (`aiAccess*` columns, `AiResourceType.OpenStackCloud`) was left out on purpose: it needs the agent's command policy, so it arrives with #5746 and #5747 and a migration of its own.

## What real clouds taught us

Don't relearn these. The recordings prove each one.

- Nova names a service by its short host name, and a hypervisor by its full one. Placement agrees with the hypervisor. Join with `isSameOpenStackHost`.
- Nova's hypervisor series carry no state, and keep reporting a lost host's last numbers. State comes from its `nova-compute`. A lost or disabled host is not capacity.
- `openstack_neutron_floating_ip` has no `port_id`. In use means `router_id` is set. Use `isOpenStackFloatingIpAssociated`.
- A dual-stack pool's IPv6 /64 swamps its total, so address percentages read IPv4 only.
- `openstack_nova_running_vms` has no `tenant_id`. `address_ipv4` and `address_ipv6` are empty. `openstack_cinder_snapshot_gb` isn't sent by the pinned exporter, only a count. Images need `openstack_glance_image_created_at` for status and visibility.
- Nova's zone `internal` is for its control services, never a zone anyone counts.
- `openstack_nova_up` reads 0 only when every call failed, so a failed single read still reads up. A stopped Nova API does give `openstack_nova_up 0`.
- OVN has no L3 agents, so a router there has nothing to be missing. `openstack_neutron_l3_agent_of_router` appears only on ML2/OVS.
- Exporter 1.7.0 (which Kolla pins) has no volume series and no hypervisor capacity series.
- `--disable-slow-metrics` also removes the image list, so the agent instead names each read it leaves out with `--disable-metric`. Naming the series that reads the others turns them all off.
- DevStack calls a service down after 12 minutes unless `NOVA_SERVICE_REPORT_INTERVAL` and `CINDER_SERVICE_REPORT_INTERVAL` are set, and points Neutron at `policy.json`.

**Access, on all five setups:**

- Level 1, an application credential with access rules: every read works, every write 401. It needs `service_type` set for keystonemiddleware and an API restart. Rules match the path a service sees, so behind a path prefix they must be fitted with `access/access-rules-for-cloud.py`.
- Level 2, the `oneuptime_monitoring` role on an **empty zero-quota project**: sees Keystone's lists, all of Nova, Placement, Neutron's agents and address pools. Every write refused.
- Cinder's `os-services` and `get_pools` require an admin context in code, so no policy override opens them. Only level 1 sees them.
- Where Cinder's `enforce_new_defaults` is off, its own default, any role on a project can create that project's volumes, `reader` included. Recorded on Epoxy, Flamingo and Gazpacho. Hence the empty project.
- Level 3, plain reader: through the agent, no instances at all, because the exporter's all-projects read is refused whole.
- To take a policy override off, empty the file, never delete it: on Flamingo, Keystone stopped validating tokens after a read policy file was deleted.

**Decided:** a probe never sends a credential over plain HTTP. Those clouds use the agent or turn on TLS.

## The rig

`gh workflow run test.openstack-e2e.yaml --repo OneUptime/oneuptime --ref claude/openstack-oneuptime-integration-f314c0`, with optional `-f logs_only=true`, `-f control_plane_only=true`, or `-f logs_only=true -f traces_only=true`. About 45 minutes or more per run, five setups. It runs the commit it was dispatched at, so pushes don't disturb it, but another plain dispatch on the same ref cancels it. `control_plane_only` and `traces_only` have their own concurrency groups. A pull_request run on a merged PR gets cancelled by `cancel-closed-pr-runs`, so don't rely on those.

Download with `gh run download <id> --repo OneUptime/oneuptime --pattern 'openstack-recording-*' --dir <folder>`. `import-recording.py` rewrites a release's whole fixture folder, so copy only the subfolder you need unless you mean to refresh everything. Read `gh run view --job <id> --log` for a failed job once its run has finished.

## Running things on this machine

The machine is shared with about 15 other sessions, at load averages of 100 to 500, so wall-clock timings mean little. Run the narrowest test you can, in the background with long timeouts, and don't leave runs behind. **Don't restart Docker, which was down all day, and don't touch other sessions' Postgres (ports 5499 and 55432).**

- **Common:** from `packages/Common`, `npx jest <file> --silent`.
- **App:** from `packages/App`, `NODE_OPTIONS=--max-old-space-size=4096 node ../Common/node_modules/.bin/jest --rootDir . --config jest.config.json <file>`. Its install is partial.
- **Ops:** from `Tests/Ops`, `npx jest --config jest.config.json <file>`.
- **Type check:** from `packages/Common`, `npx tsc --noEmit -p tsconfig.json --incremental --tsBuildInfoFile <file>`. Took up to two hours under load, with the incremental file making later runs faster. Old errors to ignore: `Infrastructure/Queue.ts`, `TableHealthCollector.ts` (`oracledb`, `mongodb`), `RuntimeMetrics.ts` (`IntervalHistogram`): probably stale `node_modules`. The dashboard has no `node_modules` of its own here, so `npm run compile` can't run: earlier workers used a scratch tsconfig.
- **Postgres:** Homebrew Postgres 14. The last session's throwaway server is stopped. Data at `/private/tmp/claude-501/-Users-nawazdhandala-Projects-OneUptime-oneuptime--claude-worktrees-openstack-oneuptime-integration-f314c0/73637e20-a795-4e01-a3c5-4b7d031dca66/scratchpad/pgdata` if it still exists (`mkdir -p /tmp/ou-os-pg`, then `pg_ctl -D <dir> -o "-p 55491 -k /tmp/ou-os-pg" start`), with all migrations up to `AddOpenStackResourceNameIndex1808992960000`. If it's gone: `initdb`, create `oneuptimedb`, and `migration:run`. Database user `postgres`, password from `config.env`. A new worktree needs its own gitignored `config.env`, copied from `config.example.env` with `DATABASE_PUBLISHED_PORT`, `DATABASE_MIGRATIONS_PORT` set to your port, `DATABASE_STATEMENT_TIMEOUT_MS=0`, `DATABASE_CONNECTION_TIMEOUT_MS=300000`, `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS=0`, `DATABASE_QUERY_TIMEOUT_MS=3600000`. Without those timeouts, generating a migration fails under load.
- **Migrations:** `env DATABASE_SLOW_QUERY_LOG_THRESHOLD_MS=0 TS_NODE_TRANSPILE_ONLY=1 sh ./Scripts/Install/WithConfig.sh node --require ts-node/register ./node_modules/typeorm/cli.js migration:generate ./packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/<Name> -d ./packages/Common/Server/Infrastructure/Postgres/LocalMigrationGenerationDataSource.ts`. Apply master's first with `migration:run`, or the diff includes them.
- **Drift:** `TS_NODE_TRANSPILE_ONLY=1 bash ./Scripts/Postgres/CheckSchemaDrift.sh`.
- **Postgres suites:** `RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true OPENSTACK_INVENTORY_TEST_DATABASE_HOST=localhost OPENSTACK_INVENTORY_TEST_DATABASE_PORT=<port> OPENSTACK_INVENTORY_TEST_DATABASE_NAME=oneuptimedb DATABASE_PASSWORD=<it> DATABASE_USERNAME=postgres npx jest --runInBand Tests/Server/Services/OpenStackResourcePostgres.test.ts --forceExit --silent`. See also `OpenStackProjectsAndTopologyPostgres.test.ts` and `OpenStackProbeCollectionSqlPostgres.test.ts`.
- **Strings:** from `packages/App/FeatureSet/Dashboard`, `npx --prefix ../../../.. ts-node --transpile-only scripts/i18n/I18n.ts extract`. It also repairs conflicted locale files.
- **Resource Topology's fixture** can't find `reactflow`, `use-async-effect` or `jspdf` here, and earlier ran with a `NODE_OPTIONS=--require=...` shim setting node paths, plus `FIXTURE_NODE_PATH`.

### Checks

Before each merge, because a type check takes too long:

1. **No model without a migration:** run the drift check.
2. **Does the dashboard bundle?** Run esbuild with `createConfig` from `packages/Common/UI/esbuild-config.js` over `Routes/OpenStackRoutes.tsx`, aliasing `Common`, `react` and `react-dom` as `packages/E2E/OpenStackPages/Fixture/server.js` does. Ignore unresolved `use-async-effect`, `reactflow` and `recharts`, which aren't installed here. Anything else is real.
3. **Generated wiring:** the early wiring was generated by cloning Proxmox blocks with an AST script, which cloned whole statements in places and broke `TelemetryEntity`, `MonitorMaintenanceSuppression` and `SeriesResourceLinker`. A quick AST scan for statements after a `return` and for redeclared names in changed files caught these. They're fixed, but don't clone that way again without those checks.

## Merging, and traps that already bit

- `sync_with_base_branch` needs a clean tree, and it's the way to bring in master. With workers running, commit right before calling it.
- Each merge conflicts in `SchemaMigrations/Index.ts` (keep both, in timestamp order) and often in `Locales/*.json` (run the extract, then `git add`, then `git commit --no-edit`).
- OpenStack migration timestamps must be unique and above master's newest: the first one collided. Newest of ours: `1808992960000`.
- An index or foreign key on an existing table goes through `OnlineDdl`, in its own migration with `transaction = false`. `SchemaMigrationsOnlineDdl` enforces it.
- **Check for model changes before every merge.** A snapshot of a working tree swept probe models onto master with no migration in #5789.
- A merged PR's branch is deleted on the remote. `git push origin HEAD` recreates it, which you need before any `gh workflow run --ref`.
- To merge only finished commits, push one to a new branch: `git push origin "${SHA}:refs/heads/<name>"`.
- The shell is zsh: `$LIST` doesn't word-split (use `bash -c` with an array), `$X:r` is a modifier (write `${X}:r`), and a bare `=====` is an error.
- `HUSKY=0 git commit` skips a slow pre-commit hook. Commit with explicit paths when others are writing.
- Workers in one worktree work if each owns its files, nobody changes git state, and only you commit. Tell them not to run `i18n:extract`, and to message you before changing a model.

## Decisions waiting on the user

- Plain HTTP refusal for probes (decided that way, and told them they can overrule it).
- Whether to send upstream fixes, such as Placement's `[profiler_otlp]`, if the rig confirms it.
- Whether OpenStack's native OpenTelemetry tracing deserves its own issue. oslo.middleware 8.2.0 and oslo.messaging 18.3.1 ship it, off by default, and it could become the always-on path OSProfiler can't be. Untested. The traces page is keyed on the cloud rather than on OSProfiler so such spans could appear there.
- Project and domain as real conditions on owner and label rules, which needs two columns, instead of a description marker.
- Name and logo: the product uses a neutral icon until the OpenInfra trademark check in #5751.

## More context, if it still exists

The last session's transcript and its workers' are on this machine. They're very large, so search rather than read:

- Main: `~/.claude/projects/-Users-nawazdhandala-Projects-OneUptime-oneuptime--claude-worktrees-openstack-oneuptime-integration-f314c0/73637e20-a795-4e01-a3c5-4b7d031dca66.jsonl`
- Workers, under `/private/tmp/claude-501/-Users-nawazdhandala-Projects-OneUptime-oneuptime--claude-worktrees-openstack-oneuptime-integration-f314c0/73637e20-a795-4e01-a3c5-4b7d031dca66/tasks/<id>.output`: `aa7c2a4808dbb36ab` probe, `a881fe5ab93a37326` scale, `a5734515de032df68` guides and dependencies, `a0425e7d5b49a8556` VM metrics and links, `a6cdcaba21ebd81a7` logs, events and audit, `a24cd07e53ce9106a` traces. The first six were stopped mid-task. Finished ones, whose final reports hold test numbers and gaps: `a58c41ddffb7a8806` Overview and Services, `a462b4c1ef609e8f5` part pages, `a84d5c9320ed81308` projects and topology, `a8fe33d76300a5858` monitors, `ac470429ed08eb398` agent and access, `a6da5ede250efc8ee` guards, `ac94f6c854ff3b2af` shell.
- The scratchpad beside `tasks/` also has the epic's source files (`epic/`) and earlier recordings. Temp files can vanish, so don't depend on any of it. The issues, the branch and the fixtures are the durable record. To correct a spec, edit its issue with `gh issue edit`.
