# Alert Grouping / Episodes Implementation Plan

## Overview

This sub-plan details the implementation of Alert Grouping and Episodes functionality for OneUptime. This feature groups related alerts into logical containers called "Episodes" to reduce noise and help operators focus on root causes rather than individual symptoms.

## Documents

| Document | Description |
|----------|-------------|
| [1-DataModels.md](./1-DataModels.md) | Database models and schema definitions |
| [2-Backend.md](./2-Backend.md) | Backend services and grouping engine |
| [3-API.md](./3-API.md) | REST API endpoints |
| [4-UI.md](./4-UI.md) | Frontend components and pages |
| [5-Migration.md](./5-Migration.md) | Database migrations and rollout |

## Feature Summary

### What is an Episode?

An **Episode** is a container that groups related alerts together. Instead of seeing 50 individual "connection timeout" alerts, operators see one episode: "Database Connectivity Issues (50 alerts)".

### Key Capabilities

1. **Automatic Grouping** - Rules-based grouping of alerts into episodes
2. **Time-Window Grouping** - Group alerts occurring within N minutes
3. **Field-Based Grouping** - Group by monitor, severity, labels, etc.
4. **Manual Management** - Merge, split, add/remove alerts from episodes
5. **Episode Lifecycle** - Active → Acknowledged → Resolved states
6. **Root Cause Tracking** - Document root cause analysis per episode

### User Stories

```
As an operator, I want to see related alerts grouped together
so that I can focus on root causes instead of individual symptoms.

As an operator, I want to acknowledge an entire episode at once
so that I don't have to acknowledge each alert individually.

As a team lead, I want to configure grouping rules
so that alerts are automatically organized by our team's workflow.

As an operator, I want to document the root cause of an episode
so that the team can learn from past incidents.
```

## Implementation Phases

### Phase 1: Core Models & Basic Grouping (Week 1-2)

- [ ] Create AlertEpisode model
- [ ] Create AlertEpisodeMember model
- [ ] Create AlertGroupingRule model
- [ ] Implement basic time-window grouping engine
- [ ] Integrate with alert creation flow

### Phase 2: Episode Management (Week 3)

- [ ] Episode state management (acknowledge, resolve)
- [ ] Episode assignment (owners, teams)
- [ ] Episode timeline tracking
- [ ] Manual alert management (add/remove)

### Phase 3: UI - List & Detail Views (Week 4-5)

- [ ] Episodes list page
- [ ] Episode detail page
- [ ] Episode actions (acknowledge, resolve, assign)
- [ ] Alert-to-episode linking in alerts table

### Phase 4: UI - Configuration (Week 6)

- [ ] Grouping rules list page
- [ ] Create/edit grouping rule form
- [ ] Rule testing functionality
- [ ] Episode badge in alerts table

### Phase 5: Advanced Features (Week 7-8)

- [ ] Field-based grouping
- [ ] Episode merge/split functionality
- [ ] Episode notifications
- [ ] Analytics and metrics

## Dependencies

### Existing Components Used

- `Alert` model and `AlertService`
- `AlertState` and `AlertStateTimeline`
- Dashboard routing and layout components
- ModelTable and ModelForm components
- On-call notification system

### New Components Created

- `AlertEpisode` model
- `AlertEpisodeMember` model
- `AlertGroupingRule` model
- `GroupingEngine` service
- Episode UI pages and components

## Success Metrics

| Metric | Target |
|--------|--------|
| Alert-to-episode ratio | 5:1 or higher |
| Episode acknowledgment time | 50% faster than individual alerts |
| User adoption | 80% of projects with grouping rules |
| Processing latency | < 30ms added to alert creation |

## References

- [Parent Plan: AlertEngine.md](../AlertEngine.md)
- [Splunk ITSI Episode Review](https://docs.splunk.com/Documentation/ITSI)
- [PagerDuty Alert Grouping](https://support.pagerduty.com/docs/alert-grouping)
