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

## Utils

`Utils/Xml.js` is a small strict XML parser. The repo root has no XML parser
installed and these tests intentionally add no dependency; it exists so both
sides of the ClickHouse cross-check are parsed identically rather than compared
with regexes.
