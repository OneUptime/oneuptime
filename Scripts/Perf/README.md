# CPU measurement kit

Scripts that run a production-like OneUptime on one machine, fill it with
realistic projects, put steady load on it and measure the CPU of every
process: the App, the Probe, Postgres, ClickHouse and Valkey. They are how
the numbers in the "less CPU in production" pull requests were taken, and
they are kept here so the next change can be measured the same way.

## What the stack is like

- The App and the Probe run natively, the way their images run them:
  `NODE_ENV=production`, ts-node in transpile-only mode, from
  `/usr/src/app` and `/usr/src/Common` (a private mount namespace maps those
  paths onto this checkout's packages, so CPU profiles name files as
  production profiles do). Settings are `config.example.env`'s with logs at
  `ERROR`, as it ships them.
- Postgres 15, Valkey 9.1 and ClickHouse 26.7 run in containers of their
  own, with the settings and the ClickHouse drop-ins `docker-compose.base.yml`
  mounts.
- The Probe is sized like a big install's (20 workers, 50 monitors a fetch;
  compose ships 5 and 10, which checks at most 50 monitors a minute).
- Containers are named `$PERF_PREFIX-*` (default `oneuptime-perf`) and every
  process's PID is kept in `$PERF_DIR` (default `/tmp/oneuptime-perf`), so
  `stack.sh down` stops only what `stack.sh up` started.

## What it needs

- Linux, root (for `unshare -m`), Docker, cgroup v2 with the systemd cgroup
  driver (`cpu-sample.py` reads each container's `cpu.stat`), Node 22 or
  newer (global `fetch` and `WebSocket`), Python 3.
- `npm ci` in `packages/Common`, `packages/App` and `packages/Probe`.
- For people on the Dashboard (`browse-load.js`): the Dashboard built
  (`npm ci && npm run build` in `packages/App/FeatureSet/Dashboard`) and
  Playwright's Chromium (`npm ci --ignore-scripts && npx playwright install
  chromium` in `packages/E2E`).

## A run

From this folder:

```sh
bash stack.sh up --probe                  # containers, the App, then the Probe
node target-server.js > /tmp/oneuptime-perf/target.log 2>&1 &
                                          # what the Website, API and Port monitors check
bash in-app.sh seed.js 50 /tmp/oneuptime-perf/seed.json
                                          # 50 projects of 20 monitors, a status page,
                                          # incidents and alerts; about 10 minutes
bash stack.sh probe-stop
python3 -I cpu-sample.py 10 idle          # 10 minutes idle: the App's jobs only
bash stack.sh probe-restart
bash load-phase.sh /tmp/oneuptime-perf/seed.json load 10
                                          # 10 minutes of steady load (after 2 of warm-up)
bash stack.sh down --all                  # stop everything, remove the containers
```

Start the Probe before seeding: a new monitor is assigned the probes that
exist when it is created. Each sample prints a line every interval and the
totals - CPU seconds and percent of one core for each process, its memory
at the end (resident memory for the App and the Probe; a container's
`memory.current`, page cache included), and what Postgres did in the window
(commits, rows read, the tables read most) - and writes them to
`$PERF_DIR/results/<label>.json`.

Steady load (`load-phase.sh`) is, besides the Probe checking every seeded
Website, API and Port monitor once a minute:

- `heartbeats.js`: every Incoming Request monitor's heartbeat once a
  minute, but for one monitor in twenty, which stays silent;
- `otlp-load.js`: 20 OpenTelemetry Collectors sending gzipped OTLP/protobuf
  logs, traces and metrics every 4 seconds (500 logs, 250 spans and about
  560 metric points a second; `PERF_OTLP_PERIOD_MS` changes it - at 2
  seconds the App's telemetry queue falls behind, and a window then measures
  a backlog rather than a steady load);
- `browse-load.js`: 5 people on the Dashboard, opening a page every 15
  seconds through the app's own navigation, each page polling as it does.

## A CPU profile

```sh
bash stack.sh app-restart APP_NODE_FLAGS=--inspect=127.0.0.1:9371
bash load-phase.sh /tmp/oneuptime-perf/seed.json load-profiled 5 120 20 5 --profile
node profile-summary.js summary /tmp/oneuptime-perf/results/load-profiled.cpuprofile 40
node profile-summary.js callers /tmp/oneuptime-perf/results/load-profiled.cpuprofile findMetadata
```

`summary` charges each sample to the deepest OneUptime frame on its stack,
so time spent in a library counts for the OneUptime code that called it.
`timeline` shows the once-a-minute bursts of the jobs; `window` what runs
inside one. The inspector costs some CPU: compare profiled runs only with
profiled runs.

## A/B: a baseline against this checkout

```sh
bash make-baseline.sh                     # the merge base with origin/master, in $PERF_DIR/baseline
bash ab-stack.sh /tmp/oneuptime-perf/seed.json 8 8 2
                                          # both sides twice, idle then load: about 100 minutes
bash ab-monitor.sh heartbeat 300 3        # one heartbeat check, both sides, 3 rounds
bash ab-monitor.sh probe 300 3            # one probe result
```

The baseline links this checkout's `node_modules`, so compare commits with
the same lock files. Rounds alternate so that slow drift (data growing, the
machine's other work) favours neither side; `ab-summary.py` prints them.

## What each job costs

```sh
bash in-app.sh job-cost.js 2 /tmp/oneuptime-perf/job-cost.json
```

runs every Worker job's body twice in a process of its own and prints CPU
and Postgres, ClickHouse and Valkey calls per run, runs per hour from its
schedule, and CPU seconds an hour. A whole run took longer than 20 minutes
on the seeded stack - a job that runs until its two-minute timeout sets the
pace - so a name filter (`... job-cost.json monitor`) measures the jobs it
names. The jobs do what they do in production (send
notifications, delete rows): run it only against this kit's stack.
`monitor-cost.js` does the same for one monitor check (`--sql` lists every
statement of one).

## Settings of the datastores themselves

Some savings are a datastore's own setting, measured by switching it on the
running stack and back, in turn:

- Postgres: `ALTER SYSTEM SET jit = on` (or `off`), then `SELECT
  pg_reload_conf()` - every session takes it at its next statement unless
  it set its own. With `log_min_duration_statement` set the same way, the
  slow statements and their parameters land in `docker logs`, for `EXPLAIN
  (ANALYZE)`.
- ClickHouse: a drop-in written into the running container's
  `/etc/clickhouse-server/config.d/` (`docker exec -i ... sh -c "cat > ..."`;
  `docker cp` cannot write beside the bind-mounted files) - it reloads
  `<logger>` without a restart.

## What it measured first

The pull request that added this kit (2026-10-27, 50 projects, a 32-core
machine other work shared) measured its base, c916959ca6, against its
changes with `ab-stack.sh seed.json 8 8 2` - percent of one core, mean of
two rounds:

| | idle, base | idle, changed | load, base | load, changed |
|---|---|---|---|---|
| App | 3.94 | 2.26 | 54.98 | 45.59 |
| Postgres | 2.96 | 1.83 | 10.41 | 8.98 |
| ClickHouse | 10.02 | 7.57 | 33.42 | 37.69 |
| Valkey | 0.36 | 0.34 | 2.46 | 2.83 |
| Probe | - | - | 2.00 | 2.09 |

ClickHouse drifted window by window whichever side ran, in the order run:
down at idle (11.6, 8.4, 8.4, 6.7) as it finished merging what had been
loaded before, up under load (29.8, 35.4, 37.0, 40.0) as the load added
more. The changes do not change what the App asks of it. Compare a later
run with these by the same command on the same seed size, or better,
against a baseline of its own.
