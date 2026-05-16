# Offentlig statusside-API

Her er hvordan du kan bruke det offentlige statusside-API-et for å hente status for ressursene på statussiden. Alt du trenger å gjøre er å sende en POST-forespørsel til API-endepunktet.

#### Oversikts-API

Dette API-et vil hente alle ressursene på statussiden, inkludert den overordnede statusen til ressursene, hendelser, vedlikehold og mer.

For å hente den overordnede statusen til ressursene på statussiden kan du sende en POST-forespørsel til følgende endepunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Dette er svaret fra API-et:

```json
{

    "overallStatus": 
        {   // Monitor Status-objekt
            // Den overordnede statusen er den dårligste statusen for alle monitorer og grupper på statussiden.
            // Du finner mer detaljer om monitorstatusen her.
            // https://oneuptime.com/reference/monitor-status
            
        },
    "scheduledMaintenanceEventsPublicNotes": [
        // Du finner mer detaljer om offentlig notat for planlagt vedlikehold her.
        // https://oneuptime.com/reference/scheduled-maintenance-public-note
        {
            // Objekt for offentlig notat for planlagt vedlikehold
        }, 
        {
            // Objekt for offentlig notat for planlagt vedlikehold
        }
    ],
    "statusPageHistoryChartBarColorRules": [
        // Du finner mer detaljer om fargeregel for historikkdiagram på statussiden her.
        // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
        {
            // Objekt for fargeregel for historikkdiagram på statussiden
        },
        {
            // Objekt for fargeregel for historikkdiagram på statussiden
        }
    ],
    "scheduledMaintenanceEvents": [
        // Du finner mer detaljer om planlagt vedlikeholdshendelse her.
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Objekt for planlagt vedlikeholdshendelse
        },
        {
            // Objekt for planlagt vedlikeholdshendelse
        }
    ],
    "activeAnnouncements": [
        // Du finner mer detaljer om aktiv kunngjøring her.
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Kunngjøringsobjekt for statussiden
        },
        {
            // Kunngjøringsobjekt for statussiden
        }
    ],
    "incidentPublicNotes": [
        // Du finner mer detaljer om offentlig hendelsesnotat her.
        // https://oneuptime.com/reference/incident-public-note
        {
            // Objekt for offentlig hendelsesnotat
        },
        {
            // Objekt for offentlig hendelsesnotat
        }
    ],
    "activeIncidents": [
        // Du finner mer detaljer om aktiv hendelse her.
        // https://oneuptime.com/reference/incident
        {
            // Hendelsesobjekt
        },
        {
            // Hendelsesobjekt
        }
    ],
    "monitorStatusTimelines": [
        // Du finner mer detaljer om monitorstatustidslinje her.
        // https://oneuptime.com/reference/monitor-status-timeline
        {
            // Objekt for monitorstatustidslinje
        },
        {
            // Objekt for monitorstatustidslinje
        }
    ],
    "resourceGroups": [
        // Du finner mer detaljer om ressursgruppe her.
        // https://oneuptime.com/reference/resource-group
        {
            // Ressursguppeobjekt
        },
        {
            // Ressursguppeobjekt
        }
    ],
    "monitorStatuses": [
        // Du finner mer detaljer om monitorstatus her.
        // https://oneuptime.com/reference/monitor-status
        {
            // Monitor Status-objekt
        },
        {
            // Monitor Status-objekt
        }

    ],
    "statusPageResources": [
        // Du finner mer detaljer om statussideressurs her.
        // https://oneuptime.com/reference/status-page-resource
        {
            // Statussideressursobjekt
        },
        {
            // Statussideressursobjekt
        }
    ],
    "incidentStateTimelines": [
        // Du finner mer detaljer om hendelsestilstandstidslinje her.
        // https://oneuptime.com/reference/incident-state-timeline
        {
            // Objekt for hendelsestilstandstidslinje
        },
        {
            // Objekt for hendelsestilstandstidslinje
        }
    ],
    "statusPage": {
       // Du finner mer detaljer om statussiden her.
         // https://oneuptime.com/reference/status-page
    },
    "scheduledMaintenanceStateTimelines": [
        // Du finner mer detaljer om tidslinje for tilstand for planlagt vedlikehold her.
        // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
        {
            // Objekt for tidslinje for tilstand for planlagt vedlikehold
        },
        {
            // Objekt for tidslinje for tilstand for planlagt vedlikehold
        }
    ],
    "monitorGroupCurrentStatuses": {
        // Gjeldende status for monitorgruppen.
    },
    "monitorsInGroup": {
        // Monitorer i gruppen.
    }
}
```

#### Oppetids-API

Dette API-et vil hente all oppetid for alle ressurser på statussiden.

For å hente den overordnede oppetiden for alle ressurser kan du sende en POST-forespørsel til følgende endepunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Forespørselskropp (valgfritt):**

Du kan sende startDate og endDate som forespørselskropp.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Disse datoene skal ikke være mer enn 90 dager fra hverandre. Hvis du ikke angir datoene, vil API-et returnere oppetiden for de siste 14 dagene.

**Eksempelsvar:**

Dette er eksempelsvaret fra API-et:

```json
{
    "statusPageResourceUptimes": [
        {
            "statusPageResourceId": {
                "_type": "ObjectID",
                "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
            },
            "uptimePercent": 99.98,
            "statusPageResourceName": "Navn på statussideressurs",
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


### Hendelses-API

Dette API-et vil hente alle hendelsene som er på statussiden. For å hente alle hendelsene på statussiden kan du sende en POST-forespørsel til følgende endepunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Dette er svaret fra API-et:

```json
{
    "incidents": [
        // Du finner mer detaljer om hendelse her.
        // https://oneuptime.com/reference/incident
        {
            // Hendelsesobjekt
        },
        {
            // Hendelsesobjekt
        }
    ]
}
```


### Planlagt vedlikeholds-API

Dette API-et vil hente all planlagt vedlikehold som er på statussiden. For å hente all planlagt vedlikehold på statussiden kan du sende en POST-forespørsel til følgende endepunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Dette er svaret fra API-et:

```json
{
    "scheduledMaintenanceEvents": [
        // Du finner mer detaljer om planlagt vedlikeholdshendelse her.
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Objekt for planlagt vedlikeholdshendelse
        },
        {
            // Objekt for planlagt vedlikeholdshendelse
        }
    ]
}
```

### Kunngjørings-API

Dette API-et vil hente alle kunngjøringer som er på statussiden. For å hente alle kunngjøringer på statussiden kan du sende en POST-forespørsel til følgende endepunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Dette er svaret fra API-et:

```json
{
    "announcements": [
        // Du finner mer detaljer om kunngjøring her.
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Kunngjøringsobjekt
        },
        {
            // Kunngjøringsobjekt
        }
    ]
}
```
