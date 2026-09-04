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
> node Common/node_modules/jest/bin/jest.js \
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
`otelcol-contrib` 0.154.0 — the version the images are built `FROM` — over a
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
`otelcol validate` from the pinned `otel/opentelemetry-collector-contrib:0.154.0`
image over the three agent configs and over both collector ConfigMaps rendered
out of the `kubernetes-agent` chart.

That is not a YAML check. `validate` constructs every component and builds the
stanza operator graph for real, which compiles the RE2 regexes and the expr-lang
expressions — the Go-side class of error the jest suite structurally cannot see:
a malformed regex, an `output`/`default` naming an operator that does not exist,
or an expr string one backslash short. It runs on every PR from the
"Ops Config Test" workflow.

```sh
cd Tests/Ops && npm run validate-collector-configs
```

### `ContainerAgentDockerApiVersion.test.js`

The `docker_stats` receiver has to name the Docker Engine API version it speaks,
and a daemon refuses a client _newer_ than its own maximum. With a literal
`"1.44"` baked into the image there was no way out on Docker Engine 20.10 (max
API 1.41) short of replacing the config: the receiver fails to start, the
collector exits with it, and the container restart-loops. The version is now the
`DOCKER_API_VERSION` environment variable, defaulting to `1.44` in the image
`ENV` and in each compose file's pass-through.

Everything this suite asserts was **measured** against
`otel/opentelemetry-collector-contrib:0.154.0` and a real daemon, not assumed —
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
`DockerSwarmAgent/docker-compose.yml` passes the variable to the
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

## Utils

`Utils/Xml.js` is a small strict XML parser. The repo root has no XML parser
installed and these tests intentionally add no dependency; it exists so both
sides of the ClickHouse cross-check are parsed identically rather than compared
with regexes.
