# Grafana-integration

Omvandla [Grafana](https://grafana.com)-larm till OneUptime-incidenter. Grafana utvärderar larmreglerna på dina instrumentpaneler; OneUptime registrerar, eskalerar och spårar dem.

Den här integrationen är **inkommande**: Grafanas larmhantering postar till ett OneUptime **[Arbetsflöde](/docs/workflows/index)** som börjar med en **Webhook-utlösare**, med hjälp av en Grafana **Webhook contact point**.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Förutsättningar

- Grafana 9+ med [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) aktiverat (standardinställningen på modern Grafana).
- Grafana måste kunna nå din OneUptime-instans via HTTPS.
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

## Steg 1 — Bygg OneUptime-arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Grafana → Incidents` och öppna **Builder**.
2. Lägg till en **Webhook**-utlösare och **kopiera dess URL**. Byt namn på blocket till `Grafana`.
3. Lägg till ett **Conditions**-block kopplat till utlösaren:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Från **Yes**, lägg till ett **Create Incident**-block:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: välj en (eller förgrena på `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Spara** (lämna inaktiverat tills det testats).

Grafanas webhook-payload följer Alertmanager-formen — den innehåller `status`, en `alerts`-array, `commonLabels` och `commonAnnotations`, plus praktiska toppnivåfält `title` och `message`.

## Steg 2 — Konfigurera Grafana contact point

1. Gå i Grafana till **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: klistra in ditt arbetsflödes webhook-URL. **HTTP Method**: `POST`.
4. Spara contact point.
5. Gå till **Alerting → Notification policies** och dirigera de larm du vill ha (eller standardpolicyn) till **OneUptime** contact point.

## Steg 3 — Testa det

1. Aktivera arbetsflödet.
2. På contact point-skärmen, använd **Test** för att skicka en exempelnotifiering, eller låt en riktig larmregel utlösas.
3. Kontrollera arbetsflödets flik **Logs** och din lista med **Incidents**.

## Lösning vid återhämtning (valfritt)

När larmet rensas skickar Grafana en annan notifiering med `status: resolved`. Lägg till en andra **Conditions**-gren (`status == resolved`), hitta den matchande incidenten och flytta den till ditt lösta tillstånd med **Update Incident**.

## Noteringar

- **Äldre larmhantering (Grafana 8 och tidigare)** skickar en annan payload (`ruleName`, `state`, `evalMatches`). Om du använder äldre larmhantering, referera till `{{Grafana.Request Body.ruleName}}` och `{{Grafana.Request Body.state}}` i stället, och förgrena på `state == alerting`.
- Du kan också hoppa över Grafanas larmhantering helt och låta OneUptime övervaka samma mätvärden direkt — se [Metrics Monitor](/docs/monitor/metrics-monitor).

## Felsökning

- **Ingen körning visas** — bekräfta att Grafana kan nå URL:en (kontrollera Grafanas serverloggar) och att arbetsflödet är **Enabled**.
- **Tomma fält** — granska utlösarens utdata på fliken **Logs**; referera till fält som finns för din larmhanteringsversion.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — det inkommande mönstret.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — nära besläktad payload.
- [Metrics Monitor](/docs/monitor/metrics-monitor) — övervaka mätvärden i OneUptime direkt.
