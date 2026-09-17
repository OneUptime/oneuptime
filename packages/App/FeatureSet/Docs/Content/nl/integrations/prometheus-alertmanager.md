# Prometheus Alertmanager-integratie

Zet meldingen van [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) om in OneUptime-incidenten. Prometheus evalueert je alertingregels, Alertmanager routeert ze, en OneUptime legt ze vast en escaleert ze.

Deze integratie is **inbound**, en er zijn twee manieren om hem te bouwen:

| Aanpak                                                                              | Gebruik dit wanneer                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Inkomend verzoek-monitor](/docs/monitor/incoming-request-monitor)** (aanbevolen) | Je wilt dat alerts incidenten worden met wachtdienst-escalatie, één incident per alert en automatische oplossing bij herstel. Geen eigen logica te onderhouden. |
| **[Workflow](/docs/workflows/index) met een Webhook trigger**                       | Je hebt routeringslogica nodig die OneUptime niet standaard biedt — andere systemen aanroepen, payloads omvormen, voorwaardelijk vertakken.                     |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Vereisten

- Een Prometheus + Alertmanager-opzet waarin je `alertmanager.yml` kunt bewerken.
- Alertmanager moet je OneUptime-instantie via HTTPS kunnen bereiken.
- Een OneUptime-project waarin je monitors (of workflows) kunt aanmaken.

## Optie 1 — Inkomend verzoek-monitor

### Stap 1 — Maak de monitor aan

1. Ga naar **Monitors → Monitor maken** en kies **Inkomend verzoek**.
2. Open de monitor en klik op **Documentation** in het linkermenu. Kopieer de URL:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Gebruik je eigen host als je zelf host. De geheime sleutel in het pad is de enige credential.

### Stap 2 — Richt Alertmanager erop

In `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` is verplicht — het is wat OneUptime vertelt dat een alert hersteld is. Herlaad Alertmanager met `curl -X POST http://localhost:9093/-/reload`, of herstart hem.

Alertmanager stuurt `Content-Type: application/json`, wat OneUptime nodig heeft om velden uit de payload te lezen.

### Stap 3 — Configureer de criteria

Open de **Criteria** van de monitor en bewerk het eerste criterium.

**Filter**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  De aanhalingstekens rond de placeholder zijn nodig voor een stringvergelijking. Een filter `Request Body` / `Contains` / `"status":"firing"` werkt ook als je liever geen expressie gebruikt.

**Acties**

- Zet _When filters match, change monitor status_ aan en stel het in op **Offline** (of Degraded).
- Zet _When filters match, declare an incident_ aan. Stel de **Title**, de **Severity** en de **On-Call Policies** in die opgeroepen moeten worden.
- Zet onder **Advanced Options** van dat incident **Auto Resolve Incident** aan. Zonder dit worden herstelmeldingen genegeerd en blijven incidenten voor altijd openstaan.

**Settings → Group incidents and alerts by a payload field**

Zet dit aan zodat één endpoint meerdere gelijktijdige incidenten kan dragen — één per alert — in plaats van één incident per melding.

| Veld                               | Waarde                              |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` waaiert uit over de `alerts`-array van Alertmanager en opent één incident per **unieke** uitgelezen waarde. Omdat beide paden `[*]` gebruiken, wordt herstel per alert beoordeeld: in een payload waarin één alert is opgelost en er twee nog actief zijn, sluit alleen de opgeloste.

> **Warning:** Groepeer op iets dat echt uniek is per alert. De `fingerprint` van Alertmanager is een hash van de volledige labelset van de alert, dus dat is hij altijd. Een label werkt alleen als het **binnen** een melding varieert — en elk label dat in de `group_by` van je route staat doet dat nooit, want dat is precies wat de aggregatiegroep definieert. Met de `group_by: ["alertname", "instance"]` hierboven haalt groeperen op `requestBody.alerts[*].labels.alertname` dezelfde waarde uit elke alert in de payload, zodat ze allemaal samenvallen tot één incident. Erger nog: van dubbele waarden blijft alleen het **eerste** voorkomen over, dus een payload waarvan de eerste alert `resolved` is sluit dat incident terwijl de rest nog actief is.

### Stap 4 — Schrijf de titel en beschrijving van het incident

De groeperingssleutel is beschikbaar als een variabele met de naam van het laatste segment van het pad, dus `requestBody.alerts[*].fingerprint` geeft je `{{fingerprint}}`. Dat is een hash, niet iets om aan een responder te tonen — geef het incident in plaats daarvan een titel op basis van de labels die de melding deelt. `commonLabels` bevat elk label uit de `group_by` van je route, dus met de configuratie hierboven zijn `alertname` en `instance` allebei beschikbaar:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` en `commonAnnotations` bevatten de velden die de melding deelt. Een pad per alert zoals `requestBody.alerts[0].annotations.summary` leest altijd de _eerste_ alert in de payload, niet die waarvoor dit specifieke incident is geopend — houd `group_by` dus strak als je wilt dat elk incident zijn eigen annotatietekst draagt. Een pad dat niet oplost wordt letterlijk afgedrukt, accolades en al, in plaats van leeg gelaten. Zie [Dynamische incident- en alerttemplates](/docs/monitor/incident-alert-templating) voor de volledige variabelenlijst.

### Stap 5 — Zet de monitor terug op Operational (optioneel)

Criteria handelen alleen wanneer ze matchen, dus voeg een tweede criterium toe zodat de monitor niet Offline blijft nadat alles is opgelost:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, en maak geen incident aan.

### Stap 6 — Test het

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

Je zou twee incidenten moeten krijgen — één per `fingerprint`. Stuur het opnieuw met de `status` van beide alerts op `resolved` en beide zouden moeten sluiten.

Je kunt ook een echte alert afvuren met `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Optie 2 — Workflow

Gebruik dit wanneer je logica nodig hebt die verder gaat dan "een alert wordt een incident".

1. Open **Workflows → Workflow maken**, geef het de naam `Alertmanager → Incidents`, en open de **Bouwer**.
2. Voeg een **Webhook**-trigger toe en **kopieer de URL**. Hernoem het blok naar `Alertmanager`.
3. Voeg een **Voorwaarden**-blok toe verbonden met de trigger:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Voeg vanuit **Ja** een **Incident maken**-blok toe:
   - **Titel**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Beschrijving**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Ernst**: kies er een (of vertak eerst op `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Opslaan**, en richt daarna de `webhook_configs`-URL uit Stap 2 hierboven op de URL van de workflow.

Voor één incident per alert voeg je een [Custom Code](/docs/workflows/components#custom-code)-blok toe dat over `Request Body.alerts` loopt. Met `send_resolved: true` voeg je een tweede **Voorwaarden**-tak toe op `status == resolved` die het bijbehorende incident opzoekt en het met **Update Incident** naar je opgeloste status verplaatst.

## Dodemansknop

Geen van beide opties vertelt je wanneer Prometheus zelf stopt met werken — geen binnenkomende alerts ziet er precies zo uit als "er is niets aan de hand". Het gebruikelijke antwoord is een altijd-actieve alert die naar een monitor wordt gerouteerd die hem volgens een schema verwacht. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) levert er een met de naam `Watchdog`; op een kale Prometheus voeg je een alertingregel toe met een expressie die altijd waar is (`vector(1)`).

Maak een **tweede** Inkomend verzoek-monitor aan, routeer `Watchdog` ernaartoe met een kort `repeat_interval`, en geef die monitor een criterium **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. Dat is het enige geval waarin een criterium voor een ontbrekend verzoek thuishoort op een alertontvanger.

Dit is de configuratie uit Stap 2 met de watchdog-route en -receiver erin verwerkt — een subroute wordt vóór de eigen receiver van de bovenliggende route beoordeeld, dus `Watchdog` gaat naar de tweede monitor en al het andere gaat nog steeds naar de eerste:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## Probleemoplossing

- **Er komt niets binnen** — bevestig dat Alertmanager de URL kan bereiken; controleer zijn logs op afleverfouten. OneUptime beantwoordt elk verzoek met een lege `200` voordat er iets gevalideerd wordt, dus een `200` bevestigt niet dat de payload is geaccepteerd. Kijk in plaats daarvan naar de tijdlijn van de monitor.
- **Incidenten gaan open maar sluiten nooit** — controleer `send_resolved: true` in Alertmanager, het herstelveld en de waarde op het criterium (de vergelijking is hoofdlettergevoelig), en **Auto Resolve Incident** onder de **Advanced Options** van het incident. Twee subtielere oorzaken: een payload met meer unieke sleutels dan **Max incidents per request** verbergt de sleutels voorbij de limiet ook voor herstel; en als juist de `resolved`-melding degene is die door het samenvoegen bij ingest (hieronder) wordt weggelaten, blijft het incident permanent hangen, omdat Alertmanager firing-meldingen herhaalt maar resolved-meldingen niet. Sluit die met de hand.
- **Helemaal geen incidenten, monitorstatus ongewijzigd** — het groeperingspad moet beginnen met het letterlijke `requestBody.`, en alleen de eerste `[*]` in een pad is een jokerteken. Beide fouten mislukken stilzwijgend.
- **De incidenttekst toont ruwe `{{...}}`-placeholders** — het pad is niet omgezet, en OneUptime laat niet-omgezette placeholders staan in plaats van ze leeg te maken. Verschillende regels zetten verschillende annotaties, dus verwijs naar velden die voor jouw regels ook echt bestaan (`commonAnnotations` versus de `annotations` per alert).
- **Slechts één incident voor een payload vol alerts** — je hebt gegroepeerd op een label dat binnen een melding niet varieert, meestal een label dat ook in de `group_by` van je route staat. Groepeer in plaats daarvan op `requestBody.alerts[*].fingerprint`.
- **Te veel incidenten** — verbreed `group_by` / `group_interval` zodat Alertmanager verwante alerts bundelt. **Max incidents per request** verlagen begrenst ze, maar verbergt de sleutels voorbij de limiet ook voor herstel.
- **Sommige meldingen lijken bij zware pieken overgeslagen te worden** — verzoeken naar dezelfde monitor worden bij ingest samengevoegd zodat één verzender een monitor niet kan overspoelen, wat een tussenliggende payload kan laten vallen wanneer meldingen kort na elkaar binnenkomen. `group_wait` en `group_interval` verhogen spreidt ze uit. Het samenvoegen wordt geregeld door de omgevingsvariabele `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` van de app-container, die standaard aan staat; zelfhostende beheerders die elke payload beoordeeld willen hebben kunnen hem op die container op `false` zetten.

## Waar verder lezen

- [Inkomend verzoek-monitor](/docs/monitor/incoming-request-monitor) — het monitortype, zijn criteria en incidentgroepering in volle breedte.
- [Overzicht van integraties](/docs/integrations/index) — de inbound- en outbound-patronen.
- [Grafana](/docs/integrations/grafana) — hetzelfde idee, Grafana-alerting.
- [Webhook trigger](/docs/workflows/triggers#webhook) — hoe de ontvangende URL van de workflow werkt.
