# Публичный API страниц статуса

Ниже описано, как использовать публичный API страниц статуса для получения состояния ресурсов, отображаемых на странице статуса. Для этого необходимо выполнить POST-запрос к конечной точке API.

#### API обзора

Этот API возвращает все ресурсы, размещённые на странице статуса, включая общий статус ресурсов, инциденты, плановые работы и многое другое.

Для получения общего статуса ресурсов на странице статуса выполните POST-запрос к следующей конечной точке:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Ответ API: 

```json
{

    "overallStatus": 
        {   // Объект статуса монитора
            // Общий статус — наихудший из всех мониторов и групп на странице статуса. 
            // Подробнее об объекте статуса монитора:
            // https://oneuptime.com/reference/monitor-status
            
        },
    "scheduledMaintenanceEventsPublicNotes": [
        // Подробнее об объекте публичной заметки планового обслуживания:
        // https://oneuptime.com/reference/scheduled-maintenance-public-note
        {
            // Объект публичной заметки планового обслуживания
        }, 
        {
            // Объект публичной заметки планового обслуживания
        }
    ],
    "statusPageHistoryChartBarColorRules": [
        // Подробнее об объекте правила цвета столбца диаграммы истории страницы статуса:
        // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
        {
            // Объект правила цвета столбца диаграммы истории
        },
        {
            // Объект правила цвета столбца диаграммы истории
        }
    ],
    "scheduledMaintenanceEvents": [
        // Подробнее об объекте события планового обслуживания:
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Объект события планового обслуживания
        },
        {
            // Объект события планового обслуживания
        }
    ],
    "activeAnnouncements": [
        // Подробнее об объекте активного объявления:
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Объект объявления страницы статуса
        },
        {
            // Объект объявления страницы статуса
        }
    ],
    "incidentPublicNotes": [
        // Подробнее об объекте публичной заметки инцидента:
        // https://oneuptime.com/reference/incident-public-note
        {
            // Объект публичной заметки инцидента
        },
        {
            // Объект публичной заметки инцидента
        }
    ],
    "activeIncidents": [
        // Подробнее об объекте инцидента:
        // https://oneuptime.com/reference/incident
        {
            // Объект инцидента
        },
        {
            // Объект инцидента
        }
    ],
    "monitorStatusTimelines": [
        // Подробнее об объекте временной шкалы статуса монитора:
        // https://oneuptime.com/reference/monitor-status-timeline
        {
            // Объект временной шкалы статуса монитора
        },
        {
            // Объект временной шкалы статуса монитора
        }
    ],
    "resourceGroups": [
        // Подробнее об объекте группы ресурсов:
        // https://oneuptime.com/reference/resource-group
        {
            // Объект группы ресурсов
        },
        {
            // Объект группы ресурсов
        }
    ],
    "monitorStatuses": [
        // Подробнее об объекте статуса монитора:
        // https://oneuptime.com/reference/monitor-status
        {
            // Объект статуса монитора
        },
        {
            // Объект статуса монитора
        }

    ],
    "statusPageResources": [
        // Подробнее об объекте ресурса страницы статуса:
        // https://oneuptime.com/reference/status-page-resource
        {
            // Объект ресурса страницы статуса
        },
        {
            // Объект ресурса страницы статуса
        }
    ],
    "incidentStateTimelines": [
        // Подробнее об объекте временной шкалы состояния инцидента:
        // https://oneuptime.com/reference/incident-state-timeline
        {
            // Объект временной шкалы состояния инцидента
        },
        {
            // Объект временной шкалы состояния инцидента
        }
    ],
    "statusPage": {
       // Подробнее об объекте страницы статуса:
         // https://oneuptime.com/reference/status-page
    },
    "scheduledMaintenanceStateTimelines": [
        // Подробнее об объекте временной шкалы состояния планового обслуживания:
        // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
        {
            // Объект временной шкалы состояния планового обслуживания
        },
        {
            // Объект временной шкалы состояния планового обслуживания
        }
    ],
    "monitorGroupCurrentStatuses": {
        // Текущий статус группы мониторов. 
    },
    "monitorsInGroup": {
        // Мониторы в группе.
    }
}
```

#### API доступности

Этот API возвращает доступность всех ресурсов на странице статуса.

Для получения общей доступности всех ресурсов выполните POST-запрос к следующей конечной точке:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Тело запроса (необязательно):**

Можно передать `startDate` и `endDate` в теле запроса. 

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Даты не должны отличаться более чем на 90 дней. Если даты не указаны, API вернёт доступность за последние 14 дней.

**Пример ответа:**

```json
{
    "statusPageResourceUptimes": [
        {
            "statusPageResourceId": {
                "_type": "ObjectID",
                "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
            },
            "uptimePercent": 99.98,
            "statusPageResourceName": "Название ресурса страницы статуса",
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
            "statusPageGroupName": "Название группы",
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


### API инцидентов

Этот API возвращает все инциденты на странице статуса. Для получения всех инцидентов выполните POST-запрос к следующей конечной точке:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Ответ API: 

```json
{
    "incidents": [
        // Подробнее об объекте инцидента:
        // https://oneuptime.com/reference/incident
        {
            // Объект инцидента
        },
        {
            // Объект инцидента
        }
    ]
}
```


### API плановых работ

Этот API возвращает все плановые работы на странице статуса. Для получения всех плановых работ выполните POST-запрос к следующей конечной точке:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Ответ API: 

```json
{
    "scheduledMaintenanceEvents": [
        // Подробнее об объекте события планового обслуживания:
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Объект события планового обслуживания
        },
        {
            // Объект события планового обслуживания
        }
    ]
}
```

### API объявлений

Этот API возвращает все объявления на странице статуса. Для получения всех объявлений выполните POST-запрос к следующей конечной точке:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Ответ API: 

```json
{
    "announcements": [
        // Подробнее об объекте объявления:
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Объект объявления
        },
        {
            // Объект объявления
        }
    ]
}
```
