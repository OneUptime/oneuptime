# Alert Deduplication Implementation Plan

## Overview

This sub-plan details the implementation of Alert Deduplication and Fingerprinting functionality for OneUptime. This feature prevents duplicate alerts from being created and tracks duplicate occurrences.

## Documents

| Document | Description |
|----------|-------------|
| [1-DataModels.md](./1-DataModels.md) | Database models and schema definitions |
| [2-Backend.md](./2-Backend.md) | Backend services and deduplication engine |
| [3-API.md](./3-API.md) | REST API endpoints |
| [4-UI.md](./4-UI.md) | Frontend components and pages |

## Feature Summary

### What is Alert Deduplication?

Alert Deduplication prevents the same alert from being created multiple times within a configurable time window. Instead of creating duplicate alerts, the system increments a counter on the original alert.

### How Fingerprinting Works

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Alert Fingerprint Generation                           │
└─────────────────────────────────────────────────────────────────────────────────┘

   Alert Data                    Fingerprint Fields               Hash
┌─────────────────┐           ┌───────────────────┐         ┌────────────┐
│ monitorId: abc  │           │ monitorId: abc    │         │            │
│ criteriaId: xyz │    ──►    │ criteriaId: xyz   │   ──►   │ SHA-256    │
│ severity: high  │           │ severity: high    │         │ = a1b2c3.. │
│ title: "Error"  │           │ title: "Error"    │         │            │
│ time: 10:00 AM  │           │ (time excluded)   │         │            │
└─────────────────┘           └───────────────────┘         └────────────┘
```

### Key Capabilities

1. **Fingerprint Generation** - Compute unique hash from alert fields
2. **Time-Window Deduplication** - Deduplicate within configurable window
3. **Duplicate Counting** - Track how many duplicates were suppressed
4. **Configurable Fields** - Choose which fields to include in fingerprint
5. **Per-Project Settings** - Customize deduplication per project

### Benefits

| Without Deduplication | With Deduplication |
|-----------------------|-------------------|
| 100 identical alerts created | 1 alert with count: 100 |
| 100 notifications sent | 1 notification sent |
| Alert fatigue | Reduced noise |
| Storage waste | Efficient storage |

### User Stories

```
As an operator, I want duplicate alerts to be automatically merged
so that I don't see the same alert repeated 50 times.

As a team lead, I want to know how many times an alert occurred
so that I can understand the severity of the issue.

As an SRE, I want to configure the deduplication window
so that I can tune it for my team's workflow.
```

## Implementation Phases

### Phase 1: Core Fingerprinting (Week 1)

- [ ] Create FingerprintGenerator utility
- [ ] Add fingerprint field to Alert model
- [ ] Implement basic SHA-256 fingerprinting
- [ ] Add duplicate count field to Alert

### Phase 2: Deduplication Engine (Week 2)

- [ ] Create AlertFingerprint cache model
- [ ] Implement DeduplicationEngine
- [ ] Integrate with AlertService
- [ ] Add time-window support

### Phase 3: Configuration & UI (Week 3)

- [ ] Add project-level deduplication settings
- [ ] Create deduplication configuration UI
- [ ] Add duplicate count to Alert detail view
- [ ] Add deduplication metrics

### Phase 4: Advanced Features (Week 4)

- [ ] Configurable fingerprint fields
- [ ] Redis caching for fingerprints
- [ ] Deduplication analytics dashboard

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Deduplication Flow                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │   Alert Trigger      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ FingerprintGenerator │
                    │    .generate()       │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ DeduplicationEngine  │
                    │   .checkDuplicate()  │
                    └──────────┬───────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
    ┌─────────────────┐              ┌─────────────────┐
    │ DUPLICATE       │              │ NEW             │
    │                 │              │                 │
    │ - Increment     │              │ - Create alert  │
    │   count on      │              │ - Register      │
    │   original      │              │   fingerprint   │
    │ - Skip creation │              │ - Send notifs   │
    └─────────────────┘              └─────────────────┘
```

## Configuration Options

```typescript
interface DeduplicationConfig {
    // Enable/disable deduplication
    enabled: boolean;

    // Time window for deduplication (minutes)
    windowMinutes: number;  // Default: 60

    // Fields to include in fingerprint
    fingerprintFields: Array<string>;  // Default: ['monitorId', 'criteriaId', 'severity', 'title']

    // Whether to normalize strings (lowercase, trim)
    normalizeStrings: boolean;  // Default: true
}
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Duplicate detection accuracy | > 99% |
| Fingerprint generation time | < 5ms |
| Storage reduction | 30-50% |
| Notification reduction | 40-60% |

## References

- [Parent Plan: AlertEngine.md](../AlertEngine.md)
- [Alert Grouping Plan](../AlertGrouping/README.md)
- [Alert Suppression Plan](../AlertSuppression/README.md)
