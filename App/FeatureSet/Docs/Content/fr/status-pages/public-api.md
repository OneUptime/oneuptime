# API publique de page de statut

Voici comment vous pouvez utiliser l'API publique de page de statut pour obtenir le statut de vos ressources figurant sur la page de statut. Il vous suffit d'effectuer une requête POST vers le point d'accès de l'API.

#### API de vue d'ensemble

Cette API récupère toutes les ressources figurant sur la page de statut, y compris le statut global des ressources, les incidents, les maintenances, et plus encore.

Pour obtenir le statut global des ressources sur la page de statut, vous pouvez effectuer une requête POST vers le point d'accès suivant :

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Voici la réponse de l'API :

```json
{
  "overallStatus": {
    // Objet de statut du moniteur
    // Le statut global est le pire statut de tous les moniteurs et groupes sur la page de statut.
    // Vous pouvez trouver plus de détails sur le statut du moniteur ici.
    // https://oneuptime.com/reference/monitor-status
  },
  "scheduledMaintenanceEventsPublicNotes": [
    // Vous pouvez trouver plus de détails sur la note publique de maintenance planifiée ici.
    // https://oneuptime.com/reference/scheduled-maintenance-public-note
    {
      // Objet de note publique de maintenance planifiée
    },
    {
      // Objet de note publique de maintenance planifiée
    }
  ],
  "statusPageHistoryChartBarColorRules": [
    // Vous pouvez trouver plus de détails sur la règle de couleur de barre du graphique d'historique de la page de statut ici.
    // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
    {
      // Objet de règle de couleur de barre du graphique d'historique de la page de statut
    },
    {
      // Objet de règle de couleur de barre du graphique d'historique de la page de statut
    }
  ],
  "scheduledMaintenanceEvents": [
    // Vous pouvez trouver plus de détails sur l'événement de maintenance planifiée ici.
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // Objet d'événement de maintenance planifiée
    },
    {
      // Objet d'événement de maintenance planifiée
    }
  ],
  "activeAnnouncements": [
    // Vous pouvez trouver plus de détails sur l'annonce active ici.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Objet d'annonce de la page de statut
    },
    {
      // Objet d'annonce de la page de statut
    }
  ],
  "incidentPublicNotes": [
    // Vous pouvez trouver plus de détails sur la note publique d'incident ici.
    // https://oneuptime.com/reference/incident-public-note
    {
      // Objet de note publique d'incident
    },
    {
      // Objet de note publique d'incident
    }
  ],
  "activeIncidents": [
    // Vous pouvez trouver plus de détails sur l'incident actif ici.
    // https://oneuptime.com/reference/incident
    {
      // Objet d'incident
    },
    {
      // Objet d'incident
    }
  ],
  "monitorStatusTimelines": [
    // Vous pouvez trouver plus de détails sur la chronologie du statut du moniteur ici.
    // https://oneuptime.com/reference/monitor-status-timeline
    {
      // Objet de chronologie du statut du moniteur
    },
    {
      // Objet de chronologie du statut du moniteur
    }
  ],
  "resourceGroups": [
    // Vous pouvez trouver plus de détails sur le groupe de ressources ici.
    // https://oneuptime.com/reference/resource-group
    {
      // Objet de groupe de ressources
    },
    {
      // Objet de groupe de ressources
    }
  ],
  "monitorStatuses": [
    // Vous pouvez trouver plus de détails sur le statut du moniteur ici.
    // https://oneuptime.com/reference/monitor-status
    {
      // Objet de statut du moniteur
    },
    {
      // Objet de statut du moniteur
    }
  ],
  "statusPageResources": [
    // Vous pouvez trouver plus de détails sur la ressource de la page de statut ici.
    // https://oneuptime.com/reference/status-page-resource
    {
      // Objet de ressource de la page de statut
    },
    {
      // Objet de ressource de la page de statut
    }
  ],
  "incidentStateTimelines": [
    // Vous pouvez trouver plus de détails sur la chronologie d'état d'incident ici.
    // https://oneuptime.com/reference/incident-state-timeline
    {
      // Objet de chronologie d'état d'incident
    },
    {
      // Objet de chronologie d'état d'incident
    }
  ],
  "statusPage": {
    // Vous pouvez trouver plus de détails sur la page de statut ici.
    // https://oneuptime.com/reference/status-page
  },
  "scheduledMaintenanceStateTimelines": [
    // Vous pouvez trouver plus de détails sur la chronologie d'état de maintenance planifiée ici.
    // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
    {
      // Objet de chronologie d'état de maintenance planifiée
    },
    {
      // Objet de chronologie d'état de maintenance planifiée
    }
  ],
  "monitorGroupCurrentStatuses": {
    // Statut actuel du groupe de moniteurs.
  },
  "monitorsInGroup": {
    // Moniteurs dans le groupe.
  }
}
```

#### API de disponibilité

Cette API récupère la disponibilité de toutes les ressources sur la page de statut.

Pour obtenir la disponibilité globale de toutes les ressources, vous pouvez effectuer une requête POST vers le point d'accès suivant :

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Corps de la requête (optionnel) :**

Vous pouvez envoyer startDate et endDate dans le corps de la requête.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Ces dates ne doivent pas être séparées de plus de 90 jours. Si vous ne fournissez pas les dates, l'API retournera la disponibilité des 14 derniers jours.

**Exemple de réponse :**

Voici l'exemple de réponse de l'API :

```json
{
  "statusPageResourceUptimes": [
    {
      "statusPageResourceId": {
        "_type": "ObjectID",
        "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
      },
      "uptimePercent": 99.98,
      "statusPageResourceName": "Nom de la ressource de la page de statut",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "isPermissionIf": {},
        "name": "Opérationnel",
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
            "name": "Opérationnel",
            "color": {
              "_type": "Color",
              "value": "#2ab57d"
            },
            "isOperationalState": true,
            "priority": 1
          }
        }
      ],
      "statusPageGroupName": "Nom du groupe",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "isPermissionIf": {},
        "name": "Opérationnel",
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

### API des incidents

Cette API récupère tous les incidents figurant sur la page de statut. Pour obtenir tous les incidents sur la page de statut, vous pouvez effectuer une requête POST vers le point d'accès suivant :

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Voici la réponse de l'API :

```json
{
  "incidents": [
    // Vous pouvez trouver plus de détails sur l'incident ici.
    // https://oneuptime.com/reference/incident
    {
      // Objet d'incident
    },
    {
      // Objet d'incident
    }
  ]
}
```

### API de maintenance planifiée

Cette API récupère toutes les maintenances planifiées figurant sur la page de statut. Pour obtenir toutes les maintenances planifiées sur la page de statut, vous pouvez effectuer une requête POST vers le point d'accès suivant :

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Voici la réponse de l'API :

```json
{
  "scheduledMaintenanceEvents": [
    // Vous pouvez trouver plus de détails sur l'événement de maintenance planifiée ici.
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // Objet d'événement de maintenance planifiée
    },
    {
      // Objet d'événement de maintenance planifiée
    }
  ]
}
```

### API des annonces

Cette API récupère toutes les annonces figurant sur la page de statut. Pour obtenir toutes les annonces sur la page de statut, vous pouvez effectuer une requête POST vers le point d'accès suivant :

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Voici la réponse de l'API :

```json
{
  "announcements": [
    // Vous pouvez trouver plus de détails sur l'annonce ici.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Objet d'annonce
    },
    {
      // Objet d'annonce
    }
  ]
}
```
