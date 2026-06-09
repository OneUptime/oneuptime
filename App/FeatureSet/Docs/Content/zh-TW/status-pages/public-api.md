# 公開狀態頁面 API

以下說明如何使用公開狀態頁面 API 取得狀態頁面上各項資源的狀態。您只需要向 API 端點發出 POST 請求即可。

#### 總覽 API

此 API 會擷取狀態頁面上的所有資源，包括資源的整體狀態、事件、維護作業等。

若要取得狀態頁面上各項資源的整體狀態，您可以向以下端點發出 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

這是 API 的回應：

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

#### 運作時間 API

此 API 會擷取狀態頁面上所有資源的運作時間。

若要取得所有資源的整體運作時間，您可以向以下端點發出 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**請求主體（選填）：**

您可以將 startDate 與 endDate 作為請求主體傳送。

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

這些日期之間的間隔不應超過 90 天。如果您未提供日期，API 將會回傳過去 14 天的運作時間。

**範例回應：**

這是 API 的範例回應：

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


### 事件 API

此 API 會擷取狀態頁面上的所有事件。若要取得狀態頁面上的所有事件，您可以向以下端點發出 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

這是 API 的回應：

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


### 排程維護 API

此 API 會擷取狀態頁面上的所有排程維護作業。若要取得狀態頁面上的所有排程維護作業，您可以向以下端點發出 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

這是 API 的回應：

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

### 公告 API

此 API 會擷取狀態頁面上的所有公告。若要取得狀態頁面上的所有公告，您可以向以下端點發出 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

這是 API 的回應：

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
