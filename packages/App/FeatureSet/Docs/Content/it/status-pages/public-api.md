# API pubblica

Ogni pagina di stato risponde a un piccolo insieme di endpoint JSON in sola lettura: la sua panoramica, la disponibilità, gli incidenti, gli episodi, gli eventi di manutenzione pianificata e gli annunci. Sono gli endpoint che la pagina di stato stessa carica, quindi restituiscono esattamente ciò che vede un visitatore, e una pagina pubblica non richiede alcuna chiave API. Usali per mostrare il tuo stato nella tua app, in un chatbot o su uno schermo a parete.

:::cards
- [Endpoint](#endpoint): Un endpoint per ogni cosa che mostra la pagina.
- [Leggere la panoramica](#leggere-la-panoramica): L'intera pagina in una richiesta, con curl, Node.js e Python.
- [Disponibilità in un intervallo di date](#disponibilità-in-un-intervallo-di-date): La disponibilità per risorsa e per gruppo, fino a 90 giorni.
- [Errori](#errori): Cosa significa ogni codice di stato.
:::

## Come viene gestita una richiesta

Ogni richiesta indica la pagina di stato con il suo ID o con uno dei suoi domini personalizzati. OneUptime trova la pagina, applica le stesse regole di accesso che incontra un visitatore e risponde in JSON.

```mermaid title="Come viene gestita una richiesta all'API di una pagina di stato"
flowchart TB
    R["Richiesta con l'ID o il dominio<br/>di una pagina di stato"] --> F{"ID ben formato<br/>o dominio verificato?"}
    F -->|"No"| E404["404: Status Page not found"]
    F -->|"Sì"| A{"Pagina archiviata?"}
    A -->|"Sì"| E404
    A -->|"No"| IP{"La lista di IP consentiti<br/>fa passare il chiamante?"}
    IP -->|"No"| E403["403: indirizzo IP bloccato"]
    IP -->|"Sì"| P{"La pagina è pubblica?"}
    P -->|"Sì"| OK["200 con JSON"]
    P -->|"No"| S{"Accesso effettuato, o sbloccata<br/>con la password?"}
    S -->|"Sì"| OK
    S -->|"No"| E401["401: non autenticato"]
```

Una pagina privata risponde solo a un browser che vi ha effettuato l'accesso o che l'ha sbloccata con la sua password: l'API legge la stessa sessione della pagina. Per uno script, usa una pagina pubblica. Vedi [Limitare chi può vedere la pagina](/docs/status-pages/index#limitare-chi-può-vedere-la-pagina).

Un ID ben formato che non appartiene a nessuna pagina di stato segue lo stesso percorso di una pagina privata e riceve `401`. Se una pagina pubblica risponde `401`, controlla l'ID.

## Prima di iniziare

- **L'ID della pagina di stato.** Apri la pagina nella dashboard (**Pagine di stato → Tutte le pagine di stato**, poi la pagina). La scheda **Dettagli della pagina di stato** nella sua **Panoramica** mostra l'**ID della pagina di stato**.
- **L'URL di base.** Ogni endpoint qui sotto si trova sotto `/status-page-api`:

| Dove gira la pagina | URL di base |
| ------------------- | -------- |
| OneUptime Cloud | `https://oneuptime.com/status-page-api` |
| OneUptime self-hosted | `https://<your-oneuptime-host>/status-page-api` |
| Un dominio personalizzato della pagina | `https://status.example.com/status-page-api` |

Dove un percorso qui sotto riporta `{statusPageIdOrDomain}`, puoi inviare l'ID della pagina o uno dei suoi domini personalizzati verificati, come `status.example.com`. L'endpoint della disponibilità accetta solo l'ID.

## Endpoint

| Endpoint | Metodi | Restituisce |
| -------- | ------- | ------- |
| `/overview/{statusPageIdOrDomain}` | `GET`, `POST` | Tutto ciò che mostra la panoramica: lo stato complessivo, le risorse e i gruppi, gli incidenti e gli episodi attivi, la manutenzione pianificata, gli annunci in corso e i dati delle barre di disponibilità. |
| `/uptime/{statusPageId}` | `POST` | Le percentuali di disponibilità per risorsa e per gruppo, in un intervallo di date. |
| `/incidents/{statusPageIdOrDomain}` | `GET`, `POST` | Gli incidenti che la pagina elenca, con le loro note pubbliche e i cambi di stato. |
| `/incidents/{statusPageIdOrDomain}/{incidentId}` | `POST` | Un incidente. |
| `/episodes/{statusPageIdOrDomain}` | `POST` | Gli episodi di incidenti che la pagina elenca. |
| `/episodes/{statusPageIdOrDomain}/{episodeId}` | `POST` | Un episodio. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}` | `GET`, `POST` | Gli eventi di manutenzione pianificata che la pagina elenca, con le loro note pubbliche e i cambi di stato. |
| `/scheduled-maintenance-events/{statusPageIdOrDomain}/{scheduledMaintenanceId}` | `POST` | Un evento di manutenzione pianificata. |
| `/announcements/{statusPageIdOrDomain}` | `GET`, `POST` | Gli annunci che la pagina elenca. |
| `/announcements/{statusPageIdOrDomain}/{announcementId}` | `POST` | Un annuncio. |

Gli endpoint seguono le impostazioni della pagina stessa, nella scheda **Cosa mostra la tua pagina di stato** (vedi [Scegliere che cosa compare sulla pagina](/docs/status-pages/index#scegliere-che-cosa-compare-sulla-pagina)):

- Un elenco disattivato rifiuta il suo endpoint, ad esempio con `Incidents are not enabled on this status page.`
- Ogni elenco risale fino a dove indica la sua impostazione **Mostra … giorni di cronologia** (14 per impostazione predefinita). L'elenco degli incidenti include anche ogni incidente non ancora risolto, e quello della manutenzione pianificata ogni evento in arrivo o in corso.
- Con il suo ID, un incidente, un episodio, un evento o un annuncio viene restituito qualunque sia la sua età, quindi un link a uno più vecchio continua a funzionare. Uno che la pagina non mostra affatto, come un incidente su un monitor che non è nella pagina, torna come elenco vuoto, e un episodio come `404`.

**Quali incidenti restituisce una pagina.** L'endpoint degli incidenti restituisce gli incidenti sui monitor della pagina, meno quelli limitati ad altre pagine di stato, e meno ogni incidente non limitato a questa pagina se la pagina mostra solo gli incidenti limitati a lei (vedi [Una pagina di stato per pubblico](/docs/status-pages/one-status-page-per-audience)). Le pagine a cui un incidente è limitato non fanno mai parte della risposta.

## Leggere la panoramica

La panoramica è una sola richiesta per l'intera pagina. Sono gli stessi dati che disegna la pagina di stato, e hanno al massimo 15 secondi.

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

Lo stato complessivo è il peggior stato attuale dei monitor e dei gruppi di monitor sulla pagina, quello con la priorità più alta. Uno stato di monitor ha questo aspetto:

```json
{
  "_id": "cc80b385-4190-42a3-ae8b-9b391e90d79f",
  "name": "Operational",
  "color": { "_type": "Color", "value": "#2ab57d" },
  "isOperationalState": true,
  "priority": 1
}
```

### Cosa restituisce la panoramica

| Chiave | Cosa contiene |
| --- | ------------- |
| `overallStatus` | Lo stato complessivo della pagina, uno stato di monitor come quello sopra, oppure `null` quando la pagina non contiene nulla. |
| `statusPage` | Le impostazioni pubbliche della pagina: titolo, descrizione, branding e ciò che mostra. |
| `statusPageResources` | Ogni risorsa: il nome visualizzato, la descrizione, il gruppo, il monitor o gruppo di monitor e le opzioni di visualizzazione. |
| `resourceGroups` | I gruppi, con `parentStatusPageGroupId` per i gruppi annidati. |
| `monitorStatuses` | Ogni stato di monitor del progetto, dalla priorità più bassa alla più alta. |
| `monitorGroupCurrentStatuses`, `monitorsInGroup` | Lo stato attuale di ogni gruppo di monitor della pagina, e i monitor che contiene. |
| `monitorStatusTimelines`, `uptimeDailyAggregate`, `monitorGroupMergedDowntime`, `statusPageHistoryChartBarColorRules` | Ciò da cui vengono disegnate le barre di disponibilità, e le regole di colore delle barre della pagina. |
| `activeIncidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates` | Gli incidenti non risolti che la pagina mostra, le loro note pubbliche e i cambi di stato, e gli stati degli incidenti del progetto. |
| `timelineIncidents` | Gli incidenti nella finestra delle barre di disponibilità, compresi quelli risolti, per i tooltip delle barre. |
| `activeEpisodes`, `episodePublicNotes`, `episodeStateTimelines` | Lo stesso per gli episodi di incidenti. |
| `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates` | Gli eventi di manutenzione pianificata in arrivo o in corso, le loro note pubbliche e i cambi di stato. |
| `activeAnnouncements` | Gli annunci visibili adesso: iniziati e non ancora terminati. |

## Disponibilità in un intervallo di date

`POST /uptime/{statusPageId}` restituisce la disponibilità di ogni risorsa e gruppo della pagina tra due date. Entrambe le date sono facoltative:

| Campo | Predefinito | Note |
| ----- | ------- | ----- |
| `startDate` | 14 giorni fa | Una data e un'ora ISO 8601. |
| `endDate` | Adesso | Non deve precedere `startDate`. L'intervallo può coprire al massimo 90 giorni. |

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

La risposta:

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

| Chiave | Cosa contiene |
| --- | ------------- |
| `statusPageResourceUptimes` | Le risorse che non stanno in nessun gruppo, quelle che i visitatori vedono in cima alla pagina. |
| `groupUptimes` | Una voce per gruppo. `uptimePercent` e `currentStatus` di un gruppo coprono ogni risorsa sotto di esso, gruppi annidati compresi; il suo `statusPageResourceUptimes` elenca solo le risorse direttamente al suo interno. Ricostruisci l'albero con `parentStatusPageGroupId`. |
| `uptimePercent` | Arrotondato alla precisione propria della risorsa o del gruppo. `null` quando la risorsa o il gruppo non mostra una percentuale di disponibilità. |
| `currentStatus` | `null` quando la risorsa o il gruppo non mostra il suo stato attuale. |

Il tempo conta come inattività quando il suo stato di monitor è uno degli stati **Conta come inattività** della pagina.

## Incidenti, episodi, manutenzione e annunci

Gli endpoint degli elenchi rispondono a `GET` oltre che a `POST`; quelli del singolo elemento e quelli degli episodi rispondono a `POST`.

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

| Endpoint | Chiavi nella risposta |
| -------- | -------------------- |
| Incidenti | `incidents`, `incidentPublicNotes`, `incidentStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Episodi | `episodes`, `episodePublicNotes`, `episodeStateTimelines`, `incidentStates`, `statusPageResources`, `monitorsInGroup` |
| Eventi di manutenzione pianificata | `scheduledMaintenanceEvents`, `scheduledMaintenanceEventsPublicNotes`, `scheduledMaintenanceStateTimelines`, `scheduledMaintenanceStates`, `statusPageResources`, `monitorsInGroup` |
| Annunci | `announcements`, `statusPageResources`, `monitorsInGroup` |

Una richiesta per un singolo elemento risponde con le stesse chiavi, che contengono quel solo record.

## Errori

Un errore risponde con un codice di stato e un corpo JSON che ne spiega il motivo:

```json
{ "error": "You can only get uptime for 90 days. Please select a date range within 90 days." }
```

| Stato | Quando |
| ------ | ---- |
| `400` | La richiesta chiede qualcosa che la pagina non mostra, come un elenco disattivato, oppure l'intervallo della disponibilità supera i 90 giorni o finisce prima di iniziare. |
| `401` | La pagina è privata e la richiesta non ha né una sessione con accesso né la password per essa. Anche un ID ben formato che non appartiene a nessuna pagina di stato riceve `401`. |
| `403` | La lista di IP consentiti della pagina non include l'indirizzo del chiamante. |
| `404` | L'ID non è ben formato, nessun dominio personalizzato verificato corrisponde, oppure la pagina è archiviata. Anche un episodio che la pagina non mostra riceve `404`. |

## Altri modi per leggere una pagina di stato

- **RSS.** Ogni pagina di stato serve `/rss`, un feed dei suoi incidenti, annunci ed eventi di manutenzione pianificata. Vedi [Il badge incorporabile e il feed RSS](/docs/status-pages/index#il-badge-incorporabile-e-il-feed-rss).
- **llms.txt.** Accanto a `/rss`, ogni pagina di stato serve `/llms.txt`, che indirizza gli agenti di IA verso il feed RSS e il JSON della panoramica.
- **MCP.** Gli agenti di IA possono leggere la pagina tramite il server MCP di OneUptime all'indirizzo `https://oneuptime.com/mcp`, senza chiave API, passando l'ID o il dominio della pagina come `statusPageIdOrDomain`. È attivo per impostazione predefinita; disattivalo con **Abilita server MCP** in **IA → MCP** nel menu laterale della pagina. Vedi [Server MCP](/docs/ai/mcp-server).
- **L'API REST.** Per creare o modificare pagine di stato, risorse, iscritti e annunci, usa l'[API di OneUptime](/docs/api-reference/api-reference) con una chiave API.

## Passaggi successivi

:::cards
- [Panoramica delle pagine di stato](/docs/status-pages/index): Cosa mostra una pagina di stato e chi può vederla.
- [Risorse e gruppi della pagina di stato](/docs/status-pages/resources-and-groups): Le risorse e i gruppi che restituiscono questi endpoint.
- [Una pagina di stato per pubblico](/docs/status-pages/one-status-page-per-audience): Perché una pagina elenca un incidente che un'altra non elenca.
- [Branding e domini della pagina di stato](/docs/status-pages/branding-and-domains): Servi la pagina, e questi endpoint, sul tuo dominio.
:::
