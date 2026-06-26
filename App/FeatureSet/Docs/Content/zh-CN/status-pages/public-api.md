# 公共状态页面 API

以下是如何使用公共状态页面 API 获取状态页面上资源状态的方法。您只需向 API 端点发送 POST 请求即可。

#### 概览 API

此 API 将获取状态页面上的所有资源，包括资源的整体状态、事件、维护等信息。

要获取状态页面上资源的整体状态，您可以向以下端点发送 POST 请求：

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

以下是 API 的响应：

```json
{
  "overallStatus": {
    // 监控器状态对象
    // 整体状态是状态页面上所有监控器和组中最差的状态。
    // 您可以在此处找到有关监控器状态的更多详细信息。
    // https://oneuptime.com/reference/monitor-status
  },
  "scheduledMaintenanceEventsPublicNotes": [
    // 您可以在此处找到有关计划维护公开备注的更多详细信息。
    // https://oneuptime.com/reference/scheduled-maintenance-public-note
    {
      // 计划维护公开备注对象
    },
    {
      // 计划维护公开备注对象
    }
  ],
  "statusPageHistoryChartBarColorRules": [
    // 您可以在此处找到有关状态页面历史图表条形颜色规则的更多详细信息。
    // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
    {
      // 状态页面历史图表条形颜色规则对象
    },
    {
      // 状态页面历史图表条形颜色规则对象
    }
  ],
  "scheduledMaintenanceEvents": [
    // 您可以在此处找到有关计划维护事件的更多详细信息。
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // 计划维护事件对象
    },
    {
      // 计划维护事件对象
    }
  ],
  "activeAnnouncements": [
    // 您可以在此处找到有关活跃公告的更多详细信息。
    // https://oneuptime.com/reference/status-page-announcement
    {
      // 状态页面公告对象
    },
    {
      // 状态页面公告对象
    }
  ],
  "incidentPublicNotes": [
    // 您可以在此处找到有关事件公开备注的更多详细信息。
    // https://oneuptime.com/reference/incident-public-note
    {
      // 事件公开备注对象
    },
    {
      // 事件公开备注对象
    }
  ],
  "activeIncidents": [
    // 您可以在此处找到有关活跃事件的更多详细信息。
    // https://oneuptime.com/reference/incident
    {
      // 事件对象
    },
    {
      // 事件对象
    }
  ],
  "monitorStatusTimelines": [
    // 您可以在此处找到有关监控器状态时间线的更多详细信息。
    // https://oneuptime.com/reference/monitor-status-timeline
    {
      // 监控器状态时间线对象
    },
    {
      // 监控器状态时间线对象
    }
  ],
  "resourceGroups": [
    // 您可以在此处找到有关资源组的更多详细信息。
    // https://oneuptime.com/reference/resource-group
    {
      // 资源组对象
    },
    {
      // 资源组对象
    }
  ],
  "monitorStatuses": [
    // 您可以在此处找到有关监控器状态的更多详细信息。
    // https://oneuptime.com/reference/monitor-status
    {
      // 监控器状态对象
    },
    {
      // 监控器状态对象
    }
  ],
  "statusPageResources": [
    // 您可以在此处找到有关状态页面资源的更多详细信息。
    // https://oneuptime.com/reference/status-page-resource
    {
      // 状态页面资源对象
    },
    {
      // 状态页面资源对象
    }
  ],
  "incidentStateTimelines": [
    // 您可以在此处找到有关事件状态时间线的更多详细信息。
    // https://oneuptime.com/reference/incident-state-timeline
    {
      // 事件状态时间线对象
    },
    {
      // 事件状态时间线对象
    }
  ],
  "statusPage": {
    // 您可以在此处找到有关状态页面的更多详细信息。
    // https://oneuptime.com/reference/status-page
  },
  "scheduledMaintenanceStateTimelines": [
    // 您可以在此处找到有关计划维护状态时间线的更多详细信息。
    // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
    {
      // 计划维护状态时间线对象
    },
    {
      // 计划维护状态时间线对象
    }
  ],
  "monitorGroupCurrentStatuses": {
    // 监控器组的当前状态。
  },
  "monitorsInGroup": {
    // 组中的监控器。
  }
}
```

#### 正常运行时间 API

此 API 将获取状态页面上所有资源的正常运行时间。

要获取所有资源的整体正常运行时间，您可以向以下端点发送 POST 请求：

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**请求体（可选）：**

您可以将 startDate 和 endDate 作为请求体发送。

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

这些日期之间不应相差超过 90 天。如果您不提供日期，API 将返回过去 14 天的正常运行时间。

**示例响应：**

以下是 API 的示例响应：

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

此 API 将获取状态页面上的所有事件。要获取状态页面上的所有事件，您可以向以下端点发送 POST 请求：

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

以下是 API 的响应：

```json
{
  "incidents": [
    // 您可以在此处找到有关事件的更多详细信息。
    // https://oneuptime.com/reference/incident
    {
      // 事件对象
    },
    {
      // 事件对象
    }
  ]
}
```

### 计划维护 API

此 API 将获取状态页面上的所有计划维护。要获取状态页面上的所有计划维护，您可以向以下端点发送 POST 请求：

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

以下是 API 的响应：

```json
{
  "scheduledMaintenanceEvents": [
    // 您可以在此处找到有关计划维护事件的更多详细信息。
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // 计划维护事件对象
    },
    {
      // 计划维护事件对象
    }
  ]
}
```

### 公告 API

此 API 将获取状态页面上的所有公告。要获取状态页面上的所有公告，您可以向以下端点发送 POST 请求：

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

以下是 API 的响应：

```json
{
  "announcements": [
    // 您可以在此处找到有关公告的更多详细信息。
    // https://oneuptime.com/reference/status-page-announcement
    {
      // 公告对象
    },
    {
      // 公告对象
    }
  ]
}
```
