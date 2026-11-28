# XCP-ng fixtures

What Xen Orchestra serves, and what the XCP-ng Agent sends OneUptime for it.

| File | What it is |
| --- | --- |
| `XenOrchestraScrape1.txt`, `XenOrchestraScrape2.txt` | `GET /openmetrics/metrics` as Xen Orchestra's OpenMetrics plugin answers it for the recorded lab (two pools, two minutes), from `Tests/Ops/Fixtures/XcpNg/XenOrchestraScrape.js` at `nowSeconds` 1795000000 and 1795000060. |
| `AgentOtlpScrape1.json`, `AgentOtlpScrape2.json` | What the agent's collector sends OneUptime for those two scrapes: one OTLP `ExportMetricsServiceRequest` each, in OTLP/JSON as the collector's file exporter writes it, holding one resource per pool. |
| `XenOrchestraRest/` | The same lab as Xen Orchestra's REST API (`/rest/v0`) answers it, for what a probe reads beyond the metrics (#10997): see [The REST API's lab](#the-rest-apis-lab). |

## How the agent's files are made

```sh
bash Tests/Ops/xcp-ng-agent-scrape-behaviour.sh --write-fixtures
```

That runs the real collector (`otel/opentelemetry-collector-contrib:0.165.0`, the
image `agents/XcpNgAgent/docker-compose.yml` pins) with the shipped
`otel-collector-config.yaml`, scraping every 5 seconds instead of 60, against a
stand-in Xen Orchestra (`Tests/Ops/Utils/FakeXenOrchestra.js`) that serves the
recorded scrape over HTTPS. The collector's own `otlp_http` exporter sends to an
OTLP sink (a second collector of the same image) whose file exporter writes what
it receives. Without `--write-fixtures` the same test holds every run to these two
files, so they stay what the collector really sends: regenerate them after a
change to the agent's config, its collector pin or the recorded scrape.

Only what changes from run to run is normalized:

- `xcp_pool_connected`'s `timeUnixNano`. Xen Orchestra serves that one series
  without a timestamp, so the collector stamps it with the moment it scraped; the
  files carry the second the stand-in served the scrape instead (1795000000 and
  1795000060).
- The order of resources, metrics, datapoints and attributes. The collector
  builds them through maps, so it changes between runs, and OTLP gives it no
  meaning: they are sorted by `xcp_ng.pool.id`, metric name, datapoint attributes
  and attribute key.

Everything else is as the collector sent it.

## What they show

- One resource per pool. `xcp_ng.pool.id` is the pool's UUID; `xcp_ng.pool.name`
  is its name, and is absent for the pool XAPI names nothing (Xen Orchestra sends
  `pool_name=""` on `xcp_pool_connected`, and Prometheus reads an empty label as no
  label). Each also carries `xen_orchestra.name` (`xo-behaviour`, the test's
  `XO_NAME`), `oneuptime.agent.version` (`0.165.0`) and the three attributes the
  receiver adds (`server.address`, `server.port`, `url.scheme`); no
  `service.name`, no `service.instance.id`, no `pool_id` / `pool_name`.
- Only `xcp_*` series: no `xo_*`, no `up` / `scrape_*`, and no
  `xcp_host_power_consumption_watts` (the plugin labels the IPMI host power
  without `pool_id`, so it belongs to no pool).
- Names exactly as Xen Orchestra writes them: the eight series it types
  `counter` keep their `_total` (the collector reads
  `# TYPE xcp_host_network_receive_bytes_total counter` as a counter named
  `xcp_host_network_receive_bytes_total`). The agent turns those eight into
  gauges, with the values served - also where scrape 2's is lower than scrape
  1's - and no start time; their `metadata` still says `prometheus.type: counter`.
  Every other series is a gauge as served.
- Times are the seconds Xen Orchestra served (OpenMetrics timestamps are in
  seconds): the RRD series at Xen Orchestra's last full minute minus one
  (1794999900 in scrape 1), the storage, virtual disk, status and uptime series
  at the scrape's own second.
- No staleness markers. Prometheus marks a vanished series stale only when it was
  served without a timestamp, which for Xen Orchestra is `xcp_pool_connected`
  alone: a VM that stopped, or a virtual disk that was deleted, in scrape 2 simply
  has no series there. The behaviour test's third scrape, in which Xen Orchestra
  loses the unnamed pool, shows the one marker the agent sends: that pool's
  resource once more, holding a single `xcp_pool_connected` datapoint with
  `flags: 1` and no value.

## The REST API's lab

`XenOrchestraRest/` holds what Xen Orchestra's REST API answers for the lab
above - the same two pools, hosts, VMs and storage repositories, by the same
UUIDs and names - with what #10997 reads beyond the metrics:

| File | What it is |
| --- | --- |
| `pools.json`, `hosts.json`, `objects.json` | `/rest/v0/pools`, `/hosts` and the VMs and storage repositories, with every field the probe asks for (HA, the master, power states). |
| `messages.json` | XAPI's messages on the lab's objects, as `/rest/v0/messages` keeps them; the stand-in serves the alarms among them (`ALARM`, `BOND_STATUS_CHANGED`, `MULTIPATH_PERIODIC_ALERT`) from `/rest/v0/alarms`, parsed as Xen Orchestra parses them. |
| `backup-jobs.json`, `schedules.json` | `/rest/v0/backup-jobs` and `/rest/v0/schedules`: a nightly delta and a weekly full VM backup, a pool metadata backup, and a monthly job whose only schedule is disabled, each schedule with its cron and time zone. |
| `backup-logs.json` | `/rest/v0/backup-logs`: runs with each VM's task tree as Xen Orchestra's backup log keeps it - successes, a run in which VMs failed with their errors and one was skipped (`unhealthy VDI chain`), an interrupted run, and a metadata backup whose remote refused it. |
| `missing-patches.json` | `/rest/v0/hosts/<id>/missing_patches` for three of the lab's hosts, by host UUID. |

No Xen Orchestra was at hand to record these from. They are written to the
shapes Xen Orchestra's own source serves (`@xen-orchestra/rest-api` and
`xo-server`, master on 26 November 2026), and
`Probe/Tests/Utils/XcpNg/FakeXenOrchestraRest.ts` serves them as that
source does: `fields=` picks keys, `filter=` is complex-matcher, the token is
the `authenticationToken` cookie, a list the token may not read is answered
empty, and missing patches answer 403 where the licence does not cover them.
`XenOrchestraEventsReader.test.ts` reads the lab through the probe's own
reader, end to end into the server's processing. When a real Xen
Orchestra is at hand, record its answers over these files and run the
suites again.
