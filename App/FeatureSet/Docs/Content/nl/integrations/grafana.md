# Grafana-integratie

Zet [Grafana](https://grafana.com)-alerts om in OneUptime-incidenten. Grafana evalueert de alertingregels op je dashboards; OneUptime registreert, escaleert en bewaakt ze.

Deze integratie is **inbound**: Grafana's alerting post naar een OneUptime **[Workflow](/docs/workflows/index)** die start met een **Webhook trigger**, via een Grafana **Webhook contact point**.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Vereisten

- Grafana 9+ met [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) ingeschakeld (de standaard op moderne Grafana).
- Grafana moet je OneUptime-instantie via HTTPS kunnen bereiken.
- Een OneUptime-project waar je workflows kunt aanmaken.

## Stap 1 — Bouw de OneUptime-workflow

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

De webhook-payload van Grafana volgt de Alertmanager-vorm — hij bevat `status`, een `alerts`-array, `commonLabels` en `commonAnnotations`, plus handige velden `title` en `message` op het hoogste niveau.

## Stap 2 — Configureer het Grafana-contactpunt

1. Ga in Grafana naar **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: plak de webhook-URL van je workflow. **HTTP Method**: `POST`.
4. Sla het contactpunt op.
5. Ga naar **Alerting → Notification policies** en routeer de gewenste alerts (of het standaardbeleid) naar het contactpunt **OneUptime**.

## Stap 3 — Test het

1. Schakel de workflow in.
2. Gebruik in het contactpuntscherm **Test** om een voorbeeldnotificatie te sturen, of laat een echte alertregel afgaan.
3. Controleer het tabblad **Logboeken** van de workflow en je lijst met **Incidenten**.

## Oplossen bij herstel (optioneel)

Wanneer de alert wegvalt, stuurt Grafana een andere notificatie met `status: resolved`. Voeg een tweede **Voorwaarden**-tak toe (`status == resolved`), zoek het bijbehorende incident, en verplaats het naar je opgeloste status met **Update Incident**.

## Opmerkingen

- **Legacy alerting (Grafana 8 en eerder)** stuurt een andere payload (`ruleName`, `state`, `evalMatches`). Als je legacy alerting gebruikt, verwijs dan naar `{{Grafana.Request Body.ruleName}}` en `{{Grafana.Request Body.state}}` in plaats daarvan, en vertak op `state == alerting`.
- Je kunt ook Grafana's alerting volledig overslaan en OneUptime dezelfde metrics direct laten monitoren — zie de [Metrics Monitor](/docs/monitor/metrics-monitor).

## Probleemoplossing

- **Er verschijnt geen run** — bevestig dat Grafana de URL kan bereiken (controleer Grafana's serverlogs) en dat de workflow **Ingeschakeld** is.
- **Lege velden** — bekijk de triggeruitvoer in het tabblad **Logboeken**; verwijs naar velden die bestaan voor jouw alertingversie.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — het inbound-patroon.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — nauw verwante payload.
- [Metrics Monitor](/docs/monitor/metrics-monitor) — metrics direct in OneUptime monitoren.
