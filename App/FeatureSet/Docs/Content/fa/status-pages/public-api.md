# API عمومی صفحه وضعیت

این‌گونه می‌توانید از API عمومی صفحه وضعیت برای گرفتن وضعیت منابعی که روی صفحه وضعیت‌اند استفاده کنید. تنها کاری که لازم است بکنید یک درخواست POST به نقطه پایانی API است.

## API نمای کلی

این API همه منابع روی صفحه وضعیت را می‌گیرد، از جمله وضعیت کلی منابع، حادثه‌ها، نگهداری و بیشتر.

برای گرفتن وضعیت کلی منابع روی صفحه وضعیت، می‌توانید درخواستی POST به نقطه پایانی زیر بفرستید:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

این پاسخ API است:

```json
{
  "overallStatus": {
    // Monitor Status Object
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

## API آپ‌تایم

این API آپ‌تایم همه منابع روی صفحه وضعیت را می‌گیرد.

برای گرفتن آپ‌تایم کلی همه منابع، می‌توانید درخواستی POST به نقطه پایانی زیر بفرستید:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**بدنه درخواست (اختیاری):**

می‌توانید startDate و endDate را به‌عنوان بدنه درخواست بفرستید.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

فاصله این تاریخ‌ها نباید بیش از ۹۰ روز باشد. اگر تاریخ‌ها را ندهید، API آپ‌تایم ۱۴ روز گذشته را برمی‌گرداند.

**نمونه پاسخ:**

این نمونه پاسخ API است:

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

## API حادثه

این API همه حادثه‌های روی صفحه وضعیت را می‌گیرد. برای گرفتن همه حادثه‌های روی صفحه وضعیت، می‌توانید درخواستی POST به نقطه پایانی زیر بفرستید:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

این پاسخ API است:

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

## API نگهداری زمان‌بندی‌شده

این API همه نگهداری‌های زمان‌بندی‌شده روی صفحه وضعیت را می‌گیرد. برای گرفتن همه نگهداری‌های زمان‌بندی‌شده روی صفحه وضعیت، می‌توانید درخواستی POST به نقطه پایانی زیر بفرستید:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

این پاسخ API است:

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

## API اعلامیه‌ها

این API همه اعلامیه‌های روی صفحه وضعیت را می‌گیرد. برای گرفتن همه اعلامیه‌های روی صفحه وضعیت، می‌توانید درخواستی POST به نقطه پایانی زیر بفرستید:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

این پاسخ API است:

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

## در ادامه چه بخوانیم

- [نمای کلی صفحه‌های وضعیت](/docs/status-pages/index) — صفحه وضعیت چیست و اجزا چگونه کنار هم می‌نشینند.
- [منابع و گروه‌های صفحه وضعیت](/docs/status-pages/resources-and-groups) — منابعی که این نقطه‌های پایانی برمی‌گردانند.
- [برندسازی و دامنه‌های صفحه وضعیت](/docs/status-pages/branding-and-domains) — دامنه سفارشی‌ای که این نقطه‌های پایانی از آن سرو می‌شوند.
- [مشترکان و اعلامیه‌ها](/docs/status-pages/subscribers) — اعلامیه‌هایی که نقطه پایانی اعلامیه‌ها سرو می‌کند.
- [نمای کلی حادثه‌ها](/docs/incidents/index) — حادثه‌های موجود در این پاسخ‌ها از کجا می‌آیند.
