# Datadog-integration

Omvandla [Datadog](https://www.datadoghq.com)-monitorlarm till OneUptime-incidenter, så att Datadogs identifiering matar OneUptime:s incidenthantering och statussidor.

Den här integrationen är **inkommande**: Datadogs [Webhooks-integration](https://docs.datadoghq.com/integrations/webhooks/) postar till ett OneUptime **[Arbetsflöde](/docs/workflows/index)** som börjar med en **Webhook-utlösare**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Förutsättningar

- Ett Datadog-konto där du kan konfigurera integrationer och monitorer.
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

## Steg 1 — Bygg OneUptime-arbetsflödet

1. Öppna **Workflows → Create Workflow**, namnge det `Datadog → Incidents` och öppna **Builder**.
2. Lägg till en **Webhook**-utlösare och **kopiera dess URL**. Byt namn på blocket till `Datadog`.
3. Lägg till ett **Conditions**-block kopplat till utlösaren:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. Från **Yes**, lägg till ett **Create Incident**-block:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: välj en.
5. **Spara** (lämna inaktiverat tills det testats).

## Steg 2 — Skapa Datadog-webhooken

1. Gå i Datadog till **Integrations → Webhooks** (installera **Webhooks**-integrationen om du inte redan har gjort det).
2. **Lägg till en webhook**:
   - **Name**: `oneuptime` (detta blir `@webhook-oneuptime`).
   - **URL**: ditt arbetsflödes webhook-URL.
   - **Payload** — Datadog låter dig definiera JSON-bodyn med hjälp av [mallvariabler](https://docs.datadoghq.com/integrations/webhooks/#usage):

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Spara webhooken.

## Steg 3 — Skicka en monitors larm till webhooken

Lägg till webhook-referensen i de monitorer du vill vidarebefordra. I varje monitors **notifieringsmeddelande**, inkludera:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

Detta skickar både larmet och återhämtningen till OneUptime. (För att vidarebefordra allt kan du också lägga till `@webhook-oneuptime` i en monitor ovillkorligt.)

## Steg 4 — Testa det

1. Aktivera arbetsflödet.
2. Från en monitor, använd **Test Notifications → Alert**, eller låt en riktig monitor utlösas.
3. Kontrollera arbetsflödets flik **Logs** och din lista med **Incidents**.

## Lösning vid återhämtning (valfritt)

`$ALERT_TRANSITION` är `Recovered` när en monitor rensas. Lägg till en andra **Conditions**-gren (`transition == Recovered`), hitta den matchande incidenten (matcha på det `id` du skickade) och flytta den till ditt lösta tillstånd med **Update Incident**.

## Felsökning

- **Ingen körning visas** — bekräfta att monitorns meddelande innehåller `@webhook-oneuptime` och att arbetsflödet är **Enabled**.
- **Fält är tomma** — Datadog ersätter bara mallvariabler som gäller för händelsen. Granska utlösarens utdata på fliken **Logs** och justera din webhook-payload.
- **Dubblettincidenter** — en monitor som larmar om igen (renotify) skickar flera `Triggered`-händelser; deduplicera med en **Find Incident**-kontroll på `id` innan du skapar.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — det inkommande mönstret.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) och [Grafana](/docs/integrations/grafana) — andra inkommande källor.
- [Webhook-utlösare](/docs/workflows/triggers#webhook) — hur den mottagande URL:en fungerar.
