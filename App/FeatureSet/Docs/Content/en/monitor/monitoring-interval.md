# Monitoring Interval

The monitoring interval is how often OneUptime checks a monitor. You set it when you create a monitor, and you can change it later from **Dashboard -> Monitors -> (your monitor) -> Interval**.

The intervals available to every OneUptime installation are:

- Every Minute
- Every 2 Minutes
- Every 5 Minutes (the default for a new monitor)
- Every 10 Minutes
- Every 15 Minutes
- Every 30 Minutes
- Every Hour
- Every Day
- Every Week

## Sub-minute intervals (self-hosted only)

Self-hosted installations can also check a monitor more than once a minute:

- Every 10 Seconds
- Every 20 Seconds
- Every 30 Seconds

These options only appear on self-hosted installations. They are not available on OneUptime Cloud, and the API rejects them there too — the dropdown is not the only place the rule is enforced.

Ten seconds is the floor. Faster values such as one second or five seconds are refused everywhere, because OneUptime cannot deliver them reliably: the probe has to fetch work, run the check, and post the result back for every single tick.

Only 10, 20 and 30 seconds are offered because each divides 60 evenly, so the checks land on an even grid (`:00`, `:20`, `:40`, `:00`…) with no anomaly at the minute rollover. A 45-second interval, by contrast, would alternate 45-second and 15-second gaps.

### Which monitors can use them

Sub-minute intervals are available for the monitor types a probe actively polls:

Website, API, Ping, IP, Port, DNS, DNSSEC, Domain, SQL Query, and External Status Page.

They are **not** available for:

- **Synthetic Monitor, Custom JavaScript Code, and SSL Certificate.** These checks are too slow to finish inside a sub-minute window — the dashboard already hides the 1- and 2-minute options for them.
- **Telemetry and infrastructure monitors** (Logs, Metrics, Traces, Exceptions, Profiles, Kubernetes, Docker, Host, Podman, Docker Swarm, Proxmox, Ceph, IoT Device). These are evaluated by a server-side worker that runs once a minute, so a sub-minute value would be accepted and then quietly honoured as 60 seconds.
- **Manual, Incoming Request / Heartbeat, Incoming Email, Server, and Network Device monitors**, which have no outbound monitoring interval at all.

## Making sure your probes keep up

A probe asks the server for monitors that are due on a fixed cadence, set by `PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS` (default: 10 seconds). This is the ceiling on how fast any monitor can be checked — a monitor set to 20 seconds cannot beat a probe that only asks for work once a minute.

The supported values are 10, 12, 15, 20, 30 and 60 seconds; anything else falls back to 10. Setting it to 60 restores exactly the behaviour probes had before sub-minute intervals existed, at the cost of making sub-minute monitors run at one check a minute.

Two other settings decide how much a probe gets through:

- `PROBE_MONITOR_FETCH_LIMIT` (default: 10) — how many monitors the probe claims per fetch.
- `PROBE_MONITORING_WORKERS` (default: 1) — how many fetches run in parallel.

A probe keeps up as long as `PROBE_MONITORING_WORKERS × PROBE_MONITOR_FETCH_LIMIT` covers the number of monitors that come due in a single fetch cycle. If you run many sub-minute monitors on one probe, raise `PROBE_MONITOR_FETCH_LIMIT` first.

For Docker Compose these map to `GLOBAL_PROBE_1_MONITOR_FETCH_INTERVAL_IN_SECONDS` and friends in `config.env`. For Helm they are `probes.<name>.monitorFetchIntervalInSeconds`, `monitorFetchLimit` and `monitoringWorkers` in `values.yaml`.

## What to expect in practice

A monitor set to 20 seconds produces consecutive check results roughly 20 seconds apart. Small variation is normal — the probe adds a fraction of a second of jitter so that its workers do not all hit the server at the same instant, and the check itself takes time.

Two things can legitimately stretch the gap:

- **The check takes longer than the interval.** A monitor whose request genuinely needs 25 seconds cannot be checked every 20 seconds; it will run at roughly the duration of the check. Keep your request timeout comfortably below the interval.
- **The probe is at capacity.** If more monitors come due than the probe can claim in one cycle, the backlog stretches every interval. Raise `PROBE_MONITOR_FETCH_LIMIT`, add workers, or add another probe.

Sub-minute intervals are opt-in per monitor. An installation with none configured behaves exactly as it did before, with no additional database load.
