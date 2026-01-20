# Alert Suppression Implementation Plan

## Overview

This sub-plan details the implementation of Alert Suppression functionality for OneUptime. This feature allows users to suppress alert creation and/or notifications based on configurable rules including maintenance windows, conditions, and rate limits.

## Documents

| Document | Description |
|----------|-------------|
| [1-DataModels.md](./1-DataModels.md) | Database models and schema definitions |
| [2-Backend.md](./2-Backend.md) | Backend services and suppression engine |
| [3-API.md](./3-API.md) | REST API endpoints |
| [4-UI.md](./4-UI.md) | Frontend components and pages |
| [5-Migration.md](./5-Migration.md) | Database migrations and rollout |

## Feature Summary

### What is Alert Suppression?

Alert Suppression allows you to temporarily or permanently prevent alerts from being created or notifications from being sent based on configurable rules.

### Suppression Types

| Type | Description | Use Case |
|------|-------------|----------|
| **Maintenance Window** | Time-based suppression | Planned deployments, scheduled maintenance |
| **Condition-Based** | Suppress based on alert attributes | Ignore staging alerts, low-priority monitors |
| **Rate Limit** | Suppress after threshold exceeded | Prevent alert storms, noise reduction |

### Key Capabilities

1. **Maintenance Windows** - Schedule suppression periods (one-time or recurring)
2. **Condition Matching** - Suppress alerts matching specific criteria
3. **Rate Limiting** - Limit alerts per time window per dimension
4. **Suppression Actions** - Choose to suppress creation, notifications, or both
5. **Audit Trail** - Track all suppressed alerts for compliance
6. **Suppression Groups** - Group related rules for coordinated suppression

### User Stories

```
As an operator, I want to create a maintenance window
so that I don't get alerted during planned deployments.

As a team lead, I want to suppress notifications for staging alerts
so that my team only gets paged for production issues.

As an SRE, I want to rate-limit alerts per monitor
so that a single flapping service doesn't flood my inbox.

As a compliance officer, I want to see which alerts were suppressed
so that I can audit our alert handling procedures.
```

## Implementation Phases

### Phase 1: Data Models & Core Engine (Week 1-2)

- [ ] Create AlertSuppressionRule model
- [ ] Create AlertSuppressionGroup model
- [ ] Create SuppressedAlertLog model
- [ ] Implement SuppressionEngine
- [ ] Integrate with AlertService

### Phase 2: Maintenance Windows (Week 3)

- [ ] Time-based suppression logic
- [ ] Recurring schedule support (RRULE)
- [ ] Timezone handling
- [ ] Calendar UI component

### Phase 3: Condition & Rate Limiting (Week 4)

- [ ] Condition-based matching
- [ ] Rate limit state tracking
- [ ] AlertThrottleState model
- [ ] Per-field rate limiting

### Phase 4: UI Implementation (Week 5-6)

- [ ] Suppression rules list page
- [ ] Create/edit rule forms
- [ ] Maintenance window calendar
- [ ] Suppressed alerts log view

### Phase 5: Analytics & Reporting (Week 7)

- [ ] Suppression metrics dashboard
- [ ] Noise reduction statistics
- [ ] Audit log export

## Dependencies

### Existing Components Used

- `Alert` model and `AlertService`
- `AlertSeverity` and `AlertState` models
- `Monitor` and `Label` models
- Dashboard ModelTable and ModelForm components
- Notification system

### New Components Created

- `AlertSuppressionRule` model
- `AlertSuppressionGroup` model
- `SuppressedAlertLog` model
- `AlertThrottleState` model
- `SuppressionEngine` service
- Suppression UI pages

## Success Metrics

| Metric | Target |
|--------|--------|
| Suppression rule creation | < 5 minutes |
| Rule evaluation latency | < 10ms |
| Maintenance window accuracy | 100% (no alerts during window) |
| User adoption | 60% of projects with rules |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Alert Creation Flow                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │   Alert Trigger      │
                    │  (Monitor/Manual)    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  SuppressionEngine   │
                    │    .evaluate()       │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
    │ Maintenance     │ │ Condition   │ │ Rate Limit      │
    │ Window Check    │ │ Check       │ │ Check           │
    └────────┬────────┘ └──────┬──────┘ └────────┬────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                     ┌─────────┴─────────┐
                     │                   │
                     ▼                   ▼
           ┌─────────────────┐  ┌─────────────────┐
           │ SUPPRESS        │  │ ALLOW           │
           │ - Log to audit  │  │ - Create alert  │
           │ - Skip creation │  │ - Send notifs   │
           │   or notifs     │  │                 │
           └─────────────────┘  └─────────────────┘
```

## References

- [Parent Plan: AlertEngine.md](../AlertEngine.md)
- [Alert Grouping Plan](../AlertGrouping/README.md)
- [PagerDuty Maintenance Windows](https://support.pagerduty.com/docs/maintenance-windows)
- [Splunk Alert Suppression](https://docs.splunk.com/Documentation/ITSI)
