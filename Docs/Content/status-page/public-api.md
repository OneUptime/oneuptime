# Public Status Page API

Here's how you can use the Public Status Page API to get the status of your resources that are on the Status Page. All you need to do is to make a GET request to the API endpoint.

#### Overview API

This API will fetch all the resources that are on the status page including the overall status of the resources, incidents, and maintenance, and more.

To get overall status of the resources on the status page, you can make a GET request to the following endpoint:

```bash
curl -X GET https://api.oneuptime.com/status-page-api/overview/:statusPageId
```

This is the response from the API: 

```json
{
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

### Incident API

This API will fetch all the incidents that are on the status page. To get all the incidents on the status page, you can make a GET request to the following endpoint:

```bash
curl -X GET https://api.oneuptime.com/status-page-api/incidents/:statusPageId
```

This is the response from the API: 

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


### Scheduled Maintenance API

This API will fetch all the scheduled maintenance that are on the status page. To get all the scheduled maintenance on the status page, you can make a GET request to the following endpoint:

```bash
curl -X GET https://api.oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

This is the response from the API: 

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

# Announcements API

This API will fetch all the announcements that are on the status page. To get all the announcements on the status page, you can make a GET request to the following endpoint:

```bash
curl -X GET https://api.oneuptime.com/status-page-api/announcements/:statusPageId
```

This is the response from the API: 

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

