# IoT Device Monitor

The IoT Device monitor watches an entire fleet of IoT devices with a single monitor. It evaluates the `iot_*` metrics your devices push (see the [IoT Devices ingestion guide](/docs/telemetry/iot-devices)) against your criteria once per minute, server-side — there is no probe or agent involved in evaluation — and fans out **one incident or alert per affected device**, grouped by `device.id`.

## Overview

IoT Device monitors evaluate fleet-scoped metric criteria to give you per-device alerting without creating one monitor per device. This enables you to:

- Detect devices that go offline (`iot_device_up` drops to 0)
- Catch low batteries before a device dies (`iot_battery_percent`)
- Watch wireless signal strength degrade (`iot_signal_strength_dbm`)
- Alert on overheating hardware (`iot_temperature_celsius`)
- Track CPU, memory, and uptime across the fleet (`iot_cpu_usage_ratio`, `iot_memory_usage_bytes` / `iot_memory_size_bytes`, `iot_uptime_seconds`)
- Alert on fleet-wide health using server-computed rollups (`iot_fleet_online_ratio`, `iot_fleet_battery_percent_p10`, and friends — see [Fleet Health Rollup Metrics](#fleet-health-rollup-metrics))

## Prerequisites

Your devices (or a gateway on their behalf) must already be pushing `iot_*` metrics over OTLP with the `iot.fleet.name` resource attribute and a `device.id` label on each datapoint. Follow the [IoT Devices ingestion guide](/docs/telemetry/iot-devices) first — once the first metrics arrive, the fleet is auto-registered (keyed by `iot.fleet.name`, shown as the telemetry service `iot/<fleet>`) and becomes selectable in the monitor form. You do not create fleets manually.

## Creating an IoT Device Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **IoT Device** as the monitor type (under the Infrastructure category)
4. In the monitor step, select the **IoT Fleet** to monitor
5. Configure the metric query using one of the three tabs: **Quick Setup**, **Custom Metric**, or **Advanced**
6. Configure monitoring criteria (Quick Setup templates pre-fill these for you)

### Selecting the Fleet

The **IoT Fleet** dropdown lists every fleet that has shipped telemetry to your project. Every metric query in the monitor is automatically scoped to the selected fleet via the `resource.iot.fleet.name` attribute — you never configure the fleet filter manually, and metrics from other fleets are never evaluated.

### Quick Setup (Alert Templates)

The **Quick Setup** tab shows pre-built alert templates grouped by category — Availability, Power, Connectivity, Environment, System, and Fleet Health — each with a severity badge. Selecting a template auto-configures everything: the metric query, the aggregation, grouping (per-device templates group by `device.id`), the time range, both criteria (an unhealthy criteria that creates an incident and an alert, and a healthy criteria that flips the monitor back), and the incident/alert titles and descriptions. After selecting a template you can adjust the **Time Range**; everything else remains editable later in the criteria section.

The per-device templates:

| Template                 | Category     | Severity | Metric                                              | Aggregation (per device) | Fires when      | Recovers when |
| ------------------------ | ------------ | -------- | --------------------------------------------------- | ------------------------ | --------------- | ------------- |
| **Device Offline**       | Availability | Critical | `iot_device_up`                                     | Min                      | value < 1       | value >= 1    |
| **Low Battery**          | Power        | Warning  | `iot_battery_percent`                               | Avg                      | value < 20 (%)  | value >= 20   |
| **Weak Signal**          | Connectivity | Warning  | `iot_signal_strength_dbm`                           | Avg                      | value < -100 dBm | value >= -100 |
| **High Temperature**     | Environment  | Critical | `iot_temperature_celsius`                           | Max                      | value > 70 (°C) | value <= 70   |
| **High CPU Usage**       | System       | Warning  | `iot_cpu_usage_ratio`                               | Avg                      | value > 0.9     | value <= 0.9  |
| **High Memory Pressure** | System       | Warning  | `(iot_memory_usage_bytes / iot_memory_size_bytes) * 100` | Avg                 | value > 90 (%)  | value <= 90   |

Every per-device template uses a **Past 5 Minutes** rolling window, groups by `device.id` so one incident fires per affected device, creates both an incident and an alert with auto-resolve enabled, and changes the monitor status while any device is breaching. High Memory Pressure is a two-query **formula** template: it divides `iot_memory_usage_bytes` by `iot_memory_size_bytes` per device, so it only evaluates devices that report both metrics.

The aggregation is chosen per template on purpose: `Min` for Device Offline and `Max` for High Temperature so a single bad reading trips the threshold instead of being averaged away, and `Avg` for the slow-moving level readings (battery, signal, CPU, memory).

The **Fleet Health** templates alert on the whole fleet instead of individual devices. They evaluate the server-computed [fleet rollup series](#fleet-health-rollup-metrics) — one datapoint per fleet per minute — so there is **no `device.id` grouping and no per-device fan-out**: at most one incident fires per fleet, and titles reference the monitor/fleet name rather than a device.

| Template                    | Category     | Severity | Metric                          | Aggregation | Window          | Fires when  | Recovers when |
| --------------------------- | ------------ | -------- | ------------------------------- | ----------- | --------------- | ----------- | ------------- |
| **Fleet Offline Ratio High** | Fleet Health | Critical | `iot_fleet_online_ratio`        | Avg         | Past 5 Minutes  | value < 0.9 (more than 10% of the fleet offline) | value >= 0.9 |
| **Fleet Battery Low**       | Fleet Health | Warning  | `iot_fleet_battery_percent_p10` | Avg         | Past 15 Minutes | value < 20 (bottom-decile battery under 20%)     | value >= 20  |

Fleet Battery Low uses a wider **Past 15 Minutes** window because the p10 series is only emitted while fresh battery readings exist — the longer window rides out emission gaps. During any rollup emission gap (for example an empty fleet), the monitor holds its current state rather than resolving.

### Custom Metric

The **Custom Metric** tab lets you build a single-metric monitor from the IoT metric catalog. Pick a metric from the dropdown (organized by the same six categories); the form pre-fills the recommended aggregation and — for device-scope metrics — a device-scope filter, and shows the metric's description and underlying metric name. You can then adjust:

- **Resource filters** — see [Resource Filters](#resource-filters) below
- **Aggregation** — Average, Maximum, Minimum, Sum, or Count
- **Time Range** — the rolling evaluation window

The catalog contains the device-scope metrics:

| Metric               | Underlying metric name    | Unit  | Default aggregation |
| -------------------- | ------------------------- | ----- | ------------------- |
| **Device Up**        | `iot_device_up`           | —     | Min                 |
| **Battery Level**    | `iot_battery_percent`     | %     | Avg                 |
| **Signal Strength**  | `iot_signal_strength_dbm` | dBm   | Avg                 |
| **Temperature**      | `iot_temperature_celsius` | °C    | Avg                 |
| **CPU Usage Ratio**  | `iot_cpu_usage_ratio`     | ratio | Avg                 |
| **Memory Usage**     | `iot_memory_usage_bytes`  | bytes | Avg                 |
| **Memory Size**      | `iot_memory_size_bytes`   | bytes | Max                 |
| **Uptime**           | `iot_uptime_seconds`      | s     | Max                 |

…and, under **Fleet Health**, the server-computed rollup series (see [Fleet Health Rollup Metrics](#fleet-health-rollup-metrics)):

| Metric                                | Underlying metric name          | Unit    | Default aggregation |
| ------------------------------------- | ------------------------------- | ------- | ------------------- |
| **Fleet Device Count**                | `iot_fleet_device_count`        | devices | Avg                 |
| **Fleet Online Count**                | `iot_fleet_online_count`        | devices | Avg                 |
| **Fleet Offline Count**               | `iot_fleet_offline_count`       | devices | Max                 |
| **Fleet Stale Count**                 | `iot_fleet_stale_count`         | devices | Max                 |
| **Fleet Online Ratio**                | `iot_fleet_online_ratio`        | ratio   | Avg                 |
| **Fleet Battery Median (p50)**        | `iot_fleet_battery_percent_p50` | %       | Avg                 |
| **Fleet Battery Bottom Decile (p10)** | `iot_fleet_battery_percent_p10` | %       | Avg                 |
| **Fleet Weak Signal Count**           | `iot_fleet_weak_signal_count`   | devices | Max                 |

Unlike Quick Setup, the Custom Metric tab configures only the metric query — you define the alerting thresholds yourself in the monitor's **Criteria** section (threshold, which monitor status to set, and whether to create incidents or alerts).

### Advanced

The **Advanced** tab exposes the full metric query builder — the same one used by the [Metrics Monitor](/docs/monitor/metrics-monitor). Use it to:

- Query any metric your fleet reports (including ones outside the catalog, such as `iot_device_info`)
- Add multiple queries with attribute filters and group-by keys
- Combine queries with **formulas** — for example memory pressure as a percentage: `(iot_memory_usage_bytes / iot_memory_size_bytes) * 100`, grouped by `device.id` (this is exactly what the High Memory Pressure template builds for you)

The fleet scope still applies automatically on top of whatever you build here.

### Resource Filters

The Custom Metric and Advanced tabs offer three optional filters on top of the automatic fleet scope:

| Filter             | Maps to                                       | Notes                                                             |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------- |
| **Resource Scope** | `iot.scope` datapoint attribute               | `device` or `fleet` — the scope stamped by the agent/gateway      |
| **Device ID**      | `device.id` datapoint label                   | Scope the monitor to a single device. Wins over the other filters |
| **Device Type**    | `iot.device.type` datapoint attribute         | For example `sensor`, `gateway`, `camera`                          |

### Rolling Time Window

Select the time window for metric evaluation: Past 1 Minute (the default), Past 5 Minutes (used by all templates), Past 10 Minutes, and longer windows. Choose a window at least as long as your devices' push interval — otherwise most evaluations will find no datapoints.

## How Per-Device Fan-Out Works

An IoT Device monitor is evaluated **once per minute** by OneUptime's telemetry workers:

1. Every metric query is scoped to the selected fleet via the `resource.iot.fleet.name` attribute.
2. When a query groups by `device.id` (all per-device templates do), the worker aggregates the raw datapoints per device and produces a per-device series breakdown. Queries without a group-by (the Fleet Health templates) evaluate a single aggregate series instead.
3. Each criteria is then evaluated **once per device series**. Every device whose values breach the criteria produces its own incident and/or alert — one monitor, many devices, one incident per breaching device.
4. Each incident's root cause states exactly which filter breached for that specific device, including the `device.id` and the offending value. While a device keeps breaching, its incident stays open rather than duplicating on every evaluation.
5. With templates, recovery is automatic: when the device's readings move back to the healthy side of the threshold, the healthy criteria matches and the incident auto-resolves.

One safeguard applies when the **entire fleet** goes silent: an evaluation that finds no data at all is ambiguous (a quiet fleet looks identical to a dead gateway), so OneUptime checks whether the fleet's telemetry source is reporting at all. During a collection blackout the monitor **holds its current state** instead of flipping back to the default status — a crashed gateway will not masquerade as a recovery.

Note the flip side of this design: templates evaluate values that are **reported**. "Device Offline" fires when something pushes `iot_device_up = 0` for the device — typically a gateway reporting on the device's behalf. A device that simply vanishes stops producing series entirely and cannot trip a value threshold on its own, so have your gateway publish `iot_device_up = 0` when a device misses its heartbeats. The Fleet Health templates close this gap at the fleet level: the rollup worker tracks each device's liveness server-side and counts a device that stopped reporting as stale or offline, so `iot_fleet_online_ratio` still drops even when the device itself pushes nothing.

## Fleet Health Rollup Metrics

Alongside the metrics your devices push, OneUptime **computes** a set of fleet-level rollup series once per minute per fleet and writes them to the same metric store. They are synthetic — your devices never send them — and are stamped with the attributes `resource.iot.fleet.name` (the fleet name), `iot.scope = fleet`, and `oneuptime.synthetic = fleet-rollup`. Each series has exactly **one datapoint per fleet per minute** and carries **no `device.id` label**, so never group them by device.

| Metric name                     | Meaning                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `iot_fleet_device_count`        | Active devices in the fleet (non-Retired, non-archived)                                          |
| `iot_fleet_online_count`        | Active devices currently online                                                                   |
| `iot_fleet_offline_count`       | Active devices currently offline                                                                  |
| `iot_fleet_stale_count`         | Active devices whose readings have gone stale                                                     |
| `iot_fleet_online_ratio`        | Online share of active devices, `0`–`1`. Only emitted while `device_count > 0`                    |
| `iot_fleet_battery_percent_p50` | Median battery (%) across devices with fresh battery readings. Only emitted while such readings exist |
| `iot_fleet_battery_percent_p10` | 10th-percentile battery (%) — the fleet's weakest batteries. Only emitted while fresh battery readings exist |
| `iot_fleet_weak_signal_count`   | Devices whose fresh signal readings are below -100 dBm                                            |

The Fleet Health templates (Fleet Offline Ratio High, Fleet Battery Low) are built on these series, and all of them are available from the **Custom Metric** tab under the Fleet Health category and from the **Advanced** query builder. Because `iot_fleet_online_ratio` and the battery percentiles are only emitted when their inputs exist, monitors on them keep the default no-data behavior: an emission gap matches no criteria and the monitor holds its current state.

## Custom Criteria

Templates are just pre-filled criteria — you can edit them or build your own in the monitor's **Criteria** section. Each criteria contains one or more filters on **Metric Value** (referencing a query by its alias), a threshold, the monitor status to set, and optional incident/alert definitions. Typical customizations:

- Change a threshold (for example battery below 30% instead of 20%)
- Route to different [incident severities or on-call policies](/docs/monitor/incident-alert-templating)
- Create alerts only (no incidents), or vice versa
- Add multiple criteria levels — for example Warning below 30% battery, Critical below 10%

If you build criteria from scratch, remember to also add a **healthy** criteria (one that matches when values are back to normal and sets the operational status) — without it, the monitor status will not flip back and auto-resolve will never trigger.

## Troubleshooting

### The fleet dropdown is empty / the monitor reports no data

1. The fleet is only registered after the first metrics arrive. Verify ingestion end-to-end using the [IoT Devices guide](/docs/telemetry/iot-devices) — `iot.fleet.name` must be a **resource** attribute and the token must be valid.
2. Check the metric names — only the exact `iot_*` names are in the catalog; typos land as generic metrics (still queryable from the Advanced tab, but not what templates evaluate).
3. Compare the rolling window with your devices' push interval. Devices that push every 10 minutes evaluated over a Past 1 Minute window will find no datapoints most of the time — widen the window.

### A device never appears / never fires an incident

1. Every datapoint must carry the `device.id` label — the fan-out groups on it, so points without it cannot be attributed to a device.
2. Check the resource filters on the monitor step: a **Device ID** filter wins over everything else, and a **Device Type** filter silently excludes devices whose `iot.device.type` does not match.
3. A device that only sends `iot_device_info` shows up in the fleet inventory but reports no data metrics — the Device Offline template needs an actual `iot_device_up = 0` datapoint (usually pushed by the gateway) to fire.

### Alerts are not resolving

1. Auto-resolve requires the healthy criteria to **match**, which requires data: the device must report values on the healthy side of the threshold. A device that went completely silent produces no series, and the blackout safeguard holds the monitor state instead of resolving it.
2. If you replaced the template criteria with custom ones, confirm a recovery criteria exists and sets the operational monitor status.
3. Keep `device.id` stable. If a device's id changes (for example it is regenerated on reboot), the old id's incident never sees a recovery reading and stays open, while the new id shows up as a brand-new device.

## Related

- [IoT Devices — ingestion guide](/docs/telemetry/iot-devices)
- [Metrics Monitor](/docs/monitor/metrics-monitor)
- [Incident & Alert Templating](/docs/monitor/incident-alert-templating)
- [Integrate OpenTelemetry with OneUptime](/docs/telemetry/open-telemetry)
