# Tests/Ops

Static / structural tests for the repo's operational configuration. They read
files off disk and parse them — they never start a container, so they run with
**no Docker, no Postgres and no ClickHouse**.

Run them from this directory:

```sh
cd Tests/Ops && npm test
```

The one exception is `validate-collector-configs.sh`, which is deliberately not
part of `npm test`: it runs the real collector binary over the agent configs and
therefore needs docker and helm. See its section below.

Two checks inside `npm test` use tools when they are there, and the "Ops Config
Test" workflow provides both:

- **gomplate.** `EnterpriseEditionBuild.test.js` checks its Dockerfile renderer
  against gomplate for every `Dockerfile.tpl`. Without gomplate on PATH the
  check is skipped with the reason logged, except when `CI` is set: then it
  fails, because a parity check must not pass by skipping. The workflow
  installs the release binary at the `GOMPLATE_VERSION` that
  `Scripts/Install/configure.sh` pins.
- **docker.** `RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS=1` turns on the real-Docker
  check of what `COPY ./ee` ships through `.dockerignore` (it builds one tiny
  image from `public.ecr.aws/docker/library/node:26-alpine3.24`). With the
  variable set, a docker that does not answer `docker version` fails the test
  instead of skipping it. The workflow sets the variable on the jest step.
- **the npm registry, and docker.** `RUN_NPM_CLI_UPDATE_TESTS=1` turns on the
  real runs of `Scripts/Docker/UpdateNpmCli.js` in `UpdateNpmCli.test.js`:
  one against a vulnerable npm installed from the registry, one inside
  `node:26-alpine3.24` through the real `.dockerignore`. The workflow sets it
  on the jest step too.

or from the repo root:

```sh
node node_modules/jest/bin/jest.js --config Tests/Ops/jest.config.json --runInBand
```

There are no dependencies beyond what the repo root already installs (`jest`,
`js-yaml`). `Tests/Ops/package.json` sets `"type": "commonjs"` so these files
stay CommonJS inside the ESM repo root.

> **Known issue with the root install.** The root `node_modules` can end up with
> a hoisted `jest-environment-node`/`jest-mock` at one 30.x patch and
> `jest-runtime` at another, which makes _any_ jest run whose `rootDir` is
> inside this repo die with
> `TypeError: this._moduleMocker.clearMocksOnScope is not a function` before a
> single test executes. It is not specific to this suite — a one-line
> `expect(1).toBe(1)` fails the same way. If you hit it, either reinstall the
> root dependencies or run the suite with another consistent jest in the repo:
>
> ```sh
> node packages/Common/node_modules/jest/bin/jest.js \
>   --config Tests/Ops/jest.config.json --runInBand
> ```

## What is covered

### `ClickhouseSystemLogTtl.test.js`

ClickHouse's own system logs (`system.query_log`, `system.trace_log`, …) have
no TTL in the stock config, so they grow forever;
`system.processors_profile_log` reached 536 GiB on the hosted deployment before
it was disabled. Both the Helm path and
`Clickhouse/config.d/system-log-ttl.xml` (docker-compose) cap six of them at 6h
and remove `processors_profile_log`.

**The TTL keys off `event_time`, not `event_date`, and the tests pin that.**
Both files carried `event_date + INTERVAL 6 HOUR DELETE` for a long time.
`event_date` is a `Date`, so adding hours to it coerces to midnight of that day:
the expiry lands at 06:00 on the row's _own_ date, meaning a row written at
23:00 is born seventeen hours expired. That is not a 6 hour cap — in steady
state it discards nearly everything written after 06:00. `event_time` is the
`DateTime` column every one of these six tables has, and
`event_time + INTERVAL 6 HOUR DELETE` is what actually retains six hours.
`the shared TTL really is 6 hours from a DateTime column in both files` fails on
the old expression, so it cannot come back.

The other important test here is the **lockstep cross-check**: the retention
settings are parsed out of _both_ `HelmChart/Public/oneuptime/values.yaml`
(`clickhouse.configuration`) and the compose drop-in, then compared table by
table. If someone changes one and not the other, the suite names the tables that
drifted. Divergence between the compose and Helm ClickHouse configs is what let
the 25.7-vs-26.7 aggregate-schema bug through, so it is worth a hard gate.

Because TTL is enforced by background merges (not a timer), and these tables
keep the stock monthly partitioning, 6h is the floor on what is retained rather
than a guarantee that everything older is already gone.

### `BackupRestoreScripts.test.js`

`backup.sh` emits one custom-format (`--format=custom`) dump; `restore.sh` feeds
it to `pg_restore`. The tests pin the flags and, more importantly, assert
end-to-end that the artifact name `backup.sh` writes (`db-$(date +%d).backup`)
is a name `DATABASE_RESTORE_FILENAME` in `config.example.env` can actually
refer to — the coherence that was previously missing, when `backup.sh` wrote
`db-DD.sql`/`db-DD.tar` and the shipped restore default was `db-31.backup`.

Both scripts are also checked with `bash -n`, and with `shellcheck` when it is
on PATH (skipped, not failed, when it is not).

### `ContainerAgentLogSeverity.test.js`

Container runtimes record no severity on a log line, so `DockerAgent`,
`PodmanAgent` and `DockerSwarmAgent` derive one in their baked-in collector
config. That used to be the stream alone (`stderr -> ERROR, stdout -> INFO`),
which brands the entire output of any service that logs structured lines to
stderr — PSR-3/Monolog and Go zap/logrus both do by default — as ERROR. The
config now reads a level keyword out of the body first and keeps the stream
mapping as the fallback.

**A keyword counts only where a level actually sits.** The first version of the
read was an unanchored scan that took the leftmost level word anywhere in the
recombined body, and it cost more than it looked: `{"status":"ok","error":null}`
on stdout became Error, `Recovered from panic, continuing` became Fatal, and —
because `=` was a trailing delimiter but not a leading one — logfmt's
`level=error` was invisible while a level word later in the same message was
not, turning a genuine error into Information. The scan is now field-aware, and
matches exactly two shapes:

1. **Line preamble.** The keyword is on the first line of the record and
   everything before it is preamble: punctuation, digits, and word tokens that
   end on a structural delimiter. `[ERROR] …`, `app.INFO: …`,
   `2026-08-31 07:25:04 INFO …`, `… - myapp - INFO - …`, `level=error …`. Prose
   is not preamble — `Connection error, retrying` stops dead at `Connection `,
   because a bare word followed by a space is not a preamble token. The
   repetition is lazy, so the FIRST keyword in preamble position wins rather
   than the last.
2. **Level field.** The keyword is the value of a level-ish key anywhere in the
   line — `level` / `lvl` / `severity` / `severity_text` / `levelname` /
   `log.level` / `log_level` — quoted or not, separated by `:` or `=`. That is
   zap and logrus JSON, and logfmt whose level is not the first field.

The preamble branch is anchored, so when it matches it is the leftmost match and
beats a level field further along the same line. Both branches take end of body
as a trailing delimiter, which is what settles the old Docker/Podman divergence:
Docker's json-file driver keeps the trailing newline in the `log` field and
Podman's CRI format does not, so a line ending on its level used to be read
differently by the two agents.

The chain is five stanza operators of YAML, duplicated across three agent images
**and** the Kubernetes agent's DaemonSet ConfigMap
(`HelmChart/Public/kubernetes-agent/templates/configmap-daemonset.yaml`).
Nothing compiles it. `otelcol validate` only proves each operator is
individually well-formed, so the two failure modes that matter are both silent
and both leave the agent worse than the stream-only behaviour it replaced:

- **The router's regex and the parser's regex drift apart.** They are the same
  pattern written with two different amounts of escaping — the router's lives
  inside an expr-lang string literal (`\\s`), the parser's is a bare YAML
  scalar (`\s`). The suite decodes the router's the way expr-lang does and
  asserts the two are identical. The decode is deliberately strict about unknown
  escapes, because `\s` in a Go string literal is not "backslash-s", it is a
  config the collector refuses to start on.
- **A keyword the regex captures has no severity mapping.** stanza's built-in
  `default` preset knows trace/debug/info/warn/warning/error/err/fatal and
  nothing else — `notice`, `crit`, `critical`, `panic`, `alert`, `emerg` and
  `emergency` are supplied by the config's own `mapping:` block. A keyword
  without one does not error and does not drop the record: `severity_parser`
  leaves it **Unspecified**. So the suite walks every alternative in the regex
  and asserts each resolves to a real OTel severity number, and then that each
  survives OneUptime's ingest (`OtelLogsIngestService.getSeverityText`, which
  re-derives severityText from severityNumber) as a real `LogSeverity` rather
  than Unspecified. It also asserts the list covers all eight PSR-3 levels,
  which is the hole `ALERT` and `EMERGENCY` used to sit in.

On top of that it pins the operator graph (nothing unreachable, `log.iostream`
populated before the fallback reads it, both branches converging on the severity
parser and then the cleanup), runs the real regex over a corpus of Monolog, zap,
logfmt, nginx, logback, Python, .NET and klog lines, and holds the three agents
and the Kubernetes ConfigMap to one identical chain.

The expectations are not guesses: each config was run through the real
`otelcol-contrib` 0.161.0 — the version the images are built `FROM` — over a
fixture log file, and the severity this suite predicts is the severity the
collector emitted. The pattern is additionally cross-checked against Go's
`regexp` package, which is the same RE2 implementation stanza's `regex_parser`
and expr-lang's `matches` both use.

The block **`regression: what the unanchored keyword scan got wrong`** is the
old characterization block turned the right way up. Every line in it is one the
unanchored scan got wrong, now asserted in the direction it is supposed to go:

- **Escalation.** A benign stdout line that mentions a level word in prose was
  `Information` and became `Error`, or `Fatal`. Thirty level-free stdout lines
  (eleven of which were reclassified) are asserted to reach the fallback.
- **Inversion.** A genuine stderr error whose message contained an earlier level
  word was `Error` and became `Information` — a real error hidden, the worse of
  the two.
- **logfmt.** `level=error` is now read, wherever in the line it sits.
- **PSR-3 `ALERT` and `EMERGENCY`** are in the keyword list and in the mapping.

Two more properties are pinned because they are easy to break while widening the
pattern: only the first line of a recombined body can supply a preamble level,
and the pattern must stay cheap on pathological input — the Kubernetes API-mode
tailer runs the same source through JavaScript's backtracking engine rather than
RE2, where a pattern that is linear in RE2 can still be exponential.

### `validate-collector-configs.sh`

Not part of `npm test`, because it needs docker and helm. It runs
`otelcol validate` from the pinned `otel/opentelemetry-collector-contrib:0.161.0`
image over the four agent configs, over the Database Agent's per-engine
configs (as shipped, and again with every optional metric their comments list
switched on), and over both collector ConfigMaps rendered out of the
`kubernetes-agent` chart.

That is not a YAML check. `validate` constructs every component and builds the
stanza operator graph for real, which compiles the RE2 regexes and the expr-lang
expressions — the Go-side class of error the jest suite structurally cannot see:
a malformed regex, an `output`/`default` naming an operator that does not exist,
or an expr string one backslash short. It runs on every PR from the
"Ops Config Test" workflow.

```sh
cd Tests/Ops && npm run validate-collector-configs
```

### `DatabaseAgentConfigs.test.js`

The Database Agent (`agents/DatabaseAgent`) is config-only: a stock collector
image plus one config per engine (`configs/{postgresql,mysql,redis,mongodb}.yaml`).
OneUptime registers a database from what those configs stamp, so their shape is
pinned, per engine:

- the `resource` processor upserts `db.system.name`, `server.address`,
  `server.port` (unquoted, so it stays an integer), `oneuptime.database.agent:
  "true"` and `oneuptime.agent.version` (equal to the compose image pin), and
  deletes `service.name`; it stamps no `k8s.*` / `host.*` / `os.*` /
  `container.*` / `cloud.*` attribute — ingest reads `k8s.cluster.name` as the
  Kubernetes agent's heartbeat;
- `oneuptime.database.server.id` is set by a transform and deleted again when
  `DATABASE_SERVER_ID` is blank, on metrics and logs, and never by the
  resource processor (which refuses an empty value);
- no `resourcedetection` processor, one receiver instance per pipeline, the
  processor order `memory_limiter → resource → transform → batch`, and a
  single `otlphttp` exporter to `${env:ONEUPTIME_URL}/otlp` with the
  ingestion-key header;
- TLS flags and event toggles stay unquoted (booleans), query events exist only
  where the receiver has them, and Redis / MongoDB turn on the receiver's own
  `server.address` / `server.port`;
- every `${env:...}` is passed by `docker-compose.yml`, `install.sh` reuses and
  writes exactly the compose variables, accepts only engines that have a
  config, and shares its host classifiers with `troubleshoot.sh`; the systemd
  unit runs the directory `install.sh` installs to.

### `ContainerAgentDockerApiVersion.test.js`

The `docker_stats` receiver has to name the Docker Engine API version it speaks,
and a daemon refuses a client _newer_ than its own maximum. With a literal
`"1.44"` baked into the image there was no way out on Docker Engine 20.10 (max
API 1.41) short of replacing the config: the receiver fails to start, the
collector exits with it, and the container restart-loops. The version is now the
`DOCKER_API_VERSION` environment variable, defaulting to `1.44` in the image
`ENV` and in each compose file's pass-through.

Everything this suite asserts was **measured** against
`otel/opentelemetry-collector-contrib:0.161.0` and a real daemon, not assumed —
see the header comment for the full table. Three measurements matter:

| `api_version`         | on the wire            | collector             |
| --------------------- | ---------------------- | --------------------- |
| omitted               | `/v1.44/`              | starts                |
| `""` (unset or empty) | `HEAD /_ping` then max | starts                |
| too new / too old     | —                      | exits, pipeline fails |

So the receiver's own default is **1.44**, and `1.25` is its accepted _minimum_,
not its default. The configs used to say the opposite ("the receiver default is
`1.25`, which modern daemons reject"), which made an unset variable look
dangerous when it is not; a test now fails if that claim comes back.

An empty `api_version` is safe: the receiver falls back to Docker SDK
**auto-negotiation** — one `HEAD /_ping`, then the daemon's own maximum — which
works against any daemon. That makes it a real escape hatch for operators who
cannot easily read their daemon's maximum, so the READMEs and docs pages
describe it and a test keeps that documentation honest.

Because empty is meaningful, every pass-through uses `${VAR-1.44}` and **not**
`${VAR:-1.44}`. Both Compose and the shell treat `:-` as "substitute when unset
_or_ empty", which would silently swallow the escape hatch; the colon-less form
only fills in when the variable is absent entirely. A test pins that distinction
so it does not get tidied back.

The config itself keeps a plain `${env:DOCKER_API_VERSION}`. Upstream's own
`envprovider` test table shows that confmap's `:-` applies only when the variable
is genuinely unset (`{value: "", uri: "env:MY_VAR:-foo", expectedVal: ""}`), so a
`${env:…:-1.44}` default would not catch an empty value either — and the unset
case already degrades to auto-negotiation, which is the safer outcome.

The inventory pollers are the other client of that API. Rather than
pattern-matching their source, the suite **runs** each script's `API_VERSION`
resolution block under `sh` and asserts the URL it produces: unset →
`http://localhost/v1.44`, explicitly empty → `http://localhost` (unversioned, the
curl analogue of negotiating), explicit → that version. It also asserts
`agents/DockerSwarmAgent/docker-compose.yml` passes the variable to the
`oneuptime-docker-swarm-inventory` sidecar, the container that actually runs the
script, which the collector service's entry does not reach. `DockerAgent`'s and
`PodmanAgent`'s scripts are not wired into their images today (`Dockerfile.tpl`
copies only the collector config, and nothing references `entrypoint.sh`), so for
them the assertion guards the comment rather than a running path.

The remaining blocks are cross-checks: a **lockstep** comparison so a bump
applied to one agent and not the rest fails; a check that the agents baking an
image are exactly the ones with a `Dockerfile.tpl`; a check that `AGENTS` covers
**every** `docker_stats` receiver in the repo, so a fourth agent added later with
a literal pin cannot slip past; and a **locale parity** check that all 16
translations of `docker-host.md` and `podman-host.md` document the variable and
carry the troubleshooting entry, since the English page racing ahead of the other
15 is the normal way this rots.

### `ContainerAgentDockerApiVersionRuntime.test.js`

The runtime counterpart. The suite above pins the _shape_ of the plumbing by
reading files; this one pins the _behaviour_ that shape exists to produce, by
running the pinned collector image against a real daemon: a version above the
daemon's maximum kills the collector, one below its minimum does too, and an
empty value starts fine via auto-negotiation.

It needs Docker and pulls an image, so it is **off by default** and never runs in
the normal `npm test` or CI path:

```bash
RUN_CONTAINER_AGENT_RUNTIME_TESTS=1 npm test
```

It adapts to whatever daemon it finds — the API version bounds are read from that
daemon, and any case the daemon cannot demonstrate (for example `1.25` on a
daemon whose floor is low enough to accept it) is skipped with a reason rather
than failed. A guard test that always runs reports why the suite is idle, so it
cannot rot into permanent silence.

### `EnterpriseEditionBuild.test.js`

How the Community and Enterprise editions are built, tested and shipped. The
enterprise code lives in `ee/` under its own license, and the split only holds
if the build and CI machinery keeps the two apart. Almost none of that
machinery runs on a pull request (images are published, and the e2e suites
run, only after a merge), so the suite pins the machinery itself:

- **The App image** (`packages/App/Dockerfile.tpl`, rendered for production
  and development with `Utils/DockerfileTemplate.js`). The stage graph is
  `base -> community-build -> enterprise-build -> enterprise`, with `community`
  built from `community-build` and kept last so a plain `docker build` is the
  Community Edition. Nothing the community stage is built from copies or
  mentions `ee/`, and it refuses bundles that contain the ee sentinel strings.
  The enterprise build recreates the `/usr/src/packages` links that
  `ee/package.json`'s `file:` dependencies resolve through, installs ee from
  its lockfile with `--ignore-scripts` before copying the sources, type-checks
  the ee server, rebuilds only the Dashboard and Admin Dashboard with
  `ONEUPTIME_EDITION=enterprise`, refuses bundles without the sentinels, and
  prunes ee's dev dependencies afterwards. Only the enterprise stage sets
  `ONEUPTIME_EDITION`. The development image never copies `ee/`.
- **Every other image**: each `Dockerfile.tpl` in the repository (production
  and development renders, with and without its optional `file.Exists`
  blocks) is checked stage by stage with `Utils/DockerfileContext.js`, and
  only the App's `enterprise-build` and `enterprise` stages may take anything
  from `ee/`. Every image is built with the repository root as its context,
  so `ee/` is always there to take. The check refuses a `COPY`/`ADD` of the
  whole context (`.`, `./`, `/`), of any path with an `ee` segment, of a
  pattern that matches `ee`, or of a variable, in the shell and JSON forms
  with any flags. It also refuses `COPY --from`, `FROM` or `RUN --mount` from
  a stage that holds `ee/`, and a `RUN --mount` bind of the context. Each of
  those has a negative-control test.
- **`.dockerignore` / `.gitignore`**: ee key material, build output and tests
  stay out of `COPY ./ee` and out of git. With
  `RUN_ENTERPRISE_IMAGE_RUNTIME_TESTS=1` (set in CI) a real `docker build`
  proves what `COPY ./ee` ships through the real `.dockerignore`. It includes
  a fixture for every `ee/**/*.<ext>` key pattern listed there.
- **CI**: every core compile/test job deletes `ee/` before it installs
  anything (core is the Community Edition by construction); `compile-ee` and
  `test.ee.yaml` install what ee needs and compile/test it, and `test.ee.yaml`
  also runs App's two Enterprise boundary guards with `ee/` present (their
  ee-direction checks skip without it); the Build workflow
  builds both App targets and checks each with
  `Scripts/GHA/check_app_image_edition.sh`; the release jobs that enable
  billing (the SaaS e2e jobs) run the `enterprise-` tags, the self-hosted e2e
  jobs the Community ones, and every image merge publishes an `enterprise-`
  tag.
- **Deployment**: no compose file and no Helm template sets `ONEUPTIME_EDITION`,
  which would override the Enterprise image's own marker.
- **The dev loop**: the dev `app` service mounts `ee/` with an anonymous
  `node_modules` volume, nodemon watches `ee/Server`, and `dev.sh`'s
  `install_enterprise_deps` (run for real with a fake `npm`) installs ee's
  dependencies once per lockfile and does nothing without `ee/`.
  `Scripts/Dev/install-node-modules.sh` (also run for real) installs `ee/` last.
- **Helm**: both charts are annotated Apache-2.0, and the fictitious "hardened
  images" claim is gone.

The renderer is cross-checked against gomplate itself, for every
`Dockerfile.tpl` with and without an `SslCertificates` directory. A missing
gomplate fails this check in CI and skips it elsewhere.

### `EnterpriseSbomCoverage.test.js`

`Scripts/GHA/generate_sboms.sh` scans the `enterprise-` tag only for the images
in its hard-coded `ENTERPRISE_IMAGES`. Those should be exactly the images whose
enterprise tag is a separate build: the ones whose Dockerfile has an
`enterprise` stage, which `build_docker_images.sh` builds as a target. The
suite reads the images and Dockerfiles from release.yml's
`build_docker_images.sh --image ... --dockerfile ...` calls. It renders each
template, finds the ones with an `enterprise` stage (using the same line test
as `build_docker_images.sh`, cross-checked against the stage parser) and
asserts that set equals `ENTERPRISE_IMAGES`, which bash reads from the script.

### `UpdateNpmCli.test.js`

npm bundles its whole dependency tree, so the `tar`, `undici`,
`brace-expansion` and `ip-address` inside `<global root>/npm` are whatever the
npm release was packed with, and `npm audit` over our lockfiles never sees
them. Scanners reported nine CVEs in exactly those four in every Node image,
put there by `npm install -g npm@latest`. Every Node image now runs
`Scripts/Docker/UpdateNpmCli.js` instead: `npm@latest` (never older than the
image's npm), with its dependencies reinstalled by npm's own resolver at the
newest versions npm's ranges accept, checked with the new npm itself
(`--version`, `ls --all --omit=dev`) before and after it replaces anything.

The suite covers the version choice, the install manifest, the order of the
steps, the swap (including the overlayfs `EXDEV` fallbacks and putting the old
npm back when the move fails), and that every failure leaves the image's npm
exactly as it was, with no staging directory behind. With
`RUN_NPM_CLI_UPDATE_TESTS=1` it also updates a real npm 12.0.2 (which bundles
all four vulnerable packages) and uses the result for a real install, and runs
the script inside `node:26-alpine3.24` through the real `.dockerignore`.

### `ContainerImageHardening.test.js`

What keeps the images free of the rest of what scanners reported, for every
`Dockerfile.tpl`, rendered for production and development:

- every Node image runs the npm update in the stage that ships, before
  anything it installs, and none installs npm with `npm install -g npm`;
- `.dockerignore` lets that one script into the build context, and still keeps
  the rest of `Scripts/` out;
- no image starts `FROM` a full Debian node image (buildpack-deps: compilers,
  kernel headers and ~70 `-dev` libraries), only alpine or slim;
- a production image that installs a compiler removes it after the last step
  that could need it (`apk del .gyp`, or `apt-get purge --auto-remove`);
- tini is started from the path the image's package manager installs it to;
- the Runner still installs the command-line tools the full image provided;
- E2E installs itself with `--ignore-scripts` (its `preinstall` would install
  a second, unpinned set of browsers and WebKit's libraries), only while no
  dependency has an install script, and installs exactly the engines its
  Playwright projects launch;
- the App drops aedes' `examples/` (a `package.json` named like a malware
  package) in the layer that installs it;
- the Nginx base and its node donor are pinned to the same Alpine release, and
  only the nginx modules `nginx.conf` never loads are removed;
- the collector version is the same everywhere the container agents run it or
  it is validated.

### `lint-app-dockerfile.sh`

Not part of `npm test`, because it needs docker. It renders the App
Dockerfile for production and development and runs
`docker buildx build --check` over the production render for the default,
`community` and `enterprise` targets and over the development render. That
resolves each target's stage graph with BuildKit itself, which the jest suite
cannot. It runs on every PR from the "Ops Config Test" workflow.

```sh
cd Tests/Ops && npm run lint-app-dockerfile
```

## Utils

`Utils/DockerfileTemplate.js` renders a `Dockerfile.tpl` for production or
development and splits a Dockerfile into its stages. It understands only the
one `if`/`else`/`end` block the templates use, plus, when the caller answers
`file.Exists`, the optional `{{- if file.Exists "..." }}` blocks (with Go's
whitespace trimming). It throws on anything else. It also finds every
`Dockerfile.tpl` the way `configure.sh` does.

`Utils/DockerfileContext.js` parses `COPY`/`ADD` (shell and JSON forms) and
`RUN --mount`, and reports every way a stage can take `ee/` from the build
context or from a stage that holds it.

`Utils/Xml.js` is a small strict XML parser. The repo root has no XML parser
installed and these tests intentionally add no dependency; it exists so both
sides of the ClickHouse cross-check are parsed identically rather than compared
with regexes.
