# API Pública de Página de Status

Veja como usar a API Pública de Página de Status para obter o status dos seus recursos que estão na Página de Status. Tudo o que você precisa fazer é fazer uma requisição POST para o endpoint da API.

#### API de Visão Geral

Esta API buscará todos os recursos que estão na página de status, incluindo o status geral dos recursos, incidentes, manutenções e mais.

Para obter o status geral dos recursos na página de status, você pode fazer uma requisição POST para o seguinte endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Esta é a resposta da API:

```json
{
  "overallStatus": {
    // Monitor Status Object
    // O Status Geral é o pior status de todos os monitores e grupos na página de status.
    // Você pode encontrar mais detalhes sobre o status do monitor aqui.
    // https://oneuptime.com/reference/monitor-status
  },
  "scheduledMaintenanceEventsPublicNotes": [
    // Você pode encontrar mais detalhes sobre a nota pública de manutenção programada aqui.
    // https://oneuptime.com/reference/scheduled-maintenance-public-note
    {
      // Scheduled Maintenance Public Note Object
    },
    {
      // Scheduled Maintenance Public Note Object
    }
  ],
  "statusPageHistoryChartBarColorRules": [
    // Você pode encontrar mais detalhes sobre a regra de cor da barra do gráfico de histórico da página de status aqui.
    // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
    {
      // Status Page History Chart Bar Color Rule Object
    },
    {
      // Status Page History Chart Bar Color Rule Object
    }
  ],
  "scheduledMaintenanceEvents": [
    // Você pode encontrar mais detalhes sobre o evento de manutenção programada aqui.
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // Scheduled Maintenance Event Object
    },
    {
      // Scheduled Maintenance Event Object
    }
  ],
  "activeAnnouncements": [
    // Você pode encontrar mais detalhes sobre o anúncio ativo aqui.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Status Page Announcement Object
    },
    {
      // Status Page Announcement Object
    }
  ],
  "incidentPublicNotes": [
    // Você pode encontrar mais detalhes sobre a nota pública de incidente aqui.
    // https://oneuptime.com/reference/incident-public-note
    {
      // Incident Public Note Object
    },
    {
      // Incident Public Note Object
    }
  ],
  "activeIncidents": [
    // Você pode encontrar mais detalhes sobre o incidente ativo aqui.
    // https://oneuptime.com/reference/incident
    {
      // Incident Object
    },
    {
      // Incident Object
    }
  ],
  "monitorStatusTimelines": [
    // Você pode encontrar mais detalhes sobre a linha do tempo do status do monitor aqui.
    // https://oneuptime.com/reference/monitor-status-timeline
    {
      // Monitor Status Timeline Object
    },
    {
      // Monitor Status Timeline Object
    }
  ],
  "resourceGroups": [
    // Você pode encontrar mais detalhes sobre o grupo de recursos aqui.
    // https://oneuptime.com/reference/resource-group
    {
      // Resource Group Object
    },
    {
      // Resource Group Object
    }
  ],
  "monitorStatuses": [
    // Você pode encontrar mais detalhes sobre o status do monitor aqui.
    // https://oneuptime.com/reference/monitor-status
    {
      // Monitor Status Object
    },
    {
      // Monitor Status Object
    }
  ],
  "statusPageResources": [
    // Você pode encontrar mais detalhes sobre o recurso da página de status aqui.
    // https://oneuptime.com/reference/status-page-resource
    {
      // Status Page Resource Object
    },
    {
      // Status Page Resource Object
    }
  ],
  "incidentStateTimelines": [
    // Você pode encontrar mais detalhes sobre a linha do tempo do estado do incidente aqui.
    // https://oneuptime.com/reference/incident-state-timeline
    {
      // Incident State Timeline Object
    },
    {
      // Incident State Timeline Object
    }
  ],
  "statusPage": {
    // Você pode encontrar mais detalhes sobre a página de status aqui.
    // https://oneuptime.com/reference/status-page
  },
  "scheduledMaintenanceStateTimelines": [
    // Você pode encontrar mais detalhes sobre a linha do tempo do estado de manutenção programada aqui.
    // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
    {
      // Scheduled Maintenance State Timeline Object
    },
    {
      // Scheduled Maintenance State Timeline Object
    }
  ],
  "monitorGroupCurrentStatuses": {
    // Status Atual do grupo de monitores.
  },
  "monitorsInGroup": {
    // Monitores no grupo.
  }
}
```

#### API de Uptime

Esta API buscará todo o uptime de todos os recursos na página de status.

Para obter o uptime geral de todos os recursos, você pode fazer uma requisição POST para o seguinte endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Corpo da Requisição (opcional):**

Você pode enviar startDate e endDate como corpo da requisição.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Essas datas não devem ter mais de 90 dias de diferença. Se você não fornecer as datas, a API retornará o uptime dos últimos 14 dias.

**Exemplo de Resposta:**

Este é o exemplo de resposta da API:

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

### API de Incidentes

Esta API buscará todos os incidentes que estão na página de status. Para obter todos os incidentes na página de status, você pode fazer uma requisição POST para o seguinte endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Esta é a resposta da API:

```json
{
  "incidents": [
    // Você pode encontrar mais detalhes sobre o incidente aqui.
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

### API de Manutenção Programada

Esta API buscará todas as manutenções programadas que estão na página de status. Para obter todas as manutenções programadas na página de status, você pode fazer uma requisição POST para o seguinte endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Esta é a resposta da API:

```json
{
  "scheduledMaintenanceEvents": [
    // Você pode encontrar mais detalhes sobre o evento de manutenção programada aqui.
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

### API de Anúncios

Esta API buscará todos os anúncios que estão na página de status. Para obter todos os anúncios na página de status, você pode fazer uma requisição POST para o seguinte endpoint:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Esta é a resposta da API:

```json
{
  "announcements": [
    // Você pode encontrar mais detalhes sobre o anúncio aqui.
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
