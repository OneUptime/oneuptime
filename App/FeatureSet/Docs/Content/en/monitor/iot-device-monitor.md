# IoT Device Monitor

IoT Device monitors alert on the telemetry your fleets push to OneUptime — device offline, low battery, weak signal, high temperature, high CPU, or any custom condition over the `iot_*` metrics. They evaluate the ingested data directly (no probe involved), so they work identically whether your devices report over OpenTelemetry or MQTT.

Before creating one, get your devices reporting — see [IoT Devices ingestion guide](/docs/telemetry/iot-devices).

## Overview

An IoT Device monitor targets one **fleet** and evaluates a metric query over a rolling window (the past 1 minute by default; the Quick Setup templates use 5 minutes) on your monitoring interval. Results are grouped **per device** (`device.id`), so a single monitor fans out into one incident or alert per breaching device — 30 offline sensors means 30 incidents with the device id stamped on each, not one vague fleet-level incident. When a device's series recovers (or disappears after recovery), its incident auto-resolves.

## Creating an IoT Device Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **IoT Device** as the monitor type
4. Pick the fleet, then configure via one of the three tabs below

### Quick Setup (templates)

Five one-click templates cover the common cases. Each pairs an alerting criteria with a recovery criteria and auto-resolve:

| Template            | Condition                                     | Severity |
| ------------------- | --------------------------------------------- | -------- |
| Device Offline      | `iot_device_up` minimum `< 1` over 5 minutes  | Critical |
| Low Battery         | `iot_battery_percent` average `< 20`          | Warning  |
| Weak Signal         | `iot_signal_strength_dbm` average `< -100`    | Warning  |
| High Temperature    | `iot_temperature_celsius` maximum `> 70`      | Critical |
| High CPU            | `iot_cpu_usage_ratio` average `> 0.9`         | Warning  |

Thresholds are editable after applying a template — open the monitor's criteria and adjust.

### Custom Metric

Pick any metric from the IoT catalog (device up, battery, signal, temperature, CPU, memory, uptime), choose the aggregation (Avg/Min/Max/Sum/Count/percentiles) and rolling window, and scope it with resource filters:

| Filter      | Effect                                                        |
| ----------- | ------------------------------------------------------------- |
| Scope       | Evaluate per **Device** or across the whole **Fleet**         |
| Device ID   | Restrict to one device                                        |
| Device Type | Restrict to devices reporting that `iot.device.type` value    |

### Advanced

A full metric query builder over anything the fleet reports — including your own custom metric names — with formulas across query aliases (for example memory used ÷ memory size as a percentage).

## Offline Detection

The Device Offline template fires when a device reports `iot_device_up = 0`. Two ways that value gets there:

- **Gateway-reported**: the gateway or collector publishes `iot_device_up = 0` for devices it can no longer reach.
- **MQTT Last Will**: devices connecting over OneUptime's MQTT endpoint can register a Last Will on their `status` topic. If the device dies, the broker publishes `iot_device_up = 0` on its behalf the moment the session drops — no polling, no missed-scrape delay. See [Sending Metrics via MQTT](/docs/telemetry/iot-devices).

A device that goes silent without either mechanism simply stops producing series data. In a per-device grouped monitor, the **no-data policy** set to **Trigger** cannot single out one silent device — it fires only when the whole query returns no data (for example, the entire fleet goes dark). To catch silent deaths per device, use MQTT Last Will or gateway-reported status; for an individual critical device, create a monitor scoped to just that device (Custom Metric tab → Device ID filter) with the no-data policy set to Trigger.

## No-Data Semantics

Every metric criteria supports a per-series no-data policy:

| Policy         | Behavior when a series returns no datapoints          |
| -------------- | ------------------------------------------------------ |
| Ignore (default) | The series is skipped this evaluation               |
| Treat as Zero  | The series evaluates as `0`                            |
| Trigger        | The criteria fires                                     |

## Notifications

IoT Device monitors plug into the standard incident/alert pipeline — on-call policies, escalation, Slack, Microsoft Teams, email, SMS, and webhooks all work the same as any other monitor type.

## Related

- [IoT Devices ingestion guide](/docs/telemetry/iot-devices) — get data flowing (OTLP and MQTT)
- [Metrics Monitor](/docs/monitor/metrics-monitor) — the generic metric monitor, if you need to alert on non-IoT telemetry
