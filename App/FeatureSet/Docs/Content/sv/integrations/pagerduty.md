# PagerDuty-integration

Utlös en [PagerDuty](https://www.pagerduty.com)-incident när en OneUptime-incident skapas, och lös den när OneUptime löser den. Användbart när PagerDuty äger dina eskalerings- och jourscheman och du vill att OneUptime:s övervakning ska mata det.

Den här integrationen är **utgående**: OneUptime anropar PagerDutys [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/). Den använder ett OneUptime **[Arbetsflöde](/docs/workflows/index)** med en **Incident → On Create**-utlösare och en **API-komponent**.

> OneUptime har sin egen jour- och eskalering inbyggd — se [Jour](/docs/on-call/incoming-call-policy). Använd den här integrationen bara om du specifikt vill att händelser ska hamna i PagerDuty också.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Förutsättningar

- En PagerDuty-tjänst med en **Events API v2**-integration. I PagerDuty: **Service → Integrations → Add integration → Events API v2**. Kopiera **Integration Key** (kallas också *routing key*).
- Ett OneUptime-projekt där du kan skapa arbetsflöden.

## Steg 1 — Spara routing-nyckeln

1. Gå till **Workflows → Global Variables → Create**.
2. Namnge det `PAGERDUTY_ROUTING_KEY`, klistra in integrationsnyckeln och slå på **Is Secret**.

## Steg 2 — Bygg arbetsflödet för "utlösning"

1. Öppna **Workflows → Create Workflow**, namnge det `Incidents → PagerDuty` och öppna **Builder**.
2. Lägg till en **Incident**-utlösare inställd på **On Create**. Byt namn till `Incident`.
3. Lägg till ett **API**-block kopplat till utlösaren:
   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   **`dedup_key`** kopplar den här PagerDuty-incidenten till OneUptime-incidenten så att du kan lösa den senare. Att använda OneUptime-incidentens id gör det unikt och förutsägbart.
4. **Spara**, aktivera och skapa en testincident. Ett `202`-svar i arbetsflödets loggar betyder att PagerDuty accepterade händelsen.

## Steg 3 — Lös vid OneUptime-lösning (rekommenderas)

1. I **samma** arbetsflöde, lägg till en andra **Incident**-utlösare? Nej — ett arbetsflöde har en utlösare. Skapa i stället ett **andra** arbetsflöde som heter `Resolve PagerDuty` med en **Incident → On Update**-utlösare.
2. Lägg till ett **Conditions**-block för att kontrollera att incidenten nu är löst (förgrena på incidentens tillstånd/`{{Incident.currentIncidentState.name}}` lika med ditt lösta tillståndsnamn).
3. Från **Yes**, lägg till ett **API**-block till PagerDuty med samma **`dedup_key`** och `event_action` inställt på `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty matchar `dedup_key` och stänger den ursprungliga incidenten.

## Allvarlighetsgradsmappning (valfritt)

PagerDutys `severity` accepterar `critical`, `error`, `warning` eller `info`. För att mappa från OneUptime-allvarlighetsgrader, lägg till **Conditions**-grenar på `{{Incident.incidentSeverity.name}}` före API-blocket och skicka en annan body från var och en.

## Inkommande (valfritt)

För att gå den andra vägen — öppna en OneUptime-incident från en PagerDuty-händelse — lägg till ett arbetsflöde med **Webhook**-utlösare och peka en PagerDuty [V3-webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (eller en Events Orchestration) mot dess URL, använd sedan **Create Incident**. Se det [inkommande mönstret](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Felsökning

- **`400` med `"invalid routing key"`** — integrationen måste vara **Events API v2**, inte det äldre Events API v1 eller en annan integrationstyp. Kopiera om nyckeln.
- **Lösning stänger ingenting** — `dedup_key` i lösningsanropet måste matcha utlösningsanropet exakt.
- **Ingenting i loggarna** — bekräfta att arbetsflödet är **Enabled** och att utlösaren är **On Create**.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — mönster och autentiseringsfuskbladet.
- [Jour](/docs/on-call/incoming-call-policy) — OneUptime:s inbyggda eskalering.
- [Opsgenie](/docs/integrations/opsgenie) — samma idé för Opsgenie.
