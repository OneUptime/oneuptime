# Grafana-integratie

Zet [Grafana](https://grafana.com)-alerts om in OneUptime-incidenten. Grafana evalueert de alertregels op je dashboards; OneUptime legt ze vast, escaleert ze en volgt ze op.

Deze integratie is **inbound**: een Grafana-**Webhook-contactpunt** POST naar OneUptime. Er zijn twee manieren om dat te ontvangen.

| Aanpak                                                                              | Gebruik dit wanneer                                                                                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Inkomend verzoek-monitor](/docs/monitor/incoming-request-monitor)** (aanbevolen) | Je wilt dat alerts incidenten worden met wachtdienst-escalatie, één incident per alert en automatische oplossing bij herstel.               |
| **[Workflow](/docs/workflows/index) met een Webhook trigger**                       | Je hebt routeringslogica nodig die OneUptime niet standaard biedt — andere systemen aanroepen, payloads omvormen, voorwaardelijk vertakken. |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

De webhook-payload van Grafana volgt de Alertmanager-vorm — `status`, een `alerts`-array, `commonLabels` en `commonAnnotations`, plus handige velden `title` en `message` op het hoogste niveau.

## Vereisten

- Grafana 9+ met [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) ingeschakeld (de standaard op modern Grafana).
- Grafana moet je OneUptime-instantie via HTTPS kunnen bereiken.
- Een OneUptime-project waarin je monitors (of workflows) kunt aanmaken.

## Optie 1 — Inkomend verzoek-monitor

1. Ga naar **Monitors → Monitor maken** en kies **Inkomend verzoek**. Open hem en klik op **Documentation** in het linkermenu om de URL te kopiëren.
2. Open de **Criteria** van de monitor en zet **Filter Type** op `JavaScript Expression` en **Value** op `"{{requestBody.status}}" === "firing"`.
3. Maak bij een match een incident aan, kies de **On-Call Policies** die opgeroepen moeten worden, en zet **Auto Resolve Incident** aan onder **Advanced Options**.
4. Zet onder **Settings** de optie **Group incidents and alerts by a payload field** aan en stel in:

   | Veld                               | Waarde                              |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Geef het incident de titel `{{requestBody.commonLabels.alertname}}` en beschrijf het met `{{requestBody.message}}` of `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` bevat de groeperingssleutel zelf, maar dat is een hash — niet iets om aan een responder te tonen.)
6. Richt het Grafana-contactpunt op de URL van de monitor (zie de stappen voor het contactpunt hieronder).

Elke **unieke** groeperingswaarde wordt een eigen incident, en elk daarvan sluit wanneer Grafana meldt dat het is opgelost. De `fingerprint` per alert van Grafana is uniek voor de labelset van een alert, en daarom is dat hierboven het groeperingspad. De pagina [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) loopt dezelfde opzet uitgebreider door — de vorm van de payload is dezelfde, dus elke stap daar geldt ook hier.

> **Warning:** Groepeer niet op een label dat binnen een melding constant is. Grafana's standaard notificatiebeleid groepeert op `grafana_folder` en `alertname`, dus elke alert in één webhook deelt dezelfde alertname — groeperen op `requestBody.alerts[*].labels.alertname` zou de hele payload tot één incident laten samenvallen. De groeperingspaden moeten bovendien beginnen met het letterlijke `requestBody.`, en alleen de eerste `[*]` in een pad is een jokerteken. Al deze fouten mislukken stilzwijgend.

## Optie 2 — Workflow

Gebruik dit wanneer je logica nodig hebt die verder gaat dan "een alert wordt een incident".

### Stap 1 — Bouw de OneUptime-workflow

1. Open **Workflows → Workflow maken**, geef het de naam `Grafana → Incidents`, en open de **Bouwer**.
2. Voeg een **Webhook**-trigger toe en **kopieer de URL**. Hernoem het blok naar `Grafana`.
3. Voeg een **Voorwaarden**-blok toe verbonden met de trigger:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Voeg vanuit **Ja** een **Incident maken**-blok toe:
   - **Titel**: `{{Grafana.Request Body.title}}`
   - **Beschrijving**: `{{Grafana.Request Body.message}}`
   - **Ernst**: kies er een (of vertak op `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Opslaan** (laat uitgeschakeld totdat getest).

## Configureer het Grafana-contactpunt

1. Ga in Grafana naar **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: plak de monitor-URL uit Optie 1, of de webhook-URL van de workflow uit Optie 2. **HTTP Method**: `POST`.
4. Sla het contactpunt op.
5. Ga naar **Alerting → Notification policies** en routeer de gewenste alerts (of het standaardbeleid) naar het contactpunt **OneUptime**.

## Test het

1. Schakel de workflow in, als je er een hebt gebouwd.
2. Gebruik in het scherm van het contactpunt **Test** om een voorbeeldmelding te sturen, of laat een echte alertregel afgaan.
3. Controleer je lijst met **Incidenten** — en het tabblad **Logs** van de workflow als je Optie 2 gebruikte.

## Oplossen bij herstel

Wanneer de alert wegvalt, stuurt Grafana nog een melding met `status: resolved`.

Met **Optie 1** sluiten het hierboven ingestelde herstelveld en de waarde het bijbehorende incident automatisch — mits **Auto Resolve Incident** aan staat.

Met **Optie 2** voeg je een tweede **Voorwaarden**-tak toe (`status == resolved`), zoek je het bijbehorende incident op en verplaats je het met **Update Incident** naar je opgeloste status.

## Opmerkingen

- **Legacy alerting (Grafana 8 en ouder)** stuurt een andere payload (`ruleName`, `state`, `evalMatches`). Gebruik je legacy alerting, verwijs dan naar `{{Grafana.Request Body.ruleName}}` en `{{Grafana.Request Body.state}}`, en vertak op `state == alerting`.
- Je kunt de alerting van Grafana ook helemaal overslaan en OneUptime dezelfde metrics rechtstreeks laten monitoren — zie de [Metrics-monitor](/docs/monitor/metrics-monitor).

## Probleemoplossing

- **Er komt niets binnen** — bevestig dat Grafana de URL kan bereiken (controleer de serverlogs van Grafana) en, bij Optie 2, dat de workflow **Ingeschakeld** is. OneUptime beantwoordt elk inkomend verzoek met een lege `200` voordat het gevalideerd wordt, dus een `200` in Grafana's logs bevestigt niet dat de payload is geaccepteerd.
- **Incidenten gaan open maar sluiten nooit** — controleer het herstelveld en de waarde op het criterium, en of **Auto Resolve Incident** aan staat onder de **Advanced Options** van het incident. De vergelijking is hoofdlettergevoelig.
- **Slechts één incident voor een payload vol alerts** — je hebt gegroepeerd op een label dat binnen een melding niet varieert. Groepeer in plaats daarvan op `requestBody.alerts[*].fingerprint`.
- **De incidenttekst toont ruwe `{{...}}`-placeholders** — het pad is niet omgezet, en niet-omgezette placeholders blijven staan in plaats van leeggemaakt te worden. Verwijs naar velden die in jouw alerting-versie bestaan; inspecteer de trigger-uitvoer op het tabblad **Logs** als je Optie 2 gebruikte.

## Waar verder lezen

- [Inkomend verzoek-monitor](/docs/monitor/incoming-request-monitor) — het monitortype, zijn criteria en incidentgroepering in volle breedte.
- [Overzicht van integraties](/docs/integrations/index) — het inbound-patroon.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — nauw verwante payload.
- [Metrics-monitor](/docs/monitor/metrics-monitor) — monitor metrics rechtstreeks in OneUptime.
