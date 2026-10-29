# CPU and memory measurement kit

Scripts that run a production-like OneUptime on one machine, fill it with
realistic projects, put steady load on it and measure the CPU and memory of
every process: the App, the Probe, Postgres, ClickHouse and Valkey. They are
how the numbers in the "less CPU in production" and "less memory in
production" pull requests were taken, and they are kept here so the next
change can be measured the same way. Memory has a section of its own below.

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
- `make_env.py` writes the App's and the Probe's settings (`app.env`,
  `probe.env` in `$PERF_DIR`) the first time `stack.sh` needs them, and
  `seed.js` and `browse-load.js` call the API as the Dashboard does, through
  `api.js`.

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

`load-phase.sh --profile` takes the profile with `cpu-profile.js`, over the
App's inspector, for as long as the window runs.
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

## Memory

What a process holds is measured three ways: its resident memory over a
window, its live heap (what a full garbage collection leaves), and what in
that heap holds the most.

```sh
bash stack.sh app-restart APP_NODE_FLAGS=--inspect=127.0.0.1:9371
bash memory-phase.sh /tmp/oneuptime-perf/seed.json idle 10 0 0 0 9371 10
                                          # 10 minutes idle: no load at all
bash memory-phase.sh /tmp/oneuptime-perf/seed.json load 15 120 20 5 9371 30
                                          # 15 minutes of steady load
node heap-snapshot.js 9371                # the live heap, after a full collection
node heap-snapshot.js 9371 /tmp/oneuptime-perf/app.heapsnapshot
node --max-old-space-size=32000 heap-summary.js /tmp/oneuptime-perf/app.heapsnapshot 40
```

- `memory-sample.py` (run by `memory-phase.sh`) records, every 30 seconds,
  each process's resident memory split into anonymous and file-backed
  pages, each container's cgroup memory split into anon (what the server
  holds) and file (page cache, which the kernel takes back when it needs
  it), ClickHouse's own accounting (MemoryTracking, jemalloc, its caches),
  Postgres's connections and Valkey's used_memory - and every Nth sample the
  App's live heap. Reading the live heap runs a full garbage collection,
  which lowers resident memory too: read it rarely (`heapEvery`) when
  resident memory is what is being measured.
- `heap-summary.js` reads a snapshot (1-3 GB for the App; it needs about
  three times that in free memory): self size by type and constructor, the
  dominator tree's biggest retainers with the chain that keeps each, and
  with `--strings`, `--scripts` (the source text V8 keeps, by package),
  `--chains <constructor>`, `--find <prefix>` (the shortest path from the
  root to a node: what keeps it alive) and `--json`. `heap-diff.js` compares
  two `--json` tables: what grew between two snapshots of a long run.
- Native memory is not in the heap. Under load the App's resident memory is
  two to five times its live heap - garbage between collections, buffers,
  zlib streams and the allocator's free lists - and the allocator is the
  image's (musl on Alpine), not this machine's (glibc): measure resident
  memory with the App as its image.

```sh
bash app-image.sh build                   # images of the merge base and of this checkout
bash app-image.sh run base                # the App as its image, on the host network
bash memory-phase.sh /tmp/oneuptime-perf/seed.json base-load 15 120 20 5 9371 30
bash app-image.sh run branch
bash memory-phase.sh /tmp/oneuptime-perf/seed.json branch-load 15 120 20 5 9371 30
bash app-image.sh stop
```

`image/App.Dockerfile` is the production stage of `packages/App/Dockerfile.tpl`
without the frontends' production builds (the Dashboard's bundle is copied
in from this checkout) and without the build-time type check.

The other servers - the Probe, the Runner, the ingress sidecar
(`packages/Nginx`) - one at a time, natively as their images run them, the
live heap a while after start (`npm ci` in the package first; the env file
gives the settings, `app.env` for the sidecar, `probe.env` for the Probe):

```sh
bash server-heap.sh Nginx development 45 /tmp/oneuptime-perf/app.env
                                          # ts-node's own compile: inline source maps
bash server-heap.sh Nginx production 45 /tmp/oneuptime-perf/app.env
                                          # Common's transpiler, as the image runs it
```

`Tests/Ops/PerfKit.test.js` keeps the kit runnable without a stack: every
script parses, this README names every file, the memory tools run end to end
on a Node process that holds a known structure (heap-snapshot.js,
heap-summary.js and its options, heap-diff.js, memory-phase.sh with
memory-sample.py), and `image/App.Dockerfile` starts the App as the App's
own image does.

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

## What it measured for memory

The "less memory in production" pull request (2026-10-28, the same seed)
measured its base, 44e16e9403, against its changes with the App as its
image (`app-image.sh`): each side 3 minutes' warm-up, 10 minutes idle with
the Probe stopped, then 15 minutes of steady load after 2 of warm-up. MB;
live heap is what a full garbage collection leaves, RSS the median of the
30-second samples:

| App                   | base          | changed   |
| --------------------- | ------------- | --------- |
| live heap at start    | 1,419         | 380       |
| RSS at start          | 1,671         | 564       |
| idle RSS              | 1,751         | 629       |
| steady load RSS       | 2,066         | 792       |
| steady load live heap | 1,447 - 1,459 | 402 - 427 |

The heap snapshots showed where the base's went: 560 MB of zod schemas kept
by zod-to-openapi's metadata registry (a Map, not a WeakMap), about 470 MB
of ts-node's inline source maps in the code V8 keeps, and the 33 MB OpenAPI
spec document. Under the same load Postgres held 0.4-0.5 GB (51 connections,
about 10 MB each), ClickHouse 1.3-1.6 GB anon and 1.5-1.8 GB of page cache,
Valkey 9 MB; the Probe 310 MB. Over 40 minutes of steady load the changed
App's live heap stayed between 400 and 433 MB.

The other servers, run natively, live heap after a full collection with
ts-node's own compile (`NODE_ENV=development`) against Common's transpiler
(production): the ingress sidecar 269 -> 150 MB (`server-heap.sh`, 45
seconds after start, three runs each; resident 448 -> 307 MB), the Probe
126.5 -> 90.9 MB, the Runner 88.5 -> 63.9 MB.
