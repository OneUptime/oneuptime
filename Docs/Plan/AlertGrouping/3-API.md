# API Design for Alert Grouping

## Overview

This document defines the REST API endpoints for Alert Grouping / Episodes functionality.

## Base URLs

All endpoints are prefixed with the project scope:

```
/api/project/{projectId}/alert-episode
/api/project/{projectId}/alert-grouping-rule
```

---

## Episodes API

### List Episodes

```http
GET /api/project/{projectId}/alert-episode
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `currentAlertStateId` | ObjectID | Filter by state |
| `alertSeverityId` | ObjectID | Filter by severity |
| `groupingRuleId` | ObjectID | Filter by grouping rule |
| `startedAt` | DateRange | Filter by start time |
| `search` | string | Search in title/description |
| `limit` | number | Results per page (default: 10) |
| `skip` | number | Pagination offset |
| `sort` | string | Sort field (default: `-lastActivityAt`) |

**Response:**

```json
{
  "data": [
    {
      "_id": "episode-id-1",
      "episodeNumber": 42,
      "title": "Database Connectivity Issues",
      "description": "Multiple database connection failures",
      "currentAlertState": {
        "_id": "state-id",
        "name": "Active",
        "color": "#FF0000"
      },
      "alertSeverity": {
        "_id": "severity-id",
        "name": "Critical",
        "color": "#FF0000"
      },
      "alertCount": 15,
      "uniqueMonitorCount": 3,
      "startedAt": "2026-01-20T10:45:00Z",
      "lastActivityAt": "2026-01-20T10:57:00Z",
      "groupingRule": {
        "_id": "rule-id",
        "name": "Database alerts - 5min"
      }
    }
  ],
  "count": 55,
  "skip": 0,
  "limit": 10
}
```

---

### Get Episode Details

```http
GET /api/project/{projectId}/alert-episode/{episodeId}
```

**Response:**

```json
{
  "_id": "episode-id-1",
  "episodeNumber": 42,
  "title": "Database Connectivity Issues",
  "description": "Multiple database connection failures",
  "currentAlertState": {
    "_id": "state-id",
    "name": "Active",
    "color": "#FF0000"
  },
  "alertSeverity": {
    "_id": "severity-id",
    "name": "Critical",
    "color": "#FF0000"
  },
  "alertCount": 15,
  "uniqueMonitorCount": 3,
  "startedAt": "2026-01-20T10:45:00Z",
  "lastActivityAt": "2026-01-20T10:57:00Z",
  "acknowledgedAt": null,
  "resolvedAt": null,
  "groupingRule": {
    "_id": "rule-id",
    "name": "Database alerts - 5min"
  },
  "ownerUsers": [],
  "ownerTeams": [],
  "labels": [],
  "rootCause": null
}
```

---

### Create Episode (Manual)

```http
POST /api/project/{projectId}/alert-episode
```

**Request Body:**

```json
{
  "title": "Custom Episode Title",
  "description": "Optional description"
}
```

**Response:** Created episode object

---

### Update Episode

```http
PUT /api/project/{projectId}/alert-episode/{episodeId}
```

**Request Body:**

```json
{
  "title": "Updated Title",
  "description": "Updated description",
  "ownerUsers": ["user-id-1"],
  "ownerTeams": ["team-id-1"],
  "labels": ["label-id-1"],
  "rootCause": "Database connection pool exhausted"
}
```

---

### Delete Episode

```http
DELETE /api/project/{projectId}/alert-episode/{episodeId}
```

Deleting an episode removes all member relationships but does NOT delete the alerts themselves. Alerts will have their `episodeId` set to null.

---

### Acknowledge Episode

```http
POST /api/project/{projectId}/alert-episode/{episodeId}/acknowledge
```

**Request Body:**

```json
{
  "acknowledgeAlerts": true  // Optional: also acknowledge all alerts
}
```

**Response:**

```json
{
  "_id": "episode-id",
  "currentAlertState": {
    "_id": "acknowledged-state-id",
    "name": "Acknowledged"
  },
  "acknowledgedAt": "2026-01-20T11:00:00Z"
}
```

---

### Resolve Episode

```http
POST /api/project/{projectId}/alert-episode/{episodeId}/resolve
```

**Request Body:**

```json
{
  "rootCause": "Database server restarted",
  "resolveAlerts": true  // Optional: also resolve all alerts
}
```

---

### Get Episode Alerts

```http
GET /api/project/{projectId}/alert-episode/{episodeId}/alerts
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Results per page |
| `skip` | number | Pagination offset |
| `sort` | string | Sort field |

**Response:**

```json
{
  "data": [
    {
      "_id": "alert-id-1",
      "alertNumber": 127,
      "title": "MySQL connection pool exhausted",
      "currentAlertState": { ... },
      "alertSeverity": { ... },
      "monitor": { ... },
      "createdAt": "2026-01-20T10:57:00Z",
      "episodeMembership": {
        "addedBy": "rule",
        "addedAt": "2026-01-20T10:57:00Z",
        "groupingRule": { "_id": "rule-id", "name": "Database alerts" }
      }
    }
  ],
  "count": 15,
  "skip": 0,
  "limit": 10
}
```

---

### Add Alert to Episode

```http
POST /api/project/{projectId}/alert-episode/{episodeId}/add-alert
```

**Request Body:**

```json
{
  "alertId": "alert-id-to-add"
}
```

---

### Remove Alert from Episode

```http
POST /api/project/{projectId}/alert-episode/{episodeId}/remove-alert
```

**Request Body:**

```json
{
  "alertId": "alert-id-to-remove"
}
```

---

### Merge Episodes

```http
POST /api/project/{projectId}/alert-episode/merge
```

**Request Body:**

```json
{
  "targetEpisodeId": "episode-to-keep",
  "sourceEpisodeIds": ["episode-to-merge-1", "episode-to-merge-2"]
}
```

All alerts from source episodes are moved to the target episode. Source episodes are deleted.

---

### Split Episode

```http
POST /api/project/{projectId}/alert-episode/{episodeId}/split
```

**Request Body:**

```json
{
  "alertIds": ["alert-id-1", "alert-id-2"],
  "newEpisodeTitle": "Split Episode"
}
```

Creates a new episode with the specified alerts removed from the original episode.

---

### Get Episode Timeline

```http
GET /api/project/{projectId}/alert-episode/{episodeId}/timeline
```

**Response:**

```json
{
  "data": [
    {
      "type": "alert_added",
      "timestamp": "2026-01-20T10:57:00Z",
      "description": "Alert #127 added to episode",
      "alert": { "_id": "alert-id", "title": "MySQL connection pool exhausted" },
      "addedBy": "rule"
    },
    {
      "type": "state_change",
      "timestamp": "2026-01-20T10:50:00Z",
      "description": "Assigned to John Smith",
      "user": { "_id": "user-id", "name": "John Smith" }
    },
    {
      "type": "episode_created",
      "timestamp": "2026-01-20T10:45:00Z",
      "description": "Episode created with 3 initial alerts",
      "groupingRule": { "_id": "rule-id", "name": "Database alerts - 5min" }
    }
  ]
}
```

---

## Grouping Rules API

### List Grouping Rules

```http
GET /api/project/{projectId}/alert-grouping-rule
```

**Response:**

```json
{
  "data": [
    {
      "_id": "rule-id-1",
      "name": "Database Alerts - 5 minute window",
      "description": "Groups database-related alerts within 5 minutes",
      "isEnabled": true,
      "priority": 1,
      "matchCriteria": {
        "labelIds": ["database-label-id"],
        "titlePattern": ".*(connection|database|mysql|postgres).*"
      },
      "groupingConfig": {
        "type": "time_window",
        "timeWindowMinutes": 5
      },
      "episodeConfig": {
        "titleTemplate": "{{severity}} - Database Issues",
        "autoResolveWhenEmpty": true,
        "breakAfterMinutesInactive": 60
      }
    }
  ],
  "count": 3
}
```

---

### Get Grouping Rule

```http
GET /api/project/{projectId}/alert-grouping-rule/{ruleId}
```

---

### Create Grouping Rule

```http
POST /api/project/{projectId}/alert-grouping-rule
```

**Request Body:**

```json
{
  "name": "Database Alerts - 5 minute window",
  "description": "Groups database-related alerts within 5 minutes",
  "isEnabled": true,
  "priority": 1,
  "matchCriteria": {
    "severityIds": ["critical-id", "high-id"],
    "labelIds": ["database-label-id"],
    "titlePattern": ".*(connection|database).*"
  },
  "groupingConfig": {
    "type": "time_window",
    "timeWindowMinutes": 5
  },
  "episodeConfig": {
    "titleTemplate": "{{severity}} - Database Issues",
    "autoResolveWhenEmpty": true,
    "breakAfterMinutesInactive": 60
  }
}
```

---

### Update Grouping Rule

```http
PUT /api/project/{projectId}/alert-grouping-rule/{ruleId}
```

---

### Delete Grouping Rule

```http
DELETE /api/project/{projectId}/alert-grouping-rule/{ruleId}
```

---

### Enable/Disable Grouping Rule

```http
POST /api/project/{projectId}/alert-grouping-rule/{ruleId}/enable
POST /api/project/{projectId}/alert-grouping-rule/{ruleId}/disable
```

---

### Test Grouping Rule

```http
POST /api/project/{projectId}/alert-grouping-rule/{ruleId}/test
```

**Request Body:**

```json
{
  "alertIds": ["alert-id-1", "alert-id-2", "alert-id-3"]
}
```

**Response:**

```json
{
  "matchedAlerts": [
    { "_id": "alert-id-1", "title": "MySQL timeout", "wouldMatch": true },
    { "_id": "alert-id-2", "title": "API error", "wouldMatch": false },
    { "_id": "alert-id-3", "title": "PostgreSQL error", "wouldMatch": true }
  ],
  "wouldCreateEpisodes": 1,
  "groupingPreview": [
    {
      "episodeTitle": "Critical - Database Issues",
      "alerts": ["alert-id-1", "alert-id-3"]
    }
  ]
}
```

---

## Existing Alert API Changes

### Alert Response Enhancement

The existing Alert response will include episode information:

```json
{
  "_id": "alert-id",
  "alertNumber": 127,
  "title": "MySQL connection pool exhausted",
  "episode": {
    "_id": "episode-id",
    "episodeNumber": 42,
    "title": "Database Connectivity Issues"
  },
  "fingerprint": "abc123...",
  "duplicateCount": 5
}
```

### Filter Alerts by Episode

```http
GET /api/project/{projectId}/alert?episodeId={episodeId}
```

### Get Ungrouped Alerts

```http
GET /api/project/{projectId}/alert?episodeId=null
```

---

## API Implementation Notes

### Permissions

| Endpoint | Required Permission |
|----------|---------------------|
| GET episodes | `ProjectMember` |
| Create/Update/Delete episodes | `ProjectAdmin` |
| Acknowledge/Resolve episodes | `ProjectMember` |
| GET grouping rules | `ProjectMember` |
| Create/Update/Delete grouping rules | `ProjectAdmin` |

### Error Responses

```json
{
  "error": {
    "code": "EPISODE_NOT_FOUND",
    "message": "Episode with ID xxx not found"
  }
}
```

Common error codes:
- `EPISODE_NOT_FOUND` - Episode doesn't exist
- `ALERT_NOT_FOUND` - Alert doesn't exist
- `ALERT_ALREADY_IN_EPISODE` - Alert is already part of an episode
- `CANNOT_MERGE_RESOLVED` - Cannot merge resolved episodes
- `INVALID_GROUPING_CONFIG` - Invalid grouping rule configuration

### Rate Limiting

Standard API rate limits apply. Batch operations (merge, bulk add) count as multiple operations.

---

## Implementation Checklist

### Episode API
- [ ] GET /alert-episode (list)
- [ ] GET /alert-episode/:id (details)
- [ ] POST /alert-episode (create)
- [ ] PUT /alert-episode/:id (update)
- [ ] DELETE /alert-episode/:id (delete)
- [ ] POST /alert-episode/:id/acknowledge
- [ ] POST /alert-episode/:id/resolve
- [ ] GET /alert-episode/:id/alerts
- [ ] POST /alert-episode/:id/add-alert
- [ ] POST /alert-episode/:id/remove-alert
- [ ] POST /alert-episode/merge
- [ ] POST /alert-episode/:id/split
- [ ] GET /alert-episode/:id/timeline

### Grouping Rule API
- [ ] GET /alert-grouping-rule (list)
- [ ] GET /alert-grouping-rule/:id (details)
- [ ] POST /alert-grouping-rule (create)
- [ ] PUT /alert-grouping-rule/:id (update)
- [ ] DELETE /alert-grouping-rule/:id (delete)
- [ ] POST /alert-grouping-rule/:id/enable
- [ ] POST /alert-grouping-rule/:id/disable
- [ ] POST /alert-grouping-rule/:id/test

### Alert API Updates
- [ ] Add episode field to alert response
- [ ] Add episodeId filter to alert list
- [ ] Add fingerprint field to alert response
