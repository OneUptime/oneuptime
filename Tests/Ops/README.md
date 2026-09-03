# Tests/Ops

Static / structural tests for the repo's operational configuration. They read
files off disk and parse them — they never start a container, so they run with
**no Docker, no Postgres and no ClickHouse**.

Run them from this directory:

```sh
cd Tests/Ops && npm test
```

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
  nothing else — `notice`, `crit`, `critical` and `panic` are supplied by the
  config's own `mapping:` block. A keyword without one does not error and does
  not drop the record: `severity_parser` leaves it **Unspecified**. So the suite
  walks every alternative in the regex and asserts each resolves to a real OTel
  severity number, and then that each survives OneUptime's ingest
  (`OtelLogsIngestService.getSeverityText`, which re-derives severityText from
  severityNumber) as a real `LogSeverity` rather than Unspecified.

On top of that it pins the operator graph (nothing unreachable, `log.iostream`
populated before the fallback reads it, both branches converging on the severity
parser and then the cleanup), runs the real regex over a corpus of Monolog, zap,
nginx, logback, Python, .NET and klog lines, and holds the three agents and the
Kubernetes ConfigMap to one identical chain.

The expectations are not guesses: each config was run through the real
`otelcol-contrib` 0.154.0 — the version the images are built `FROM` — over a
fixture log file, and the severity this suite predicts is the severity the
collector emitted.

The last block, **`characterization: what the keyword scan gets wrong`**, is not
a list of things the suite approves of. Deciding severity by scanning for a
keyword has a price, and these tests are the record of it:

- **Escalation.** A benign stdout line that mentions a level word in prose used
  to be `Information` and is now `Error`, or `Fatal`. `{"status":"ok","error":null}`
  → Error. `Recovered from panic, continuing` → Fatal.
- **Inversion.** A genuine stderr error whose message contains an earlier level
  word used to be `Error` and is now `Information` — a real error hidden, which
  is the worse of the two.
- **logfmt is invisible.** `=` is in the pattern's _trailing_ delimiter class
  but not its leading one, so `level=error` can never be captured while a level
  word later in the same message can. That is Grafana, Traefik, Prometheus,
  Loki, the Docker daemon and the HashiCorp tools.
- **PSR-3 `ALERT` and `EMERGENCY` are missing** from the keyword list, so
  Monolog's two most severe levels fall back to the stream.

Fixing those means making the scan field-aware — or at minimum adding `=` to the
leading class — in all four copies of the chain at once. Until then these tests
say what is actually happening, and changing them should be a deliberate act.
Two smaller limitations are pinned the same way: the **leftmost** level word
wins, and a body ending on the keyword needs a trailing delimiter (Docker keeps
the newline in the log field, Podman's CRI format does not).

## Utils

`Utils/Xml.js` is a small strict XML parser. The repo root has no XML parser
installed and these tests intentionally add no dependency; it exists so both
sides of the ClickHouse cross-check are parsed identically rather than compared
with regexes.
