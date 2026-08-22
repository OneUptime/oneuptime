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

- opens a OneUptime **alert** (deduplicated per rule and group value, routed through alert severities and on-call),
- optionally opens an **incident** — off by default, since incidents drive on-call escalation, SLAs and status pages; severity follows the same precedence as alerts (explicit per-rule severity, else the Sigma level mapped onto your incident severities), and
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

The **Security Events** monitor type counts matching events (by severity, class, message, attributes, source service) over a sliding window and drives the standard criteria machinery — change monitor status, open alerts or incidents, route to on-call. **Security Events → Monitors** lists every monitor of this type.

Detection rules and monitors are complementary, not two flavors of one feature. A rule reads each event once and asks *"did this pattern appear?"* — one occurrence matters, and there is no "unmatch". A monitor re-reads a rolling window and asks *"how many, right now?"* — no single event is interesting, the rate is, and the count falling back under the threshold is what lets it say the coast is clear again.

## Watching your detections

Every rule match is also written back into the events table as a **Detection Finding** event (OCSF class 2004), attributed to a telemetry service named `OneUptime Detections`. A finding carries the rule's name and id, its MITRE ATT&CK tags, the matched group value in `observables`, and these attributes:

| Attribute | Value |
|---|---|
| `oneuptime.detection.rule_id` | id of the rule that fired |
| `oneuptime.detection.rule_name` | its name |
| `oneuptime.detection.match_count` | how many events are behind this finding |
| `oneuptime.detection.group_value` | the Group By value, when the rule sets one |
| `oneuptime.detection.sigma_id` | the Sigma rule's own `id:` field |

Because findings are ordinary security events, a **Security Events monitor** can watch them — and that composes the two features into a second tier of detection:

- **Detection storms.** A monitor over event class `Detection Finding`, counting all findings. Twenty different rules firing in an hour is a signal no individual rule can see — each only knows its own matches. The monitor sees the aggregate, changes status, and can open an incident.
- **Per-rule rate changes.** Filter on the `oneuptime.detection.rule_id` attribute (immutable — a filter on `rule_name` silently stops matching if the rule is ever renamed). A rule that fires weekly firing fifty times an hour is a different event with a different response.
- **Detection pipeline silence.** Findings dropping to zero when you normally see a handful usually means a broken forwarder, not a peaceful network. Express it as a count-below-threshold criteria.

The quickest path is the **Create Monitor** row action on **Security Events → Detection Rules**: it opens monitor creation pre-filled with the `Detection Finding` class and that rule's name filter.

## Retention and billing

Security events are metered per GB ingested, like other telemetry, and honor the same retention configuration (project default, per-service override, and a dedicated `securityEvents` retention pillar). Rows are TTL-deleted by ClickHouse when their retention date passes.

## Google SecOps

See the [Google SecOps integration guide](/docs/integrations/google-secops) for connecting Chronicle: SOAR playbook webhooks, the managed detections connector, and UDM forwarding.
