# Upgrading OneUptime

This guide covers how to safely upgrade your self-hosted OneUptime installation.

## General Guidance

- Upgrade step-by-step across major versions (for example, 6 → 7 → 8). Do not skip major versions.
- You can leapfrog minor/patch versions (for example, 8.1 → 8.4) as long as you follow the release notes.
- Always take backups before upgrading, and validate you can restore them.

## Community and Enterprise Edition images

OneUptime now ships the app as two images. The **Community Edition** is open
source under the Apache License 2.0 and includes SAML and OIDC single sign-on,
global SSO and "Require SSO for login". The **Enterprise Edition** adds the
enterprise modules from the repository's `ee/` directory: SCIM, team
compliance, audit logs and the enterprise Health dashboards in the Admin
Dashboard. Before this change both editions ran the same code, and
`IS_ENTERPRISE_EDITION` decided which features were switched on. Now the image
decides, and the Community image does not contain the `ee/` directory.

The [Enterprise Edition](/docs/self-hosted/enterprise) page has the full
feature comparison, licensing details and what happens when you switch
editions.

### What to do before you upgrade

- **Community Edition without SCIM:** nothing. Upgrade as usual.
- **Helm with `image.type: enterprise-edition`:** nothing. The chart already
  pulls the `enterprise-` images, which now contain the enterprise modules.
- **Docker Compose with `IS_ENTERPRISE_EDITION=true`:** switch to the
  Enterprise image when you upgrade by setting `APP_TAG=enterprise-release`
  (or `enterprise-<version>`) in `config.env`. `APP_TAG=release` is the
  Community image, and `IS_ENTERPRISE_EDITION=true` no longer switches anything
  on. `npm run update` makes this change for you while
  `IS_ENTERPRISE_EDITION=true` (`release` becomes `enterprise-release`, a
  pinned `13.0.7` becomes `enterprise-13.0.7`) and prints what it changed.
  The App now **refuses to start** when `IS_ENTERPRISE_EDITION=true` is set on
  the Community image, instead of silently stopping SCIM provisioning and
  audit logging. The error says what to set:
  `APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
  `IS_ENTERPRISE_EDITION=false` to run the Community Edition.
- **Community image with SCIM already configured:** SCIM provisioning stops
  with this upgrade, including deprovisioning. Switch to the Enterprise image
  to keep it. Otherwise, read [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community)
  before you upgrade. It explains what stops and who to remove first. To run
  the Community Edition, also set `IS_ENTERPRISE_EDITION=false`. Single
  sign-on is not affected: the Community image serves it too.

Your configuration is never deleted, and no migration is needed to switch
editions in either direction.

### Licensing after the upgrade

The Enterprise Edition now checks its license:

- **An install with a license key** keeps working. It checks the license with
  OneUptime when it starts and once a day. If the license expires, everything
  keeps working for a 30-day grace period, and after that the same happens as
  for an install with no license.
- **An install with no license**, for example one that ran the Enterprise
  Edition on `IS_ENTERPRISE_EDITION=true` alone, gets a 14-day trial from the
  first start of this release. **If you use SCIM or audit logging, activate a
  license before the trial ends.** After the trial, SCIM provisioning stops and
  audit logging stops recording. Enterprise configuration also becomes
  read-only and the enterprise Health dashboards are locked. Single sign-on is
  not affected. Everything resumes, without a restart, as soon as you activate
  a license. The trial is for evaluation: production use of the Enterprise
  Edition requires a OneUptime Enterprise subscription. See
  [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing).
- **Air-gapped installs** can activate with a signed license token instead of
  a key. See [Offline activation](/docs/self-hosted/enterprise#offline-activation-air-gapped-installs).

### OneUptime Cloud customers

Nothing changes for you. OneUptime Cloud runs the Enterprise Edition, and your
plan still decides which features you get: SSO, OIDC, SCIM and team
compliance on the Scale plan and above, and audit logs on the Enterprise plan.
Projects on the Scale plan now see the SSO, OIDC, SCIM and team compliance
settings that used to show an upgrade prompt.

### API and endpoint changes

- `GET /api/global-config/license` returns the license key, the license token,
  the instance list, the instance ID and version details only to master
  admins. Other callers get the edition and the license status.
- Self-hosted installs no longer serve the license-server endpoints under
  `/api/enterprise-license/`. Only oneuptime.com uses them.
- The SCIM endpoints keep their exact paths on the Enterprise Edition, so
  identity provider configuration does not change. On the Community Edition
  they return `404`. On the Enterprise Edition they refuse requests while the
  license is lapsed (after the trial or grace period), and answer again as
  soon as a license is activated.
- The SSO and OIDC endpoints (SAML sign-in and ACS URLs, OIDC redirect URIs,
  and the global SSO endpoints) keep their exact paths and are served by both
  editions in every license state.

## Upgrading from OneUptime 13 → 14

OneUptime 14 splits the app into two editions, and the image you pull decides
which one you run. The **Community Edition** (Apache-2.0, the `release` and
`<version>` tags) includes SAML SSO, OpenID Connect, global SSO and "Require
SSO for login". It does not contain the repository's `ee/` directory, so SCIM
provisioning, team compliance settings, audit logs, the Admin **Health**
dashboards and the Admin **Query Console** are not in that image at all. The
**Enterprise Edition** (the `enterprise-release` and `enterprise-<version>`
tags) contains them, and checks an Enterprise license while it runs, which
OneUptime 13 never did. Single sign-on does not depend on that license.

[Community and Enterprise Edition images](#community-and-enterprise-edition-images)
above is the reference for the change: what each edition contains, what to set
on each deployment path, and what the license does. This section is the upgrade
itself. Upgrade from 13 — if you are still on 12, do 12 → 13 first.

Nothing is deleted on either edition. Single sign-on works the same on both:
your SSO and OIDC configuration and your "Require SSO for login" settings carry
over as they are. Your SCIM configuration and the audit logs recorded so far
stay in the database. The Community Edition simply does not serve them, and
switching editions needs no migration in either direction.

### What you need to do

1. **Decide which edition this install runs.** If you use SCIM provisioning,
   team compliance settings or audit logs, or you want the Admin **Health**
   dashboards, that is the Enterprise Edition. Otherwise nothing here needs a
   decision: the Community Edition is what you already have, and it includes
   SAML SSO and OpenID Connect.
2. **On Helm, set the edition in your values file:** `image.type:
   enterprise-edition` (the default is `community-edition`). Leave `image.tag`
   alone — the chart adds the `enterprise-` prefix itself, so `image.tag:
   release` pulls `oneuptime/app:enterprise-release`. This value is not new. If
   you already run `enterprise-edition`, there is nothing to change: the tag you
   already pull now contains `ee/`.
3. **On Docker Compose, set `APP_TAG=enterprise-release`** (or
   `enterprise-<version>` to pin a release) in `config.env`. `APP_TAG=release`
   is the Community image. This is the one thing that stops a 13 install: on 13
   a Compose Enterprise install was `APP_TAG=release` plus
   `IS_ENTERPRISE_EDITION=true`, and that combination now **refuses to start**
   rather than coming up as the Community Edition with SCIM provisioning and
   audit logging silently stopped. `npm run update` rewrites `APP_TAG` for you
   while `IS_ENTERPRISE_EDITION=true` (`release` becomes `enterprise-release`, a
   pinned `13.0.8` becomes `enterprise-13.0.8`) and prints what it changed. If
   you pull images by hand instead, set `APP_TAG` yourself first.
4. **On the Enterprise Edition, activate a license.** An install with no license
   gets a 14-day trial, counted from its first start of the Enterprise Edition —
   for an upgrade that is the day you upgrade, not the day you first installed
   OneUptime. A master admin activates it from the edition label in the Admin
   Dashboard header; air-gapped installs activate with a signed token instead.
   See [Licensing](/docs/self-hosted/enterprise#licensing).
5. **If this install will run the Community Edition while your identity
   provider deprovisions users through SCIM, review who has access before you
   upgrade.** SCIM deprovisioning stops, so the people you remove at your
   identity provider keep their OneUptime accounts, and unless "Require SSO for
   login" applies to them, anyone who can still reach such an account's mailbox
   can set a password with "Forgot password" and sign in. Remove those users
   first:
   [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community).
6. **If you monitor IPv6 addresses with Ping, Port or SSL monitors, re-save
   those monitors after the upgrade.** Destinations saved before 14 may have been
   stored truncated — see [IPv6 Ping, Port and SSL monitors](#ipv6-ping-port-and-ssl-monitors).

### Editions: what changed, and what did not

| | Until 13 | From 14 |
| --- | --- | --- |
| Enterprise code | in every image; `IS_ENTERPRISE_EDITION=true` switched it on | in `ee/`, and only in the `enterprise-` images |
| Helm selector | `image.type` | `image.type` — unchanged, but the images now differ |
| Compose selector | `IS_ENTERPRISE_EDITION=true` | `APP_TAG=enterprise-release` |
| Enterprise license | never checked while running | checked at startup and once a day |
| SSO and OIDC endpoints | the same paths in both editions | the same paths in both editions, whatever the license state |
| SCIM endpoints | the same paths in both editions | the same paths on Enterprise; `404` on Community |
| Your enterprise configuration | stored, enforced | stored either way, enforced on Enterprise |

One migration runs: a nullable `enterpriseEditionFirstSeenAt` column on the
single-row `GlobalConfig` table, which is instant. There is no ClickHouse
migration, nothing is dropped, and no migration is needed to switch editions in
either direction.

### The license timeline on the Enterprise Edition

- **An install with no license** runs a 14-day trial, counted from the first
  start of the Enterprise Edition. Every enterprise feature works during it, and
  the edition label warns before it ends. The trial is for evaluation:
  production use of the Enterprise Edition requires a subscription under the
  OneUptime Enterprise License.
- **A license that expires** gets a 30-day grace period from its expiry date,
  during which every enterprise feature works and the edition label warns.
- **After the trial, or after that grace period**, until a license is activated:
  your identity provider's SCIM requests are refused and audit logging stops
  recording. Enterprise configuration becomes read-only — you can still view
  and delete it and reset a SCIM bearer token, which is what an incident
  needs — and the Admin Health dashboards and Query Console are locked.
- **Nothing is deleted, and core monitoring is never affected.** Monitors,
  alerts, incidents, on-call, status pages and telemetry are outside the
  license, and so is sign-in: SSO and OIDC sign-in, "Require SSO for login" and
  password sign-in for every user, master admins included, work the same in
  every license state. Activating a license restores SCIM provisioning and
  audit logging with the configuration you already have, without a restart.
- **A license key you already have is accepted**, as an "unverified" license: its
  expiry date and seat limit come from what the license server has already told
  this install, and it gets the same 30-day grace period after that expiry.
  Licenses issued from now on are signed and verified by the app itself. You do
  not need a new key for this upgrade.
- **A key whose expiry this install never recorded** keeps working through the
  trial rather than stopping. The license server writes the key and the expiry
  date separately, so an install can hold a key it was never told an expiry
  for. That install is treated exactly like one with no license: every
  enterprise feature works during the 14-day trial counted from the first start
  of the Enterprise Edition, and after the trial the same things stop as above.
  The seat limit is not enforced while the license is in this state, because the
  license record this install holds is already incomplete. A master admin
  re-activating the license from the edition label, or the daily license sync
  fetching the expiry from oneuptime.com, restores it without a restart.

See
[When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing)
for the full state table.

### Docker Compose: pick the image tag

```
git checkout release # Please make sure you're on release branch.
git pull
npm run update
```

- **`npm run update` moves `APP_TAG` while `IS_ENTERPRISE_EDITION=true`**, to
  the Enterprise image of the same release, and prints what it changed. It keeps
  your comments and quoting, leaves an `APP_TAG` that is already an
  `enterprise-` tag alone, and changes nothing on a second run.
- **Pulling images by hand skips that**, and the App then exits at startup with
  an error naming exactly what to set: `APP_TAG=enterprise-<version>` to keep
  the Enterprise Edition, or `IS_ENTERPRISE_EDITION=false` to run the Community
  Edition.
- **To move to the Community Edition deliberately**, set `APP_TAG=release` and
  `IS_ENTERPRISE_EDITION=false`. Read point 5 above first if your identity
  provider deprovisions users through SCIM.
- Nothing else in `config.env` has to change for this release.

### Helm: pick the image type

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **An install already on `image.type: enterprise-edition` needs no values
  change.** The chart has prefixed the tag for a long time; what is new is that
  the `enterprise-` images contain `ee/`. The license applies to it from this
  release, per the timeline above.
- **`image.tag: release` is the default**, so a chart left on the floating tag
  moves to 14 on its next upgrade with no values change at all. If that install
  has SCIM configured on `community-edition`, set `image.type:
  enterprise-edition` in the same upgrade.
- **`IS_ENTERPRISE_EDITION` is still emitted by the chart**, derived from
  `image.type` so the two can never disagree. It gates nothing. Forcing it to
  `true` through `extraEnv` on a Community image only makes the App refuse to
  start. Never set `ONEUPTIME_EDITION` through the chart.
- **Chart probes honor `probes.<key>.allowPrivateNetworkMonitors` again**
  ([#3879](https://github.com/OneUptime/oneuptime/issues/3879)). Nothing changes
  unless you set it — it still defaults to `false` — and it applies to monitors
  from every project on the instance, because chart probes are global probes.
  Loopback, link-local and `169.254.169.254` stay blocked whatever you set.

### Other changes in 14

- **OTLP ingest acknowledges a batch only after the queue accepts it.** 13
  replied `200` first and enqueued afterwards, so a batch the queue rejected was
  lost silently. 14 answers `503` with `Telemetry queue unavailable. Please
  retry.` instead, and the gRPC endpoint returns `UNAVAILABLE`; both are
  retryable, and exporters retry. This applies to logs, metrics, traces and
  profiles. No action is needed, but exporter-side retries and queue
  backpressure are now visible where data used to disappear — worth knowing if
  you size ingest capacity.
- **The Admin Dashboard Health dashboards and the Query Console need the
  Enterprise Edition**, along with the PostgreSQL and Valkey health alerts. On
  13 they came with `IS_ENTERPRISE_EDITION=true` alone, so this is a visible
  loss for a Community install that used them. ClickHouse capacity monitoring
  and pruning, migration status, global probes and the support bundle are in
  both editions.
- **HTTPS monitors that reach an IP address through a probe's proxy work
  again.** The probe used to send the IP as the TLS server name, which is not a
  valid server name and which Node refuses outright, so a monitor on
  `https://<private IP>` from a global probe with
  `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` failed its handshake. The probe now
  omits the server name for an IP target and checks the certificate against the
  IP itself. Hostname targets are unchanged.
- **The `oneuptime` CLI reports its real version** for `--version` instead of a
  placeholder.
- **Runners moved from Project Settings into Runbooks.** Runners are now under
  **Runbooks → Runners** (`…/runbooks/runners`) and Runner Credentials under
  **Runbooks → Runners → Credentials** (`…/runbooks/runner-credentials`), next
  to the runbooks whose steps they run. The old `…/settings/runners` and
  `…/settings/runner-credentials` URLs redirect, so bookmarks keep working.
  Nothing else changes: Runners keep their ids, keys, capabilities and
  permissions, and they still run AI code fixes and AI remediation commands.
  A Runner image older than this release still prints "Project Settings >
  Runners" in its log messages; read that as Runbooks → Runners.
- See [API and endpoint changes](#api-and-endpoint-changes) above for the
  endpoints that moved or tightened, including
  `GET /api/global-config/license` and the license-server endpoints that
  self-hosted installs no longer serve.

### IPv6 Ping, Port and SSL monitors

A Ping or Port destination pasted with surrounding whitespace — which is what
copying an address out of a looking glass or a router config gives you — used to
be stored truncated: `2001:518:2800:9::2 ` became the host `2001` with port
`518`. Both halves are legal, so nothing failed and no error was shown; the
monitor simply watched a host nobody typed. IPv4 addresses were never affected,
because there is no colon to split on. 14 fixes the parsing, together with IPv6
Ping monitors on macOS and FreeBSD probes failing instantly and permanently (and
being reported as real outages) and IPv6 SSL monitors failing with `ENOTFOUND`.

There is no migration for destinations already stored, so **re-open each IPv6
Ping, Port and SSL monitor after the upgrade and save it again**, and check the
destination it shows. Expect monitors that were failing permanently on macOS or
FreeBSD probes to start reporting the truth, which may resolve incidents or
raise new ones.

### Kubernetes agent chart: the Kubernetes AI agent

The `kubernetes-agent` chart now runs the **Kubernetes AI agent** by default:
one small, read-only pod (`component=ai-agent`, image
`oneuptime/kubernetes-ai-agent`) that lets OneUptime AI run `kubectl` while it
investigates an incident or alert on that cluster. It replaces the in-cluster
Runner that `aiAccess.enabled=true` installed. It is not related to the AI
Agent retired in OneUptime 12
([If you ran the standalone AI Agent](#if-you-ran-the-standalone-ai-agent)).

- **Upgrade the OneUptime server before the chart.** The AI agent needs an API
  that older servers do not have. Against one, it logs "This OneUptime server
  does not have the Kubernetes AI agent API" and retries every 5 minutes —
  and the chart upgrade has already removed the old in-cluster Runner. Until
  you can upgrade the server, install the chart version that matches it
  (`--version <your OneUptime version>`).
- **Mirror the image, or opt out, if your upgrades wait.** The chart upgrade
  adds a pod that pulls `docker.io/oneuptime/kubernetes-ai-agent`. If your
  nodes pull through a mirror or an image allowlist and you upgrade with
  `--wait` or `--atomic`, with Terraform or with Flux, mirror the image and set
  `aiAgent.image.repository` (and `aiAgent.imagePullSecrets` for a private
  registry), or pass `--set aiAgent.enabled=false`. Otherwise the pod never
  becomes ready, the upgrade times out, and `--atomic` rolls back the whole
  release.
- **`aiAccess` settings carry over.** Write access, the namespace list, the
  node-operations switch and `aiAccess.extraEnv` keep applying until you set
  the matching `aiAgent.*` value, which always wins. `aiAccess.enabled=false`
  does not turn the AI agent off — `--set aiAgent.enabled=false` does — and
  `aiAccess.image` and `aiAccess.resources` are not carried over.
- **Cluster AI settings are kept**, with two changes made by the server
  upgrade: a cluster whose Runner someone had unbound or deleted (the
  in-cluster Runner or any other) starts with kubectl access off, and
  **Automatic** or **Bypass approval** on a cluster whose project never
  turned on **Enable AI Command Execution** becomes **Ask for approval**.
- **To downgrade the chart, use `helm rollback`**, not
  `helm upgrade --version <older version>`: an older chart's schema refuses the
  `aiAgent` values stored on the release. Within a week of the upgrade, the
  rollback brings the in-cluster Runner back, and it reconnects on its own
  once the AI agent has stopped. After that, OneUptime may have removed the
  old Runner, and the rolled-back one is not used until you bind it to the
  cluster again with the API or Terraform (the cluster's **AI Access
  Runner**; a Project Owner, a Project Admin or **Edit Auto Remediation
  Rule** may do it), or you upgrade the chart again.

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAgent.enabled=true
```

Use your own release name and namespace if they differ. The Kubernetes agent
page's [Upgrading the Agent](/docs/telemetry/kubernetes-agent#upgrading-the-agent)
has the details, and [AI SRE — Cluster access](/docs/ai/ai-sre#cluster-access-let-oneuptime-ai-run-kubectl)
explains what the agent may do and how to let it fix what it finds.

### What AI may do is set on the AI agent

Investigation and fixes on a Kubernetes cluster or an infrastructure resource
are now the AI agent's own settings — the chart's `aiAgent.investigation` and
`aiAgent.fixes`, or `ONEUPTIME_AI_INVESTIGATION` and `ONEUPTIME_AI_FIXES`
where a resource AI agent runs. The agent reports them, OneUptime applies
them, and the AI agent page shows them read-only: **Change** shows the
command for each option instead of saving anything.

- **Settings you chose stay.** A cluster or resource whose AI settings someone
  chose on its AI agent page keeps them until its agent's configuration names
  them. An agent or chart older than this release reports nothing, and the
  page sets them as before.
- **A configuration that names them wins.** OneUptime then refuses a change
  made anywhere else — the AI agent page, the API, Terraform — until the
  configuration stops naming them. The command allowlist stays on the page.
- **Nothing chosen yet: the agent's defaults.** Investigation on, and fixes
  **Ask for approval** when the agent has write access, else **Off**.
- A cluster whose AI commands run through a Runner you bound keeps its
  settings on the page.

[AI SRE — Cluster access](/docs/ai/ai-sre#cluster-access-let-oneuptime-ai-run-kubectl)
and [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)
have the commands.

### Enable AI is the only AI switch

**Project Settings → AI Features** had three switches. **Enable
Auto-Remediation** and **Enable AI Command Execution (for Runners)** are gone:
auto-remediation and AI commands on Runners run whenever **Enable AI** is on.
Turning **Enable AI** off stops them along with every other AI feature,
including auto-remediation rules that start a runbook without AI. A project
that already has **Enable AI** off therefore stops running those rules after
the upgrade; turn **Enable AI** on to keep them.

The two switches used to hold some fixes back. So that nothing starts
changing your systems without a human when they disappear, the server
upgrade moves those fixes to asking first:

- In a project that had turned **Enable Auto-Remediation** off, **Full Auto**
  rules become **Suggest**, and clusters and resources set to **Automatic** or
  **Bypass approval** become **Ask for approval**.
- In a project that never turned on **Enable AI Command Execution**, **Full
  Auto** rules that let AI compose commands become **Suggest**. A Kubernetes
  cluster that AI reaches through a Runner you bound to it (with a Kubernetes
  credential) goes from **Automatic** or **Bypass approval** to **Ask for
  approval**. Clusters reached through the Kubernetes AI agent keep their
  mode, and so do resources: they never needed that switch.

Nothing is turned off. Rules, clusters and resources that one of the switches
kept quiet start proposing fixes, and each fix still waits for a human. To keep
auto-remediation out of a project, turn off **Enable AI**, or disable its rules
(Incidents or Alerts → Rules → Auto Remediation Rules) and set **Fixes** to
**Off** on each cluster's and resource's AI agent page. API clients and
Terraform configurations that set `enableAutoRemediation` or
`enableAiCommandExecution` (`enable_auto_remediation` or
`enable_ai_command_execution` in Terraform) should stop setting them.

### New projects start with every AI feature on

A project created after the upgrade starts with every AI feature switched on,
not only automatic incident and alert investigation: postmortem drafts,
automatic code fixes and instrumentation fixes (Incidents or Alerts →
Settings → AI), and AI Insights with its fix pull requests and auto-archiving
of expected-denial exceptions (AI → Insights → Settings).

Projects that already exist keep the settings they have; the upgrade switches
nothing on. On also does not mean running: each feature still needs an LLM
provider (and AI credits on OneUptime Cloud), and the ones that open pull
requests need a connected repository and a Runner with the code-fix
capability. Turn any of them off on its settings page, or all of them with
**Enable AI**.

A project created through the API that sets one of these fields to `false`
keeps it off. The Terraform provider's default for these attributes is still
`false`, so a project created with Terraform starts with them off unless its
configuration sets them to `true`.

### AI has no limits by default

Every limit on the work AI does on its own is now opt-in, and a limit nobody
has set does not apply. Where an existing project left one of these settings
empty, it used to get a default and now gets no limit:

| Setting                                                                                                      | Before                                   | Now                                                   |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------- |
| **Minimum Severity To Investigate** (alerts)                                                                 | The project's top two severity tiers     | Every severity                                        |
| **Re-investigation Cooldown (Minutes)** (incidents and alerts)                                               | 30 minutes                               | No cooldown: every incident and alert is investigated |
| **Max Concurrent Incident Investigations**, **Max Concurrent Alert Investigations**                          | 3, and a value you set was held to 1–25  | No limit: every investigation starts right away       |
| **Daily Incident AI Fix Task Limit**, **Daily Alert AI Fix Task Limit**                                      | 25 per UTC day                           | No limit                                              |
| AI work outside incidents and alerts: insight triage, and fix tasks for exceptions, insights and performance | 3 runs at once, 25 fix tasks per UTC day | No limit                                              |
| **Max Open Fix Pull Requests** (a repository's **Settings** page)                                            | 5                                        | No cap                                                |

Values a project already set are kept exactly, and nothing is migrated. They
work as before, except that a concurrency cap is no longer held to 25: it can
be any number from 1 up. Investigations only queue for a free slot in a lane
that has a cap, and a queued one still expires after 30 minutes. 0 still
pauses where it did: a daily fix task limit of 0 pauses that lane's fix tasks,
and a **Max Open Fix Pull Requests** of 0 blocks AI fix pull requests on that
repository. A cooldown is still held to at most 1440 minutes (a day).

To keep the old limits, set them yourself: **Minimum Severity To
Investigate**, the cooldown, the concurrency caps and the daily fix task limits
on **Incidents → Settings → AI** and **Alerts → Settings → AI**, and **Max Open
Fix Pull Requests** on each repository's **Settings** page. AI work outside
incidents and alerts has no setting, so it runs without these limits. Nothing
changes for the **Daily Incident AI Token Limit** and **Daily Alert AI Token
Limit** (0 still pauses that lane) or for the investigation time limit: they
were already unset by default, which means no limit.

The AI settings also moved in the Incidents and Alerts side menus, and the
**AI** section there is gone. Its **Investigation** page is now **Settings →
AI**, the first item under **Settings**, and its **Remediation** page is now
**Rules → Auto Remediation Rules**, right after **Runbook Rules**. The URLs
(`…/settings/ai` and `…/settings/auto-remediation-rules`) have not changed, so
bookmarks keep working.

### The AI Logs get an index for the daily AI limits

A project's daily AI limits (**Project Settings → AI Features → More
settings**) and the incident and alert daily token limits add up the day's AI
Logs before every AI call. Until now that read every AI Log the project had
ever written, and a self-hosted install keeps them all. The upgrade adds an
index on the AI Logs (`LlmLog`), on the project and the time of each call, so
each check reads only that day's. The AI Logs page lists a project's logs
faster too.

Nothing to do: the index is built online during the upgrade
(`CREATE INDEX CONCURRENTLY`), and AI calls keep working while it builds. On a
large AI Logs table this takes a few minutes. The build waits at most two
minutes behind any one long-running transaction, such as a backup, and runs at
most fifteen. If it cannot finish, the upgrade still completes, the limits keep
working without the index, and the log says so and how to build it. Run this
on the OneUptime database, outside a transaction, at any time:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_LLM_LOG_PROJECT_CREATED_AT"
  ON "LlmLog" ("projectId", "createdAt");
```

If the log says an unfinished (INVALID) copy was left behind, drop it first
with `DROP INDEX CONCURRENTLY IF EXISTS "IDX_LLM_LOG_PROJECT_CREATED_AT";`.
An index you build this way before upgrading is kept as it is.

### Verify the edition and the license

- The **edition label in the Admin Dashboard header** names the edition that is
  running, and on the Enterprise Edition the license status with it.
- **Compose:** `docker compose images` lists the tags you are running — every
  OneUptime image carries the `enterprise-` prefix on the Enterprise Edition.
- **Helm:** `kubectl get pods -n <namespace> -o jsonpath='{..image}'` prints the
  images the pods run; the same prefix rule applies.
- The SCIM endpoints tell the two cases apart: `404` means this image has no
  `ee/` in it (the Community Edition), while `402` or `403` means the
  Enterprise Edition is running with a license that needs attention.

### Rolling back to 13

- Both editions and both releases read the same data, and the only schema change
  is a nullable column 13 ignores, so rolling the images back needs no database
  work.
- **Docker Compose:** set `APP_TAG` back to the 13 tag you ran (`13.0.8`, or
  `enterprise-13.0.8`) and run `npm run update`. On 13 it is
  `IS_ENTERPRISE_EDITION=true` that turns the enterprise features on, so put it
  back if you had it.
- **Helm:** `helm rollback my-oneuptime`, or pin `image.tag` to `13.0.8`.
- Your enterprise configuration is not touched by running 14, so a rollback
  finds it as it was.

> Tip: on the Enterprise Edition, activate the license on the day you upgrade
> rather than at the end of the trial. Activation is what keeps SCIM
> provisioning and audit logging running, and the trial is counted from this
> upgrade, not from your original install date.

## Upgrading from OneUptime 12 → 13

OneUptime 13 replaces Redis with [Valkey](https://valkey.io) as the bundled
cache and queue engine. Redis 7.4 left the BSD licence and most of the original
Redis contributors moved to Valkey, which is a fork of Redis 7.2 and speaks the
same wire protocol. Nothing above the socket changed — and you can still point
OneUptime at a real Redis, or at a managed Redis-compatible service, if you
prefer.

Everything you configure is now named for it: the settings are `VALKEY_*`, the
Helm values are `valkey:` / `externalValkey:`, and the Kubernetes objects are
`<release>-valkey*`. **Every old name still works**, so an untouched
`config.env` or `values.yaml` upgrades and keeps running. There is no
configuration you are required to edit, and no data to migrate — the cache is
not a source of truth, and Postgres and ClickHouse are untouched.

What you need to do depends on how you deployed:

- **Docker Compose:** upgrade the usual way, with one flag that matters — see
  [Docker Compose upgrades](#docker-compose-upgrades).
- **Helm:** no values change, but the cache pod is recreated and comes back
  empty — see [Helm upgrades](#helm-upgrades).
- **You point OneUptime at a cache you run yourself** (managed Redis,
  ElastiCache, Memorystore, your own Valkey): read [If you run your own
  cache](#if-you-run-your-own-cache). This is the one setup that can quietly
  stop reaching your server.
- **You have dashboards, alerts, network policies or scripts keyed on the
  Kubernetes object names:** those names change — see
  [Helm upgrades](#helm-upgrades).

### What changed, and what did not

| | Until 12 | From 13 |
| --- | --- | --- |
| Engine | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| Settings | `REDIS_*` | `VALKEY_*` — `REDIS_*` still read |
| Compose service | `redis` | `valkey` — still answers to the hostname `redis` |
| Helm values | `redis:`, `externalRedis:` | `valkey:`, `externalValkey:` — old keys still applied |
| Kubernetes objects | `<release>-redis`, `<release>-redis-master` | `<release>-valkey`, `<release>-valkey-master` |
| Generated Secret | `redis-password` in `<release>-redis` | `valkey-password` in `<release>-valkey` |
| External cache Secret | `<release>-external-redis` | `<release>-external-valkey` |

The ten renamed settings are `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_DB`,
`VALKEY_USERNAME`, `VALKEY_PASSWORD`, `VALKEY_IP_FAMILY`, `VALKEY_TLS_CA`,
`VALKEY_TLS_CERT`, `VALKEY_TLS_KEY` and `VALKEY_TLS_SENTINEL_MODE`. Where a
setting is present under both spellings the app prefers the `VALKEY_*` one. The
Helm chart resolves the collision the other way round: a legacy `redis:` key
wins over the new default, so a values file you never touched keeps behaving
exactly as it did.

**The cache restarts once**, on both deployment paths, because the container is
replaced. It holds nothing on disk (`appendonly no`, `save ""`), so it comes
back cold: cached values are gone, and BullMQ jobs that were waiting, delayed or
backing off are lost. Repeatable and cron jobs re-register themselves on
reconnect. Upgrade at a quiet moment if in-flight telemetry or workflow retries
matter to you.

### Docker Compose upgrades

The standard update is all you need:

```
git checkout release # Please make sure you're on release branch.
git pull
npm run update
```

- **Use `--remove-orphans` if you run compose by hand.** `npm run update` and
  `npm run start` already pass it, and it is what removes the old `redis`
  container. Leave that container running and two containers answer to the
  hostname `redis` — connections land on the stale one at random.
- **Your `config.env` is not rewritten.** `npm run update` normally appends any
  setting it finds in `config.example.env` and your file lacks, but it
  recognises these ten as renames and leaves your values — including your
  `REDIS_PASSWORD` — exactly where they are. It prints which ones it kept.
- Renaming your own keys to `VALKEY_*` is optional and safe to do later. Set
  only one spelling per setting.
- **If you set cache variables in a `docker-compose.override.yml`, rename them
  to `VALKEY_*`.** The base file now sets `VALKEY_HOST` from your `REDIS_HOST`,
  and the app reads `VALKEY_HOST` first, so an override that sets only
  `REDIS_HOST` no longer wins.

### Helm upgrades

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **No values change is needed.** `redis:` and `externalRedis:` still work —
  whatever you set under them is layered on top of the new `valkey:` /
  `externalValkey:` defaults — and `helm upgrade` prints a `DEPRECATED VALUES`
  notice listing the old keys it found. Rename them when convenient.
- **Nothing rotates.** The chart reads the password out of your existing
  `<release>-redis` Secret and carries it into `<release>-valkey`, rather than
  minting a new one.
- **Both old Secrets are kept.** `<release>-redis` and, if you bring your own
  cache, `<release>-external-redis` are annotated
  `helm.sh/resource-policy: keep`, so they stay behind holding now-unused
  copies. Delete them once the upgrade has stuck — but read
  [Rolling back](#rolling-back-to-12) first.
- **Object names change.** Update anything keyed on `<release>-redis` or
  `<release>-redis-master`: Grafana dashboards, alert rules, NetworkPolicies,
  ServiceMonitors, backup jobs.
- The Service is also published under its old name, `<release>-redis-master`,
  so pods that have not rolled yet reconnect on their own instead of resolving
  nothing for the length of the rollout. Set `valkey.legacyServiceAlias: false`
  to drop it once every workload has rolled.
- **If you had `persistence.enabled: true`**, the new StatefulSet claims a fresh
  `data-<release>-valkey-0` volume. The old `data-<release>-redis-0` never held
  anything, so delete it to stop paying for it.

### If you run your own cache

Pointing OneUptime at a cache it does not run is still fully supported, and the
server on the other end can be Valkey, Redis, or a managed Redis-compatible
service. What changes is the name of the block that configures it.

- Rename `externalRedis:` to `externalValkey:` in your values file. Optional —
  the old key is still applied — but it is what the chart documents now.
- The chart re-renders the Secret under the new name, `<release>-external-valkey`.
  The old `<release>-external-redis` is kept and no longer updated, so if any of
  your own manifests reference it by name, repoint them.
- **`extraEnv` overrides stop reaching the cache — this one fails silently.** If
  you point at a managed cache with `extraEnv: [{name: REDIS_HOST, ...}]`
  instead of the `externalValkey:` block, your entry still wins the `REDIS_HOST`
  slot, but the app now reads `VALKEY_HOST` first — and the chart sets that to
  its own in-cluster cache. Your override is present in the pod spec and
  ignored. Rename those entries to `VALKEY_*`, or move the settings into
  `externalValkey:`, which is the supported way. `helm upgrade` warns about
  chart-wide `extraEnv` entries; it cannot see per-service
  `<service>.extraEnv` lists, so check those yourself. The Compose equivalent is
  an override file that sets only `REDIS_HOST`.

### Verify the upgrade

- **Admin Dashboard → Health → Valkey** should read Connected, with a memory
  figure. This is the same reachability check the health warning emails use.
- **Compose:** `docker compose ps` lists a `valkey` service and no `redis`
  container.
- **Helm:** `kubectl get pods,svc -n <namespace>` shows `<release>-valkey-0`
  Running and the `<release>-valkey-master` Service. Run
  `helm get notes my-oneuptime` to replay the deprecation notices the upgrade
  printed.
- For a deeper look, `HelmChart/Public/diagnose.sh` reports cache memory,
  evictions and connectivity, and understands both the old and new object names.

### Rolling back to 12

- **Helm:** `helm rollback` works, because the 12 chart finds the
  `<release>-redis` Secret it created still in place and reuses its password.
  This is why the old Secrets are kept — do not delete them until you are
  confident you are staying on 13.
- **Docker Compose:** keep the `REDIS_*` spelling in `config.env` until you are
  confident. OneUptime 12 reads only `REDIS_*`, so rolling back a `config.env`
  whose keys you renamed leaves the cache with no configured password, and it
  starts wide open on the compose network with the app unable to authenticate.
  Keeping both spellings, with identical values, also works.
- Rolling back restarts the cache again, with the same cold-start cost.

### Names that stayed Redis on purpose

These are not oversights, and none of them need action:

- **The API keeps its shape.** `components.redis` and `summary.redis` in the
  instance health payload, the `/api/admin/health/redis` route, and the `redis`
  engine value in the admin Query Console are wire keys, not display text.
  Anything you have scripted against them keeps working.
- **Redis-protocol vocabulary:** `redis-cli`, the `redis_version` field in
  `INFO`, and the stored memory-baseline key that the health notifications
  compare against. Renaming that key would discard every instance's history.
- **The default hostname is still `redis`**, for hand-written manifests and bare
  `docker run` setups. It is only used when neither `VALKEY_HOST` nor
  `REDIS_HOST` is set, which never happens in our own Compose or Helm.
- Internal class names and Postgres column names, which no reader sees and whose
  rename would cost a migration.

## Upgrading from OneUptime 11 → 12

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Runs Runbooks** (on by default),
**Runs AI Code Fixes** (off by default), and **Runs AI Remediation Commands** (off by
default). Capability changes are adopted on the Runner's next heartbeat —
no restart needed. See [Runners](/docs/runbooks/agents) for how the
component works day to day.

What you need to do depends on how you deployed:

- **Everyone:** read [What happens automatically](#what-happens-automatically)
  and [Dashboard pages moved](#dashboard-pages-moved).
- **You installed Runbook Agents on your hosts:** redeploy them onto the new
  image — see [Redeploy your Runbook Agents](#redeploy-your-runbook-agents).
- **Docker Compose:** environment variable renames plus **one
  security-relevant step** — see [Docker Compose deployments](#docker-compose-deployments).
- **Helm:** a values-file rename that fails validation if skipped — see
  [Helm deployments](#helm-deployments).
- **API keys that were granted agent permissions directly:** re-grant them —
  see [Permissions: teams migrate, API keys do not](#permissions-teams-migrate-api-keys-do-not).

### What happens automatically

No manual database work. On first boot, v12 runs a migration that:

- Renames the Postgres tables and columns (`RunbookAgent` → `Runner`,
  `RunbookAgentJob` → `RunnerJob`, plus the owner, label, and join tables to
  match). Runner ids, keys, and job history are untouched — this is a
  rename, not a re-registration.
- Migrates every **team** permission grant from the old `…RunbookAgent…`
  permission names to the new `…Runner…` names, so team roles keep working
  without reassignment. (Direct API-key grants are the exception — see below.)

The API stays compatible too:

- Requests to `/api/runbook-agent`, `/api/runbook-agent-job`,
  `/api/runbook-agent-owner-team`, and `/api/runbook-agent-owner-user` are
  rewritten server-side onto their `/runner…` equivalents, so existing
  scripts keep working.
- The agent-facing ingest path `/runbook-agent-ingest` is still served
  alongside the new `/runner-ingest`, so **Runbook Agent containers you have
  not redeployed yet keep heartbeating and executing Bash and JavaScript
  steps** against a v12 server. Each one logs a deprecation warning on the
  server naming the agent that should be redeployed.

### Redeploy your Runbook Agents

Your existing agents keep running Bash and JavaScript steps unchanged, so
this does not block the upgrade — but do it soon after:

- **SSH and Kubernetes steps (new in v12) fail on old agents.** The server
  does not exclude old agents from claiming them: an agent still on the
  `runbook-agent` image will claim an SSH or Kubernetes job and fail it with
  `Unsupported step type` — typically mid-incident, when the runbook runs.
  Redeploy the agent **before** authoring SSH or Kubernetes steps that
  target it.
- The old image receives no further updates of any kind.

Redeploying means re-running the install command with the new image and
variable names. The agent's id and key are **unchanged** (same database
row) — swap the names, keep the values:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(Or open the Runner in **Runbooks → Runners** and use **Show setup
instructions** for a pre-filled command.)

If you tuned the agent with environment variables, rename them — the old
names are **silently ignored** by the new image:

| Old (Runbook Agent)                     | New (Runner)                              |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### If you ran the standalone AI Agent

The **Settings → AI → AI Agents** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Runbooks → Runners** and install it with the
   command from **Show setup instructions**.
2. Enable **Runs AI Code Fixes** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `npm run update` flow, the new variables are appended to your
`config.env` automatically and the stack boots — but read the key warning
below. The renames, if you manage `config.env` or overrides by hand:

| Old                              | New                                |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

The old `AI_AGENT_*` lines can stay in `config.env`; nothing reads them
anymore.

**Important — set `ONEUPTIME_RUNNER_KEY` to a random value.** The template
merge appends it with the literal placeholder
`please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is
**not** carried over. This key registers the instance-wide Runner and
authenticates the AI code-fix protocol — including minting repository
access tokens — so leaving the publicly known placeholder in place is a
security hole. Before starting v12, set it to a long random value (reusing
your old `AI_AGENT_KEY` value is fine).

**Remove the orphaned `ai-agent` container.** `npm start` runs compose with
`--remove-orphans` and cleans it up. If you run `docker compose up -d` by
hand, add `--remove-orphans` (or `docker rm -f` the old container) —
otherwise the old AI Agent keeps running and keeps claiming code-fix work
alongside the new Runner.

### Helm deployments

- Rename the `aiAgent:` block in your values overrides to `runner:`. All
  subkeys (`enabled`, `replicaCount`, `resources`, `keda`, and so on) are
  unchanged. This is a hard break: the chart schema rejects unknown keys,
  so `helm upgrade` **fails validation** while an `aiAgent:` block remains.
- Workload names change from `<release>-ai-agent` to `<release>-runner` —
  update anything keyed on the old names (dashboards, alerts, network
  policies).
- The release secret key changes from `ai-agent-key` to `runner-key`. A
  fresh key is generated on upgrade and the in-cluster Runner re-registers
  itself automatically, so there is nothing to do unless something external
  referenced the old secret value.
- Deliberately unchanged: the KEDA scaling metric is still named
  `oneuptime_ai_agent_queue_size` — do not rename it in custom scalers.

### Permissions: teams migrate, API keys do not

Twelve permissions were renamed (`CreateRunbookAgent` → `CreateRunner`,
`EditRunbookAgent` → `EditRunner`, `DeleteRunbookAgent` → `DeleteRunner`,
`ReadRunbookAgent` → `ReadRunner`, and the same four verbs for
`…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` and
`…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). Grants held through
**teams** are migrated automatically. Grants attached **directly to an API
key** are not — a key that held one of these twelve permissions loses that
access after the upgrade. Re-grant the new `…Runner…` permissions on those
keys in the dashboard. The `RunbookSecret`, `RunbookCredential`, and
`RunbookExecution` permission families kept their names.

Separately, v12 closes a hole: starting a runbook execution now requires
an authenticated caller with `ProjectOwner`, `ProjectAdmin`,
`ProjectMember`, `CreateRunbookExecution`, `RunbookAdmin`, or
`RunbookMember` — advancing or cancelling one also accepts
`EditRunbookExecution`. Unauthenticated triggering no longer works, and
read-only roles (for example `RunbookViewer`) can no longer start runs —
API automation that triggers runbooks needs `CreateRunbookExecution`.

### Dashboard pages moved

There are no redirects from the old URLs — update bookmarks and internal
wiki links:

| Page                    | Old location                             | New location                              |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (was "Agents")  | Runbooks → Settings → Agents (`…/runbooks/settings/agents`) | Settings → Runners (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Settings → Credentials (`…/runbooks/settings/credentials`) | Settings → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Settings → AI → AI Agents (`…/settings/ai-agents`) | Removed — Runners with the **Runs AI Code Fixes** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Settings → Secrets.

That is where the pages were in 12 and 13. In 14 the two Runner pages moved
again, to **Runbooks → Runners** (`…/runbooks/runners`) and **Runbooks →
Runners → Credentials** (`…/runbooks/runner-credentials`); the 12 and 13 URLs
in the table redirect there. See [Other changes in 14](#other-changes-in-14).

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Runs AI Remediation Commands**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## Upgrading from OneUptime 10 → 11

OneUptime 11 has two changes that need your attention before you upgrade:

1. **SCIM provisioning and team compliance settings moved to the Enterprise
   Edition** — if you use them on a self-hosted Community build, read this
   first.
2. **The ClickHouse telemetry storage was rebuilt** — relevant if you want to
   carry historical telemetry forward.

This page explains both — what changes, who needs to act, and (for the
telemetry rebuild) every query needed to migrate history.

### SCIM and team compliance settings now require the Enterprise Edition

In v11, the following access-management features moved to the **OneUptime
Enterprise Edition** and are no longer part of the free, open-source
(Community) build:

- **SCIM user provisioning** — project and status page
- **Team compliance settings**

SAML SSO, OpenID Connect (OIDC) and global (instance-wide) SSO, for both
project login and status-page login, are part of the Community Edition — see
[Community and Enterprise Edition images](#community-and-enterprise-edition-images).

**What you'll see after upgrading:** if you configured SCIM or team compliance
settings on a Community Edition build, the settings pages show an upgrade
prompt instead of the configuration form, and the configuration can no longer
be changed. Your existing configuration is **preserved in the database** —
nothing is deleted — and it works again as soon as the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SCIM and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license, mention that you upgraded from v10 to v11, and we'll help you get it
back online. If your team is mid-upgrade and this is blocking provisioning,
contact us before upgrading production so we can plan it with you.

### What changes in v11 (telemetry storage)

Telemetry (logs, traces, metrics, exceptions, profiles, monitor logs,
audit logs) moves to new ClickHouse tables with time-based partitioning,
per-column compression codecs, and the new entity-model columns:

| Old table             | New table             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Two columns are renamed on every telemetry table: `serviceId` →
`primaryEntityId` and `serviceType` → `primaryEntityType`. This is a hard
rename — **if you query the OneUptime analytics API directly with
`serviceId`/`serviceType` filters, update them to the new names.**
Dashboards, monitors, and alerts inside OneUptime are migrated
automatically.

The cut is **forward-only**: the new tables start empty, all telemetry
ingested after the upgrade lands in them immediately, and history fills
back in naturally as time passes. The old tables are **dropped
automatically** during the upgrade to reclaim their disk — if you want
the option of carrying history forward, rename them **before**
upgrading (Step 0 below).

> **Already on 11.0.0 or 11.0.1?** Those releases kept the old tables
> (they drained via TTL, and the copy could be run "any time after the
> upgrade"). Any later update **drops them at boot**. If you still want
> the history copy and have not done it yet, run Step 0 below before
> applying the update.

### Who needs to do anything

- **Fresh installations:** nothing to do.
- **Upgrades that don't need pre-upgrade telemetry in the UI:** nothing to
  do. Telemetry pages simply show data from the upgrade moment onward;
  the old tables are dropped during the upgrade.
- **Upgrades that want pre-upgrade telemetry visible:** rename the old
  tables **before** the upgrade (Step 0 below), then run the manual copy
  any time after it.

As always: upgrade major versions step-by-step (10 → 11, do not skip),
and take backups of Postgres and ClickHouse before upgrading.

### Optional: carry telemetry history forward

Step 0 runs **before the upgrade**; everything from Step 1 on runs
**after the upgrade has fully booted** (the new tables and their
materialized views must exist). Connect directly on your ClickHouse
host — the native protocol has no HTTP timeouts, so multi-hour statements
are fine:

```bash
clickhouse-client --database oneuptime
```

Good to know before starting:

- The copy is safe to run while OneUptime is live. New telemetry writes
  to the new tables independently; copied history fills in behind it.
- Expect hours at large scale (hundreds of GB).
- Every statement below carries an `insert_deduplication_token`, and the
  new tables ship with a deduplication window — so **re-running a
  statement that failed partway is safe** (already-inserted blocks are
  skipped, including in the metric rollups), provided you re-run it
  reasonably soon. Under heavy live ingest the window (last 10,000 insert
  blocks per table) eventually evicts old tokens.
- Copying metrics also rebuilds the pre-aggregated dashboard rollups
  automatically (each copied row re-feeds the rollup materialized views)
  — this makes the metric copy slower than the others; run it last.

#### Step 0 — before upgrading, rename the old tables

The upgrade drops the old tables at boot, so move the ones you want to
copy from out of its reach first. Stop OneUptime (scale the deployment
down) so nothing is writing to or able to recreate them, then rename —
`RENAME TABLE` is an instant metadata operation, and `IF EXISTS` lets
the batch skip tables your installation never had (deployments older
than mid-10.0.x may lack `AuditLogV1` or some `…V2` tables entirely —
there is no history of that type to copy):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

Then upgrade and let OneUptime boot fully before continuing.

> If you roll back to v10 after renaming (v10 recreates empty old-name
> tables at boot), rename the `_backup` tables back to their original
> names before restarting v10 — otherwise telemetry ingested during the
> rollback lands in the recreated tables and is dropped at the eventual
> upgrade.

#### Step 1 — list the source partitions

Each old table has at most 16 partitions. For each source table:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Step 2 — generate the copy statement

Column sets can differ slightly between installations (older deployments
may lack recently added columns), so generate the statement from your
live schema rather than copy-pasting a fixed one. Set `src` and `dst` in
the `WITH` clause to one of the table pairs from the table above (the
source carries the `_backup` suffix from Step 0), and run:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

The generated statement copies only the columns both tables share (new
columns take their defaults), renames `serviceId`/`serviceType` on the
fly, orders rows deterministically so a retry produces identical,
deduplicatable blocks, and lifts the execution-time and partition-count
limits that a statement this size needs.

#### Step 3 — run it, one partition at a time

Take the generated statement and substitute `{PARTITION}` (it appears
twice — in the `WHERE` and in the token) with each partition id from
Step 1. Run the statements one at a time, then repeat Steps 1–3 for each
table pair.

> Note: if a source table was skipped in Step 0 because it did not exist
> on your installation, Step 1 fails with `UNKNOWN_TABLE` for that pair —
> simply skip the pair; there is no history of that type to copy.

If a statement fails partway, re-run the **same** statement promptly —
already-committed blocks deduplicate. If re-running much later, compare
row counts first (Step 5).

#### Step 4 (optional) — per-host metric rollup history

Copied raw metric rows rebuild the service-level rollups automatically,
but not the **per-host** rollup (old rows have no host entity key). The
renamed old rollup table from Step 0 is the only source for this
history; carry it forward by computing the new key from the hostname:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

The `ORDER BY` matters: it makes a re-run produce identical insert blocks
so the deduplication token can recognize them. Without it, a retry could
be silently skipped or double-counted. (Edge case: hostnames containing
`\`, `|`, or `=` — not legal RFC-1123 hostname characters — would compute
a different key than the application; ignore unless you know you have
such hosts.)

#### Step 5 — verify

Compare totals per table pair (the new table also contains post-upgrade
rows, so it should be greater than or equal to the old one):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 — drop the backups

The renamed tables keep their retention TTL, so they drain and shrink by
themselves — but once you are satisfied with the copy, drop them to
reclaim the disk immediately:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` lifts the server's 50 GB drop protection
for that one statement.)

> Tip: as with every major upgrade, test in a staging environment first
> and confirm telemetry is flowing into the new tables before relying on
> the copy in production.

## Upgrading from OneUptime 9 → 10

No changes that require manual action. Just follow the standard upgrade process.

## Upgrading from OneUptime 8 → 9

The Helm chart no longer provisions a Kubernetes Ingress resource. OneUptime ships an ingress gateway container that already terminates TLS, manages status page domains, and routes traffic for the platform, so a cluster ingress controller is no longer necessary.

- Remove any `oneuptimeIngress` overrides from your custom `values.yaml` files before upgrading. Those keys are now ignored and will cause validation errors if left in place.
- Ensure `nginx.service.type` reflects how you want to expose the bundled ingress gateway (for example `LoadBalancer`, `NodePort`, or `ClusterIP` with an external load balancer).
- Verify any DNS records for status pages or primary hosts still point to the Service or load balancer that fronts the OneUptime ingress gateway.
- After the upgrade, confirm TLS certificates continue to renew via the embedded gateway and that status page domains resolve correctly.

## Upgrading from OneUptime 7 → 8

If you're running on Kubernetes, there are important breaking changes:

- We no longer use Bitnami charts for Postgres, Redis, and ClickHouse because of [Bitnami License Changes](https://github.com/bitnami/charts/issues/35164)
- These changes are not backward compatible. You must follow the new structure in the Helm chart `values.yaml`.
- Backup your data (Postgres, ClickHouse, and any persistent volumes) before upgrading.

> Tip: Test the upgrade in a staging environment first. Confirm your workloads are healthy and data is intact before upgrading production.
