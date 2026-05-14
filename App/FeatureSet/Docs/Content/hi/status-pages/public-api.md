# Public Status Page API

यहाँ बताया गया है कि आप Status Page पर मौजूद अपने resources की status प्राप्त करने के लिए Public Status Page API कैसे उपयोग कर सकते हैं। आपको बस API endpoint पर एक POST request करनी है।

#### Overview API

यह API status page पर मौजूद सभी resources को fetch करेगा, जिसमें resources की overall status, incidents, maintenance और अधिक शामिल हैं।

Status page पर resources की overall status प्राप्त करने के लिए, आप निम्नलिखित endpoint पर एक POST request कर सकते हैं:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

API से response यह है: 

```json
{

    "overallStatus": 
        {   // Monitor Status Object
            // Overall Status सभी monitors और groups की status page पर worst status है। 
            // monitor status पर अधिक details यहाँ मिल सकती हैं।
            // https://oneuptime.com/reference/monitor-status
            
        },
    "scheduledMaintenanceEventsPublicNotes": [
        // scheduled maintenance public note पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/scheduled-maintenance-public-note
        {
            // Scheduled Maintenance Public Note Object
        }, 
        {
            // Scheduled Maintenance Public Note Object
        }
    ],
    "statusPageHistoryChartBarColorRules": [
        // status page history chart bar color rule पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
        {
            // Status Page History Chart Bar Color Rule Object
        },
        {
            // Status Page History Chart Bar Color Rule Object
        }
    ],
    "scheduledMaintenanceEvents": [
        // scheduled maintenance event पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // Scheduled Maintenance Event Object
        },
        {
            // Scheduled Maintenance Event Object
        }
    ],
    "activeAnnouncements": [
        // active announcement पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/status-page-announcement
        {
            // Status Page Announcement Object
        },
        {
            // Status Page Announcement Object
        }
    ],
    "incidentPublicNotes": [
        // incident public note पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/incident-public-note
        {
            // Incident Public Note Object
        },
        {
            // Incident Public Note Object
        }
    ],
    "activeIncidents": [
        // active incident पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/incident
        {
            // Incident Object
        },
        {
            // Incident Object
        }
    ],
    "monitorStatusTimelines": [
        // monitor status timeline पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/monitor-status-timeline
        {
            // Monitor Status Timeline Object
        },
        {
            // Monitor Status Timeline Object
        }
    ],
    "resourceGroups": [
        // resource group पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/resource-group
        {
            // Resource Group Object
        },
        {
            // Resource Group Object
        }
    ],
    "monitorStatuses": [
        // monitor status पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/monitor-status
        {
            // Monitor Status Object
        },
        {
            // Monitor Status Object
        }

    ],
    "statusPageResources": [
        // status page resource पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/status-page-resource
        {
            // Status Page Resource Object
        },
        {
            // Status Page Resource Object
        }
    ],
    "incidentStateTimelines": [
        // incident state timeline पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/incident-state-timeline
        {
            // Incident State Timeline Object
        },
        {
            // Incident State Timeline Object
        }
    ],
    "statusPage": {
       // status page पर अधिक details यहाँ मिल सकती हैं।
         // https://oneuptime.com/reference/status-page
    },
    "scheduledMaintenanceStateTimelines": [
        // scheduled maintenance state timeline पर अधिक details यहाँ मिल सकती हैं।
        // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
        {
            // Scheduled Maintenance State Timeline Object
        },
        {
            // Scheduled Maintenance State Timeline Object
        }
    ],
    "monitorGroupCurrentStatuses": {
        // monitor group की Current Status। 
    },
    "monitorsInGroup": {
        // group में Monitors।
    }
}
```

#### Uptime API

यह API status page पर सभी resources का uptime fetch करेगा।

सभी resources का overall uptime प्राप्त करने के लिए, आप निम्नलिखित endpoint पर एक POST request कर सकते हैं:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Request Body (वैकल्पिक):**

आप startDate और endDate को request body के रूप में भेज सकते हैं। 

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

ये dates 90 दिनों से अधिक अलग नहीं होनी चाहिए। यदि आप dates provide नहीं करते, तो API पिछले 14 दिनों का uptime return करेगा।

**उदाहरण Response:**

API से उदाहरण response यह है: 

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


### Incident API

यह API status page पर मौजूद सभी incidents को fetch करेगा। Status page पर सभी incidents प्राप्त करने के लिए, आप निम्नलिखित endpoint पर एक POST request कर सकते हैं:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

API से response यह है: 

```json
{
    "incidents": [
        // incident पर अधिक details यहाँ मिल सकती हैं।
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

यह API status page पर मौजूद सभी scheduled maintenance को fetch करेगा। Status page पर सभी scheduled maintenance प्राप्त करने के लिए, आप निम्नलिखित endpoint पर एक POST request कर सकते हैं:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

API से response यह है: 

```json
{
    "scheduledMaintenanceEvents": [
        // scheduled maintenance event पर अधिक details यहाँ मिल सकती हैं।
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

### Announcements API

यह API status page पर मौजूद सभी announcements को fetch करेगा। Status page पर सभी announcements प्राप्त करने के लिए, आप निम्नलिखित endpoint पर एक POST request कर सकते हैं:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

API से response यह है: 

```json
{
    "announcements": [
        // announcement पर अधिक details यहाँ मिल सकती हैं।
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
