# Öffentliche Status-Seiten-API

Hier erfahren Sie, wie Sie die öffentliche Status-Seiten-API verwenden können, um den Status Ihrer Ressourcen auf der Status-Seite abzurufen. Alles, was Sie tun müssen, ist einen POST-Request an den API-Endpunkt zu senden.

#### Übersichts-API

Diese API ruft alle Ressourcen auf der Status-Seite ab, einschließlich des Gesamtstatus der Ressourcen, Incidents, Wartungen und mehr.

Um den Gesamtstatus der Ressourcen auf der Status-Seite abzurufen, können Sie einen POST-Request an den folgenden Endpunkt senden:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Dies ist die Antwort von der API:

```json
{
  "overallStatus": {
    // Monitor Status Object
    // Overall Status is the worst status of all the monitors and groups on the status page.
    // You can find more details on the monitor status here.
    // https://oneuptime.com/reference/monitor-status
  },
  "scheduledMaintenanceEventsPublicNotes": [
    // You can find more details on the scheduled maintenance public note here.
    // https://oneuptime.com/reference/scheduled-maintenance-public-note
    {
      // Scheduled Maintenance Public Note Object
    },
    {
      // Scheduled Maintenance Public Note Object
    }
  ],
  "statusPageHistoryChartBarColorRules": [
    {
      // Status Page History Chart Bar Color Rule Object
    },
    {
      // Status Page History Chart Bar Color Rule Object
    }
  ],
  "scheduledMaintenanceEvents": [
    {
      // Scheduled Maintenance Event Object
    },
    {
      // Scheduled Maintenance Event Object
    }
  ],
  "activeAnnouncements": [
    {
      // Status Page Announcement Object
    },
    {
      // Status Page Announcement Object
    }
  ],
  "incidentPublicNotes": [
    {
      // Incident Public Note Object
    },
    {
      // Incident Public Note Object
    }
  ],
  "activeIncidents": [
    {
      // Incident Object
    },
    {
      // Incident Object
    }
  ],
  "monitorStatusTimelines": [
    {
      // Monitor Status Timeline Object
    },
    {
      // Monitor Status Timeline Object
    }
  ],
  "resourceGroups": [
    {
      // Resource Group Object
    },
    {
      // Resource Group Object
    }
  ],
  "monitorStatuses": [
    {
      // Monitor Status Object
    },
    {
      // Monitor Status Object
    }
  ],
  "statusPageResources": [
    {
      // Status Page Resource Object
    },
    {
      // Status Page Resource Object
    }
  ],
  "incidentStateTimelines": [
    {
      // Incident State Timeline Object
    },
    {
      // Incident State Timeline Object
    }
  ],
  "statusPage": {
    // You can find more details on the status page here.
    // https://oneuptime.com/reference/status-page
  },
  "scheduledMaintenanceStateTimelines": [
    {
      // Scheduled Maintenance State Timeline Object
    },
    {
      // Scheduled Maintenance State Timeline Object
    }
  ],
  "monitorGroupCurrentStatuses": {
    // Aktueller Status der Monitor-Gruppe.
  },
  "monitorsInGroup": {
    // Monitore in der Gruppe.
  }
}
```

#### Verfügbarkeits-API

Diese API ruft die Verfügbarkeit aller Ressourcen auf der Status-Seite ab.

Um die Gesamtverfügbarkeit aller Ressourcen abzurufen, können Sie einen POST-Request an den folgenden Endpunkt senden:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Anfragetext (optional):**

Sie können startDate und endDate als Anfragetext senden.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Diese Datumsangaben dürfen nicht mehr als 90 Tage auseinanderliegen. Wenn Sie keine Datumsangaben angeben, gibt die API die Verfügbarkeit für die letzten 14 Tage zurück.

### Incidents-API

Diese API ruft alle Incidents auf der Status-Seite ab. Um alle Incidents abzurufen, können Sie einen POST-Request an den folgenden Endpunkt senden:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

### Geplante Wartungs-API

Diese API ruft alle geplanten Wartungen auf der Status-Seite ab:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

### Ankündigungs-API

Diese API ruft alle Ankündigungen auf der Status-Seite ab:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```
