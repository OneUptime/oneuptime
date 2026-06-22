# Offentlig statussides API

Her er, hvordan du kan bruge den Offentlige statussides API til at hente status for dine ressourcer, der er på statussiden. Alt du skal gøre er at sende en POST-anmodning til API-endpointet.

#### Oversigtens API

Denne API henter alle ressourcer, der er på statussiden, herunder den overordnede status for ressourcerne, incidents og vedligeholdelse og mere.

For at hente den overordnede status for ressourcerne på statussiden kan du sende en POST-anmodning til følgende endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Dette er svaret fra API'en:

```json
{
  "overallStatus": {
    // Monitor Status-objekt
    // Overordnet status er den værste status for alle monitorer og grupper på statussiden.
    // Du kan finde flere detaljer om monitorstatus her.
    // https://oneuptime.com/reference/monitor-status
  },
  "scheduledMaintenanceEventsPublicNotes": [
    // Du kan finde flere detaljer om den planlagte vedligeholdelses offentlige note her.
    // https://oneuptime.com/reference/scheduled-maintenance-public-note
    {
      // Planlagt vedligeholdelses offentlig note-objekt
    },
    {
      // Planlagt vedligeholdelses offentlig note-objekt
    }
  ],
  "statusPageHistoryChartBarColorRules": [
    // Du kan finde flere detaljer om statussidernes historikdiagram-stavsfarveregel her.
    // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
    {
      // Statussidernes historikdiagram-stavsfarveregel-objekt
    },
    {
      // Statussidernes historikdiagram-stavsfarveregel-objekt
    }
  ],
  "scheduledMaintenanceEvents": [
    // Du kan finde flere detaljer om den planlagte vedligeholdelsesbegivenhed her.
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // Planlagt vedligeholdelsesbegivenhed-objekt
    },
    {
      // Planlagt vedligeholdelsesbegivenhed-objekt
    }
  ],
  "activeAnnouncements": [
    // Du kan finde flere detaljer om den aktive meddelelse her.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Statussidernes meddelelse-objekt
    },
    {
      // Statussidernes meddelelse-objekt
    }
  ],
  "incidentPublicNotes": [
    // Du kan finde flere detaljer om den offentlige incidentnote her.
    // https://oneuptime.com/reference/incident-public-note
    {
      // Incident offentlig note-objekt
    },
    {
      // Incident offentlig note-objekt
    }
  ],
  "activeIncidents": [
    // Du kan finde flere detaljer om det aktive incident her.
    // https://oneuptime.com/reference/incident
    {
      // Incident-objekt
    },
    {
      // Incident-objekt
    }
  ],
  "monitorStatusTimelines": [
    // Du kan finde flere detaljer om monitorstatustidslinjen her.
    // https://oneuptime.com/reference/monitor-status-timeline
    {
      // Monitorstatustidslinje-objekt
    },
    {
      // Monitorstatustidslinje-objekt
    }
  ],
  "resourceGroups": [
    // Du kan finde flere detaljer om ressourcegruppen her.
    // https://oneuptime.com/reference/resource-group
    {
      // Ressourcegruppe-objekt
    },
    {
      // Ressourcegruppe-objekt
    }
  ],
  "monitorStatuses": [
    // Du kan finde flere detaljer om monitorstatus her.
    // https://oneuptime.com/reference/monitor-status
    {
      // Monitorstatus-objekt
    },
    {
      // Monitorstatus-objekt
    }
  ],
  "statusPageResources": [
    // Du kan finde flere detaljer om statussideressourcen her.
    // https://oneuptime.com/reference/status-page-resource
    {
      // Statussideressource-objekt
    },
    {
      // Statussideressource-objekt
    }
  ],
  "incidentStateTimelines": [
    // Du kan finde flere detaljer om incidenttilstandstidslinjen her.
    // https://oneuptime.com/reference/incident-state-timeline
    {
      // Incidenttilstandstidslinje-objekt
    },
    {
      // Incidenttilstandstidslinje-objekt
    }
  ],
  "statusPage": {
    // Du kan finde flere detaljer om statussiden her.
    // https://oneuptime.com/reference/status-page
  },
  "scheduledMaintenanceStateTimelines": [
    // Du kan finde flere detaljer om den planlagte vedligeholdelses tilstandstidslinje her.
    // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
    {
      // Planlagt vedligeholdelses tilstandstidslinje-objekt
    },
    {
      // Planlagt vedligeholdelses tilstandstidslinje-objekt
    }
  ],
  "monitorGroupCurrentStatuses": {
    // Aktuel status for monitorgruppen.
  },
  "monitorsInGroup": {
    // Monitorer i gruppen.
  }
}
```

#### Oppetids-API

Denne API henter al oppetid for alle ressourcer på statussiden.

For at hente den samlede oppetid for alle ressourcer kan du sende en POST-anmodning til følgende endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Anmodningsindhold (valgfrit):**

Du kan sende startDate og endDate som anmodningsindhold.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Disse datoer bør ikke være mere end 90 dage fra hinanden. Hvis du ikke angiver datoerne, returnerer API'en oppetiden for de seneste 14 dage.

**Eksempelsvar:**

Dette er eksempelsvaret fra API'en:

```json
{
  "statusPageResourceUptimes": [
    {
      "statusPageResourceId": {
        "_type": "ObjectID",
        "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
      },
      "uptimePercent": 99.98,
      "statusPageResourceName": "Statussideressourcenavn",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "isPermissionIf": {},
        "name": "Operational",
        "color": {
          "_type": "Color",
          "value": "#2ab57d"
        },
        "isOperationalState": true,
        "priority": 1
      }
    }
  ],
  "groupUptimes": [
    {
      "statusPageGroupId": {
        "_type": "ObjectID",
        "value": "df7632c4-c5c0-453c-88bf-9ee3d68d45f2"
      },
      "uptimePercent": 99.98,
      "statusPageResourceUptimes": [
        {
          "statusPageResourceId": {
            "_type": "ObjectID",
            "value": "8175534f-aa77-456c-ad5b-b8e7b85876aa"
          },
          "uptimePercent": 99.98,
          "statusPageResourceName": "dfg",
          "currentStatus": {
            "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
            "isPermissionIf": {},
            "name": "Operational",
            "color": {
              "_type": "Color",
              "value": "#2ab57d"
            },
            "isOperationalState": true,
            "priority": 1
          }
        }
      ],
      "statusPageGroupName": "Gruppenavn",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "isPermissionIf": {},
        "name": "Operational",
        "color": {
          "_type": "Color",
          "value": "#2ab57d"
        },
        "isOperationalState": true,
        "priority": 1
      }
    }
  ],
  "startDate": "2021-09-01T00:00:00Z",
  "endDate": "2021-09-30T23:59:59Z"
}
```

### Incident-API

Denne API henter alle incidents, der er på statussiden. For at hente alle incidents på statussiden kan du sende en POST-anmodning til følgende endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Dette er svaret fra API'en:

```json
{
  "incidents": [
    // Du kan finde flere detaljer om incidentet her.
    // https://oneuptime.com/reference/incident
    {
      // Incident-objekt
    },
    {
      // Incident-objekt
    }
  ]
}
```

### Planlagt vedligeholdelses-API

Denne API henter al planlagt vedligeholdelse, der er på statussiden. For at hente al planlagt vedligeholdelse på statussiden kan du sende en POST-anmodning til følgende endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Dette er svaret fra API'en:

```json
{
  "scheduledMaintenanceEvents": [
    // Du kan finde flere detaljer om den planlagte vedligeholdelsesbegivenhed her.
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // Planlagt vedligeholdelsesbegivenhed-objekt
    },
    {
      // Planlagt vedligeholdelsesbegivenhed-objekt
    }
  ]
}
```

### Meddelelse-API

Denne API henter alle meddelelser, der er på statussiden. For at hente alle meddelelser på statussiden kan du sende en POST-anmodning til følgende endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Dette er svaret fra API'en:

```json
{
  "announcements": [
    // Du kan finde flere detaljer om meddelelsen her.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Meddelelse-objekt
    },
    {
      // Meddelelse-objekt
    }
  ]
}
```
