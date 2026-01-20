# Alert Grouping / Episodes - Summary

## What is Alert Grouping?

Alert Grouping is a feature that automatically combines related alerts into logical containers called **Episodes**. Instead of seeing 50 individual "connection timeout" alerts, operators see one episode: "Database Connectivity Issues (50 alerts)".

## Key Capabilities

1. **Automatic Grouping** - Rules-based grouping of alerts into episodes
2. **Time-Window Grouping** - Group alerts occurring within N minutes
3. **Field-Based Grouping** - Group by monitor, monitor custom fields, severity, labels, etc.
4. **Manual Management** - Merge, split, add/remove alerts from episodes
5. **Episode Lifecycle** - Active → Acknowledged → Resolved states. These should be linked to alert states.
6. **Root Cause Tracking** - Document root cause analysis per episode. This is a placeholder field for user to fill out. We can even use Generate with AI to help summarize the episode based on Root Cause of all the alerts in the episode.
7. **Flapping Prevention** - Grace periods before resolution and reopen windows

## Data Models

### Three New Models

| Model | Purpose |
|-------|---------|
| **AlertEpisode** | Container for grouped alerts (title, state, severity, timing, ownership) |
| **AlertEpisodeMember** | Links alerts to episodes with metadata (addedBy, addedAt, similarityScore) |
| **AlertGroupingRule** | Configures automatic grouping behavior (match criteria, grouping config, priority) |

### Alert Model Enhancements

- `episodeId` - Link to parent episode
- `fingerprint` - Hash for deduplication
- `duplicateCount` - Number of duplicates suppressed

## Grouping Types

| Type | Description |
|------|-------------|
| **Time Window** | Groups alerts within N minutes of each other |
| **Field-Based** | Groups by matching fields (monitor, severity, labels) |
| **Smart** | ML-based similarity matching (future) |

## Flapping Prevention

- **resolveDelayMinutes** - Grace period before auto-resolving (prevents rapid state changes)
- **reopenWindowMinutes** - Window after resolution where episode can be reopened instead of creating new

## On-Call Policy Resolution

Priority chain for notifications:
1. Grouping rule's is linked to on-call policy. When episode is created via a grouping rule, that rule's on-call policy is used. 
2. If alert has any on-call policy. Please use it as well along with grouping rule's on-call policy.
3. If neither the grouping rule nor alert has an on-call policy, no notifications are sent. 

When an alert joins an episode, the alert policy (if any) is executed as normal. The episode's on-call policy is also executed. This means that if an alert has an on-call policy, notifications may be sent twice - once for the alert and once for the episode. If the episode policy is executed and then a new alert joins the episode, the episode's on-call policy is NOT re-executed.

### Worker Jobs
- **EpisodeAutoResolve** - Resolves episodes when all alerts resolved
- **EpisodeBreakInactive** - Resolves episodes after inactivity period

## Database Migrations 

Please do not write Database migrations. I will do that manually.
