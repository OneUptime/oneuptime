# ステータスページ公開API

ステータスページにあるリソースのステータスを取得するために、ステータスページ公開APIを使用する方法を説明します。APIエンドポイントにPOSTリクエストを送信するだけで利用できます。

#### 概要API

このAPIはステータスページにあるすべてのリソース（リソースの全体ステータス、インシデント、メンテナンスなど）を取得します。

ステータスページのリソースの全体ステータスを取得するには、以下のエンドポイントにPOSTリクエストを送信します：

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

APIからのレスポンスは次のとおりです：

```json
{

    "overallStatus": 
        {   // モニターステータスオブジェクト
            // 全体ステータスはステータスページにあるすべてのモニターとグループの中で最も悪いステータスです。
            // モニターステータスの詳細はこちら。
            // https://oneuptime.com/reference/monitor-status
            
        },
    "scheduledMaintenanceEventsPublicNotes": [
        // スケジュールされたメンテナンスの公開メモの詳細はこちら。
        // https://oneuptime.com/reference/scheduled-maintenance-public-note
        {
            // スケジュールされたメンテナンスの公開メモオブジェクト
        }, 
        {
            // スケジュールされたメンテナンスの公開メモオブジェクト
        }
    ],
    "statusPageHistoryChartBarColorRules": [
        // ステータスページ履歴チャートのバーカラールールの詳細はこちら。
        // https://oneuptime.com/reference/status-page-history-chart-bar-color-rule
        {
            // ステータスページ履歴チャートのバーカラールールオブジェクト
        },
        {
            // ステータスページ履歴チャートのバーカラールールオブジェクト
        }
    ],
    "scheduledMaintenanceEvents": [
        // スケジュールされたメンテナンスイベントの詳細はこちら。
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // スケジュールされたメンテナンスイベントオブジェクト
        },
        {
            // スケジュールされたメンテナンスイベントオブジェクト
        }
    ],
    "activeAnnouncements": [
        // アクティブなお知らせの詳細はこちら。
        // https://oneuptime.com/reference/status-page-announcement
        {
            // ステータスページお知らせオブジェクト
        },
        {
            // ステータスページお知らせオブジェクト
        }
    ],
    "incidentPublicNotes": [
        // インシデントの公開メモの詳細はこちら。
        // https://oneuptime.com/reference/incident-public-note
        {
            // インシデントの公開メモオブジェクト
        },
        {
            // インシデントの公開メモオブジェクト
        }
    ],
    "activeIncidents": [
        // アクティブなインシデントの詳細はこちら。
        // https://oneuptime.com/reference/incident
        {
            // インシデントオブジェクト
        },
        {
            // インシデントオブジェクト
        }
    ],
    "monitorStatusTimelines": [
        // モニターステータスタイムラインの詳細はこちら。
        // https://oneuptime.com/reference/monitor-status-timeline
        {
            // モニターステータスタイムラインオブジェクト
        },
        {
            // モニターステータスタイムラインオブジェクト
        }
    ],
    "resourceGroups": [
        // リソースグループの詳細はこちら。
        // https://oneuptime.com/reference/resource-group
        {
            // リソースグループオブジェクト
        },
        {
            // リソースグループオブジェクト
        }
    ],
    "monitorStatuses": [
        // モニターステータスの詳細はこちら。
        // https://oneuptime.com/reference/monitor-status
        {
            // モニターステータスオブジェクト
        },
        {
            // モニターステータスオブジェクト
        }

    ],
    "statusPageResources": [
        // ステータスページリソースの詳細はこちら。
        // https://oneuptime.com/reference/status-page-resource
        {
            // ステータスページリソースオブジェクト
        },
        {
            // ステータスページリソースオブジェクト
        }
    ],
    "incidentStateTimelines": [
        // インシデントステートタイムラインの詳細はこちら。
        // https://oneuptime.com/reference/incident-state-timeline
        {
            // インシデントステートタイムラインオブジェクト
        },
        {
            // インシデントステートタイムラインオブジェクト
        }
    ],
    "statusPage": {
       // ステータスページの詳細はこちら。
         // https://oneuptime.com/reference/status-page
    },
    "scheduledMaintenanceStateTimelines": [
        // スケジュールされたメンテナンスステートタイムラインの詳細はこちら。
        // https://oneuptime.com/reference/scheduled-maintenance-state-timeline
        {
            // スケジュールされたメンテナンスステートタイムラインオブジェクト
        },
        {
            // スケジュールされたメンテナンスステートタイムラインオブジェクト
        }
    ],
    "monitorGroupCurrentStatuses": {
        // モニターグループの現在のステータス。
    },
    "monitorsInGroup": {
        // グループ内のモニター。
    }
}
```

#### 稼働率API

このAPIはステータスページにあるすべてのリソースの稼働率を取得します。

すべてのリソースの全体的な稼働率を取得するには、以下のエンドポイントにPOSTリクエストを送信します：

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**リクエストボディ（オプション）：**

startDateとendDateをリクエストボディとして送信できます。

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

これらの日付は90日以上離れていてはなりません。日付を指定しない場合、APIは過去14日間の稼働率を返します。

**レスポンス例：**

APIからのレスポンス例は次のとおりです：

```json
{
    "statusPageResourceUptimes": [
        {
            "statusPageResourceId": {
                "_type": "ObjectID",
                "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
            },
            "uptimePercent": 99.98,
            "statusPageResourceName": "ステータスページリソース名",
            "currentStatus": {
                "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
                "isPermissionIf": {},
                "name": "正常",
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
                        "name": "正常",
                        "color": {
                            "_type": "Color",
                            "value": "#2ab57d"
                        },
                        "isOperationalState": true,
                        "priority": 1
                    }
                }
            ],
            "statusPageGroupName": "グループ名",
            "currentStatus": {
                "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
                "isPermissionIf": {},
                "name": "正常",
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


### インシデントAPI

このAPIはステータスページにあるすべてのインシデントを取得します。ステータスページのすべてのインシデントを取得するには、以下のエンドポイントにPOSTリクエストを送信します：

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

APIからのレスポンスは次のとおりです：

```json
{
    "incidents": [
        // インシデントの詳細はこちら。
        // https://oneuptime.com/reference/incident
        {
            // インシデントオブジェクト
        },
        {
            // インシデントオブジェクト
        }
    ]
}
```


### スケジュールされたメンテナンスAPI

このAPIはステータスページにあるすべてのスケジュールされたメンテナンスを取得します。ステータスページのすべてのスケジュールされたメンテナンスを取得するには、以下のエンドポイントにPOSTリクエストを送信します：

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

APIからのレスポンスは次のとおりです：

```json
{
    "scheduledMaintenanceEvents": [
        // スケジュールされたメンテナンスイベントの詳細はこちら。
        // https://oneuptime.com/reference/scheduled-maintenance
        {
            // スケジュールされたメンテナンスイベントオブジェクト
        },
        {
            // スケジュールされたメンテナンスイベントオブジェクト
        }
    ]
}
```

### お知らせAPI

このAPIはステータスページにあるすべてのお知らせを取得します。ステータスページのすべてのお知らせを取得するには、以下のエンドポイントにPOSTリクエストを送信します：

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

APIからのレスポンスは次のとおりです：

```json
{
    "announcements": [
        // お知らせの詳細はこちら。
        // https://oneuptime.com/reference/status-page-announcement
        {
            // お知らせオブジェクト
        },
        {
            // お知らせオブジェクト
        }
    ]
}
```
