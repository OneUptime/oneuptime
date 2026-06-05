# Prometheus Alertmanager-integratie

Zet [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)-notificaties om in OneUptime-incidenten. Prometheus evalueert je alertingregels, Alertmanager routeert ze, en OneUptime registreert en escaleert ze.

Deze integratie is **inbound**: Alertmanager POST naar een OneUptime **[Workflow](/docs/workflows/index)** die start met een **Webhook trigger**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Vereisten

- Een Prometheus + Alertmanager-setup waarbij je `alertmanager.yml` kunt bewerken.
- Alertmanager moet je OneUptime-instantie via HTTPS kunnen bereiken.
- Een OneUptime-project waar je workflows kunt aanmaken.

## Stap 1 — Bouw de OneUptime-workflow

1. Open **Workflows → Create Workflow**, geef het de naam `Alertmanager → Incidents`, en open de **Builder**.
2. Voeg een **Webhook**-trigger toe en **kopieer de URL**. Hernoem het blok naar `Alertmanager`.
3. Voeg een **Conditions**-blok toe verbonden met de trigger:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Voeg vanuit **Yes** een **Create Incident**-blok toe:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: kies er een (of vertak eerst op `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Sla op** (laat uitgeschakeld totdat getest).

> **Over gegroepeerde alerts.** Alertmanager groepeert alerts en stuurt een `alerts`-**array**. De `commonLabels` en `commonAnnotations` hierboven zijn de velden die over de groep worden gedeeld — ideaal voor één incident per notificatie. Als je **één incident per alert** wilt, voeg je een [Custom Code](/docs/workflows/components#custom-code)-blok toe dat over `Request Body.alerts` loopt en voor elk een incident aanmaakt. Stel groepering in met `group_by` in je route.

## Stap 2 — Configureer Alertmanager

Voeg een webhook-receiver toe die naar de workflow-URL wijst, en routeer alerts ernaar. In `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Herlaad Alertmanager (`curl -X POST http://localhost:9093/-/reload` of herstart hem).

## Stap 3 — Test het

1. Schakel de workflow in.
2. Gooi een testalert — bijvoorbeeld met `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Controleer het tabblad **Logs** van de workflow en je lijst met **Incidents**.

## Oplossen bij herstel (optioneel)

Met `send_resolved: true` POST Alertmanager ook wanneer een alert wegvalt, ditmaal met `status: resolved`. Voeg een tweede **Conditions**-tak toe (`status == resolved`), zoek het bijbehorende incident (match op `commonLabels.alertname`), en verplaats het naar je opgeloste status met **Update Incident**.

## Probleemoplossing

- **Er verschijnt geen run** — bevestig dat Alertmanager de URL kan bereiken (controleer de logs ervan op afleverfouten) en dat de workflow **Enabled** is.
- **Incidentvelden zijn leeg** — verschillende regels stellen verschillende annotaties in. Bekijk de triggeruitvoer in het tabblad **Logs** en verwijs naar velden die daadwerkelijk bestaan (`commonAnnotations` versus per-alert `annotations`).
- **Te veel incidenten** — verhoog `group_by`/`group_interval` zodat Alertmanager gerelateerde alerts groepeert.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — het inbound-patroon.
- [Grafana](/docs/integrations/grafana) — hetzelfde idee voor Grafana alerting.
- [Webhook trigger](/docs/workflows/triggers#webhook) — hoe de ontvangende URL werkt.
