# Prometheus Alertmanager-integration

Gör notifieringar från [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) till OneUptime-incidenter. Prometheus utvärderar dina larmregler, Alertmanager dirigerar dem, och OneUptime registrerar och eskalerar dem.

Den här integrationen är **inkommande**, och det finns två sätt att bygga den:

| Tillvägagångssätt                                                                                  | Använd det när                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Monitor för inkommande förfrågningar](/docs/monitor/incoming-request-monitor)** (rekommenderas) | Du vill att larm ska bli incidenter med jour-eskalering, en incident per larm och automatisk lösning vid återhämtning. Ingen egen logik att underhålla. |
| **[Workflow](/docs/workflows/index) med en Webhook-utlösare**                                      | Du behöver dirigeringslogik som OneUptime inte gör inbyggt — anropa andra system, forma om payloads, villkorlig förgrening.                             |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Förutsättningar

- En Prometheus + Alertmanager-uppsättning där du kan redigera `alertmanager.yml`.
- Alertmanager måste kunna nå din OneUptime-instans över HTTPS.
- Ett OneUptime-projekt där du kan skapa monitorer (eller arbetsflöden).

## Alternativ 1 — Monitor för inkommande förfrågningar

### Steg 1 — Skapa monitorn

1. Gå till **Monitorer → Skapa monitor** och välj **Inkommande förfrågan**.
2. Öppna monitorn och klicka på **Documentation** i vänstermenyn. Kopiera URL:en:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Använd din egen host om du kör självhostat. Den hemliga nyckeln i sökvägen är den enda inloggningsuppgiften.

### Steg 2 — Peka Alertmanager mot den

I `alertmanager.yml`:

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

`send_resolved: true` krävs — det är det som talar om för OneUptime att ett larm har återhämtat sig. Ladda om Alertmanager med `curl -X POST http://localhost:9093/-/reload`, eller starta om den.

Alertmanager skickar `Content-Type: application/json`, vilket OneUptime behöver för att kunna läsa fält ur payloaden.

### Steg 3 — Konfigurera kriterierna

Öppna monitorns **Criteria** och redigera det första kriteriet.

**Filter**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  Citattecknen runt platshållaren krävs för en strängjämförelse. Ett filter `Request Body` / `Contains` / `"status":"firing"` fungerar också om du hellre slipper ett uttryck.

**Åtgärder**

- Slå på _When filters match, change monitor status_ och sätt den till **Offline** (eller Degraded).
- Slå på _When filters match, declare an incident_. Ange **Title**, **Severity** och de **On-Call Policies** som ska larmas.
- Under **Advanced Options** på den incidenten slår du på **Auto Resolve Incident**. Utan detta ignoreras återhämtningsnotifieringar och incidenter står öppna för alltid.

**Settings → Group incidents and alerts by a payload field**

Slå på detta så att en endpoint kan hålla flera samtidiga incidenter — en per larm — i stället för en enda incident per notifiering.

| Fält                               | Värde                               |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` breder ut sig över Alertmanagers `alerts`-array och öppnar en incident per **unikt** uthämtat värde. Eftersom båda sökvägarna använder `[*]` bedöms återhämtning per larm: i en payload där ett larm har lösts och två fortfarande är aktiva stängs bara det lösta.

> **Warning:** Gruppera på något som verkligen är unikt per larm. Alertmanagers `fingerprint` är en hash av larmets fullständiga etikettuppsättning, så den är det alltid. En etikett duger bara om den varierar **inom** en notifiering — och varje etikett som står i din routes `group_by` gör aldrig det, eftersom det är precis det som definierar aggregeringsgruppen. Med `group_by: ["alertname", "instance"]` ovan hämtar gruppering på `requestBody.alerts[*].labels.alertname` samma värde från varje larm i payloaden, så alla faller samman till en enda incident. Värre än så: av dubblettvärden behålls bara den **första** förekomsten, så en payload vars första larm är `resolved` stänger den incidenten medan resten fortfarande är aktiva.

### Steg 4 — Skriv incidentens titel och beskrivning

Grupperingsnyckeln finns som en variabel uppkallad efter sökvägens sista segment, så `requestBody.alerts[*].fingerprint` ger dig `{{fingerprint}}`. Det är en hash, inget att visa för en jourhavande — titulera i stället incidenten utifrån de etiketter som notifieringen delar. `commonLabels` bär varje etikett i din routes `group_by`, så med konfigurationen ovan är både `alertname` och `instance` tillgängliga:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` och `commonAnnotations` innehåller de fält som notifieringen delar. En sökväg per larm som `requestBody.alerts[0].annotations.summary` läser alltid det _första_ larmet i payloaden, inte det som just den här incidenten öppnades för — håll därför `group_by` snäv om du vill att varje incident ska bära sin egen annotationstext. En sökväg som inte löses upp skrivs ut ordagrant, klammerparenteser och allt, i stället för att lämnas tom. Se [Dynamiska incident- och varningsmallar](/docs/monitor/incident-alert-templating) för hela variabellistan.

### Steg 5 — Skicka tillbaka monitorn till Operational (valfritt)

Kriterier agerar bara när de matchar, så lägg till ett andra kriterium så att monitorn inte blir kvar som Offline när allt har lugnat ner sig:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, och skapa ingen incident.

### Steg 6 — Testa det

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

Du bör få två incidenter — en per `fingerprint`. Skicka igen med `status` satt till `resolved` för båda larmen, så bör båda stängas.

Du kan också utlösa ett riktigt larm med `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Alternativ 2 — Workflow

Använd detta när du behöver logik utöver "ett larm blir en incident".

1. Öppna **Arbetsflöden → Skapa arbetsflöde**, namnge det `Alertmanager → Incidents` och öppna **Byggare**.
2. Lägg till en **Webhook**-utlösare och **kopiera dess URL**. Byt namn på blocket till `Alertmanager`.
3. Lägg till ett **Villkor**-block kopplat till utlösaren:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Från **Ja**, lägg till ett **Skapa incident**-block:
   - **Titel**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Beskrivning**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Allvarlighetsgrad**: välj en (eller förgrena på `{{Alertmanager.Request Body.commonLabels.severity}}` först).
5. **Spara**, och peka sedan `webhook_configs`-URL:en från Steg 2 ovan mot arbetsflödets URL i stället.

För en incident per larm lägger du till ett [Custom Code](/docs/workflows/components#custom-code)-block som itererar över `Request Body.alerts`. Med `send_resolved: true` lägger du till en andra **Villkor**-gren på `status == resolved` som hittar den matchande incidenten och flyttar den till ditt lösta tillstånd med **Update Incident**.

## Dödmansgrepp

Inget av alternativen talar om för dig när Prometheus självt slutar fungera — att inga larm kommer in ser precis ut som att inget är fel. Det vanliga svaret är ett alltid aktivt larm som dirigeras till en monitor som förväntar sig det enligt ett schema. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) levererar ett som heter `Watchdog`; på ett rent Prometheus lägger du till en larmregel med ett uttryck som alltid är sant (`vector(1)`).

Skapa en **andra** monitor för inkommande förfrågningar, dirigera `Watchdog` till den med ett kort `repeat_interval`, och ge den monitorn ett kriterium **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. Det är det enda fall där ett kriterium om utebliven förfrågan hör hemma på en larmmottagare.

Detta är konfigurationen från Steg 2 med watchdog-routen och -mottagaren inflätade — en underroute matchas före föräldrarouten egen mottagare, så `Watchdog` går till den andra monitorn och allt annat går fortfarande till den första:

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

## Felsökning

- **Ingenting kommer fram** — bekräfta att Alertmanager kan nå URL:en; kolla dess loggar efter leveransfel. OneUptime svarar på varje förfrågan med en tom `200` innan något valideras, så en `200` bekräftar inte att payloaden accepterades. Titta på monitorns tidslinje i stället.
- **Incidenter öppnas men stängs aldrig** — kontrollera `send_resolved: true` i Alertmanager, återhämtningsfältet och värdet på kriteriet (jämförelsen skiljer på gemener och versaler), och **Auto Resolve Incident** under incidentens **Advanced Options**. Två subtilare orsaker: en payload med fler unika nycklar än **Max incidents per request** döljer även de bortom gränsen för återhämtning; och om det just är `resolved`-notifieringen som slås bort av sammanslagningen vid ingest (nedan) fastnar incidenten permanent, eftersom Alertmanager upprepar firing-notifieringar men inte resolved-notifieringar. Stäng dem för hand.
- **Inga incidenter alls, monitorstatus oförändrad** — grupperingssökvägen måste börja med det bokstavliga `requestBody.`, och bara det första `[*]` i en sökväg är ett jokertecken. Båda misstagen misslyckas tyst.
- **Incidenttexten visar råa `{{...}}`-platshållare** — sökvägen löstes inte upp, och OneUptime lämnar olösta platshållare på plats i stället för att tömma dem. Olika regler sätter olika annotationer, så referera till fält som faktiskt finns för dina regler (`commonAnnotations` kontra `annotations` per larm).
- **Bara en incident för en payload full av larm** — du grupperade på en etikett som inte varierar inom en notifiering, oftast en som också finns i din routes `group_by`. Gruppera på `requestBody.alerts[*].fingerprint` i stället.
- **För många incidenter** — bredda `group_by` / `group_interval` så att Alertmanager buntar ihop relaterade larm. Att sänka **Max incidents per request** begränsar dem, men döljer också nycklarna bortom gränsen för återhämtning.
- **Vissa notifieringar verkar hoppas över vid kraftiga skurar** — förfrågningar till samma monitor slås samman vid ingest så att en avsändare inte kan överbelasta en monitor, vilket kan slå bort en mellanliggande payload när notifieringar kommer tätt inpå varandra. Att öka `group_wait` och `group_interval` glesar ut dem. Sammanslagningen styrs av appcontainerns miljövariabel `INCOMING_REQUEST_INGEST_COALESCE_ENABLED`, som är påslagen som standard; självhostande operatörer som behöver få varje payload utvärderad kan sätta den till `false` på den containern.

## Läs vidare

- [Monitor för inkommande förfrågningar](/docs/monitor/incoming-request-monitor) — monitortypen, dess kriterier och incidentgruppering i sin helhet.
- [Översikt över integrationer](/docs/integrations/index) — de inkommande och utgående mönstren.
- [Grafana](/docs/integrations/grafana) — samma idé, med Grafana-larm.
- [Webhook-utlösare](/docs/workflows/triggers#webhook) — hur arbetsflödets mottagande URL fungerar.
