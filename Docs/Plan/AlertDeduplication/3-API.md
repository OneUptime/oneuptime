# API Design for Alert Deduplication

## Overview

This document defines the REST API endpoints for Alert Deduplication functionality.

## Deduplication Configuration API

### Get Deduplication Config

```http
GET /api/project/{projectId}/alert-deduplication-config
```

**Response:**

```json
{
  "enabled": true,
  "windowMinutes": 60,
  "fingerprintFields": ["monitorId", "createdCriteriaId", "alertSeverityId", "title"],
  "normalizeStrings": true
}
```

### Update Deduplication Config

```http
PUT /api/project/{projectId}/alert-deduplication-config
```

**Request Body:**

```json
{
  "enabled": true,
  "windowMinutes": 120,
  "fingerprintFields": ["monitorId", "alertSeverityId", "title"],
  "normalizeStrings": true
}
```

---

## Deduplication Statistics API

### Get Deduplication Statistics

```http
GET /api/project/{projectId}/alert-deduplication-stats
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
  "totalAlerts": 5000,
  "uniqueAlerts": 2500,
  "duplicateCount": 2500,
  "deduplicationRate": 50.0,
  "topDuplicatedAlerts": [
    {
      "alertId": "alert-1",
      "alertTitle": "MySQL connection timeout",
      "duplicateCount": 150,
      "monitor": { "name": "mysql-prod" }
    },
    {
      "alertId": "alert-2",
      "alertTitle": "API latency high",
      "duplicateCount": 89,
      "monitor": { "name": "api-gateway" }
    }
  ]
}
```

---

## Alert Fingerprint API

### List Active Fingerprints

```http
GET /api/project/{projectId}/alert-fingerprint
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Results per page |
| `skip` | number | Pagination offset |

**Response:**

```json
{
  "data": [
    {
      "_id": "fingerprint-1",
      "fingerprint": "a1b2c3d4...",
      "canonicalAlert": {
        "_id": "alert-1",
        "alertNumber": 123,
        "title": "MySQL connection timeout"
      },
      "duplicateCount": 15,
      "lastDuplicateAt": "2026-01-20T10:45:00Z",
      "windowEndAt": "2026-01-20T11:00:00Z"
    }
  ],
  "count": 50
}
```

### Get Fingerprint Details

```http
GET /api/project/{projectId}/alert-fingerprint/{fingerprintId}
```

---

## Alert Response Enhancement

The Alert response now includes deduplication fields:

```json
{
  "_id": "alert-1",
  "alertNumber": 123,
  "title": "MySQL connection timeout",
  "fingerprint": "a1b2c3d4e5f6...",
  "duplicateCount": 15,
  "lastDuplicateAt": "2026-01-20T10:45:00Z",
  "// ... other fields"
}
```

### Filter Alerts by Duplicate Count

```http
GET /api/project/{projectId}/alert?duplicateCount.gt=10
```

Get alerts with more than 10 duplicates.

---

## Available Fingerprint Fields API

### Get Available Fields

```http
GET /api/alert-deduplication-config/available-fields
```

**Response:**

```json
{
  "fields": [
    {
      "field": "monitorId",
      "label": "Monitor",
      "description": "Include monitor in fingerprint"
    },
    {
      "field": "createdCriteriaId",
      "label": "Criteria",
      "description": "Include alert criteria in fingerprint"
    },
    {
      "field": "alertSeverityId",
      "label": "Severity",
      "description": "Include severity in fingerprint"
    },
    {
      "field": "title",
      "label": "Title",
      "description": "Include alert title in fingerprint"
    },
    {
      "field": "description",
      "label": "Description",
      "description": "Include alert description in fingerprint"
    }
  ]
}
```

---

## Test Fingerprint API

### Generate Test Fingerprint

Test what fingerprint would be generated for given alert data.

```http
POST /api/project/{projectId}/alert-deduplication-config/test
```

**Request Body:**

```json
{
  "alertData": {
    "monitorId": "monitor-1",
    "alertSeverityId": "severity-1",
    "title": "MySQL connection timeout"
  }
}
```

**Response:**

```json
{
  "fingerprint": "a1b2c3d4e5f6...",
  "fieldsUsed": ["monitorId", "alertSeverityId", "title"],
  "fieldValues": {
    "monitorId": "monitor-1",
    "alertSeverityId": "severity-1",
    "title": "mysql connection timeout"
  },
  "wouldBeDuplicateOf": {
    "alertId": "alert-123",
    "alertNumber": 123,
    "alertTitle": "MySQL connection timeout"
  }
}
```

---

## Error Responses

```json
{
  "error": {
    "code": "DUPLICATE_ALERT",
    "message": "Duplicate of alert #123",
    "data": {
      "canonicalAlertId": "alert-123",
      "canonicalAlertNumber": 123,
      "duplicateCount": 16
    }
  }
}
```

Note: This is typically not shown to users as duplicates are handled silently.

---

## Implementation Checklist

### Configuration API
- [ ] GET /alert-deduplication-config
- [ ] PUT /alert-deduplication-config
- [ ] GET /alert-deduplication-config/available-fields
- [ ] POST /alert-deduplication-config/test

### Statistics API
- [ ] GET /alert-deduplication-stats

### Fingerprint API
- [ ] GET /alert-fingerprint (list)
- [ ] GET /alert-fingerprint/:id (details)

### Alert API Updates
- [ ] Add fingerprint to response
- [ ] Add duplicateCount to response
- [ ] Add duplicateCount filter
