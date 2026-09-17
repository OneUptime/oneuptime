# Grafana-integration

Gör [Grafana](https://grafana.com)-larm till OneUptime-incidenter. Grafana utvärderar larmreglerna på dina dashboards; OneUptime registrerar, eskalerar och följer upp dem.

Den här integrationen är **inkommande**: en Grafana-**Webhook contact point** POSTar till OneUptime. Det finns två sätt att ta emot det.

| Tillvägagångssätt                                                                                  | Använd det när                                                                                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **[Monitor för inkommande förfrågningar](/docs/monitor/incoming-request-monitor)** (rekommenderas) | Du vill att larm ska bli incidenter med jour-eskalering, en incident per larm och automatisk lösning vid återhämtning.      |
| **[Workflow](/docs/workflows/index) med en Webhook-utlösare**                                      | Du behöver dirigeringslogik som OneUptime inte gör inbyggt — anropa andra system, forma om payloads, villkorlig förgrening. |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafanas webhook-payload följer Alertmanager-formen — `status`, en `alerts`-array, `commonLabels` och `commonAnnotations`, plus praktiska toppnivåfält `title` och `message`.

## Förutsättningar

- Grafana 9+ med [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) aktiverat (standard i modernt Grafana).
- Grafana måste kunna nå din OneUptime-instans över HTTPS.
- Ett OneUptime-projekt där du kan skapa monitorer (eller arbetsflöden).

## Alternativ 1 — Monitor för inkommande förfrågningar

1. Gå till **Monitorer → Skapa monitor** och välj **Inkommande förfrågan**. Öppna den och klicka på **Documentation** i vänstermenyn för att kopiera URL:en.
2. Öppna monitorns **Criteria** och sätt **Filter Type** till `JavaScript Expression` och **Value** till `"{{requestBody.status}}" === "firing"`.
3. Skapa en incident vid träff, välj de **On-Call Policies** som ska larmas, och slå på **Auto Resolve Incident** under **Advanced Options**.
4. Slå på **Group incidents and alerts by a payload field** under **Settings** och sätt:

   | Fält                               | Värde                               |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Ge incidenten titeln `{{requestBody.commonLabels.alertname}}` och beskriv den med `{{requestBody.message}}` eller `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` innehåller själva grupperingsnyckeln, men det är en hash — inget att visa för en jourhavande.)
6. Peka Grafanas contact point mot monitorns URL (se stegen för contact point nedan).

Varje **unikt** grupperingsvärde blir en egen incident, och var och en stängs när Grafana rapporterar den som löst. Grafanas `fingerprint` per larm är unik för ett larms etikettuppsättning, och det är därför den är grupperingssökvägen ovan. Sidan [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) går igenom samma uppsättning mer i detalj — payloadformen är densamma, så varje steg där gäller även här.

> **Warning:** Gruppera inte på en etikett som är konstant genom en notifiering. Grafanas standardnotifieringspolicy grupperar på `grafana_folder` och `alertname`, så varje larm i en webhook delar samma alertname — att gruppera på `requestBody.alerts[*].labels.alertname` skulle få hela payloaden att falla samman till en enda incident. Grupperingssökvägarna måste dessutom börja med det bokstavliga `requestBody.`, och bara det första `[*]` i en sökväg är ett jokertecken. Allt detta misslyckas tyst.

## Alternativ 2 — Workflow

Använd detta när du behöver logik utöver "ett larm blir en incident".

### Steg 1 — Bygg OneUptime-arbetsflödet

1. Öppna **Arbetsflöden → Skapa arbetsflöde**, namnge det `Grafana → Incidents` och öppna **Byggare**.
2. Lägg till en **Webhook**-utlösare och **kopiera dess URL**. Byt namn på blocket till `Grafana`.
3. Lägg till ett **Villkor**-block kopplat till utlösaren:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Från **Ja**, lägg till ett **Skapa incident**-block:
   - **Titel**: `{{Grafana.Request Body.title}}`
   - **Beskrivning**: `{{Grafana.Request Body.message}}`
   - **Allvarlighetsgrad**: välj en (eller förgrena på `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Spara** (lämna inaktiverat tills det testats).

## Konfigurera Grafana contact point

1. Gå i Grafana till **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: klistra in monitor-URL:en från Alternativ 1, eller arbetsflödets webhook-URL från Alternativ 2. **HTTP Method**: `POST`.
4. Spara contact pointen.
5. Gå till **Alerting → Notification policies** och dirigera de larm du vill (eller standardpolicyn) till contact pointen **OneUptime**.

## Testa det

1. Aktivera arbetsflödet, om du byggde ett.
2. Använd **Test** på contact point-skärmen för att skicka en exempelnotifiering, eller låt en riktig larmregel utlösas.
3. Kontrollera din **Incidenter**-lista — och arbetsflödets flik **Loggar** om du använde Alternativ 2.

## Lösning vid återhämtning

När larmet lugnar sig skickar Grafana ytterligare en notifiering med `status: resolved`.

Med **Alternativ 1** stänger återhämtningsfältet och värdet som konfigurerades ovan den matchande incidenten automatiskt — förutsatt att **Auto Resolve Incident** är påslaget.

Med **Alternativ 2** lägger du till en andra **Villkor**-gren (`status == resolved`), hittar den matchande incidenten och flyttar den till ditt lösta tillstånd med **Update Incident**.

## Noteringar

- **Äldre larmhantering (Grafana 8 och tidigare)** skickar en annan payload (`ruleName`, `state`, `evalMatches`). Använder du äldre larmhantering, referera i stället till `{{Grafana.Request Body.ruleName}}` och `{{Grafana.Request Body.state}}`, och förgrena på `state == alerting`.
- Du kan också hoppa över Grafanas larmhantering helt och låta OneUptime övervaka samma mätvärden direkt — se [Metrikövervakning](/docs/monitor/metrics-monitor).

## Felsökning

- **Ingenting kommer fram** — bekräfta att Grafana kan nå URL:en (kolla Grafanas serverloggar) och, för Alternativ 2, att arbetsflödet är **Aktiverat**. OneUptime svarar på varje inkommande förfrågan med en tom `200` innan den valideras, så en `200` i Grafanas loggar bekräftar inte att payloaden accepterades.
- **Incidenter öppnas men stängs aldrig** — kontrollera återhämtningsfältet och värdet på kriteriet, och att **Auto Resolve Incident** är påslaget under incidentens **Advanced Options**. Jämförelsen skiljer på gemener och versaler.
- **Bara en incident för en payload full av larm** — du grupperade på en etikett som inte varierar inom en notifiering. Gruppera på `requestBody.alerts[*].fingerprint` i stället.
- **Incidenttexten visar råa `{{...}}`-platshållare** — sökvägen löstes inte upp, och olösta platshållare lämnas kvar i stället för att tömmas. Referera till fält som finns i din version av larmhanteringen; granska utlösarens utdata i fliken **Loggar** om du använde Alternativ 2.

## Läs vidare

- [Monitor för inkommande förfrågningar](/docs/monitor/incoming-request-monitor) — monitortypen, dess kriterier och incidentgruppering i sin helhet.
- [Översikt över integrationer](/docs/integrations/index) — det inkommande mönstret.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — nära besläktad payload.
- [Metrikövervakning](/docs/monitor/metrics-monitor) — övervaka mätvärden direkt i OneUptime.
