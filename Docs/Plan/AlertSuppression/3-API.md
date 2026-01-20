# API Design for Alert Suppression

## Overview

This document defines the REST API endpoints for Alert Suppression functionality.

## Base URLs

```
/api/project/{projectId}/alert-suppression-rule
/api/project/{projectId}/alert-suppression-group
/api/project/{projectId}/suppressed-alert-log
/api/project/{projectId}/maintenance-window
```

---

## Suppression Rules API

### List Suppression Rules

```http
GET /api/project/{projectId}/alert-suppression-rule
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Filter by rule type (maintenance_window, condition_based, rate_limit) |
| `isEnabled` | boolean | Filter by enabled status |
| `suppressionGroupId` | ObjectID | Filter by suppression group |
| `limit` | number | Results per page |
| `skip` | number | Pagination offset |

**Response:**

```json
{
  "data": [
    {
      "_id": "rule-id-1",
      "name": "Nightly Maintenance Window",
      "description": "Suppress alerts during nightly deployments",
      "type": "maintenance_window",
      "isEnabled": true,
      "priority": 1,
      "matchCriteria": {
        "matchAll": true
      },
      "maintenanceWindow": {
        "startTime": "2026-01-20T02:00:00Z",
        "endTime": "2026-01-20T04:00:00Z",
        "timezone": "America/Los_Angeles",
        "isRecurring": true,
        "recurrenceRule": "FREQ=DAILY"
      },
      "action": "both",
      "suppressedCount": 156,
      "lastTriggeredAt": "2026-01-20T02:15:00Z"
    },
    {
      "_id": "rule-id-2",
      "name": "Rate Limit - 10/hour per monitor",
      "type": "rate_limit",
      "isEnabled": true,
      "priority": 2,
      "matchCriteria": {},
      "rateLimit": {
        "maxAlerts": 10,
        "timeWindowMinutes": 60,
        "groupByFields": ["monitorId"]
      },
      "action": "suppress_creation",
      "suppressedCount": 523
    }
  ],
  "count": 5,
  "skip": 0,
  "limit": 10
}
```

---

### Get Suppression Rule

```http
GET /api/project/{projectId}/alert-suppression-rule/{ruleId}
```

---

### Create Suppression Rule

```http
POST /api/project/{projectId}/alert-suppression-rule
```

**Request Body (Maintenance Window):**

```json
{
  "name": "Weekend Maintenance",
  "description": "Suppress alerts during weekend maintenance",
  "type": "maintenance_window",
  "isEnabled": true,
  "priority": 1,
  "matchCriteria": {
    "labelIds": ["production-label-id"]
  },
  "maintenanceWindow": {
    "startTime": "2026-01-25T00:00:00Z",
    "endTime": "2026-01-25T06:00:00Z",
    "timezone": "America/New_York",
    "isRecurring": true,
    "recurrenceRule": "FREQ=WEEKLY;BYDAY=SA,SU"
  },
  "action": "both"
}
```

**Request Body (Rate Limit):**

```json
{
  "name": "Alert Storm Protection",
  "description": "Limit alerts to 20 per hour per monitor",
  "type": "rate_limit",
  "isEnabled": true,
  "priority": 10,
  "matchCriteria": {
    "severityIds": ["warning-id", "info-id"]
  },
  "rateLimit": {
    "maxAlerts": 20,
    "timeWindowMinutes": 60,
    "groupByFields": ["monitorId"]
  },
  "action": "suppress_creation"
}
```

**Request Body (Condition-Based):**

```json
{
  "name": "Suppress Staging Alerts",
  "description": "Suppress notifications for staging environment",
  "type": "condition_based",
  "isEnabled": true,
  "priority": 5,
  "matchCriteria": {
    "labelIds": ["staging-label-id"]
  },
  "condition": {},
  "action": "suppress_notifications"
}
```

---

### Update Suppression Rule

```http
PUT /api/project/{projectId}/alert-suppression-rule/{ruleId}
```

---

### Delete Suppression Rule

```http
DELETE /api/project/{projectId}/alert-suppression-rule/{ruleId}
```

---

### Enable/Disable Rule

```http
POST /api/project/{projectId}/alert-suppression-rule/{ruleId}/enable
POST /api/project/{projectId}/alert-suppression-rule/{ruleId}/disable
```

---

### Test Suppression Rule

Test which alerts would be suppressed by a rule.

```http
POST /api/project/{projectId}/alert-suppression-rule/{ruleId}/test
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
  "results": [
    {
      "alertId": "alert-id-1",
      "alertTitle": "MySQL connection timeout",
      "wouldSuppress": true,
      "action": "both",
      "reason": "Matches criteria and maintenance window is active"
    },
    {
      "alertId": "alert-id-2",
      "alertTitle": "API latency high",
      "wouldSuppress": false,
      "reason": "Does not match severity criteria"
    }
  ]
}
```

---

## Maintenance Windows API

Convenience endpoints for maintenance windows specifically.

### List Active Maintenance Windows

```http
GET /api/project/{projectId}/maintenance-window/active
```

**Response:**

```json
{
  "data": [
    {
      "_id": "rule-id-1",
      "name": "Nightly Maintenance",
      "startedAt": "2026-01-20T02:00:00Z",
      "endsAt": "2026-01-20T04:00:00Z",
      "remainingMinutes": 45,
      "matchCriteria": { "matchAll": true }
    }
  ]
}
```

### List Upcoming Maintenance Windows

```http
GET /api/project/{projectId}/maintenance-window/upcoming
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `hours` | number | Look ahead hours (default: 24) |

---

### Quick Create Maintenance Window

Simplified endpoint for creating one-time maintenance windows.

```http
POST /api/project/{projectId}/maintenance-window/quick
```

**Request Body:**

```json
{
  "name": "Emergency Deployment",
  "durationMinutes": 60,
  "matchCriteria": {
    "monitorIds": ["monitor-1", "monitor-2"]
  }
}
```

Creates a maintenance window starting immediately.

---

## Suppression Groups API

### List Suppression Groups

```http
GET /api/project/{projectId}/alert-suppression-group
```

### Create Suppression Group

```http
POST /api/project/{projectId}/alert-suppression-group
```

**Request Body:**

```json
{
  "name": "Database Alerts",
  "description": "Group for database-related suppression rules",
  "throttleMinutes": 30
}
```

### Get Group with Rules

```http
GET /api/project/{projectId}/alert-suppression-group/{groupId}/rules
```

---

## Suppressed Alert Log API

### List Suppressed Alerts

```http
GET /api/project/{projectId}/suppressed-alert-log
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `suppressionRuleId` | ObjectID | Filter by rule |
| `monitorId` | ObjectID | Filter by monitor |
| `action` | string | Filter by action |
| `suppressedAt` | DateRange | Filter by date |
| `limit` | number | Results per page |
| `skip` | number | Pagination offset |

**Response:**

```json
{
  "data": [
    {
      "_id": "log-id-1",
      "alertTitle": "MySQL connection timeout",
      "suppressionRule": {
        "_id": "rule-id",
        "name": "Nightly Maintenance"
      },
      "suppressionReason": "Suppressed by maintenance window: Nightly Maintenance",
      "action": "both",
      "suppressedAt": "2026-01-20T02:15:00Z",
      "monitor": {
        "_id": "monitor-id",
        "name": "MySQL Production"
      },
      "alertData": {
        "title": "MySQL connection timeout",
        "description": "Connection to MySQL timed out after 30s",
        "severity": "High"
      }
    }
  ],
  "count": 156,
  "skip": 0,
  "limit": 10
}
```

### Get Suppression Statistics

```http
GET /api/project/{projectId}/suppressed-alert-log/statistics
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | Date | Start of period |
| `endDate` | Date | End of period |

**Response:**

```json
{
  "period": {
    "startDate": "2026-01-13T00:00:00Z",
    "endDate": "2026-01-20T00:00:00Z"
  },
  "totalSuppressed": 1234,
  "byRule": [
    { "ruleId": "rule-1", "ruleName": "Nightly Maintenance", "count": 523 },
    { "ruleId": "rule-2", "ruleName": "Rate Limit", "count": 711 }
  ],
  "byAction": [
    { "action": "suppress_creation", "count": 890 },
    { "action": "suppress_notifications", "count": 244 },
    { "action": "both", "count": 100 }
  ],
  "byDay": [
    { "date": "2026-01-13", "count": 156 },
    { "date": "2026-01-14", "count": 178 },
    { "date": "2026-01-15", "count": 145 }
  ]
}
```

---

## Permissions

| Endpoint | Required Permission |
|----------|---------------------|
| GET suppression rules | `ProjectMember` |
| Create/Update/Delete rules | `ProjectAdmin` |
| Enable/Disable rules | `ProjectAdmin` |
| GET suppressed logs | `ProjectMember` |
| GET statistics | `ProjectMember` |

---

## Error Responses

```json
{
  "error": {
    "code": "INVALID_RECURRENCE_RULE",
    "message": "Invalid RRULE format: FREQ=INVALID"
  }
}
```

**Error Codes:**

| Code | Description |
|------|-------------|
| `INVALID_RECURRENCE_RULE` | Invalid RRULE format |
| `INVALID_TIME_WINDOW` | End time before start time |
| `RULE_NOT_FOUND` | Suppression rule doesn't exist |
| `CANNOT_DELETE_ACTIVE_WINDOW` | Cannot delete currently active maintenance window |
| `OVERLAPPING_WINDOWS` | Maintenance windows overlap (warning only) |

---

## Webhooks

### Suppression Events

Configure webhooks to receive suppression events:

```json
{
  "event": "alert.suppressed",
  "timestamp": "2026-01-20T02:15:00Z",
  "data": {
    "projectId": "project-id",
    "suppressionRuleId": "rule-id",
    "suppressionRuleName": "Nightly Maintenance",
    "alertTitle": "MySQL connection timeout",
    "action": "both",
    "reason": "Maintenance window active"
  }
}
```

---

## Implementation Checklist

### Suppression Rule API
- [ ] GET /alert-suppression-rule (list)
- [ ] GET /alert-suppression-rule/:id (details)
- [ ] POST /alert-suppression-rule (create)
- [ ] PUT /alert-suppression-rule/:id (update)
- [ ] DELETE /alert-suppression-rule/:id (delete)
- [ ] POST /alert-suppression-rule/:id/enable
- [ ] POST /alert-suppression-rule/:id/disable
- [ ] POST /alert-suppression-rule/:id/test

### Maintenance Window API
- [ ] GET /maintenance-window/active
- [ ] GET /maintenance-window/upcoming
- [ ] POST /maintenance-window/quick

### Suppression Group API
- [ ] GET /alert-suppression-group (list)
- [ ] POST /alert-suppression-group (create)
- [ ] GET /alert-suppression-group/:id/rules

### Suppressed Log API
- [ ] GET /suppressed-alert-log (list)
- [ ] GET /suppressed-alert-log/statistics
