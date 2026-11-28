# What Dell's powerstore-metrics-exporter v1.0.3 answers

Recorded on 26 November 2026 with `bash Tests/Ops/storage-array-agent-powerstore-behaviour.sh --record <this folder>`. The run used the Storage Array Agent's files as they ship, unmodified: `agents/StorageArrayAgent/docker-compose.yml` under the `powerstore` profile, `powerstore-exporter.Dockerfile`, `otel-collector-config.powerstore.yaml` and `powerstore-syslog.yaml`.

## What ran

- **Dell's exporter**: [dell/powerstore-metrics-exporter](https://github.com/dell/powerstore-metrics-exporter), release `powerstore-metrics-exporter_v1.0.3` (commit `564df4d`, 5 February 2026, Apache-2.0). It is Dell's own release binary, checked against its SHA-256 (`1b7996e1…`; Dell publishes the SHA-1 `c2524cc7…`), in the image the Dockerfile builds. It ran with the config the compose service writes: bulk metrics on, API v3, 16 requests at a time.
- **The collector**: `otel/opentelemetry-collector-contrib:0.165.0`, the image the compose file pins.
- **The agent's version**: the files stamped `oneuptime.agent.version` `0.165.0` when they were recorded. They stamp `0.165.1` since NetApp ONTAP, Dell PowerStore and Dell PowerScale changed the agent's files on that collector, and that one value was changed in `collector/metrics.jsonl` and `collector/syslog.jsonl` to match. Nothing else the files send changed.

## What it was run against

`Tests/Ops/Fixtures/DellPowerStore/fake-powerstore.js` is a stand-in for a PowerStore cluster's REST API. It describes a two-appliance PowerStore 3200T cluster, `ps-prod-01`. The fake answers every resource and query the exporter's v1.0.3 source sends. Its field names, enums and value shapes come from Dell's PowerStore REST API reference and from the recorded responses in Dell's gopowerstore and SODA Foundation's delfin test fixtures. Its header lists them.

The cluster has these faults:

- appliance A1's drive `Drive_0_0_7` has failed;
- A1's node B power supply is disconnected;
- A2's node B fan 1 has failed;
- A2's Fibre Channel port `BaseEnclosure-NodeB-IoModule0-FEPort1` has lost its link;
- volume `archive-legacy` is offline;
- NAS server `nas-files-02` is degraded;
- the Metro witness reaches three of the four nodes;
- A2 is 92% full and reads at 6.2 ms;
- file system `fs-home` is 94.5% full;
- A1's drive `Drive_0_0_3` has 8% of its endurance left.

## The files

- `bulk/<path>.prom`: what the exporter answers at `/metrics/fake-powerstore/<path>`, fetched from inside its container, with the bulk archive on (the agent's default). This is Prometheus text, as the exporter wrote it.
- `per-object/<path>.prom`: the same answers with `POWERSTORE_BULK_METRICS=false`. They differ from the bulk ones in one family only. Per object, the exporter's NAS server loop reads the volume group's field list, so `powerstore_metricNas_avg_size` is missing. That quirk is Dell's.
- `collector/metrics.jsonl`: what the collector sent OneUptime over several scrapes, as the OTLP/JSON a file exporter wrote. It holds every series above, plus what the agent works out itself:
  - a Healthy node's `powerstore_hardware_node_state` set to 1;
  - `powerstore_cap_physical_used_percent` for each appliance;
  - `powerstore_filesystem_logical_used_percent` for each file system.
- `collector/syslog.jsonl`: what the syslog collector sent OneUptime for `Tests/Ops/Fixtures/DellPowerStore/syslog-samples.txt` and one line sent over UDP.

## Not run against a real PowerStore

- **Every value and name of the cluster** is made up. No real PowerStore was reachable.
- **Real arrays' REST answers** may hold fields the fake leaves out. The exporter reads only the fields it names, so the extra fields would not reach these recordings.
- **Names nobody showed.** No source shows the names PowerStore gives fans, power supplies and batteries, so `BaseEnclosure-NodeA-Fan0`, `-PowerSupply` and `-Battery` are guesses after the pattern of the node and port names the fixtures show.
- **The bulk archive's layout** (one gzipped tar with one CSV per entity, one row per object) is the simplest the exporter reads. Dell documents no sample.
- **Real PowerStoreOS releases.** The exporter's behaviour on 4.1 and later is Dell's README's account: bulk metrics needed, and the Storage Operator role for them. It was not checked here.
- **The syslog lines.** The three PowerStore lines from Splunk's SC4S test suite are real. The Active alerts beside them are written in the same form, with event codes and severities from Dell's Events and Alerts Reference Guide. The syslog priority a real PowerStore puts on an Active alert is not known. The agent takes the severity from the event code for that reason.
