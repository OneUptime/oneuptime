# Openbare statuspagina API

Hier vindt u hoe u de openbare statuspagina API kunt gebruiken om de status van uw resources op de statuspagina op te halen. U hoeft alleen maar een POST-verzoek te doen naar het API-eindpunt.

#### Overzichts-API

Deze API haalt alle resources op die op de statuspagina staan, inclusief de algehele status van de resources, incidenten, onderhoud en meer.

Om de algehele status van de resources op de statuspagina te krijgen, kunt u een POST-verzoek doen naar het volgende eindpunt:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Dit is de respons van de API:

```json
{

    "overallStatus": 
        {   // Monitor Status Object
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
        // You can find more details on the status page history chart bar color rule here.
        // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
        {
            // Status Page History Chart Bar Color Rule Object
        },
        {
            // Status Page History Chart Bar Color Rule Object
        }
    ],
    "scheduledMaintenanceEvents": [
        // You can find more details on the scheduled maintenance event here.
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Scheduled Maintenance Event Object
        },
        {
            // Scheduled Maintenance Event Object
        }
    ],
    "activeAnnouncements": [
        // You can find more details on the active announcement here.
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Status Page Announcement Object
        },
        {
            // Status Page Announcement Object
        }
    ],
    "incidentPublicNotes": [
        // You can find more details on the incident public note here.
        // https://oneuptime.com/reference/incident-public-note
        {
            // Incident Public Note Object
        },
        {
            // Incident Public Note Object
        }
    ],
    "activeIncidents": [
        // You can find more details on the active incident here.
        // https://oneuptime.com/reference/incident
        {
            // Incident Object
        },
        {
            // Incident Object
        }
    ],
    "monitorStatusTimelines": [
        // You can find more details on the monitor status timeline here.
        // https://oneuptime.com/reference/monitor-status-timeline
        {
            // Monitor Status Timeline Object
        },
        {
            // Monitor Status Timeline Object
        }
    ],
    "resourceGroups": [
        // You can find more details on the resource group here.
        // https://oneuptime.com/reference/resource-group
        {
            // Resource Group Object
        },
        {
            // Resource Group Object
        }
    ],
    "monitorStatuses": [
        // You can find more details on the monitor status here.
        // https://oneuptime.com/reference/monitor-status
        {
            // Monitor Status Object
        },
        {
            // Monitor Status Object
        }

    ],
    "statusPageResources": [
        // You can find more details on the status page resource here.
        // https://oneuptime.com/reference/status-page-resource
        {
            // Status Page Resource Object
        },
        {
            // Status Page Resource Object
        }
    ],
    "incidentStateTimelines": [
        // You can find more details on the incident state timeline here.
        // https://oneuptime.com/reference/incident-state-timeline
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
        // You can find more details on the scheduled maintenance state timeline here.
        // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
        {
            // Scheduled Maintenance State Timeline Object
        },
        {
            // Scheduled Maintenance State Timeline Object
        }
    ],
    "monitorGroupCurrentStatuses": {
        // Current Status of the monitor group. 
    },
    "monitorsInGroup": {
        // Monitors in the group.
    }
}
```

#### Uptime API

Deze API haalt de uptime op van alle resources op de statuspagina.

Om de algehele uptime van alle resources te krijgen, kunt u een POST-verzoek doen naar het volgende eindpunt:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Verzoeklichaam (optioneel):**

U kunt startDate en endDate als verzoeklichaam meesturen.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Deze datums mogen niet meer dan 90 dagen uit elkaar liggen. Als u geen datums opgeeft, retourneert de API de uptime voor de afgelopen 14 dagen.

**Voorbeeldrespons:**

Dit is de voorbeeldrespons van de API:

```json
{
    "statusPageResourceUptimes": [
        {
            "statusPageResourceId": {
                "_type": "ObjectID",
                "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
            },
            "uptimePercent": 99.98,
            "statusPageResourceName": "Status Page Resource Name",
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
            "statusPageGroupName": "Group Name",
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


### Incident API

Deze API haalt alle incidenten op die op de statuspagina staan. Om alle incidenten op de statuspagina te krijgen, kunt u een POST-verzoek doen naar het volgende eindpunt:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Dit is de respons van de API:

```json
{
    "incidents": [
        // You can find more details on the incident here.
        // https://oneuptime.com/reference/incident
        {
            // Incident Object
        },
        {
            // Incident Object
        }
    ]
}
```


### Gepland onderhoud API

Deze API haalt al het geplande onderhoud op dat op de statuspagina staat. Om al het geplande onderhoud op de statuspagina te krijgen, kunt u een POST-verzoek doen naar het volgende eindpunt:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Dit is de respons van de API:

```json
{
    "scheduledMaintenanceEvents": [
        // You can find more details on the scheduled maintenance event here.
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Scheduled Maintenance Event Object
        },
        {
            // Scheduled Maintenance Event Object
        }
    ]
}
```

### Aankondigingen API

Deze API haalt alle aankondigingen op die op de statuspagina staan. Om alle aankondigingen op de statuspagina te krijgen, kunt u een POST-verzoek doen naar het volgende eindpunt:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Dit is de respons van de API:

```json
{
    "announcements": [
        // You can find more details on the announcement here.
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Announcement Object
        },
        {
            // Announcement Object
        }
    ]
}
```
