# Alert Grouping / Episodes - Summary

## What is Alert Grouping?

Alert Grouping is a feature that automatically combines related alerts into logical containers called **Episodes**. Instead of seeing 50 individual "connection timeout" alerts, operators see one episode: "Database Connectivity Issues (50 alerts)".

## Key Capabilities

1. **Automatic Grouping** - Rules-based grouping of alerts into episodes
2. **Time-Window Grouping** - Group alerts occurring within N minutes
3. **Field-Based Grouping** - Group by monitor, monitor custom fields, severity, labels, etc.
4. **Manual Management** - Add/remove alerts from episodes (merge/split deferred to future)
5. **Episode Lifecycle** - Active → Acknowledged → Resolved states. These should be linked to alert states.
6. **Root Cause Tracking** - Document root cause analysis per episode. This is a placeholder field for user to fill out. We can even use Generate with AI to help summarize the episode based on Root Cause of all the alerts in the episode.
7. **Flapping Prevention** - Grace periods before resolution and reopen windows

## Data Models

### Three New Models

| Model | Purpose |
|-------|---------|
| **AlertEpisode** | Container for grouped alerts (title, state, severity, timing, ownership) |
| **AlertEpisodeMember** | Links alerts to episodes with metadata (addedBy, addedAt) |
| **AlertGroupingRule** | Configures automatic grouping behavior (match criteria, grouping config, priority) |

### Alert Model Enhancements

- `episodeId` - Link to parent episode (nullable)

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

---

## Implementation Q&A (Industry Best Practices)

### Episode State Management

**Q1: How should episode states link to alert states?**

The episode state should reflect the "worst" or most urgent state among its member alerts:
- **Active**: At least one alert in the episode is in an active/firing state
- **Acknowledged**: All active alerts have been acknowledged, but not yet resolved
- **Resolved**: All alerts in the episode are resolved

This follows the pattern used by PagerDuty, Opsgenie, and other incident management platforms. The episode acts as an aggregate - it's only fully resolved when all underlying alerts are resolved.

If I Acknowledge an episode for exmaple, all active alerts in that episode should also be acknowledged. This ensures consistency between episode and alert states.

**Q2: If a new alert joins an already-acknowledged episode, should the episode state change back to Active?**

**No** - the acknowledgment applies to the episode as a container, not to individual alerts. When a new alert joins an acknowledged episode:
- The episode remains in "Acknowledged" state
- The new alert is marked as part of an acknowledged episode
- No new notification is sent for the episode (since it's already acknowledged)
- The alert's own on-call policy still executes normally

This prevents notification fatigue while ensuring the operator knows the episode is still being worked on.

---

### Grouping Logic

**Q3: For Time Window grouping - if an alert comes in after the initial window, should it create a new episode or join the existing one?**

Use a **rolling/sliding window** approach:
- The time window refers to the **gap between consecutive alerts**, not from the first alert
- If an episode is still **Active** and a matching alert arrives, it joins the episode regardless of when the first alert occurred
- The time window is used to determine when an episode becomes "inactive" (no new alerts for N minutes)
- Example: With a 10-minute window, alerts at T+0, T+8, T+15, T+22 would all be in the same episode (each gap < 10 min)

This is the standard approach in tools like PagerDuty's Intelligent Grouping and Opsgenie's Alert Deduplication.

**Q4: What fields can be matched in Field-Based grouping?**

Standard matchable fields should include:
| Field | Description |
|-------|-------------|
| `monitorId` | Same monitor/service |
| `monitorCustomFields` | User-defined monitor metadata |
| `alertSeverity` | Critical, Warning, Info, etc. |
| `labels` | Key-value tags on alerts |
| `alertTitle` | Exact or pattern match on title |
| `alertDescription` | Pattern match on description |
| `telemetryQuery` | The query that triggered the alert |

Rules should support both exact matching and regex patterns for string fields.

**Q5: If multiple AlertGroupingRules match a single alert, which rule takes priority?**

Use explicit **priority ordering**:
- Each rule has a `priority` field (lower number = higher priority)
- The **first matching rule** (highest priority) wins
- Only one rule processes each alert
- If no rules match, the alert remains ungrouped (standalone)

This gives operators explicit control over rule precedence, similar to firewall rules or routing tables.

---

### Scope & Implementation

**Q8: Should we implement backend only or both backend and frontend?**

Backend and Frontend. Please do not implement any database migrations. I will do that manually.

**Q9: What existing patterns in the codebase should we follow?**

Look at these existing features for patterns:
- **Alert model and workflows** - Base patterns for state management
- **Incident management** (if exists) - Similar grouping/aggregation concepts
- **On-Call Policy execution** - Notification routing patterns
- **Scheduled Jobs/Workers** - Pattern for background job implementation
- **CRUD APIs** - Standard API patterns for the new models

---

### Worker Jobs

**Q10: What should the inactivity period be for EpisodeBreakInactive?**

Make it **configurable per rule** with sensible defaults:
- **Default**: 60 minutes of inactivity
- **Configurable range**: 5 minutes to 24 hours
- **Per-rule setting**: `inactivityTimeoutMinutes` on `AlertGroupingRule`

The worker job should run every 1-5 minutes, checking for episodes that have exceeded their inactivity threshold.

| Scenario | Recommended Timeout |
|----------|---------------------|
| High-frequency alerts (metrics) | 5-15 minutes |
| Standard monitoring | 30-60 minutes |
| Low-frequency events | 2-4 hours |
| Maintenance windows | 12-24 hours |

---

### Episode Title Generation

**Q11: When an episode is auto-created by a rule, how should the title be generated?**

**Recommendation**: Use a two-tier approach:
1. **Default**: Use the first alert's title as the episode title
2. **Optional override**: Allow a template on the `AlertGroupingRule` for custom naming

Template variables could include:
- `{alertTitle}` - First alert's title
- `{monitorName}` - Monitor/service name
- `{alertSeverity}` - Severity level
- `{alertCount}` - Number of alerts (updated dynamically)

Example templates:
- `"{alertSeverity} issues on {monitorName}"` → "Critical issues on API Server"
- `"{monitorName} - {alertTitle}"` → "Database - Connection timeout"

If no template is specified on the rule, default to the first alert's title.

---

### Manual Management

**Q12: If an alert is removed from an episode, what happens to it?**

The alert becomes **standalone** (ungrouped). The user can then optionally move it to a different episode manually. The alert's `episodeId` is set to null.

---

### State Synchronization

**Q13: If I manually resolve an episode, should all member alerts also be resolved?**

**Yes** - resolving an episode resolves all member alerts. This mirrors the acknowledge behavior: episode state changes cascade down to all member alerts for consistency.

State cascade rules:
- **Acknowledge episode** → Acknowledge all member alerts
- **Resolve episode** → Resolve all member alerts

---

### Grouping Combinations

**Q14: Can a single rule use BOTH Time Window AND Field-Based grouping together?**

**Yes** - rules can combine both grouping types. For example:
- "Group alerts from the **same monitor** that occur **within 10 minutes** of each other"
- "Group alerts with the **same severity and labels** within a **30-minute window**"

Both conditions must be satisfied for alerts to be grouped together.

---

### Alert Eligibility

**Q15: Can only Active alerts be grouped into episodes, or can alerts in any state be grouped?**

Alerts in **any state** can be grouped into episodes. This allows:
- Grouping historical alerts for post-incident analysis
- Manual organization of already-resolved alerts
- Flexibility in episode management regardless of alert lifecycle stage

---

### Episode Ownership

**Q16: What ownership fields should AlertEpisode have?**

- **Assigned User** - Individual user responsible for the episode
- **Assigned Team** - Team responsible for the episode

Both are optional and can be set manually or inherited from the grouping rule configuration.

---

### Episode Severity

**Q17: How should episode severity be determined?**

Use a **high-water mark with manual override** approach:

1. **Initial**: Set to first alert's severity
2. **Auto-escalate**: When a new alert joins, if its severity > current episode severity → update episode to higher severity
3. **Never auto-downgrade**: If lower severity alert joins → keep current episode severity
4. **Manual override allowed**: User can edit severity at any time
5. **Override respected until escalation**: If user sets to "Warning" but a "Critical" alert joins → escalate to "Critical"

This ensures users are always alerted to the worst-case scenario while respecting manual judgment when appropriate.

---

### Root Cause Field

**Q18: What is the structure of the root cause field?**

Simple **text field** on AlertEpisode. Users can document their root cause analysis as free-form text. Future enhancement: AI-assisted summarization based on alert data.

---

### Flapping Prevention Configuration

**Q19: Where are flapping prevention settings configured?**

**Per-rule** on AlertGroupingRule:
- `resolveDelayMinutes` - Grace period before auto-resolving
- `reopenWindowMinutes` - Window after resolution where episode can be reopened

Each rule can have different flapping prevention settings based on the type of alerts it handles.

---

### Manual Episode Creation

**Q20: Can users create episodes manually without a grouping rule?**

**Yes** - users can manually create episodes and add alerts to them. This allows:
- Ad-hoc grouping for incidents that don't match existing rules
- Post-incident organization of related alerts
- Flexibility for edge cases not covered by automated rules

---

### Episode Deletion

**Q21: Can episodes be deleted? What happens to member alerts?**

**Yes** - episodes can be deleted, but alerts must be **removed first** to make them standalone. This is a safety measure to prevent accidental data loss. The deletion flow:
1. User removes all alerts from episode (alerts become standalone)
2. User can then delete the empty episode

Alternatively, if alerts are still in the episode when deleted, they become standalone automatically.

---

### UI Location

**Q22: Where should Episodes appear in the navigation?**

New **sidemenu item** in the Alerts section. Episodes should have their own dedicated list page accessible from the main navigation, similar to how Alerts have their own page.

---

### Alert-to-Episode Relationship

**Q23: Can an alert belong to multiple episodes?**

**No** - an alert can only belong to **one episode at a time** (single ownership). This provides:
- Simpler mental model for users
- Clear state cascade without conflicts
- Industry-standard approach (PagerDuty, Opsgenie)
- Cleaner queries and data management

The `episodeId` field on Alert is singular and nullable.
