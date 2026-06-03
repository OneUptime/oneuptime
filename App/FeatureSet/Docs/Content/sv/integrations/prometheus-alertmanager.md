# Prometheus Alertmanager-integration

Omvandla [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/)-notifieringar till OneUptime-incidenter. Prometheus utvärderar dina larmregler, Alertmanager dirigerar dem och OneUptime registrerar och eskalerar dem.

Den här integrationen är **inkommande**: Alertmanager POSTar till ett OneUptime **[Arbetsflöde](/docs/workflows/index)** som börjar med en **Webhook-utlösare**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Förutsättningar

- En Prometheus + Alertmanager-konfiguration där du kan redigera `alertmanager.yml`.
- Alertmanager måste kunna nå din OneUptime-instans via HTTPS.
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

## Steg 1 — Bygg OneUptime-arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Alertmanager → Incidents` och öppna **Builder**.
2. Lägg till en **Webhook**-utlösare och **kopiera dess URL**. Byt namn på blocket till `Alertmanager`.
3. Lägg till ett **Conditions**-block kopplat till utlösaren:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Från **Yes**, lägg till ett **Create Incident**-block:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: välj en (eller förgrena på `{{Alertmanager.Request Body.commonLabels.severity}}` först).
5. **Spara** (lämna inaktiverat tills det testats).

> **Om grupperade larm.** Alertmanager grupperar larm och skickar en `alerts`-**array**. `commonLabels` och `commonAnnotations` ovan är de fält som delas över gruppen — perfekt för en incident per notifiering. Om du vill ha **en incident per larm**, lägg till ett [Custom Code](/docs/workflows/components#custom-code)-block som itererar över `Request Body.alerts` och skapar en incident för var och en. Justera grupperingen med `group_by` i din route.

## Steg 2 — Konfigurera Alertmanager

Lägg till en webhook-mottagare som pekar på arbetsflödets URL och dirigera larm till den. I `alertmanager.yml`:

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

Ladda om Alertmanager (`curl -X POST http://localhost:9093/-/reload` eller starta om den).

## Steg 3 — Testa det

1. Aktivera arbetsflödet.
2. Utlös ett testlarm — till exempel med `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Kontrollera arbetsflödets flik **Logs** och din lista med **Incidents**.

## Lösning vid återhämtning (valfritt)

Med `send_resolved: true` POSTar Alertmanager även när ett larm rensas, den här gången med `status: resolved`. Lägg till en andra **Conditions**-gren (`status == resolved`), hitta den matchande incidenten (matcha på `commonLabels.alertname`) och flytta den till ditt lösta tillstånd med **Update Incident**.

## Felsökning

- **Ingen körning visas** — bekräfta att Alertmanager kan nå URL:en (kontrollera dess loggar för leveransfel) och att arbetsflödet är **Enabled**.
- **Incidentfält är tomma** — olika regler sätter olika annotationer. Granska utlösarens utdata på fliken **Logs** och referera till fält som faktiskt finns (`commonAnnotations` kontra per-larm `annotations`).
- **För många incidenter** — öka `group_by`/`group_interval` så att Alertmanager buntar relaterade larm.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — det inkommande mönstret.
- [Grafana](/docs/integrations/grafana) — samma idé, Grafana-larm.
- [Webhook-utlösare](/docs/workflows/triggers#webhook) — hur den mottagande URL:en fungerar.
