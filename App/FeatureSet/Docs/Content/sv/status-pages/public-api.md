# Offentligt API för statussidor

Här är hur du kan använda det offentliga statussid-API:et för att hämta statusen för dina resurser som finns på statussidan. Allt du behöver göra är att göra en POST-förfrågan till API-slutpunkten.

#### Översikts-API

Detta API hämtar alla resurser som finns på statussidan, inklusive den övergripande statusen för resurser, incidenter och underhåll, med mera.

För att hämta den övergripande statusen för resurserna på statussidan kan du göra en POST-förfrågan till följande slutpunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/overview/:statusPageId
```

Detta är svaret från API:et:

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
  "activeAnnouncements": [
    // You can find more details on the active announcement here.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Status Page Announcement Object
    }
  ],
  "activeIncidents": [
    // You can find more details on the active incident here.
    // https://oneuptime.com/reference/incident
    {
      // Incident Object
    }
  ],
  "statusPageResources": [
    // You can find more details on the status page resource here.
    // https://oneuptime.com/reference/status-page-resource
    {
      // Status Page Resource Object
    }
  ],
  "statusPage": {
    // You can find more details on the status page here.
    // https://oneuptime.com/reference/status-page
  }
}
```

#### Drifttids-API

Detta API hämtar all drifttid för alla resurser på statussidan.

För att hämta den övergripande drifttiden för alla resurser kan du göra en POST-förfrågan till följande slutpunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/:statusPageId
```

**Förfrågningsinnehåll (valfritt):**

Du kan skicka startDate och endDate som förfrågningsinnehåll.

```
{
    "startDate": "2021-09-01T00:00:00Z",
    "endDate": "2021-09-30T23:59:59Z"
}
```

Dessa datum bör inte vara mer än 90 dagar isär. Om du inte anger datum returnerar API:et drifttiden för de senaste 14 dagarna.

### Incident-API

Detta API hämtar alla incidenter som finns på statussidan. För att hämta alla incidenter på statussidan kan du göra en POST-förfrågan till följande slutpunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/incidents/:statusPageId
```

Detta är svaret från API:et:

```json
{
  "incidents": [
    // You can find more details on the incident here.
    // https://oneuptime.com/reference/incident
    {
      // Incident Object
    }
  ]
}
```

### API för planerat underhåll

Detta API hämtar alla planerade underhållshändelser som finns på statussidan. För att hämta alla planerade underhållshändelser på statussidan kan du göra en POST-förfrågan till följande slutpunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance/:statusPageId
```

Detta är svaret från API:et:

```json
{
  "scheduledMaintenanceEvents": [
    // You can find more details on the scheduled maintenance event here.
    // https://oneuptime.com/reference/scheduled-maintenance
    {
      // Scheduled Maintenance Event Object
    }
  ]
}
```

### Meddelande-API

Detta API hämtar alla meddelanden som finns på statussidan. För att hämta alla meddelanden på statussidan kan du göra en POST-förfrågan till följande slutpunkt:

```bash
curl -X POST https://oneuptime.com/status-page-api/announcements/:statusPageId
```

Detta är svaret från API:et:

```json
{
  "announcements": [
    // You can find more details on the announcement here.
    // https://oneuptime.com/reference/status-page-announcement
    {
      // Announcement Object
    }
  ]
}
```
