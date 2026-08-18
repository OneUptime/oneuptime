# Prometheus Alertmanager-integration

Lav notifikationer fra [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) om til OneUptime-hændelser. Prometheus evaluerer dine alarmregler, Alertmanager ruter dem, og OneUptime registrerer og eskalerer dem.

Denne integration er **indgående**, og der er to måder at bygge den på:

| Fremgangsmåde                                                                         | Brug den, når                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Indgående anmodningsmonitor](/docs/monitor/incoming-request-monitor)** (anbefalet) | Du vil have alarmer til at blive hændelser med vagt-eskalering, én hændelse per alarm og automatisk løsning ved genopretning. Ingen egen logik at vedligeholde. |
| **[Workflow](/docs/workflows/index) med en Webhook-trigger**                          | Du har brug for routinglogik, som OneUptime ikke laver indbygget — kalde andre systemer, omforme payloads, betinget forgrening.                                 |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Forudsætninger

- En Prometheus + Alertmanager-opsætning, hvor du kan redigere `alertmanager.yml`.
- Alertmanager skal kunne nå din OneUptime-instans over HTTPS.
- Et OneUptime-projekt, hvor du kan oprette monitorer (eller workflows).

## Mulighed 1 — Indgående anmodningsmonitor

### Trin 1 — Opret monitoren

1. Gå til **Monitorer → Opret monitor** og vælg **Indgående anmodning**.
2. Åbn monitoren og klik på **Documentation** i menuen til venstre. Kopiér URL'en:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Brug din egen host, hvis du selv hoster. Den hemmelige nøgle i stien er den eneste legitimation.

### Trin 2 — Peg Alertmanager mod den

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

`send_resolved: true` er påkrævet — det er dét, der fortæller OneUptime, at en alarm er genoprettet. Genindlæs Alertmanager med `curl -X POST http://localhost:9093/-/reload`, eller genstart den.

Alertmanager sender `Content-Type: application/json`, som OneUptime har brug for for at kunne læse felter ud af payloaden.

### Trin 3 — Konfigurér kriterierne

Åbn monitorens **Criteria** og redigér det første kriterium.

**Filter**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  Anførselstegnene omkring pladsholderen er nødvendige for en strengsammenligning. Et filter `Request Body` / `Contains` / `"status":"firing"` fungerer også, hvis du hellere vil undgå et udtryk.

**Handlinger**

- Slå _When filters match, change monitor status_ til, og sæt den til **Offline** (eller Degraded).
- Slå _When filters match, declare an incident_ til. Angiv **Title**, **Severity** og de **On-Call Policies**, der skal tilkaldes.
- Under **Advanced Options** på den hændelse skal du slå **Auto Resolve Incident** til. Uden det ignoreres genopretningsnotifikationer, og hændelser står åbne for evigt.

**Settings → Group incidents and alerts by a payload field**

Slå dette til, så ét endpoint kan rumme flere samtidige hændelser — én per alarm — i stedet for en enkelt hændelse per notifikation.

| Felt                               | Værdi                               |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` breder sig ud over Alertmanagers `alerts`-array og åbner én hændelse per **unik** udtrukket værdi. Fordi begge stier bruger `[*]`, bedømmes genopretning per alarm: i en payload, hvor én alarm er løst og to stadig er aktive, lukkes kun den løste.

> **Warning:** Gruppér efter noget, der er reelt unikt per alarm. Alertmanagers `fingerprint` er et hash af alarmens fulde labelsæt, så det er den altid. En label duer kun, hvis den varierer **inden for** en notifikation — og enhver label, der står i din rutes `group_by`, gør det aldrig, for det er netop dét, der definerer aggregeringsgruppen. Med `group_by: ["alertname", "instance"]` ovenfor udtrækker gruppering efter `requestBody.alerts[*].labels.alertname` den samme værdi fra hver alarm i payloaden, så de alle falder sammen til én hændelse. Værre endnu: af dubletværdier bevares kun den **første** forekomst, så en payload, hvis første alarm er `resolved`, lukker den hændelse, mens resten stadig er aktive.

### Trin 4 — Skriv hændelsens titel og beskrivelse

Grupperingsnøglen er tilgængelig som en variabel opkaldt efter stiens sidste segment, så `requestBody.alerts[*].fingerprint` giver dig `{{fingerprint}}`. Det er et hash, ikke noget at vise en vagthavende — giv i stedet hændelsen titel ud fra de labels, notifikationen deler. `commonLabels` bærer hver label i din rutes `group_by`, så med konfigurationen ovenfor er både `alertname` og `instance` tilgængelige:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` og `commonAnnotations` indeholder de felter, notifikationen deler. En sti per alarm som `requestBody.alerts[0].annotations.summary` læser altid den _første_ alarm i payloaden, ikke den, denne bestemte hændelse blev åbnet for — hold derfor `group_by` stram, hvis hver hændelse skal bære sin egen annotationstekst. En sti, der ikke opløses, udskrives ordret, med tuborgklammer og det hele, i stedet for at stå tom. Se [Dynamiske hændelses- og alarmskabeloner](/docs/monitor/incident-alert-templating) for den fulde variabelliste.

### Trin 5 — Send monitoren tilbage til Operational (valgfrit)

Kriterier handler kun, når de matcher, så tilføj et andet kriterium, så monitoren ikke bliver stående Offline, efter alt er faldet til ro:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, og opret ingen hændelse.

### Trin 6 — Test det

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

Du bør få to hændelser — én per `fingerprint`. Send den igen med begge alarmers `status` sat til `resolved`, og begge bør lukke.

Du kan også udløse en rigtig alarm med `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Mulighed 2 — Workflow

Brug denne, når du har brug for logik ud over "alarm bliver til hændelse".

1. Åbn **Arbejdsgange → Opret arbejdsgang**, navngiv det `Alertmanager → Incidents`, og åbn **Bygger**.
2. Tilføj en **Webhook**-trigger og **kopiér dens URL**. Omdøb blokken til `Alertmanager`.
3. Tilføj en **Betingelser**-blok forbundet til triggeren:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Fra **Ja** tilføjer du en **Opret hændelse**-blok:
   - **Titel**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Beskrivelse**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Alvorlighed**: vælg én (eller forgren på `{{Alertmanager.Request Body.commonLabels.severity}}` først).
5. **Gem**, og peg derefter `webhook_configs`-URL'en fra Trin 2 ovenfor mod workflowets URL i stedet.

For én hændelse per alarm skal du tilføje en [Custom Code](/docs/workflows/components#custom-code)-blok, der løber over `Request Body.alerts`. Med `send_resolved: true` tilføjer du en anden **Betingelser**-gren på `status == resolved`, der finder den matchende hændelse og flytter den til din løste tilstand med **Update Incident**.

## Dødemandsknap

Ingen af mulighederne fortæller dig, når Prometheus selv holder op med at virke — at der ingen alarmer kommer, ligner nøjagtigt, at intet er galt. Det sædvanlige svar er en altid-aktiv alarm, der rutes til en monitor, som forventer den efter en plan. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) leverer en, der hedder `Watchdog`; på en almindelig Prometheus tilføjer du en alarmregel med et udtryk, der altid er sandt (`vector(1)`).

Opret en **anden** Indgående anmodningsmonitor, rut `Watchdog` til den med et kort `repeat_interval`, og giv den monitor et kriterium **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. Det er det ene tilfælde, hvor et kriterium om manglende anmodning hører hjemme på en alarmmodtager.

Dette er konfigurationen fra Trin 2 med watchdog-ruten og -modtageren flettet ind — en underrute matches før den overordnede rutes egen modtager, så `Watchdog` går til den anden monitor, og alt andet går stadig til den første:

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

## Fejlfinding

- **Der kommer intet frem** — bekræft at Alertmanager kan nå URL'en; tjek dens logfiler for leveringsfejl. OneUptime svarer på hver anmodning med et tomt `200`, før noget som helst valideres, så et `200` bekræfter ikke, at payloaden blev accepteret. Kig i stedet på monitorens tidslinje.
- **Hændelser åbner, men lukker aldrig** — tjek `send_resolved: true` i Alertmanager, genopretningsfeltet og -værdien på kriteriet (sammenligningen skelner mellem store og små bogstaver) samt **Auto Resolve Incident** under hændelsens **Advanced Options**. To mere subtile årsager: en payload med flere unikke nøgler end **Max incidents per request** skjuler også dem ud over grænsen for genopretning; og hvis det netop er `resolved`-notifikationen, der bliver droppet af sammenlægning ved ingest (nedenfor), står hændelsen fast for altid, fordi Alertmanager gentager firing-notifikationer, men ikke resolved-notifikationer. Luk dem manuelt.
- **Slet ingen hændelser, og monitorstatus uændret** — grupperingsstien skal begynde med det bogstavelige `requestBody.`, og kun det første `[*]` i en sti er et jokertegn. Begge fejl fejler lydløst.
- **Hændelsesteksten viser rå `{{...}}`-pladsholdere** — stien blev ikke opløst, og OneUptime lader uopløste pladsholdere stå i stedet for at tømme dem. Forskellige regler sætter forskellige annotationer, så referér til felter, der faktisk findes for dine regler (`commonAnnotations` kontra `annotations` per alarm).
- **Kun én hændelse for en payload fuld af alarmer** — du grupperede efter en label, der ikke varierer inden for en notifikation, oftest en, der også står i din rutes `group_by`. Gruppér efter `requestBody.alerts[*].fingerprint` i stedet.
- **For mange hændelser** — udvid `group_by` / `group_interval`, så Alertmanager samler beslægtede alarmer. At sænke **Max incidents per request** begrænser dem, men skjuler også nøglerne ud over grænsen for genopretning.
- **Nogle notifikationer ser ud til at blive sprunget over under kraftige spidsbelastninger** — anmodninger til samme monitor lægges sammen ved ingest, så én afsender ikke kan overvælde en monitor, hvilket kan droppe en mellemliggende payload, når notifikationer ankommer lige efter hinanden. At øge `group_wait` og `group_interval` spreder dem. Sammenlægning styres af app-containerens miljøvariabel `INCOMING_REQUEST_INGEST_COALESCE_ENABLED`, som er slået til som standard; selvhostende operatører, der har brug for at få hver payload vurderet, kan sætte den til `false` på den container.

## Læs videre

- [Indgående anmodningsmonitor](/docs/monitor/incoming-request-monitor) — monitortypen, dens kriterier og hændelsesgruppering i fuld længde.
- [Oversigt over integrationer](/docs/integrations/index) — de indgående og udgående mønstre.
- [Grafana](/docs/integrations/grafana) — samme idé, med Grafana-alarmering.
- [Webhook-trigger](/docs/workflows/triggers#webhook) — hvordan workflowets modtagende URL fungerer.
