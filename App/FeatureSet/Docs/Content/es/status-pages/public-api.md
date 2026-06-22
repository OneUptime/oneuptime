# API pública de la página de estado

Aquí tienes cómo puedes usar la API pública de la página de estado para obtener el estado de tus recursos que se encuentran en la página de estado. Todo lo que necesitas hacer es realizar una solicitud POST al punto de conexión de la API.

#### API de información general

Esta API obtendrá todos los recursos que se encuentran en la página de estado, incluyendo el estado general de los recursos, incidentes, mantenimiento y más.

Para obtener el estado general de los recursos en la página de estado, puedes realizar una solicitud POST al siguiente punto de conexión:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Esta es la respuesta de la API:

```json
{
  "overallStatus": {
    // Objeto de estado del monitor
    // El estado general es el peor estado de todos los monitores y grupos en la página de estado.
    // Puedes encontrar más detalles sobre el estado del monitor aquí.
    // https://oneuptime.com/reference/monitor-status
  },
  "scheduledMaintenanceEventsPublicNotes": [
    // Puedes encontrar más detalles sobre la nota pública de mantenimiento programado aquí.
    // https://oneuptime.com/reference/scheduled-maintenance-public-note
    {
      // Objeto de nota pública de mantenimiento programado
    },
    {
      // Objeto de nota pública de mantenimiento programado
    }
  ],
  "statusPageHistoryChartBarColorRules": [
    // Puedes encontrar más detalles sobre la regla de color de la barra del gráfico de historial de la página de estado aquí.
    // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
    {
      // Objeto de regla de color de la barra del gráfico de historial de la página de estado
    },
    {
      // Objeto de regla de color de la barra del gráfico de historial de la página de estado
    }
  ],
  "scheduledMaintenanceEvents": [
    // Puedes encontrar más detalles sobre el evento de mantenimiento programado aquí.
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // Objeto de evento de mantenimiento programado
    },
    {
      // Objeto de evento de mantenimiento programado
    }
  ],
  "activeAnnouncements": [
    // Puedes encontrar más detalles sobre el anuncio activo aquí.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Objeto de anuncio de la página de estado
    },
    {
      // Objeto de anuncio de la página de estado
    }
  ],
  "incidentPublicNotes": [
    // Puedes encontrar más detalles sobre la nota pública del incidente aquí.
    // https://oneuptime.com/reference/incident-public-note
    {
      // Objeto de nota pública del incidente
    },
    {
      // Objeto de nota pública del incidente
    }
  ],
  "activeIncidents": [
    // Puedes encontrar más detalles sobre el incidente activo aquí.
    // https://oneuptime.com/reference/incident
    {
      // Objeto de incidente
    },
    {
      // Objeto de incidente
    }
  ],
  "monitorStatusTimelines": [
    // Puedes encontrar más detalles sobre la línea de tiempo del estado del monitor aquí.
    // https://oneuptime.com/reference/monitor-status-timeline
    {
      // Objeto de línea de tiempo del estado del monitor
    },
    {
      // Objeto de línea de tiempo del estado del monitor
    }
  ],
  "resourceGroups": [
    // Puedes encontrar más detalles sobre el grupo de recursos aquí.
    // https://oneuptime.com/reference/resource-group
    {
      // Objeto de grupo de recursos
    },
    {
      // Objeto de grupo de recursos
    }
  ],
  "monitorStatuses": [
    // Puedes encontrar más detalles sobre el estado del monitor aquí.
    // https://oneuptime.com/reference/monitor-status
    {
      // Objeto de estado del monitor
    },
    {
      // Objeto de estado del monitor
    }
  ],
  "statusPageResources": [
    // Puedes encontrar más detalles sobre el recurso de la página de estado aquí.
    // https://oneuptime.com/reference/status-page-resource
    {
      // Objeto de recurso de la página de estado
    },
    {
      // Objeto de recurso de la página de estado
    }
  ],
  "incidentStateTimelines": [
    // Puedes encontrar más detalles sobre la línea de tiempo del estado del incidente aquí.
    // https://oneuptime.com/reference/incident-state-timeline
    {
      // Objeto de línea de tiempo del estado del incidente
    },
    {
      // Objeto de línea de tiempo del estado del incidente
    }
  ],
  "statusPage": {
    // Puedes encontrar más detalles sobre la página de estado aquí.
    // https://oneuptime.com/reference/status-page
  },
  "scheduledMaintenanceStateTimelines": [
    // Puedes encontrar más detalles sobre la línea de tiempo del estado del mantenimiento programado aquí.
    // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
    {
      // Objeto de línea de tiempo del estado del mantenimiento programado
    },
    {
      // Objeto de línea de tiempo del estado del mantenimiento programado
    }
  ],
  "monitorGroupCurrentStatuses": {
    // Estado actual del grupo de monitores.
  },
  "monitorsInGroup": {
    // Monitores en el grupo.
  }
}
```

#### API de tiempo de actividad

Esta API obtendrá el tiempo de actividad de todos los recursos en la página de estado.

Para obtener el tiempo de actividad general de todos los recursos, puedes realizar una solicitud POST al siguiente punto de conexión:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Cuerpo de la solicitud (opcional):**

Puedes enviar startDate y endDate como cuerpo de la solicitud.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Estas fechas no deben estar a más de 90 días de diferencia. Si no proporcionas las fechas, la API devolverá el tiempo de actividad de los últimos 14 días.

**Respuesta de ejemplo:**

Esta es la respuesta de ejemplo de la API:

```json
{
  "statusPageResourceUptimes": [
    {
      "statusPageResourceId": {
        "_type": "ObjectID",
        "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
      },
      "uptimePercent": 99.98,
      "statusPageResourceName": "Nombre del recurso de la página de estado",
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
      "statusPageGroupName": "Nombre del grupo",
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

### API de incidentes

Esta API obtendrá todos los incidentes que están en la página de estado. Para obtener todos los incidentes en la página de estado, puedes realizar una solicitud POST al siguiente punto de conexión:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Esta es la respuesta de la API:

```json
{
  "incidents": [
    // Puedes encontrar más detalles sobre el incidente aquí.
    // https://oneuptime.com/reference/incident
    {
      // Objeto de incidente
    },
    {
      // Objeto de incidente
    }
  ]
}
```

### API de mantenimiento programado

Esta API obtendrá todos los mantenimientos programados que están en la página de estado. Para obtener todos los mantenimientos programados en la página de estado, puedes realizar una solicitud POST al siguiente punto de conexión:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Esta es la respuesta de la API:

```json
{
  "scheduledMaintenanceEvents": [
    // Puedes encontrar más detalles sobre el evento de mantenimiento programado aquí.
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // Objeto de evento de mantenimiento programado
    },
    {
      // Objeto de evento de mantenimiento programado
    }
  ]
}
```

### API de anuncios

Esta API obtendrá todos los anuncios que están en la página de estado. Para obtener todos los anuncios en la página de estado, puedes realizar una solicitud POST al siguiente punto de conexión:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Esta es la respuesta de la API:

```json
{
  "announcements": [
    // Puedes encontrar más detalles sobre el anuncio aquí.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Objeto de anuncio
    },
    {
      // Objeto de anuncio
    }
  ]
}
```
