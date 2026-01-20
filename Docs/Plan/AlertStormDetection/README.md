# Alert Storm Detection Implementation Plan

## Overview

This sub-plan details the implementation of Alert Storm Detection and Analytics functionality for OneUptime. This feature detects when alert volume spikes abnormally and provides noise reduction analytics.

## Documents

| Document | Description |
|----------|-------------|
| [1-DataModels.md](./1-DataModels.md) | Database models and schema definitions |
| [2-Backend.md](./2-Backend.md) | Backend services and storm detector |
| [3-API.md](./3-API.md) | REST API endpoints |
| [4-UI.md](./4-UI.md) | Frontend components and pages |

## Feature Summary

### What is Alert Storm Detection?

Alert Storm Detection identifies when the rate of incoming alerts significantly exceeds normal patterns. This helps operators understand when something unusual is happening and optionally enables automatic suppression during storms.

### Storm Detection Logic

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Storm Detection Algorithm                              │
└─────────────────────────────────────────────────────────────────────────────────┘

   Current Hour                Historical Average              Storm Check
┌─────────────────┐          ┌─────────────────────┐        ┌─────────────┐
│                 │          │                     │        │             │
│  150 alerts     │    vs    │  30 alerts/hour     │   =    │  5x normal  │
│  (this hour)    │          │  (last 24h avg)     │        │  = STORM!   │
│                 │          │                     │        │             │
└─────────────────┘          └─────────────────────┘        └─────────────┘
```

### Key Capabilities

1. **Storm Detection** - Identify abnormal alert spikes
2. **Historical Analysis** - Compare against baseline patterns
3. **Storm Alerts** - Notify admins when storm detected
4. **Emergency Suppression** - Optional auto-suppression during storms
5. **Noise Reduction Analytics** - Track overall noise reduction metrics
6. **Top Alerting Sources** - Identify which monitors/services cause most noise

### Storm Thresholds

| Level | Multiplier | Description |
|-------|------------|-------------|
| Normal | < 2x | Within normal variance |
| Elevated | 2x - 3x | Higher than usual |
| Storm | 3x - 5x | Significant spike |
| Critical Storm | > 5x | Major incident likely |

### User Stories

```
As an SRE, I want to be notified when an alert storm starts
so that I know something significant is happening.

As an operator, I want to see which monitors are causing the most alerts
so that I can prioritize investigation.

As a team lead, I want to see noise reduction metrics
so that I can measure the effectiveness of our alert tuning.

As an admin, I want to enable emergency suppression during storms
so that my team isn't overwhelmed during major incidents.
```

## Implementation Phases

### Phase 1: Storm Detection Core (Week 1)

- [ ] Create AlertStormEvent model
- [ ] Implement StormDetector service
- [ ] Create storm monitoring worker job
- [ ] Add storm detection settings

### Phase 2: Storm Notifications (Week 2)

- [ ] Storm start/end notifications
- [ ] Top alerting monitors identification
- [ ] Storm event timeline
- [ ] Admin notifications

### Phase 3: Noise Reduction Analytics (Week 3)

- [ ] Create NoiseReductionMetric model
- [ ] Daily metrics calculation job
- [ ] Deduplication statistics
- [ ] Suppression statistics
- [ ] Grouping statistics

### Phase 4: UI Dashboard (Week 4)

- [ ] Storm status banner
- [ ] Noise reduction dashboard
- [ ] Alert volume charts
- [ ] Top alerting sources view

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Storm Detection Flow                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

    ┌───────────────────┐
    │  Worker Job       │
    │  (Every 5 min)    │
    └─────────┬─────────┘
              │
              ▼
    ┌───────────────────────────────────────────────────────────────────────────┐
    │                         StormDetector.checkStatus()                        │
    ├───────────────────────────────────────────────────────────────────────────┤
    │                                                                            │
    │  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────────┐  │
    │  │ Get current     │──▶│ Get historical  │──▶│ Calculate multiplier    │  │
    │  │ hour count      │   │ average         │   │ current / historical    │  │
    │  └─────────────────┘   └─────────────────┘   └─────────────────────────┘  │
    │                                                        │                   │
    │                                              ┌─────────┴─────────┐         │
    │                                              │                   │         │
    │                                              ▼                   ▼         │
    │                                    ┌─────────────────┐  ┌─────────────────┐│
    │                                    │ multiplier < 3  │  │ multiplier >= 3 ││
    │                                    │ = Normal        │  │ = STORM         ││
    │                                    └─────────────────┘  └────────┬────────┘│
    │                                                                  │         │
    └──────────────────────────────────────────────────────────────────┼─────────┘
                                                                       │
                                                                       ▼
                                                         ┌─────────────────────────┐
                                                         │ Storm Actions:          │
                                                         │ - Create AlertStormEvent│
                                                         │ - Notify admins         │
                                                         │ - Show banner           │
                                                         │ - Optional: auto-suppress│
                                                         └─────────────────────────┘
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Storm detection accuracy | > 95% |
| Detection latency | < 5 minutes |
| False positive rate | < 5% |
| Noise reduction visibility | 100% of projects |

## References

- [Parent Plan: AlertEngine.md](../AlertEngine.md)
- [Alert Grouping Plan](../AlertGrouping/README.md)
- [Alert Suppression Plan](../AlertSuppression/README.md)
- [Alert Deduplication Plan](../AlertDeduplication/README.md)
