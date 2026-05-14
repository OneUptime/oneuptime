# API Pubblica della Pagina di Stato

Ecco come usare l'API Pubblica della Pagina di Stato per ottenere lo stato delle risorse presenti nella Pagina di Stato. È sufficiente effettuare una richiesta POST all'endpoint API.

#### API Panoramica

Questa API recupera tutte le risorse presenti nella pagina di stato, incluso lo stato complessivo delle risorse, gli incidenti, le manutenzioni e altro ancora.

Per ottenere lo stato complessivo delle risorse nella pagina di stato, è possibile effettuare una richiesta POST al seguente endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Questa è la risposta dell'API: 

```json
{

    "overallStatus": 
        {   // Oggetto Stato Monitor
            // Lo Stato Complessivo è il peggior stato di tutti i monitor e i gruppi nella pagina di stato. 
            // Ulteriori dettagli sullo stato del monitor sono disponibili qui.
            // https://oneuptime.com/reference/monitor-status
            
        },
    "scheduledMaintenanceEventsPublicNotes": [
        // Ulteriori dettagli sulla nota pubblica della manutenzione programmata sono disponibili qui.
        // https://oneuptime.com/reference/scheduled-maintenance-public-note
        {
            // Oggetto Nota Pubblica Manutenzione Programmata
        }, 
        {
            // Oggetto Nota Pubblica Manutenzione Programmata
        }
    ],
    "statusPageHistoryChartBarColorRules": [
        // Ulteriori dettagli sulla regola colore barra grafico cronologia pagina di stato sono disponibili qui.
        // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
        {
            // Oggetto Regola Colore Barra Grafico Cronologia Pagina di Stato
        },
        {
            // Oggetto Regola Colore Barra Grafico Cronologia Pagina di Stato
        }
    ],
    "scheduledMaintenanceEvents": [
        // Ulteriori dettagli sull'evento di manutenzione programmata sono disponibili qui.
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Oggetto Evento Manutenzione Programmata
        },
        {
            // Oggetto Evento Manutenzione Programmata
        }
    ],
    "activeAnnouncements": [
        // Ulteriori dettagli sull'annuncio attivo sono disponibili qui.
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Oggetto Annuncio Pagina di Stato
        },
        {
            // Oggetto Annuncio Pagina di Stato
        }
    ],
    "incidentPublicNotes": [
        // Ulteriori dettagli sulla nota pubblica dell'incidente sono disponibili qui.
        // https://oneuptime.com/reference/incident-public-note
        {
            // Oggetto Nota Pubblica Incidente
        },
        {
            // Oggetto Nota Pubblica Incidente
        }
    ],
    "activeIncidents": [
        // Ulteriori dettagli sull'incidente attivo sono disponibili qui.
        // https://oneuptime.com/reference/incident
        {
            // Oggetto Incidente
        },
        {
            // Oggetto Incidente
        }
    ],
    "monitorStatusTimelines": [
        // Ulteriori dettagli sulla cronologia dello stato del monitor sono disponibili qui.
        // https://oneuptime.com/reference/monitor-status-timeline
        {
            // Oggetto Cronologia Stato Monitor
        },
        {
            // Oggetto Cronologia Stato Monitor
        }
    ],
    "resourceGroups": [
        // Ulteriori dettagli sul gruppo di risorse sono disponibili qui.
        // https://oneuptime.com/reference/resource-group
        {
            // Oggetto Gruppo di Risorse
        },
        {
            // Oggetto Gruppo di Risorse
        }
    ],
    "monitorStatuses": [
        // Ulteriori dettagli sullo stato del monitor sono disponibili qui.
        // https://oneuptime.com/reference/monitor-status
        {
            // Oggetto Stato Monitor
        },
        {
            // Oggetto Stato Monitor
        }

    ],
    "statusPageResources": [
        // Ulteriori dettagli sulla risorsa della pagina di stato sono disponibili qui.
        // https://oneuptime.com/reference/status-page-resource
        {
            // Oggetto Risorsa Pagina di Stato
        },
        {
            // Oggetto Risorsa Pagina di Stato
        }
    ],
    "incidentStateTimelines": [
        // Ulteriori dettagli sulla cronologia dello stato dell'incidente sono disponibili qui.
        // https://oneuptime.com/reference/incident-state-timeline
        {
            // Oggetto Cronologia Stato Incidente
        },
        {
            // Oggetto Cronologia Stato Incidente
        }
    ],
    "statusPage": {
       // Ulteriori dettagli sulla pagina di stato sono disponibili qui.
         // https://oneuptime.com/reference/status-page
    },
    "scheduledMaintenanceStateTimelines": [
        // Ulteriori dettagli sulla cronologia dello stato della manutenzione programmata sono disponibili qui.
        // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
        {
            // Oggetto Cronologia Stato Manutenzione Programmata
        },
        {
            // Oggetto Cronologia Stato Manutenzione Programmata
        }
    ],
    "monitorGroupCurrentStatuses": {
        // Stato corrente del gruppo di monitor. 
    },
    "monitorsInGroup": {
        // Monitor nel gruppo.
    }
}
```

#### API Uptime

Questa API recupera l'uptime di tutte le risorse nella pagina di stato.

Per ottenere l'uptime complessivo di tutte le risorse, è possibile effettuare una richiesta POST al seguente endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Corpo Richiesta (opzionale):**

È possibile inviare startDate e endDate nel corpo della richiesta. 

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Queste date non devono essere distanziate di più di 90 giorni. Se non si forniscono le date, l'API restituirà l'uptime degli ultimi 14 giorni.

**Risposta di Esempio:**

Questa è la risposta di esempio dall'API: 

```json
{
    "statusPageResourceUptimes": [
        {
            "statusPageResourceId": {
                "_type": "ObjectID",
                "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
            },
            "uptimePercent": 99.98,
            "statusPageResourceName": "Nome Risorsa Pagina di Stato",
            "currentStatus": {
                "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
                "isPermissionIf": {},
                "name": "Operativo",
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
                        "name": "Operativo",
                        "color": {
                            "_type": "Color",
                            "value": "#2ab57d"
                        },
                        "isOperationalState": true,
                        "priority": 1
                    }
                }
            ],
            "statusPageGroupName": "Nome Gruppo",
            "currentStatus": {
                "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
                "isPermissionIf": {},
                "name": "Operativo",
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


### API Incidenti

Questa API recupera tutti gli incidenti presenti nella pagina di stato. Per ottenere tutti gli incidenti nella pagina di stato, è possibile effettuare una richiesta POST al seguente endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Questa è la risposta dell'API: 

```json
{
    "incidents": [
        // Ulteriori dettagli sull'incidente sono disponibili qui.
        // https://oneuptime.com/reference/incident
        {
            // Oggetto Incidente
        },
        {
            // Oggetto Incidente
        }
    ]
}
```


### API Manutenzioni Programmate

Questa API recupera tutte le manutenzioni programmate presenti nella pagina di stato. Per ottenerle, è possibile effettuare una richiesta POST al seguente endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Questa è la risposta dell'API: 

```json
{
    "scheduledMaintenanceEvents": [
        // Ulteriori dettagli sull'evento di manutenzione programmata sono disponibili qui.
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Oggetto Evento Manutenzione Programmata
        },
        {
            // Oggetto Evento Manutenzione Programmata
        }
    ]
}
```

### API Annunci

Questa API recupera tutti gli annunci presenti nella pagina di stato. Per ottenerli, è possibile effettuare una richiesta POST al seguente endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Questa è la risposta dell'API: 

```json
{
    "announcements": [
        // Ulteriori dettagli sull'annuncio sono disponibili qui.
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Oggetto Annuncio
        },
        {
            // Oggetto Annuncio
        }
    ]
}
```
