# API Design for Alert Storm Detection

## Overview

This document defines the REST API endpoints for Alert Storm Detection and Noise Reduction Analytics.

## Storm Events API

### Get Current Storm Status

```http
GET /api/project/{projectId}/alert-storm/status
```

**Response:**

```json
{
  "isStorm": true,
  "severity": "storm",
  "currentRate": 150,
  "normalRate": 30,
  "multiplier": 5.0,
  "affectedMonitors": [
    { "monitorId": "mon-1", "monitorName": "mysql-prod", "alertCount": 45 },
    { "monitorId": "mon-2", "monitorName": "api-gateway", "alertCount": 32 }
  ],
  "activeStormEvent": {
    "_id": "storm-event-1",
    "startedAt": "2026-01-20T10:00:00Z",
    "peakAlertRate": 180,
    "durationMinutes": 45
  }
}
```

### List Storm Events

```http
GET /api/project/{projectId}/alert-storm-event
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (active, resolved) |
| `startedAt` | DateRange | Filter by start date |
| `limit` | number | Results per page |
| `skip` | number | Pagination offset |

**Response:**

```json
{
  "data": [
    {
      "_id": "storm-1",
      "status": "resolved",
      "severity": "critical",
      "startedAt": "2026-01-19T14:00:00Z",
      "endedAt": "2026-01-19T15:30:00Z",
      "durationMinutes": 90,
      "peakAlertRate": 250,
      "normalAlertRate": 30,
      "multiplier": 8.33,
      "totalAlertsInStorm": 450,
      "affectedMonitors": [...]
    }
  ],
  "count": 15
}
```

### Get Storm Event Details

```http
GET /api/project/{projectId}/alert-storm-event/{eventId}
```

---

## Noise Reduction Analytics API

### Get Noise Reduction Summary

```http
GET /api/project/{projectId}/noise-reduction/summary
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
  "totalAlertTriggers": 10000,
  "alertsCreated": 3500,
  "deduplicated": 4000,
  "suppressed": 2500,
  "grouped": 1500,
  "notificationsSent": 2000,
  "noiseReductionPercent": 65.0,
  "breakdown": {
    "byDeduplication": 40.0,
    "bySuppression": 25.0
  }
}
```

### Get Daily Metrics

```http
GET /api/project/{projectId}/noise-reduction/daily
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | Date | Start of period |
| `endDate` | Date | End of period |

**Response:**

```json
{
  "data": [
    {
      "date": "2026-01-20",
      "totalAlertTriggers": 1500,
      "alertsCreated": 500,
      "deduplicated": 600,
      "suppressed": 400,
      "alertsGrouped": 200,
      "episodesCreated": 15,
      "noiseReductionPercent": 66.67
    },
    {
      "date": "2026-01-19",
      "totalAlertTriggers": 1200,
      "alertsCreated": 450
    }
  ]
}
```

### Get Top Noise Sources

```http
GET /api/project/{projectId}/noise-reduction/top-sources
```

**Response:**

```json
{
  "byMonitor": [
    { "monitorId": "mon-1", "monitorName": "mysql-prod", "alertCount": 500, "duplicateCount": 300 },
    { "monitorId": "mon-2", "monitorName": "api-gateway", "alertCount": 350, "duplicateCount": 150 }
  ],
  "bySeverity": [
    { "severityId": "sev-1", "severityName": "Warning", "alertCount": 600 },
    { "severityId": "sev-2", "severityName": "Critical", "alertCount": 200 }
  ]
}
```

---

## Storm Configuration API

### Get Storm Config

```http
GET /api/project/{projectId}/alert-storm/config
```

**Response:**

```json
{
  "stormThreshold": 3,
  "criticalThreshold": 5,
  "minimumAlertRate": 10,
  "baselineHours": 24,
  "enableEmergencySuppression": false,
  "notifyOnStormStart": true,
  "notifyOnStormEnd": true
}
```

### Update Storm Config

```http
PUT /api/project/{projectId}/alert-storm/config
```

---

## Implementation Checklist

### Storm API
- [ ] GET /alert-storm/status
- [ ] GET /alert-storm-event (list)
- [ ] GET /alert-storm-event/:id
- [ ] GET /alert-storm/config
- [ ] PUT /alert-storm/config

### Analytics API
- [ ] GET /noise-reduction/summary
- [ ] GET /noise-reduction/daily
- [ ] GET /noise-reduction/top-sources
