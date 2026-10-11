# Öffentliche API

Jede Statusseite beantwortet eine kleine Reihe von JSON-Endpunkten, die nur lesen: ihre Übersicht, Verfügbarkeit, Vorfälle, Episoden, geplanten Wartungsereignisse und Ankündigungen. Es sind die Endpunkte, die die Statusseite selbst lädt; sie liefern also genau das, was ein Besucher sieht, und eine öffentliche Seite braucht keinen API-Schlüssel. Nutzen Sie sie, um Ihren Status in Ihrer eigenen App, einem Chatbot oder auf einem Wandbildschirm zu zeigen.

:::cards
- [Endpunkte](#endpunkte): Ein Endpunkt für alles, was die Seite zeigt.
- [Die Übersicht lesen](#die-übersicht-lesen): Die ganze Seite in einer Anfrage, mit curl, Node.js und Python.
- [Verfügbarkeit für einen Zeitraum](#verfügbarkeit-für-einen-zeitraum): Verfügbarkeit pro Ressource und Gruppe, für bis zu 90 Tage.
- [Fehler](#fehler): Was jeder Statuscode bedeutet.
:::

## Wie eine Anfrage beantwortet wird

Jede Anfrage nennt die Statusseite über ihre ID oder über eine ihrer eigenen Domains. OneUptime findet die Seite, wendet dieselben Zugriffsregeln an, denen ein Besucher begegnet, und antwortet mit JSON.

```mermaid title="Wie eine Anfrage an die Statusseiten-API beantwortet wird"
flowchart TB
    R["Anfrage mit der ID oder Domain einer Statusseite"] --> F{"Gültig geformte ID<br/>oder verifizierte Domain?"}
    F -->|"Nein"| E404["404: Status Page not found"]
    F -->|"Ja"| A{"Seite archiviert?"}
    A -->|"Ja"| E404
    A -->|"Nein"| IP{"Lässt die IP-Freigabeliste<br/>den Aufrufer zu?"}
    IP -->|"Nein"| E403["403: IP-Adresse gesperrt"]
    IP -->|"Ja"| P{"Ist die Seite öffentlich?"}
    P -->|"Ja"| OK["200 mit JSON"]
    P -->|"Nein"| S{"Angemeldet oder mit dem<br/>Passwort entsperrt?"}
    S -->|"Ja"| OK
    S -->|"Nein"| E401["401: nicht authentifiziert"]
```

Eine private Seite antwortet nur einem Browser, der sich bei ihr angemeldet oder sie mit ihrem Passwort entsperrt hat: Die API liest dieselbe Sitzung wie die Seite. Für ein Skript verwenden Sie eine öffentliche Seite. Siehe [Einschränken, wer die Seite sehen darf](/docs/status-pages/index#einschränken-wer-die-seite-sehen-darf).

Eine gültig geformte ID, zu der es keine Statusseite gibt, nimmt denselben Weg wie eine private Seite und wird mit `401` beantwortet. Antwortet eine öffentliche Seite mit `401`, prüfen Sie die ID.

## Bevor Sie beginnen

- **Die ID der Statusseite.** Öffnen Sie die Seite im Dashboard (**Statusseiten → Alle Statusseiten**, dann die Seite). Die Karte **Statusseiten-Details** auf ihrer **Übersicht** zeigt die **Statusseiten-ID**.
- **Die Basis-URL.** Jeder Endpunkt unten liegt unter `/status-page-api`:

| Wo die Seite läuft | Basis-URL |
| ------------------- | -------- |
| OneUptime Cloud | `https://oneuptime.com/status-page-api` |
| Selbst gehostetes OneUptime | `https://<your-oneuptime-host>/status-page-api` |
| Eine eigene Domain der Seite | `https://status.example.com/status-page-api` |

Wo ein Pfad unten `{statusPageIdOrDomain}` sagt, können Sie die ID der Seite oder eine ihrer verifizierten eigenen Domains senden, etwa `status.example.com`. Der Verfügbarkeits-Endpunkt nimmt nur die ID.

## Endpunkte

| Endpunkt | Methoden | Liefert |
| -------- | ------- | ------- |
| `/overview/{statusPageIdOrDomain}` | `GET`, `POST` | Alles, was die Übersicht zeigt: den Gesamtstatus, Ressourcen und Gruppen, aktive Vorfälle und Episoden, geplante Wartung, laufende Ankündigungen und die Daten hinter den Verfügbarkeitsbalken. |
| `/uptime/{statusPageId}` | `POST` | Verfügbarkeit in Prozent pro Ressource und pro Gruppe, für einen Zeitraum. |
| `/incidents/{statusPageIdOrDomain}` | `GET`, `POST` | Die Vorfälle, die die Seite auflistet, mit ihren öffentlichen Notizen und Statuswechseln. |
| `/incidents/{statusPageIdOrDomain}/{incidentId}` | `POST` | Ein Vorfall. |
| `/episodes/{statusPageIdOrDomain}` | `POST` | Die Vorfall-Episoden, die die Seite auflistet. |
| `/episodes/{statusPageIdOrDomain}/{episodeId}` | `POST` | Eine Episode. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}` | `GET`, `POST` | Die geplanten Wartungsereignisse, die die Seite auflistet, mit ihren öffentlichen Notizen und Statuswechseln. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}/{scheduledMaintenanceId}` | `POST` | Ein geplantes Wartungsereignis. |
| `/announcements/{statusPageIdOrDomain}` | `GET`, `POST` | Die Ankündigungen, die die Seite auflistet. |
| `/announcements/{statusPageIdOrDomain}/{announcementId}` | `POST` | Eine Ankündigung. |

Die Endpunkte folgen den eigenen Einstellungen der Seite in der Karte **Was Ihre Statusseite zeigt** (siehe [Auswählen, was auf der Seite erscheint](/docs/status-pages/index#auswählen-was-auf-der-seite-erscheint)):

- Eine ausgeschaltete Liste verweigert ihren Endpunkt, zum Beispiel mit `Incidents are not enabled on this status page.`
- Jede Liste reicht so weit zurück, wie ihre Einstellung **Die letzten … Tage anzeigen** sagt (standardmäßig 14). Die Vorfallliste enthält außerdem jeden noch nicht behobenen Vorfall, die Liste der geplanten Wartung jedes Ereignis, das noch bevorsteht oder gerade läuft.
- Über seine ID wird ein Vorfall, eine Episode, ein Ereignis oder eine Ankündigung unabhängig vom Alter geliefert, sodass ein Link auf einen älteren Eintrag weiter funktioniert. Einer, den die Seite überhaupt nicht zeigt, etwa ein Vorfall an einem Monitor, der nicht auf der Seite ist, kommt als leere Liste zurück, eine Episode als `404`.

**Welche Vorfälle eine Seite liefert.** Der Vorfall-Endpunkt liefert die Vorfälle an den Monitoren der Seite, ohne die auf andere Statusseiten beschränkten, und ohne jeden nicht auf diese Seite beschränkten Vorfall, wenn die Seite nur auf sie beschränkte Vorfälle zeigt (siehe [Eine Statusseite pro Zielgruppe](/docs/status-pages/one-status-page-per-audience)). Auf welche Seiten ein Vorfall beschränkt ist, steht nie in der Antwort.

## Die Übersicht lesen

Die Übersicht ist eine Anfrage für die ganze Seite. Es sind dieselben Daten, die die Statusseite zeichnet, und sie sind höchstens 15 Sekunden alt.

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

Der Gesamtstatus ist der schlechteste aktuelle Status der Monitore und Monitorgruppen auf der Seite, der mit der höchsten Priorität. Ein Monitorstatus sieht so aus:

```json
{
  "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
  "name": "Operational",
  "color": { "_type": "Color", "value": "#2ab57d" },
  "isOperationalState": true,
  "priority": 1
}
```

### Was die Übersicht liefert

| Schlüssel | Was er enthält |
| --- | ------------- |
| `overallStatus` | Den Gesamtstatus der Seite, ein Monitorstatus wie oben, oder `null`, wenn auf der Seite nichts steht. |
| `statusPage` | Die öffentlichen Einstellungen der Seite: Titel, Beschreibung, Branding und was sie zeigt. |
| `statusPageResources` | Jede Ressource: ihren Anzeigenamen, ihre Beschreibung, Gruppe, ihren Monitor oder ihre Monitorgruppe und ihre Anzeigeoptionen. |
| `resourceGroups` | Die Gruppen, mit `parentStatusPageGroupId` für verschachtelte Gruppen. |
| `monitorStatuses` | Jeden Monitorstatus des Projekts, von der niedrigsten Priorität bis zur höchsten. |
| `monitorGroupCurrentStatuses`, `monitorsInGroup` | Den aktuellen Status jeder Monitorgruppe auf der Seite und die Monitore darin. |
| `monitorStatusTimelines`, `uptimeDailyAggregate`, `monitorGroupMergedDowntime`, `statusPageHistoryChartBarColorRules` | Woraus die Verfügbarkeitsbalken gezeichnet werden, und die Balkenfarbregeln der Seite. |
| `activeIncidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates` | Die nicht behobenen Vorfälle, die die Seite zeigt, ihre öffentlichen Notizen und Statuswechsel sowie die Vorfallstatus des Projekts. |
| `timelineIncidents` | Die Vorfälle im Zeitfenster der Verfügbarkeitsbalken, behobene eingeschlossen, für die Tooltips der Balken. |
| `activeEpisodes`, `episodePublicNotes`, `episodeStateTimelines` | Dasselbe für Vorfall-Episoden. |
| `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates` | Die geplanten Wartungsereignisse, die noch bevorstehen oder gerade laufen, ihre öffentlichen Notizen und Statuswechsel. |
| `activeAnnouncements` | Die Ankündigungen, die gerade angezeigt werden: begonnen und nicht beendet. |

## Verfügbarkeit für einen Zeitraum

`POST /uptime/{statusPageId}` liefert die Verfügbarkeit jeder Ressource und Gruppe der Seite zwischen zwei Daten. Beide Daten sind optional:

| Feld | Standard | Hinweise |
| ----- | ------- | ----- |
| `startDate` | Vor 14 Tagen | Datum und Uhrzeit nach ISO 8601. |
| `endDate` | Jetzt | Darf nicht vor `startDate` liegen. Der Zeitraum darf höchstens 90 Tage umfassen. |

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

Die Antwort:

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

| Schlüssel | Was er enthält |
| --- | ------------- |
| `statusPageResourceUptimes` | Die Ressourcen ohne Gruppe, die Besucher oben auf der Seite sehen. |
| `groupUptimes` | Ein Eintrag pro Gruppe. `uptimePercent` und `currentStatus` einer Gruppe decken jede Ressource unter ihr ab, verschachtelte Gruppen eingeschlossen; ihr `statusPageResourceUptimes` listet nur die Ressourcen direkt in ihr. Bauen Sie den Baum mit `parentStatusPageGroupId` wieder auf. |
| `uptimePercent` | Gerundet auf die eigene Genauigkeit der Ressource oder Gruppe. `null`, wenn die Ressource oder Gruppe keinen Verfügbarkeitsprozentsatz zeigt. |
| `currentStatus` | `null`, wenn die Ressource oder Gruppe ihren aktuellen Status nicht zeigt. |

Zeit zählt als Ausfallzeit, wenn ihr Monitorstatus einer der Status unter **Zählt als Ausfallzeit** der Seite ist.

## Vorfälle, Episoden, Wartung und Ankündigungen

Die Listen-Endpunkte beantworten `GET` ebenso wie `POST`; die Endpunkte für einzelne Einträge und die Episoden-Endpunkte beantworten `POST`.

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

| Endpunkt | Schlüssel in der Antwort |
| -------- | -------------------- |
| Vorfälle | `incidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Episoden | `episodes`, `episodePublicNotes`, `episodeStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Geplante Wartungsereignisse | `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates`, `statusPageResources`, `monitorsInGroup` |
| Ankündigungen | `announcements`, `statusPageResources`, `monitorsInGroup` |

Eine Anfrage nach einem einzelnen Eintrag antwortet mit denselben Schlüsseln, die diesen einen Datensatz enthalten.

## Fehler

Ein Fehler antwortet mit einem Statuscode und einem JSON-Inhalt, der den Grund nennt:

```json
{ "error": "You can only get uptime for 90 days. Please select a date range within 90 days." }
```

| Status | Wann |
| ------ | ---- |
| `400` | Die Anfrage fragt nach etwas, das die Seite nicht zeigt, etwa einer ausgeschalteten Liste, oder der Verfügbarkeitszeitraum ist länger als 90 Tage oder endet, bevor er beginnt. |
| `401` | Die Seite ist privat, und die Anfrage hat weder eine angemeldete Sitzung noch das Passwort dafür. Auch eine gültig geformte ID, zu der es keine Statusseite gibt, wird mit `401` beantwortet. |
| `403` | Die IP-Freigabeliste der Seite enthält die Adresse des Aufrufers nicht. |
| `404` | Die ID ist nicht gültig geformt, keine verifizierte eigene Domain passt, oder die Seite ist archiviert. Auch eine Episode, die die Seite nicht zeigt, wird mit `404` beantwortet. |

## Andere Wege, eine Statusseite zu lesen

- **RSS.** Jede Statusseite stellt `/rss` bereit, einen Feed ihrer Vorfälle, Ankündigungen und geplanten Wartungsereignisse. Siehe [Das einbettbare Badge und der RSS-Feed](/docs/status-pages/index#das-einbettbare-badge-und-der-rss-feed).
- **llms.txt.** Neben `/rss` stellt jede Statusseite `/llms.txt` bereit, das KI-Agenten auf den RSS-Feed und das Übersichts-JSON verweist.
- **MCP.** KI-Agenten können die Seite über den MCP-Server von OneUptime unter `https://oneuptime.com/mcp` lesen, ohne API-Schlüssel, indem sie die ID oder Domain der Seite als `statusPageIdOrDomain` übergeben. Er ist standardmäßig eingeschaltet; schalten Sie ihn mit **MCP-Server aktivieren** unter **KI → MCP** im Seitenmenü der Seite aus. Siehe [MCP-Server](/docs/ai/mcp-server).
- **Die REST-API.** Um Statusseiten, Ressourcen, Abonnenten und Ankündigungen zu erstellen oder zu ändern, verwenden Sie die [OneUptime-API](/docs/api-reference/api-reference) mit einem API-Schlüssel.

## Nächste Schritte

:::cards
- [Statusseiten – Übersicht](/docs/status-pages/index): Was eine Statusseite zeigt und wer sie sehen darf.
- [Statusseiten – Ressourcen & Gruppen](/docs/status-pages/resources-and-groups): Die Ressourcen und Gruppen, die diese Endpunkte liefern.
- [Eine Statusseite pro Zielgruppe](/docs/status-pages/one-status-page-per-audience): Warum eine Seite einen Vorfall auflistet, den eine andere nicht zeigt.
- [Statusseiten – Branding & Domains](/docs/status-pages/branding-and-domains): Die Seite und diese Endpunkte unter Ihrer eigenen Domain ausliefern.
:::
