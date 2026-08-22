# Security Events (SIEM)

OneUptime stores SIEM signals as a first-class telemetry type: security events live in the same ClickHouse data lake as your logs, traces, and metrics, normalized to [OCSF](https://schema.ocsf.io/) (Open Cybersecurity Schema Framework) whatever dialect they arrived in.

## Ingesting security events

Send JSON over HTTPS with your project's telemetry ingestion key:

```bash
curl -X POST "https://oneuptime.com/security-events/v1/ingest" \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: <your telemetry ingestion key>" \
  -d '{ "events": [ { "class_uid": 3002, "severity_id": 4, "time": 1755770400000, "message": "Failed logon for alice", "actor": { "user": { "name": "alice" } } } ] }'
```

Accepted dialects:

| `format` | Dialect |
|---|---|
| `ocsf` | Native OCSF event JSON (`class_uid`, `severity_id`, ...) |
| `udm` | Google SecOps / Chronicle UDM (`metadata.event_type`, ...) |
| `google-secops-alert` | SecOps detection/alert payloads (SOAR webhooks, detections stream) |
| `generic` | Anything else — common field names are mapped best-effort |

Omit `format` and the dialect is detected per event, so one webhook can mix detection alerts with raw events. The body accepts a single object, a bare array, or `{ "events": [...] }`.

## What a security event looks like

Every event is normalized onto typed columns plus a flattened attributes map:

- **Classification**: OCSF `categoryName` / `className` / `activityName` (e.g. `Identity & Access Management` / `Authentication` / `Logon`) with their numeric uids.
- **Severity**: OCSF severity (`Unknown`, `Informational`, `Low`, `Medium`, `High`, `Critical`, `Fatal`).
- **Actors and targets**: `principalUser`, `principalHost`, `principalIp`, `principalProcess`, `targetUser`, `targetHost`, `targetIp`, `targetPort`, `targetResource`.
- **Observables**: every extracted entity value (users, hosts, IPs, domains) in one indexed array — "all events mentioning X" is a single cheap query.
- **Detection provenance**: `ruleId` / `ruleName`, MITRE ATT&CK `mitreTactics` / `mitreTechniques`.
- **Attributes**: the full source payload, flattened to dot-notation keys — nothing is dropped just because it did not map.

## Detection rules (Sigma)

**Security Events → Detection Rules** evaluates [Sigma](https://sigmahq.io/) rules against your events every minute (per-rule interval configurable). A rule that matches:

- opens a OneUptime **alert** (deduplicated per rule and group value, routed through alert severities and on-call), and
- writes a **Detection Finding** event back into the events table, so detections are themselves searchable signals.

The supported Sigma subset is the boolean core: named selections (field maps with `contains` / `startswith` / `endswith` / `re` / `cidr` / `gt` / `lt` / `all` / `cased` / `windash` / `exists` modifiers, keyword lists) and the full condition grammar (`and` / `or` / `not`, parentheses, `1 of x*`, `all of them`). Aggregation conditions (`| count() ...`) are rejected at save time rather than silently ignored. Field names can be OneUptime columns (`principalUser`), common aliases (`CommandLine`, `src_ip`), or any flattened source key (`principal.hostname`).

Example:

```yaml
title: Possible Brute Force
level: high
tags:
  - attack.credential_access
  - attack.t1110
detection:
  selection:
    className: Authentication
    statusName: Failure
  filter_internal:
    principalIp|startswith: '10.'
  condition: selection and not filter_internal
```

Set a **Group By Field** (for example `principalHost`) to open one alert per distinct value instead of one for the whole match set.

## Monitors

The **Security Events** monitor type counts matching events (by severity, class, message, attributes, source service) over a sliding window and drives the standard criteria machinery — change monitor status, open alerts or incidents, route to on-call.

## Retention and billing

Security events are metered per GB ingested, like other telemetry, and honor the same retention configuration (project default, per-service override, and a dedicated `securityEvents` retention pillar). Rows are TTL-deleted by ClickHouse when their retention date passes.

## Google SecOps

See the [Google SecOps integration guide](/docs/integrations/google-secops) for connecting Chronicle: SOAR playbook webhooks, the managed detections connector, and UDM forwarding.
