# Threat Intelligence (STIX/TAXII)

OneUptime enriches your [security events](/docs/telemetry/security-events) against threat-intelligence feeds you subscribe to. Feeds speak the open standards — **TAXII 2.1** for transport, **STIX 2.1** for the indicator objects — so anything that publishes STIX `indicator` objects over TAXII 2.1 works: your own MISP, OpenCTI, or OpenTAXII instance, or a commercial provider's TAXII collection. Supported authentication is anonymous, bearer-token, or HTTP basic; feeds that require TLS client-certificate (mutual TLS) authentication, such as CISA AIS, are not supported. (Note also that MITRE's public ATT&CK TAXII server carries the ATT&CK knowledge base — attack-patterns and groups, not indicators — so subscribing it yields an empty feed.) There is no bundled feed content: you bring the collections, the same way you bring the Sigma rules.

## Subscribing a feed

**Security Events → Threat Intel → Create** takes:

| Field | What it is |
|---|---|
| **TAXII API Root URL** | The TAXII 2.1 API root, e.g. `https://taxii.example.com/api1/`. Collections are addressed beneath it. |
| **Collection ID** | The collection to poll for indicator objects. |
| **API Token** / **Basic Auth** | Optional. Bearer-token or basic-auth credentials for authenticated collections; leave both empty for anonymous ones. Secrets are encrypted at rest and never returned by the API — rotate them through the row's **Update Credentials** action. |
| **Poll Interval (Minutes)** | How often new objects are fetched. Whole minutes, `1`–`1440`; default `60`. |
| **Minimum Confidence** | Skip indicators whose STIX `confidence` is below this (0–100). `0` ingests everything. Indicators that carry no confidence always pass, so an unscored feed does not go silently empty when you set a minimum. |

The poller tracks each feed with an `added_after` cursor (the server's `X-TAXII-Date-Added-Last` header), fetching up to ten pages per poll — a large initial sync progresses across successive polls, one poll interval apart, and **Last Poll Summary** on the feed row says how far it got. To drain a big collection quickly, set a short poll interval (down to 1 minute) until the sync catches up.

## What gets ingested

STIX `indicator` objects whose pattern is plain IOC equality:

```
[ipv4-addr:value = '198.51.100.7']
[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']
[file:hashes.'SHA-256' = 'aa...ff'] OR [url:value = 'http://evil.example/x']
```

Supported observable paths: `ipv4-addr:value`, `ipv6-addr:value`, `domain-name:value`, `url:value`, `email-addr:value`, and `file:hashes` (SHA-256, SHA-1, MD5) — singly or OR-combined, including across multiple `[...]` observation expressions.

Anything beyond that — `AND`, `FOLLOWEDBY`, temporal qualifiers, negation, `LIKE`/`MATCHES`, other object paths — is deliberately **skipped whole**, and counted in the feed's Last Poll Summary as an unsupported pattern. A half-translated `AND` pattern would match far *more* than its author intended, which for a detection feed is the dangerous direction.

Each supported pattern becomes one indicator row per IOC value, carrying the STIX id, confidence, labels, and validity window:

- **`valid_from` / `valid_until`** bound when the indicator matches. An indicator with no `valid_until` stays active for 365 days from `valid_from` — the window is anchored at `valid_from` and is not extended by re-polling; only a producer update that moves `valid_from` (or sets `valid_until`) changes the expiry. Expiry is enforced at query time on every match and lookup; storage cleanup follows separately via TTL.
- **Revocations** (`revoked: true`), **expired updates** (a `valid_until` moved into the past — the other standard STIX deactivation idiom), and **updated objects** all arrive as newer versions and supersede the older rows — re-polls are idempotent. A value that an update drops from the pattern (a corrected typo, say) is retracted with a tombstone version at the same time, so it stops matching immediately rather than lingering until its original `valid_until`.

Indicator values are matched **case-insensitively** against event observables, matching the case-insensitive semantics observables already have platform-wide.

## Enrichment at ingest

Every incoming security event — HTTP ingest and the Google SecOps connector alike — is checked against your active indicators *before* it is stored. When any of the event's observables (IPs, hosts, domains, hashes, users) matches, the event is stamped with flattened attributes:

| Attribute | Value |
|---|---|
| `threat.matched` | always `"true"` on a stamped event |
| `threat.indicator_id` | the STIX indicator id |
| `threat.indicator_type` | `ipv4-addr`, `domain-name`, `url`, `email-addr`, `file-hash-sha256`, ... |
| `threat.indicator_value` | the matched IOC value (canonical, lowercased) |
| `threat.feed` / `threat.feed_id` | which feed the indicator came from |
| `threat.confidence` | the indicator's STIX confidence |
| `threat.match_count` | how many of the event's observables matched indicators |

When several indicators match one event, the highest-confidence one wins the scalar stamps.

Because these are ordinary flattened attributes, they work everywhere attributes already work, with no new query language: a Sigma rule can say `threat.matched: "true"` or `threat.confidence|gte: 80`, a Security Events monitor can filter on them, and they appear in the explorer's attribute column picker.

Enrichment can only stamp indicators that are *already known* at ingest time; ClickHouse rows are immutable, so events are never retro-stamped. Intel that lands between an event's ingest and the close of its matcher window is still caught by the matcher below; intel arriving later than that only affects future events.

## Matching on a schedule

Every minute, each enabled feed's active indicators are joined against the security events whose **event time** falls in the window since the feed's last evaluation (capped at 24 hours). Each window is evaluated once, at close, against the indicators known at that moment: intel that arrived after the enricher saw an event but before the event's window closed is caught here (and after matcher downtime, the next evaluation catches up to 24 hours), but intel arriving later than that is not retroactively joined against already-evaluated events. One consequence worth knowing: the window keys on each event's own `time`, not its arrival — an event ingested late with an older source timestamp that predates the current window is not picked up by the matcher (it is still enriched at ingest against the indicators known at that moment).

A match behaves exactly like a Sigma rule match:

- a **Threat Intel finding** is written back into the events table — OCSF class 2004 (`Detection Finding`), product `OneUptime Threat Intel`, attributed to a telemetry service of the same name, one finding per matched indicator value per evaluation (capped at the 100 busiest indicator values per feed per evaluation, ordered by match count; values beyond the cap are picked up when they match again in a later window);
- a **deduplicated alert** opens per `(feed, indicator value)` — a still-matching indicator does not stack alerts, and a resolved alert can re-open as a fresh one;
- optionally an **incident** opens (off by default — incidents drive on-call, SLAs and status pages, so opt in per feed).

Alert severity follows the same precedence as detection rules: the feed's explicit severity if set, else the indicator's confidence mapped onto your project's severities (90+ Critical, 70+ High, 40+ Medium, below Low; unscored reads as Medium).

Findings carry the `oneuptime.threat.*` attribute block, the sibling of `oneuptime.detection.*`:

| Attribute | Value |
|---|---|
| `oneuptime.threat.feed_id` / `oneuptime.threat.feed_name` | the feed |
| `oneuptime.threat.indicator_id` | the STIX indicator id |
| `oneuptime.threat.indicator_type` / `oneuptime.threat.indicator_value` | what matched |
| `oneuptime.threat.confidence` | the indicator's confidence |
| `oneuptime.threat.match_count` | how many events are behind this finding |

Findings are excluded from matching input (their OCSF class is), so the write-back can never feed itself.

## Watching your matches

Because Threat Intel findings are ordinary security events, everything that composes with detection findings composes here too. The **Create Monitor** row action on a feed opens monitor creation pre-filled with the `Detection Finding` class and a filter on that feed's `oneuptime.threat.feed_id` (its id, never its name — findings carry the feed's *current* name, so a rename would silently orphan a name-filtered monitor). Use it for match storms, per-feed rate changes, or alerting when a normally-noisy feed goes quiet.

## Retention and billing

Indicators are configuration, not telemetry — they are not metered as ingest. Finding rows written on matches are ordinary security events and follow the `securityEvents` retention pillar like everything else in the events table. Indicator rows carry a ClickHouse TTL of one day past their `valid_until`, but expired rows are dropped a whole monthly partition at a time — a row can remain on disk (and visible in the Indicators table) for up to about a month after it expires. That is storage cleanup only: expiry and revocation are always enforced at query time, so a stale row is never matched.
