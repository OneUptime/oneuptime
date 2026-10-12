# OneUptime threat model

This file is for Anthropic's OSS Scanner and anyone else reviewing OneUptime's
security. It says what OneUptime is, where untrusted input enters, which
boundaries must hold, how we rate what crosses them, and how to work with the
image `.oss-scanner/Dockerfile` builds. Our reporting policy is
[`.github/SECURITY.md`](../.github/SECURITY.md); where the two differ for a
scanner finding, this file is the more specific one.

## What OneUptime is

OneUptime is an open-source observability and incident-response platform:
uptime and synthetic monitoring, status pages, incidents and alerts, on-call
scheduling and paging, logs, traces, metrics, profiles, real-user monitoring
and session replay, dashboards, workflows and runbooks, and AI that
investigates incidents and opens fix pull requests.

It runs in two shapes, and both matter:

- **OneUptime Cloud** (`oneuptime.com`): one multi-tenant deployment with open
  sign-up. Anyone on the internet can create an account and a project, so
  every other tenant's data is one boundary away from an attacker. Billing is
  on, and the Enterprise Edition (`ee/`) is loaded.
- **Self-hosted**: the same code, run by an operator with Docker Compose
  (`docker-compose.yml`) or Kubernetes (`HelmChart/Public/oneuptime`), as the
  Community Edition or the Enterprise Edition. Usually one organization, often
  many teams and projects. The operator, and the master admins they appoint,
  are trusted.

Almost everything is TypeScript on Node.js. The Infrastructure Agent is Go,
and several agents are collector configuration plus shell installers.

## Components

### The services in `docker-compose.yml`

| Service | Code | What it does | Exposure |
| --- | --- | --- | --- |
| `app` | `packages/App`, `packages/Common`, `ee/` | The API (`/api`), sign-in and SSO (`/identity`), MCP (`/mcp`), workflows, notifications, telemetry ingestion (OTLP over HTTP and gRPC, Fluent, syslog, MQTT, Pyroscope, session replay), background workers, the docs, and every UI: Dashboard, Accounts, Admin Dashboard, Status Page, Public Dashboard. In Kubernetes the same image also runs as the `worker` and `telemetry-writer` roles. | Internet, through `ingress` |
| `ingress` | `packages/Nginx` | nginx in front of everything: TLS, routing, custom domains for status pages and dashboards, and the ACME certificates for them. | Internet |
| `probe-1` | `packages/Probe` | A global probe: runs monitors (HTTP, ping, port, DNS, SSL, SNMP, SQL, custom JavaScript, synthetic browser checks, ...) and reports results to `app` with a probe key. | Outbound to monitored targets |
| `runner` | `packages/Runner` | Runs runbook steps (Bash, JavaScript, SSH, kubectl) and AI code fixes (clones a project's repository and opens pull requests), claimed from `app` with a runner key. Customers run their own Runner inside their network. | Outbound only |
| `postgres` | schema in `packages/Common/Server/Infrastructure/Postgres` | Projects, users, configuration, incidents: everything but telemetry. | Internal only |
| `clickhouse` | `Clickhouse/`, `packages/Common/Server/Utils/AnalyticsDatabase` | Telemetry: logs, traces, metrics, profiles, monitor results. | Internal only |
| `valkey` | `packages/Common/Server/Infrastructure` | Cache, queues (BullMQ), locks and rate limits. | Internal only |

`docker-compose.base.yml` defines more services for development and testing:
`probe-2` is a second global probe like `probe-1`; `home` is the
`oneuptime.com` website (`packages/Home`), which runs on OneUptime Cloud only;
`test-server` (`packages/TestServer`) and `e2e` (`packages/E2E`) are test
fixtures; `fluentd` and `fluent-bit` are example log shippers
(`Examples/log-collectors`).

### Outside the compose stack

- **Agents** (`agents/`), installed in customers' infrastructure, each sending
  telemetry with a project's ingestion key: the Kubernetes agent (the
  `HelmChart/Public/kubernetes-agent` chart with `KubernetesLogTailer`,
  `KubernetesCostAgent` and `KubernetesAIAgent`, which runs the kubectl
  commands an AI investigation asks for), `ResourceAIAgent`, the Go
  `InfrastructureAgent`, and the Docker, Podman, Docker Swarm, Proxmox, Ceph,
  VMware, database, storage-array and host agents (collector configuration
  plus `install.sh`).
- **Recorders** that run inside customers' own applications:
  `packages/App/FeatureSet/BrowserRecorder` (real-user monitoring and session
  replay in visitors' browsers) and `packages/App/FeatureSet/MobileRecorder`
  (React Native). They mask what users type; what they send is untrusted
  input to `app`.
- **Clients** of the same API: the CLI (`packages/CLI`), the mobile app
  (`packages/MobileApp`), the Terraform provider
  (`Scripts/TerraformProvider`).
- **The Enterprise Edition** (`ee/`): SCIM provisioning for projects and status
  pages, audit logs, team compliance, admin health, and the license client
  and the license server.
- **Deployment defaults**: `HelmChart/`, `docker-compose*.yml`,
  `config.example.env` and the installers. Insecure defaults there are in
  scope (see below).

### What matters most, and least

Most: the permission layer every read and write goes through
(`packages/Common/Server/Types/Database/Permissions`, `DatabaseService`,
`BaseAPI`, the analytics database services and the middleware in
`packages/Common/Server/Middleware`), authentication and SSO, the public
status-page and dashboard paths, telemetry ingestion, the sandboxes, and every
outbound request whose target a user chooses.

Least: test code and fixtures (`**/Tests`, `packages/E2E`,
`packages/TestServer`), `Examples/`, developer tooling (`Scripts/`), and the
docs' content. They never run in a deployment.

## Who attacks, and what they start with

1. **Anyone on the internet**: sign-up and sign-in, password reset, SSO and
   OAuth callbacks, public status pages and their subscriber forms, public
   dashboards, incoming request (heartbeat) URLs, inbound email, integration
   webhooks, and on OneUptime Cloud the website.
2. **Any signed-up user** with a project of their own. On OneUptime Cloud
   that is anyone, so this is the attacker of every cross-tenant finding.
3. **A project member with a limited role**: read-only, or limited by labels
   or to the resources they own.
4. **A project admin or owner**: trusted inside their project. They write
   monitors, custom code, synthetic scripts, workflows, status-page
   customizations, webhooks, SSO configuration and LLM provider settings,
   and none of that may reach beyond their project.
5. **Whoever controls data OneUptime reads**: telemetry senders (anyone with
   an ingestion key, which ships inside customers' applications), monitored
   websites and APIs, email senders, integration webhooks, Git repositories
   that code fixes clone, and text an LLM returns.
6. **The operator of a custom probe, Runner or agent**: trusted with their own
   project's work, nothing else.

The instance operator and master admins of a self-hosted instance are trusted.

## Trust boundaries

Each of these must hold for every caller, every credential type and every
transport (REST, MCP, realtime sockets, workers, AI tools, workflows):

1. **Project tenancy.** One project's data, configuration and secrets are
   never readable or writable from another project: not by its users, API
   keys, ingestion keys, probe and runner keys, MCP sessions, workflows, AI
   runs, status pages or dashboards. Postgres rows are scoped by `projectId`
   in the permission layer (`TenantPermission`); telemetry queries in
   ClickHouse are scoped the same way; files, realtime events and queued jobs
   carry their project.
2. **Roles inside a project.** What a user may do is the union of their teams'
   permissions (`packages/Common/Types/Permission.ts`), and API keys carry
   their own. A grant may be narrowed to resources with certain labels
   (**label scopes**) or to resources the user or their team owns (**owner
   scopes**, `OwnedScopePermission`); owner-only columns and the billing plan
   (`PlanGates`) narrow it further. A member must not gain a permission,
   escape a label or owner scope, or read a column their role does not cover.
3. **Master admin.** Master admins run the instance: the Admin Dashboard,
   `/api/admin`, global settings (SMTP, Twilio, global SSO), global probes and
   every project. Nobody else may gain that. A self-hosted instance makes its
   first sign-up its master admin; OneUptime Cloud provisions master admins
   out of band and never by sign-up.
4. **Public and private.** A status page is open to anyone, to signed-in
   private users (password or SSO), or behind a password, optionally with an
   IP allowlist (`packages/Common/Types/StatusPage/StatusPageAccess.ts`); a
   dashboard is project-only, anyone with the link, or link and password
   (`packages/Common/Types/Dashboard/DashboardAccess.ts`). Private incidents,
   internal notes and monitors not shown on a page never reach its visitors.
   A status page served from the application's own origin (`/status-page/...`)
   shares that origin with the signed-in Dashboard, so it never returns
   tenant-written script; custom HTML and JavaScript are served only on a
   project's own custom domain
   (`packages/Common/Server/Utils/StatusPageCustomizationAccess.ts`).
5. **Sandboxes.** Custom JavaScript monitors and workflow JavaScript run in
   isolated-vm (`packages/Common/Server/Utils/VM/VMRunner.ts`); synthetic
   monitors run Playwright under a separate user per check, with resource and
   capability limits (`packages/Probe/Utils/Monitors/SyntheticRuntime`).
   Code there may do what its sandbox offers, and nothing more: no access to
   the host process, its environment, its files or credentials, other checks,
   or other projects.
6. **Network egress from shared infrastructure.** Requests to URLs a user
   chooses (webhooks, workflow HTTP calls, sandboxed HTTP, data sources, SSO
   metadata, external status pages, monitors) go through
   `packages/Common/Server/Utils/SSRFProtection.ts`,
   `packages/Common/Server/Utils/DataSource/EgressGuard.ts` or the Probe's
   `packages/Probe/Utils/PrivateNetworkMonitorPolicy.ts`. Loopback,
   link-local and cloud metadata addresses are refused in every deployment;
   private ranges are refused unless the operator allows them; global probes
   on OneUptime Cloud are public-only. A custom probe reaching its own
   network is its purpose.
7. **Credentials and secrets.** Session tokens, API, ingestion, probe and
   runner keys, OAuth tokens for Slack, Microsoft Teams and GitHub, LLM keys,
   SMTP and Twilio credentials, monitor secrets and data-source passwords are
   stored encrypted or hashed, and never reach another project, a role that
   may not read them, a public page, a log, a notification or an AI
   transcript.
8. **Agents and runners in customers' infrastructure** accept work only from
   their own project, and only work their configuration allows (for example
   the Kubernetes AI agent's access level, or a runbook's execute
   permission). The server cannot make them do more.
9. **AI.** Investigations and chats read telemetry, notes and monitored
   content that attackers can write. Whatever that text says, the AI acts
   only inside the invoking project, with the permissions its user and the
   project granted it; remediation runs only allow-listed commands
   (`packages/Common/Server/Utils/AutoRemediation`); transcripts are filtered
   for privacy.

## Where untrusted input enters

- **The HTTP API.** Generic CRUD for every model (`BaseAPI`: list, count, get,
  create, update, delete, with caller-supplied query, select and sort), the
  hand-written routes in `packages/Common/Server/API`, the realtime socket,
  and the API reference.
- **Authentication.** Sign-up, sign-in, password reset, email verification,
  TOTP, WebAuthn and backup codes; SAML and OIDC callbacks for projects,
  global SSO and status pages (`packages/App/FeatureSet/Identity`); SCIM
  (`ee/Server/Identity`); OAuth callbacks for Slack, Microsoft Teams and
  GitHub; status-page private-user sign-in.
- **API keys**, project-scoped, each with its own permissions, used by the
  CLI, Terraform and scripts.
- **MCP** (`packages/App/FeatureSet/MCP`): tools that act with an API key or
  an OAuth 2.1 grant (`packages/App/FeatureSet/MCP/OAuth`).
- **Public status pages and dashboards**: the pages, their JSON APIs, RSS,
  subscriber sign-up (email, SMS, webhook, Slack, Microsoft Teams),
  announcements, custom domains.
- **Incoming request (heartbeat) monitors and incoming webhooks**: secret
  per-monitor URLs, integration webhooks (Huntress, Alertmanager, Grafana,
  security-event connections), Slack, Microsoft Teams, Telegram and WhatsApp
  callbacks, Twilio voice and SMS callbacks, Stripe.
- **Inbound email** (`packages/Common/Server/Services/InboundEmail`): incoming
  email monitors and workflow email triggers.
- **Telemetry ingestion** (`packages/App/FeatureSet/Telemetry`): OTLP logs,
  traces, metrics and profiles over HTTP and gRPC, Fluent, syslog, MQTT,
  Pyroscope, session replay, source maps, security and change events,
  Kubernetes cost, server monitor reports. The ingestion key decides the
  project; the payload is attacker-written and later rendered, searched,
  alerted on and given to the AI. Browser ingestion keys are public by design
  (they ship in web pages, limited to the origins a project allows), so
  holding one must let a sender add telemetry to that one project and do
  nothing else.
- **The probe API** (`packages/App/FeatureSet/Telemetry/API/ProbeIngest`,
  `packages/Common/Server/API/ProbeAPI.ts`): probes register, fetch the
  monitors they run and report results. A probe key is a credential; a
  custom probe is run by a customer. A project's own probe whose operator
  turned packet capture on also claims the captures started from the
  dashboard, runs tcpdump with the capture's filter as one argument and
  uploads the pcap file (`packages/Probe/Utils/PacketCapture`,
  `packages/App/FeatureSet/Telemetry/API/ProbeIngest/PacketCapture.ts`);
  global probes never capture.
- **The runner API**: Runners register, claim runbook steps and code-fix runs,
  and report output.
- **Code users write that OneUptime runs**: custom JavaScript monitors,
  synthetic monitor scripts, workflow JavaScript components, JavaScript
  expressions in monitor criteria, runbook steps, regular expressions in log
  and trace pipelines, drop filters and scrub rules, and Handlebars-style
  templates in notifications and incident templates.
- **Content users write that OneUptime renders to others**: incident, alert and
  note Markdown, status page announcements and customization, dashboard
  widgets, labels and names in feeds, emails, SMS, calls, push, Slack and
  Microsoft Teams messages.
- **File uploads** (`packages/Common/Server/API/FileAPI.ts`): logos, favicons,
  attachments, images in Markdown, source maps.
- **What OneUptime fetches**: monitored responses, certificates and DNS
  answers, external status pages, SAML metadata and OIDC discovery documents,
  LLM responses, Git repositories, Kubernetes API output, data sources
  (`packages/Common/Server/Utils/DataSource`). All of it is untrusted, and
  all of it may be rendered, stored or handed to the AI.
- **Outbound requests to user-given URLs** (boundary 6), and the Runner and
  agents executing what the server sends them (boundary 8).

## In scope and out of scope

In scope: everything this repository ships and runs: `app` with its feature
sets and `ee/`, the Probe, the Runner, the ingress configuration, the agents
and their installers, the recorders, the CLI, and the defaults in the Helm
chart, the compose files and `config.example.env`; and OneUptime Cloud's
behavior.

Out of scope:

- Findings that need a misconfigured or deliberately insecure self-hosted
  install: running with the `please-change-this-to-random-value` placeholders
  from `config.example.env`, exposing Postgres, ClickHouse or Valkey to the
  internet, or an operator choosing to allow private targets
  (`ALLOW_PRIVATE_NETWORK_WEBHOOKS`, `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS`).
  A finding that reaches loopback, link-local or cloud metadata, or crosses a
  project, stays in scope whatever the operator allowed.
- What the operator or a master admin can do; they own the instance.
- License and plan enforcement on a self-hosted instance, whose operator
  controls the code. (The license server's signing and issuance, and plan
  limits on OneUptime Cloud, are in scope.)
- A project admin's code doing, inside its sandbox and its own project, what
  the feature is for: a custom monitor calling a public URL, a runbook running
  commands on that project's own servers through its own Runner, custom
  JavaScript on that project's own custom-domain status page.
- Vulnerabilities in dependencies that OneUptime's use cannot reach. If
  OneUptime's use makes one exploitable, it is in scope.
- Volumetric denial of service, brute force and rate-limit tuning without a
  demonstrated impact. Algorithmic denial of service (a regular expression or
  parser that runs for super-linear time on input an attacker controls) is in
  scope: AGENTS.md holds the codebase to linear-time handling of
  attacker-sized text.
- Missing security headers, cookie flags or TLS settings with no demonstrated
  exploit; self-XSS; reports that are only scanner output.
- Test code, fixtures, `Examples/`, `Scripts/`, and the docs' content.

## How we rate severity

Rate a finding by what the attacker starts with (the list of attackers above)
and what they end with.

**Critical**

- Reading or changing another project's data, configuration or secrets
  (cross-tenant access), by any route: API, MCP, sockets, workers, AI tools,
  workflows, probes, runners, files, telemetry queries.
- Authentication bypass or account takeover: signing in as another user,
  forging or replaying a session, API key, OAuth grant or SSO assertion, or
  linking an identity provider of one project to accounts of another.
- Becoming a master admin without being made one.
- Code execution on `app`, a worker, `ingress`, or a global probe, including
  escaping the custom-code or synthetic sandbox there, and SQL or ClickHouse
  injection.
- SSRF from `app`, a worker or a global probe on OneUptime Cloud that reaches
  internal services or cloud metadata.

**High**

- Escalation inside a project: gaining a permission, escaping a label or
  owner scope, a read-only role writing.
- Stored XSS that runs on the application's origin (Dashboard, Accounts,
  Admin Dashboard, status pages under `/status-page`), or on a public status
  page or dashboard where any visitor runs it. It is critical when the
  attacker and the victim are in different projects.
- Reading a private status page or a password-protected dashboard without
  access, or private incidents and notes through a public page.
- SSRF into private networks on a self-hosted install that refuses them; on
  OneUptime Cloud a blind SSRF (no response returned) into internal services.
- A custom probe, Runner or agent receiving another project's work or
  secrets; the server making an agent or Runner act beyond its configured
  access.
- Prompt injection that makes the AI act outside its project, run a command
  that is not allow-listed, or put secrets into its output.
- Sandbox escape on a custom probe, or into another check on the same probe.
- Secrets reaching a role, page, log or notification that may not see them.

**Medium**

- Information a member's role does not cover, without secrets: a hidden
  column, another team's private resource names.
- Prompt injection that steers the AI to take actions its project did allow
  (resolve, acknowledge, post a note).
- Algorithmic denial of service on a shared service by an authenticated
  user (by an unauthenticated one: high).
- Using OneUptime Cloud's paid features or paid messages (SMS, calls) without
  paying for them.
- CSRF on a state-changing action, an open redirect on a sign-in or OAuth
  flow, reflected XSS that needs an unusual interaction.

**Low**

- Issues that need an unusual configuration and a victim's interaction,
  account or email enumeration, missing hardening with plausible but
  unproven impact.

A finding that needs a project admin role ranks one level lower unless it
crosses a project boundary or reaches the instance itself. A finding a
self-hosted install only has with a non-default setting (other than the
out-of-scope ones above) ranks one level lower.

## How reports and patches should look

Findings go privately to security@oneuptime.com; never to a public issue
(`.github/SECURITY.md`).

- One issue per report. Name the component and files, the attacker's starting
  point (from the list above), the deployment (OneUptime Cloud, self-hosted
  Compose, Kubernetes), and the impact.
- Reproduce it with a test in the package's own suite (`packages/Common/Tests`,
  `packages/App/Tests`, `packages/Probe/Tests`, `ee/Tests`, ...) or with
  requests against the App started in the image (below). Give the exact
  commands and the output that shows the impact.
- Patches follow `AGENTS.md`: the smallest change in the surrounding style,
  with a regression test that fails without it; Postgres schema changes as
  generated migrations registered in `SchemaMigrations/Index.ts`; Markdown
  for feeds and chat built with `mdText`; outbound requests to user-given
  URLs through `SSRFProtection`; no regular expression with an unbounded
  quantifier over attacker-sized text. Do not weaken a test or guard to make
  a patch pass.

## How to exercise it

The image `.oss-scanner/Dockerfile` builds has the repository at `/src` with
every Node project's dependencies installed (except the ones the Dockerfile
lists as not built, with the reason), the frontends bundled, every service
compiled, the Probe's browsers, and the Infrastructure Agent's Go modules. It
needs no network.

Tests. Each package's `npm test` first exports `/src/config.env` (written at
build time with the settings CI's suites run with) and then runs its whole
suite; to run single files, export it once and call jest directly:

```sh
cd /src && export $(grep -v '^#' config.env | xargs)
cd /src/packages/Common && npx jest Tests/Server/Utils/SSRFProtection.test.ts
cd /src/packages/App && npx jest Tests/Utils/EnterpriseLoader.test.ts
cd /src/packages/Probe && npx jest Tests/Utils/Monitors/MonitorTypes/CustomCodeMonitor.test.ts
cd /src/ee && npx jest Tests/Server/ModuleShape.test.ts
cd /src/agents/InfrastructureAgent && go test ./...
cd /src/packages/Nginx && npm test
```

Suites that need Postgres, Valkey or ClickHouse have file names ending in
`Postgres` or `Clickhouse` and are switched on by a `RUN_POSTGRES_*` variable
or `TEST_CLICKHOUSE_URL` (already in `config.env`), as
`.github/workflows/test.common.yaml`, `test.app.yaml` and
`postgres-schema-drift.yaml` run them. Start the datastores first; they
listen where CI's do, and Postgres accepts any local password:

```sh
bash /src/.oss-scanner/start-services.sh
cd /src/packages/Common && RUN_POSTGRES_PUBLISHED_IMAGES_TESTS=true npx jest --runInBand Tests/Server/Utils/File/PublishedImagesPostgres.test.ts
```

The running product: `start-app.sh` starts the datastores and the App on
`http://localhost:3002`, as a self-hosted install with billing off. The
App's first start migrates the empty databases (about a minute), which the
suites run after `postgres-schema-drift.yaml`'s migration step need too.

```sh
bash /src/.oss-scanner/start-app.sh
curl http://localhost:3002/status/ready
```

The first account to sign up (`/accounts/register`, or
`POST /api/identity/signup` with
`{"data": {"email": ..., "password": ..., "name": ...}}`) becomes the
instance's master admin; sign up again for an ordinary user, and give each
user a project, to test a boundary between two tenants. Project API keys are
created in the Dashboard (Project Settings, API Keys) or through the API.

The agent studying the image has 2 CPUs and 8 GB of memory, so run single
test files rather than whole suites; the App's full type check
(`npm run compile`) needs more memory than that and already passed when the
image was built.

## Anything to leave alone

- The placeholder secrets in `config.example.env`, the random secrets in the
  image's `config.env`, and the sandbox settings of the datastores in the
  image (Postgres trusts local connections there). They are this test
  environment, not OneUptime.
- Generated files: migrations in
  `packages/Common/Server/Infrastructure/Postgres/SchemaMigrations`, the
  translations under `**/Locales` and `**/i18n`, vendored assets under
  `packages/Common/Server/Static/Vendor`.
