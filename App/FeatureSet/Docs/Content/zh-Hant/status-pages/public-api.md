# 公共狀態頁面 API

以下是如何使用公共狀態頁面 API 獲取狀態頁面上資源狀態的方法。您只需向 API 端點發送 POST 請求即可。

#### 概覽 API

此 API 將獲取狀態頁面上的所有資源，包括資源的整體狀態、事件、維護等信息。

要獲取狀態頁面上資源的整體狀態，您可以向以下端點發送 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

以下是 API 的響應：

```json
{

    "overallStatus": 
        {   // 監控器狀態對象
            // 整體狀態是狀態頁面上所有監控器和組中最差的狀態。
            // 您可以在此處找到有關監控器狀態的更多詳細信息。
            // https://oneuptime.com/reference/monitor-status
            
        },
    "scheduledMaintenanceEventsPublicNotes": [
        // 您可以在此處找到有關計劃維護公開備註的更多詳細信息。
        // https://oneuptime.com/reference/scheduled-maintenance-public-note
        {
            // 計劃維護公開備註對象
        }, 
        {
            // 計劃維護公開備註對象
        }
    ],
    "statusPageHistoryChartBarColorRules": [
        // 您可以在此處找到有關狀態頁面歷史圖表條形顏色規則的更多詳細信息。
        // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
        {
            // 狀態頁面歷史圖表條形顏色規則對象
        },
        {
            // 狀態頁面歷史圖表條形顏色規則對象
        }
    ],
    "scheduledMaintenanceEvents": [
        // 您可以在此處找到有關計劃維護事件的更多詳細信息。
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // 計劃維護事件對象
        },
        {
            // 計劃維護事件對象
        }
    ],
    "activeAnnouncements": [
        // 您可以在此處找到有關活躍公告的更多詳細信息。
        // https://oneuptime.com/reference/status-page-announcement
        {
            // 狀態頁面公告對象
        },
        {
            // 狀態頁面公告對象
        }
    ],
    "incidentPublicNotes": [
        // 您可以在此處找到有關事件公開備註的更多詳細信息。
        // https://oneuptime.com/reference/incident-public-note
        {
            // 事件公開備註對象
        },
        {
            // 事件公開備註對象
        }
    ],
    "activeIncidents": [
        // 您可以在此處找到有關活躍事件的更多詳細信息。
        // https://oneuptime.com/reference/incident
        {
            // 事件對象
        },
        {
            // 事件對象
        }
    ],
    "monitorStatusTimelines": [
        // 您可以在此處找到有關監控器狀態時間線的更多詳細信息。
        // https://oneuptime.com/reference/monitor-status-timeline
        {
            // 監控器狀態時間線對象
        },
        {
            // 監控器狀態時間線對象
        }
    ],
    "resourceGroups": [
        // 您可以在此處找到有關資源組的更多詳細信息。
        // https://oneuptime.com/reference/resource-group
        {
            // 資源組對象
        },
        {
            // 資源組對象
        }
    ],
    "monitorStatuses": [
        // 您可以在此處找到有關監控器狀態的更多詳細信息。
        // https://oneuptime.com/reference/monitor-status
        {
            // 監控器狀態對象
        },
        {
            // 監控器狀態對象
        }

    ],
    "statusPageResources": [
        // 您可以在此處找到有關狀態頁面資源的更多詳細信息。
        // https://oneuptime.com/reference/status-page-resource
        {
            // 狀態頁面資源對象
        },
        {
            // 狀態頁面資源對象
        }
    ],
    "incidentStateTimelines": [
        // 您可以在此處找到有關事件狀態時間線的更多詳細信息。
        // https://oneuptime.com/reference/incident-state-timeline
        {
            // 事件狀態時間線對象
        },
        {
            // 事件狀態時間線對象
        }
    ],
    "statusPage": {
       // 您可以在此處找到有關狀態頁面的更多詳細信息。
         // https://oneuptime.com/reference/status-page
    },
    "scheduledMaintenanceStateTimelines": [
        // 您可以在此處找到有關計劃維護狀態時間線的更多詳細信息。
        // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
        {
            // 計劃維護狀態時間線對象
        },
        {
            // 計劃維護狀態時間線對象
        }
    ],
    "monitorGroupCurrentStatuses": {
        // 監控器組的當前狀態。
    },
    "monitorsInGroup": {
        // 組中的監控器。
    }
}
```

#### 正常運行時間 API

此 API 將獲取狀態頁面上所有資源的正常運行時間。

要獲取所有資源的整體正常運行時間，您可以向以下端點發送 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**請求體（可選）：**

您可以將 startDate 和 endDate 作爲請求體發送。

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

這些日期之間不應相差超過 90 天。如果您不提供日期，API 將返回過去 14 天的正常運行時間。

**示例響應：**

以下是 API 的示例響應：

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

此 API 將獲取狀態頁面上的所有事件。要獲取狀態頁面上的所有事件，您可以向以下端點發送 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

以下是 API 的響應：

```json
{
    "incidents": [
        // 您可以在此處找到有關事件的更多詳細信息。
        // https://oneuptime.com/reference/incident
        {
            // 事件對象
        },
        {
            // 事件對象
        }
    ]
}
```


### 計劃維護 API

此 API 將獲取狀態頁面上的所有計劃維護。要獲取狀態頁面上的所有計劃維護，您可以向以下端點發送 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

以下是 API 的響應：

```json
{
    "scheduledMaintenanceEvents": [
        // 您可以在此處找到有關計劃維護事件的更多詳細信息。
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // 計劃維護事件對象
        },
        {
            // 計劃維護事件對象
        }
    ]
}
```

### 公告 API

此 API 將獲取狀態頁面上的所有公告。要獲取狀態頁面上的所有公告，您可以向以下端點發送 POST 請求：

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

以下是 API 的響應：

```json
{
    "announcements": [
        // 您可以在此處找到有關公告的更多詳細信息。
        // https://oneuptime.com/reference/status-page-announcement
        {
            // 公告對象
        },
        {
            // 公告對象
        }
    ]
}
```
