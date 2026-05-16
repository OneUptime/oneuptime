# 공개 상태 페이지 API

다음은 상태 페이지에 있는 리소스의 상태를 가져오기 위해 공개 상태 페이지 API를 사용하는 방법입니다. API 엔드포인트에 POST 요청을 만들기만 하면 됩니다.

#### 개요 API

이 API는 리소스의 전체 상태, 인시던트, 유지보수 등을 포함하여 상태 페이지의 모든 리소스를 가져옵니다.

상태 페이지의 리소스 전체 상태를 얻으려면 다음 엔드포인트에 POST 요청을 만들 수 있습니다:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

API의 응답은 다음과 같습니다: 

```json
{

    "overallStatus": 
        {   // 모니터 상태 객체
            // 전체 상태는 상태 페이지의 모든 모니터 및 그룹의 최악 상태입니다. 
            // 모니터 상태에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
            // https://oneuptime.com/reference/monitor-status
            
        },
    "scheduledMaintenanceEventsPublicNotes": [
        // 예정 유지보수 공개 노트에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/scheduled-maintenance-public-note
        {
            // 예정 유지보수 공개 노트 객체
        }, 
        {
            // 예정 유지보수 공개 노트 객체
        }
    ],
    "statusPageHistoryChartBarColorRules": [
        // 상태 페이지 기록 차트 막대 색상 규칙에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
        {
            // 상태 페이지 기록 차트 막대 색상 규칙 객체
        },
        {
            // 상태 페이지 기록 차트 막대 색상 규칙 객체
        }
    ],
    "scheduledMaintenanceEvents": [
        // 예정 유지보수 이벤트에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // 예정 유지보수 이벤트 객체
        },
        {
            // 예정 유지보수 이벤트 객체
        }
    ],
    "activeAnnouncements": [
        // 활성 공지에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/status-page-announcement
        {
            // 상태 페이지 공지 객체
        },
        {
            // 상태 페이지 공지 객체
        }
    ],
    "incidentPublicNotes": [
        // 인시던트 공개 노트에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/incident-public-note
        {
            // 인시던트 공개 노트 객체
        },
        {
            // 인시던트 공개 노트 객체
        }
    ],
    "activeIncidents": [
        // 활성 인시던트에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/incident
        {
            // 인시던트 객체
        },
        {
            // 인시던트 객체
        }
    ],
    "monitorStatusTimelines": [
        // 모니터 상태 타임라인에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/monitor-status-timeline
        {
            // 모니터 상태 타임라인 객체
        },
        {
            // 모니터 상태 타임라인 객체
        }
    ],
    "resourceGroups": [
        // 리소스 그룹에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/resource-group
        {
            // 리소스 그룹 객체
        },
        {
            // 리소스 그룹 객체
        }
    ],
    "monitorStatuses": [
        // 모니터 상태에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/monitor-status
        {
            // 모니터 상태 객체
        },
        {
            // 모니터 상태 객체
        }

    ],
    "statusPageResources": [
        // 상태 페이지 리소스에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/status-page-resource
        {
            // 상태 페이지 리소스 객체
        },
        {
            // 상태 페이지 리소스 객체
        }
    ],
    "incidentStateTimelines": [
        // 인시던트 상태 타임라인에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/incident-state-timeline
        {
            // 인시던트 상태 타임라인 객체
        },
        {
            // 인시던트 상태 타임라인 객체
        }
    ],
    "statusPage": {
       // 상태 페이지에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
         // https://oneuptime.com/reference/status-page
    },
    "scheduledMaintenanceStateTimelines": [
        // 예정 유지보수 상태 타임라인에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
        {
            // 예정 유지보수 상태 타임라인 객체
        },
        {
            // 예정 유지보수 상태 타임라인 객체
        }
    ],
    "monitorGroupCurrentStatuses": {
        // 모니터 그룹의 현재 상태. 
    },
    "monitorsInGroup": {
        // 그룹의 모니터.
    }
}
```

#### 업타임 API

이 API는 상태 페이지의 모든 리소스 업타임을 가져옵니다.

모든 리소스의 전체 업타임을 얻으려면 다음 엔드포인트에 POST 요청을 만들 수 있습니다:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**요청 본문 (선택 사항):**

startDate와 endDate를 요청 본문으로 전송할 수 있습니다. 

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

이 날짜들은 90일을 초과할 수 없습니다. 날짜를 제공하지 않으면 API는 지난 14일의 업타임을 반환합니다.

**응답 예시:**

API의 예시 응답은 다음과 같습니다: 

```json
{
    "statusPageResourceUptimes": [
        {
            "statusPageResourceId": {
                "_type": "ObjectID",
                "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
            },
            "uptimePercent": 99.98,
            "statusPageResourceName": "상태 페이지 리소스 이름",
            "currentStatus": {
                "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
                "isPermissionIf": {},
                "name": "정상 운영",
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
                        "name": "정상 운영",
                        "color": {
                            "_type": "Color",
                            "value": "#2ab57d"
                        },
                        "isOperationalState": true,
                        "priority": 1
                    }
                }
            ],
            "statusPageGroupName": "그룹 이름",
            "currentStatus": {
                "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
                "isPermissionIf": {},
                "name": "정상 운영",
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


### 인시던트 API

이 API는 상태 페이지의 모든 인시던트를 가져옵니다. 상태 페이지의 모든 인시던트를 얻으려면 다음 엔드포인트에 POST 요청을 만들 수 있습니다:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

API의 응답은 다음과 같습니다: 

```json
{
    "incidents": [
        // 인시던트에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/incident
        {
            // 인시던트 객체
        },
        {
            // 인시던트 객체
        }
    ]
}
```


### 예정 유지보수 API

이 API는 상태 페이지의 모든 예정 유지보수를 가져옵니다. 상태 페이지의 모든 예정 유지보수를 얻으려면 다음 엔드포인트에 POST 요청을 만들 수 있습니다:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

API의 응답은 다음과 같습니다: 

```json
{
    "scheduledMaintenanceEvents": [
        // 예정 유지보수 이벤트에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // 예정 유지보수 이벤트 객체
        },
        {
            // 예정 유지보수 이벤트 객체
        }
    ]
}
```

### 공지 API

이 API는 상태 페이지의 모든 공지를 가져옵니다. 상태 페이지의 모든 공지를 얻으려면 다음 엔드포인트에 POST 요청을 만들 수 있습니다:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

API의 응답은 다음과 같습니다: 

```json
{
    "announcements": [
        // 공지에 대한 자세한 내용은 여기에서 찾을 수 있습니다.
        // https://oneuptime.com/reference/status-page-announcement
        {
            // 공지 객체
        },
        {
            // 공지 객체
        }
    ]
}
```
