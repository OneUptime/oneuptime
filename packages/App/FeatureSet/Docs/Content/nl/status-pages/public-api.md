# Publieke API

Elke statuspagina beantwoordt een kleine reeks JSON-endpoints die alleen lezen: het overzicht, de beschikbaarheid, incidenten, episodes, geplande onderhoudsgebeurtenissen en aankondigingen. Het zijn de endpoints die de statuspagina zelf laadt, dus ze geven precies terug wat een bezoeker ziet, en een publieke pagina heeft geen API-sleutel nodig. Gebruik ze om je status te tonen in je eigen app, een chatbot of op een scherm aan de muur.

:::cards
- [Endpoints](#endpoints): Eén endpoint voor alles wat de pagina toont.
- [Het overzicht lezen](#het-overzicht-lezen): De hele pagina in één request, met curl, Node.js en Python.
- [Beschikbaarheid over een periode](#beschikbaarheid-over-een-periode): Beschikbaarheid per resource en per groep, over maximaal 90 dagen.
- [Fouten](#fouten): Wat elke statuscode betekent.
:::

## Hoe een request wordt beantwoord

Elk request noemt de statuspagina bij haar ID of bij een van haar eigen domeinen. OneUptime zoekt de pagina op, past dezelfde toegangsregels toe als bij een bezoeker en antwoordt met JSON.

```mermaid title="Hoe een request aan de API van een statuspagina wordt beantwoord"
flowchart TB
    R["Request met het ID of domein<br/>van een statuspagina"] --> F{"Geldig gevormd ID<br/>of geverifieerd domein?"}
    F -->|"Nee"| E404["404: Status Page not found"]
    F -->|"Ja"| A{"Pagina gearchiveerd?"}
    A -->|"Ja"| E404
    A -->|"Nee"| IP{"Laat de IP-toegangslijst<br/>de aanroeper toe?"}
    IP -->|"Nee"| E403["403: IP-adres geblokkeerd"]
    IP -->|"Ja"| P{"Is de pagina publiek?"}
    P -->|"Ja"| OK["200 met JSON"]
    P -->|"Nee"| S{"Aangemeld, of ontgrendeld<br/>met het wachtwoord?"}
    S -->|"Ja"| OK
    S -->|"Nee"| E401["401: niet geauthenticeerd"]
```

Een privépagina antwoordt alleen een browser die zich erbij heeft aangemeld of haar met haar wachtwoord heeft ontgrendeld: de API leest dezelfde sessie als de pagina. Gebruik voor een script een publieke pagina. Zie [Beperken wie de pagina mag zien](/docs/status-pages/index#beperken-wie-de-pagina-mag-zien).

Een geldig gevormd ID waar geen statuspagina bij hoort, volgt hetzelfde pad als een privépagina en krijgt `401`. Antwoordt een publieke pagina met `401`, controleer dan het ID.

## Voordat je begint

- **Het ID van de statuspagina.** Open de pagina in het dashboard (**Statuspagina's → Alle statuspagina's**, dan de pagina). De kaart **Statuspaginadetails** op haar **Overzicht** toont de **Statuspagina-ID**.
- **De basis-URL.** Elk endpoint hieronder staat onder `/status-page-api`:

| Waar de pagina draait | Basis-URL |
| ------------------- | -------- |
| OneUptime Cloud | `https://oneuptime.com/status-page-api` |
| Zelf gehoste OneUptime | `https://<your-oneuptime-host>/status-page-api` |
| Een eigen domein van de pagina | `https://status.example.com/status-page-api` |

Waar een pad hieronder `{statusPageIdOrDomain}` zegt, kun je het ID van de pagina sturen of een van haar geverifieerde eigen domeinen, zoals `status.example.com`. Het beschikbaarheidsendpoint neemt alleen het ID.

## Endpoints

| Endpoint | Methoden | Geeft terug |
| -------- | ------- | ------- |
| `/overview/{statusPageIdOrDomain}` | `GET`, `POST` | Alles wat het overzicht toont: de algemene status, resources en groepen, actieve incidenten en episodes, gepland onderhoud, lopende aankondigingen en de gegevens achter de beschikbaarheidsbalken. |
| `/uptime/{statusPageId}` | `POST` | Beschikbaarheidspercentages per resource en per groep, over een periode. |
| `/incidents/{statusPageIdOrDomain}` | `GET`, `POST` | De incidenten die de pagina toont, met hun publieke notities en statuswijzigingen. |
| `/incidents/{statusPageIdOrDomain}/{incidentId}` | `POST` | Eén incident. |
| `/episodes/{statusPageIdOrDomain}` | `POST` | De incidentepisodes die de pagina toont. |
| `/episodes/{statusPageIdOrDomain}/{episodeId}` | `POST` | Eén episode. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}` | `GET`, `POST` | De geplande onderhoudsgebeurtenissen die de pagina toont, met hun publieke notities en statuswijzigingen. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}/{scheduledMaintenanceId}` | `POST` | Eén geplande onderhoudsgebeurtenis. |
| `/announcements/{statusPageIdOrDomain}` | `GET`, `POST` | De aankondigingen die de pagina toont. |
| `/announcements/{statusPageIdOrDomain}/{announcementId}` | `POST` | Eén aankondiging. |

De endpoints volgen de eigen instellingen van de pagina, in de kaart **Wat uw statuspagina toont** (zie [Kiezen wat er op de pagina komt](/docs/status-pages/index#kiezen-wat-er-op-de-pagina-komt)):

- Een lijst die is uitgeschakeld, weigert haar endpoint, bijvoorbeeld met `Incidents are not enabled on this status page.`
- Elke lijst reikt zo ver terug als haar instelling **De laatste … dagen weergeven** (standaard 14). De incidentenlijst bevat daarnaast elk incident dat nog niet is opgelost, en de lijst met gepland onderhoud elke gebeurtenis die nog moet komen of loopt.
- Op ID wordt een incident, episode, gebeurtenis of aankondiging teruggegeven hoe oud die ook is, zodat een link naar een ouder exemplaar blijft werken. Een exemplaar dat de pagina helemaal niet toont, zoals een incident op een monitor die niet op de pagina staat, komt terug als lege lijst, en een episode als `404`.

**Welke incidenten een pagina teruggeeft.** Het incidentenendpoint geeft de incidenten op de monitors van de pagina terug, min de incidenten die tot andere statuspagina's zijn beperkt, en min elk incident dat niet tot deze pagina is beperkt als de pagina alleen incidenten toont die tot haar zijn beperkt (zie [Eén statuspagina per doelgroep](/docs/status-pages/one-status-page-per-audience)). Tot welke pagina's een incident is beperkt, staat nooit in het antwoord.

## Het overzicht lezen

Het overzicht is één request voor de hele pagina. Het zijn dezelfde gegevens die de statuspagina tekent, en ze zijn hooguit 15 seconden oud.

:::tabs
@tab curl
```bash
curl https://oneuptime.com/status-page-api/overview/YOUR_STATUS_PAGE_ID
```
@tab Node.js
```javascript title="status.mjs"
// Node.js 18 or later: fetch is built in. Run with `node status.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/overview/${statusPageId}`,
);
const body = await response.json();

if (!response.ok) {
  throw new Error(`${response.status}: ${body.error}`);
}

console.log(body.overallStatus?.name); // "Operational"
```
@tab Python
```python title="status.py"
# Python 3, standard library only. Run with `python3 status.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"
url = f"https://oneuptime.com/status-page-api/overview/{STATUS_PAGE_ID}"

with urllib.request.urlopen(url, timeout=10) as response:
    overview = json.load(response)

print((overview.get("overallStatus") or {}).get("name"))  # Operational
```
:::

De algemene status is de slechtste huidige status van de monitors en monitorgroepen op de pagina, die met de hoogste prioriteit. Een monitorstatus ziet er zo uit:

```json
{
  "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
  "name": "Operational",
  "color": { "_type": "Color", "value": "#2ab57d" },
  "isOperationalState": true,
  "priority": 1
}
```

### Wat het overzicht teruggeeft

| Sleutel | Wat erin staat |
| --- | ------------- |
| `overallStatus` | De algemene status van de pagina, een monitorstatus zoals hierboven, of `null` als er niets op de pagina staat. |
| `statusPage` | De publieke instellingen van de pagina: titel, beschrijving, branding en wat ze toont. |
| `statusPageResources` | Elke resource: weergavenaam, beschrijving, groep, monitor of monitorgroep, en weergaveopties. |
| `resourceGroups` | De groepen, met `parentStatusPageGroupId` voor geneste groepen. |
| `monitorStatuses` | Elke monitorstatus van het project, van de laagste prioriteit naar de hoogste. |
| `monitorGroupCurrentStatuses`, `monitorsInGroup` | De huidige status van elke monitorgroep op de pagina, en de monitors erin. |
| `monitorStatusTimelines`, `uptimeDailyAggregate`, `monitorGroupMergedDowntime`, `statusPageHistoryChartBarColorRules` | Waaruit de beschikbaarheidsbalken worden getekend, en de kleurregels voor de balken van de pagina. |
| `activeIncidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates` | De onopgeloste incidenten die de pagina toont, hun publieke notities en statuswijzigingen, en de incidentstatussen van het project. |
| `timelineIncidents` | De incidenten in het venster van de beschikbaarheidsbalken, opgeloste incidenten inbegrepen, voor de tooltips van de balken. |
| `activeEpisodes`, `episodePublicNotes`, `episodeStateTimelines` | Hetzelfde voor incidentepisodes. |
| `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates` | De geplande onderhoudsgebeurtenissen die nog moeten komen of lopen, hun publieke notities en statuswijzigingen. |
| `activeAnnouncements` | De aankondigingen die nu worden getoond: begonnen en nog niet afgelopen. |

## Beschikbaarheid over een periode

`POST /uptime/{statusPageId}` geeft de beschikbaarheid van elke resource en groep op de pagina tussen twee datums terug. Beide datums zijn optioneel:

| Veld | Standaard | Opmerkingen |
| ----- | ------- | ----- |
| `startDate` | 14 dagen geleden | Een datum en tijd volgens ISO 8601. |
| `endDate` | Nu | Mag niet vóór `startDate` liggen. De periode mag hooguit 90 dagen beslaan. |

:::tabs
@tab curl
```bash
curl -X POST https://oneuptime.com/status-page-api/uptime/YOUR_STATUS_PAGE_ID \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2026-09-01T00:00:00Z", "endDate": "2026-09-30T23:59:59Z"}'
```
@tab Node.js
```javascript title="uptime.mjs"
// Node.js 18 or later. Run with `node uptime.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/uptime/${statusPageId}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: "2026-09-01T00:00:00Z",
      endDate: "2026-09-30T23:59:59Z",
    }),
  },
);
const uptime = await response.json();

for (const group of uptime.groupUptimes) {
  console.log(group.statusPageGroupName, group.uptimePercent);
}
```
@tab Python
```python title="uptime.py"
# Python 3, standard library only. Run with `python3 uptime.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"

request = urllib.request.Request(
    f"https://oneuptime.com/status-page-api/uptime/{STATUS_PAGE_ID}",
    data=json.dumps(
        {"startDate": "2026-09-01T00:00:00Z", "endDate": "2026-09-30T23:59:59Z"}
    ).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(request, timeout=10) as response:
    uptime = json.load(response)

for group in uptime["groupUptimes"]:
    print(group["statusPageGroupName"], group["uptimePercent"])
```
:::

Het antwoord:

```json
{
  "statusPageResourceUptimes": [
    {
      "statusPageResourceId": {
        "_type": "ObjectID",
        "value": "cfffa3c3-fdf3-4cd7-9585-d6d408a14663"
      },
      "uptimePercent": 99.98,
      "statusPageResourceName": "Checkout API",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "name": "Operational",
        "color": { "_type": "Color", "value": "#2ab57d" },
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
      "parentStatusPageGroupId": null,
      "uptimePercent": 99.98,
      "statusPageResourceUptimes": [
        {
          "statusPageResourceId": {
            "_type": "ObjectID",
            "value": "8175534f-aa77-456c-ad5b-b8e7b85876aa"
          },
          "uptimePercent": 99.98,
          "statusPageResourceName": "Web app",
          "currentStatus": {
            "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
            "name": "Operational",
            "color": { "_type": "Color", "value": "#2ab57d" },
            "isOperationalState": true,
            "priority": 1
          }
        }
      ],
      "statusPageGroupName": "Web",
      "currentStatus": {
        "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
        "name": "Operational",
        "color": { "_type": "Color", "value": "#2ab57d" },
        "isOperationalState": true,
        "priority": 1
      }
    }
  ],
  "startDate": "2026-09-01T00:00:00.000Z",
  "endDate": "2026-09-30T23:59:59.000Z"
}
```

| Sleutel | Wat erin staat |
| --- | ------------- |
| `statusPageResourceUptimes` | De resources die in geen enkele groep zitten, die bezoekers bovenaan de pagina zien. |
| `groupUptimes` | Eén item per groep. `uptimePercent` en `currentStatus` van een groep dekken elke resource eronder, geneste groepen inbegrepen; haar `statusPageResourceUptimes` noemt alleen de resources die er direct in zitten. Bouw de boom opnieuw op met `parentStatusPageGroupId`. |
| `uptimePercent` | Afgerond op de eigen precisie van de resource of groep. `null` als de resource of groep geen beschikbaarheidspercentage toont. |
| `currentStatus` | `null` als de resource of groep haar huidige status niet toont. |

Tijd telt als downtime wanneer de monitorstatus een van de statussen onder **Telt als downtime** van de pagina is.

## Incidenten, episodes, onderhoud en aankondigingen

De lijst-endpoints beantwoorden `GET` en ook `POST`; de endpoints voor één item en de episode-endpoints beantwoorden `POST`.

:::tabs
@tab curl
```bash
# The incidents the page lists
curl https://oneuptime.com/status-page-api/incidents/YOUR_STATUS_PAGE_ID

# One scheduled maintenance event
curl -X POST https://oneuptime.com/status-page-api/scheduled-maintenance-events/YOUR_STATUS_PAGE_ID/EVENT_ID
```
@tab Node.js
```javascript title="incidents.mjs"
// Node.js 18 or later. Run with `node incidents.mjs`.
const statusPageId = "YOUR_STATUS_PAGE_ID";

const response = await fetch(
  `https://oneuptime.com/status-page-api/incidents/${statusPageId}`,
);
const { incidents } = await response.json();

for (const incident of incidents) {
  console.log(incident.title, incident.currentIncidentState?.name);
}
```
@tab Python
```python title="incidents.py"
# Python 3, standard library only. Run with `python3 incidents.py`.
import json
import urllib.request

STATUS_PAGE_ID = "YOUR_STATUS_PAGE_ID"
url = f"https://oneuptime.com/status-page-api/incidents/{STATUS_PAGE_ID}"

with urllib.request.urlopen(url, timeout=10) as response:
    incidents = json.load(response)["incidents"]

for incident in incidents:
    print(incident["title"], (incident.get("currentIncidentState") or {}).get("name"))
```
:::

| Endpoint | Sleutels in het antwoord |
| -------- | -------------------- |
| Incidenten | `incidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Episodes | `episodes`, `episodePublicNotes`, `episodeStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Geplande onderhoudsgebeurtenissen | `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates`, `statusPageResources`, `monitorsInGroup` |
| Aankondigingen | `announcements`, `statusPageResources`, `monitorsInGroup` |

Een request voor één item antwoordt met dezelfde sleutels, met dat ene record erin.

## Fouten

Een fout antwoordt met een statuscode en JSON-inhoud die de reden noemt:

```json
{ "error": "You can only get uptime for 90 days. Please select a date range within 90 days." }
```

| Status | Wanneer |
| ------ | ---- |
| `400` | Het request vraagt om iets wat de pagina niet toont, zoals een uitgeschakelde lijst, of de beschikbaarheidsperiode is langer dan 90 dagen of eindigt voordat ze begint. |
| `401` | De pagina is privé, en het request heeft geen aangemelde sessie of wachtwoord ervoor. Ook een geldig gevormd ID waar geen statuspagina bij hoort, krijgt `401`. |
| `403` | De IP-toegangslijst van de pagina bevat het adres van de aanroeper niet. |
| `404` | Het ID is niet geldig gevormd, geen geverifieerd eigen domein komt overeen, of de pagina is gearchiveerd. Ook een episode die de pagina niet toont, krijgt `404`. |

## Andere manieren om een statuspagina te lezen

- **RSS.** Elke statuspagina biedt `/rss`, een feed van haar incidenten, aankondigingen en geplande onderhoudsgebeurtenissen. Zie [De insluitbare badge en de RSS-feed](/docs/status-pages/index#de-insluitbare-badge-en-de-rss-feed).
- **llms.txt.** Naast `/rss` biedt elke statuspagina `/llms.txt`, dat AI-agents naar de RSS-feed en de overzichts-JSON verwijst.
- **MCP.** AI-agents kunnen de pagina lezen via de MCP-server van OneUptime op `https://oneuptime.com/mcp`, zonder API-sleutel, door het ID of domein van de pagina mee te geven als `statusPageIdOrDomain`. Dit staat standaard aan; zet het uit met **MCP-server inschakelen** onder **AI → MCP** in het zijmenu van de pagina. Zie [MCP-server](/docs/ai/mcp-server).
- **De REST API.** Om statuspagina's, resources, abonnees en aankondigingen te maken of te wijzigen, gebruik je de [OneUptime API](/docs/api-reference/api-reference) met een API-sleutel.

## Volgende stappen

:::cards
- [Statuspagina's – Overzicht](/docs/status-pages/index): Wat een statuspagina toont en wie haar mag zien.
- [Statuspagina – bronnen en groepen](/docs/status-pages/resources-and-groups): De resources en groepen die deze endpoints teruggeven.
- [Eén statuspagina per doelgroep](/docs/status-pages/one-status-page-per-audience): Waarom de ene pagina een incident toont dat de andere niet toont.
- [Statuspagina – branding en domeinen](/docs/status-pages/branding-and-domains): De pagina, en deze endpoints, op je eigen domein aanbieden.
:::
