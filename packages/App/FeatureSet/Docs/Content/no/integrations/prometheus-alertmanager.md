# Prometheus Alertmanager-integrasjon

Gjør varsler fra [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) om til OneUptime-hendelser. Prometheus evaluerer varslingsreglene dine, Alertmanager ruter dem, og OneUptime registrerer og eskalerer dem.

Denne integrasjonen er **innkommende**, og det er to måter å bygge den på:

| Fremgangsmåte                                                                            | Bruk den når                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Innkommende forespørselsmonitor](/docs/monitor/incoming-request-monitor)** (anbefalt) | Du vil at varsler skal bli hendelser med vakteskalering, én hendelse per varsel og automatisk løsning ved gjenoppretting. Ingen egen logikk å vedlikeholde. |
| **[Workflow](/docs/workflows/index) med en Webhook-trigger**                             | Du trenger rutingslogikk som OneUptime ikke gjør nativt — kalle andre systemer, omforme nyttelaster, betinget forgrening.                                   |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Forutsetninger

- Et Prometheus + Alertmanager-oppsett der du kan redigere `alertmanager.yml`.
- Alertmanager må kunne nå OneUptime-instansen din over HTTPS.
- Et OneUptime-prosjekt der du kan opprette monitorer (eller arbeidsflyter).

## Alternativ 1 — Innkommende forespørselsmonitor

### Steg 1 — Opprett monitoren

1. Gå til **Monitorer → Opprett monitor** og velg **Innkommende forespørsel**.
2. Åpne monitoren og klikk **Documentation** i venstremenyen. Kopier URL-en:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Bruk din egen host hvis du er selvhostet. Den hemmelige nøkkelen i stien er den eneste legitimasjonen.

### Steg 2 — Pek Alertmanager mot den

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

`send_resolved: true` er påkrevd — det er dette som forteller OneUptime at et varsel er gjenopprettet. Last Alertmanager på nytt med `curl -X POST http://localhost:9093/-/reload`, eller start den på nytt.

Alertmanager sender `Content-Type: application/json`, som OneUptime trenger for å lese felter ut av nyttelasten.

### Steg 3 — Konfigurer kriteriene

Åpne monitorens **Criteria** og rediger det første kriteriet.

**Filter**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  Anførselstegnene rundt plassholderen er nødvendige for en strengsammenligning. Et filter `Request Body` / `Contains` / `"status":"firing"` fungerer også hvis du heller vil unngå et uttrykk.

**Handlinger**

- Slå på _When filters match, change monitor status_ og sett den til **Offline** (eller Degraded).
- Slå på _When filters match, declare an incident_. Angi **Title**, **Severity** og de **On-Call Policies** som skal varsles.
- Under **Advanced Options** på den hendelsen slår du på **Auto Resolve Incident**. Uten dette ignoreres gjenopprettingsvarsler, og hendelser blir stående åpne for alltid.

**Settings → Group incidents and alerts by a payload field**

Slå dette på slik at ett endepunkt kan holde flere samtidige hendelser — én per varsel — i stedet for én enkelt hendelse per varsling.

| Felt                               | Verdi                               |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` brer seg ut over Alertmanagers `alerts`-matrise og åpner én hendelse per **unike** uthentede verdi. Fordi begge stiene bruker `[*]`, vurderes gjenoppretting per varsel: i en nyttelast der ett varsel er løst og to fortsatt er aktive, lukkes bare det løste.

> **Warning:** Grupper etter noe som er genuint unikt per varsel. Alertmanagers `fingerprint` er en hash av varselets fullstendige labelsett, så det er den alltid. En label duger bare hvis den varierer **innenfor** en varsling — og enhver label som står i rutens `group_by`, gjør aldri det, for det er nettopp dét som definerer aggregeringsgruppen. Med `group_by: ["alertname", "instance"]` ovenfor henter gruppering etter `requestBody.alerts[*].labels.alertname` samme verdi fra hvert varsel i nyttelasten, slik at de alle faller sammen til én hendelse. Verre: av dupliserte verdier beholdes bare den **første** forekomsten, så en nyttelast der første varsel er `resolved`, lukker den hendelsen mens resten fortsatt er aktive.

### Steg 4 — Skriv hendelsens tittel og beskrivelse

Grupperingsnøkkelen er tilgjengelig som en variabel oppkalt etter stiens siste segment, så `requestBody.alerts[*].fingerprint` gir deg `{{fingerprint}}`. Det er en hash, ikke noe å vise en vakthavende — gi heller hendelsen tittel ut fra labelene varslingen deler. `commonLabels` bærer hver label i rutens `group_by`, så med konfigurasjonen ovenfor er både `alertname` og `instance` tilgjengelige:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` og `commonAnnotations` inneholder feltene varslingen deler. En sti per varsel som `requestBody.alerts[0].annotations.summary` leser alltid det _første_ varselet i nyttelasten, ikke det denne bestemte hendelsen ble åpnet for — hold derfor `group_by` stram hvis hver hendelse skal bære sin egen annotasjonstekst. En sti som ikke løses, skrives ut ordrett, krøllparenteser og alt, i stedet for å stå tom. Se [Dynamiske hendelses- og varselmaler](/docs/monitor/incident-alert-templating) for hele variabellisten.

### Steg 5 — Send monitoren tilbake til Operational (valgfritt)

Kriterier handler bare når de matcher, så legg til et andre kriterium slik at monitoren ikke blir stående Offline etter at alt har roet seg:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, og opprett ingen hendelse.

### Steg 6 — Test det

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

Du bør få to hendelser — én per `fingerprint`. Send den på nytt med `status` satt til `resolved` for begge varslene, og begge bør lukkes.

Du kan også utløse et ekte varsel med `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Alternativ 2 — Workflow

Bruk dette når du trenger logikk utover «varsel blir hendelse».

1. Åpne **Arbeidsflyter → Opprett arbeidsflyt**, gi den navnet `Alertmanager → Incidents`, og åpne **Bygger**.
2. Legg til en **Webhook**-trigger og **kopier URL-en**. Gi blokken nytt navn til `Alertmanager`.
3. Legg til en **Betingelser**-blokk koblet til triggeren:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Fra **Ja**, legg til en **Opprett hendelse**-blokk:
   - **Tittel**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Beskrivelse**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Alvorlighetsgrad**: velg én (eller forgren på `{{Alertmanager.Request Body.commonLabels.severity}}` først).
5. **Lagre**, og pek deretter `webhook_configs`-URL-en fra Steg 2 ovenfor mot arbeidsflytens URL i stedet.

For én hendelse per varsel legger du til en [Custom Code](/docs/workflows/components#custom-code)-blokk som løper gjennom `Request Body.alerts`. Med `send_resolved: true` legger du til en andre **Betingelser**-gren på `status == resolved` som finner den matchende hendelsen og flytter den til din løste tilstand med **Update Incident**.

## Dødmannsknapp

Ingen av alternativene forteller deg når Prometheus selv slutter å virke — at ingen varsler kommer inn ser nøyaktig ut som at ingenting er galt. Det vanlige svaret er et alltid-aktivt varsel som rutes til en monitor som forventer det etter en plan. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) leverer ett som heter `Watchdog`; på en ren Prometheus legger du til en varslingsregel med et uttrykk som alltid er sant (`vector(1)`).

Opprett en **andre** innkommende forespørselsmonitor, rut `Watchdog` til den med et kort `repeat_interval`, og gi den monitoren et kriterium **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. Det er det ene tilfellet der et kriterium om manglende forespørsel hører hjemme på en varselmottaker.

Dette er konfigurasjonen fra Steg 2 med watchdog-ruten og -mottakeren flettet inn — en underrute matches før den overordnede rutens egen mottaker, så `Watchdog` går til den andre monitoren, og alt annet går fortsatt til den første:

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

## Feilsøking

- **Ingenting kommer frem** — bekreft at Alertmanager kan nå URL-en; sjekk loggene dens for leveringsfeil. OneUptime svarer på hver forespørsel med en tom `200` før noe valideres, så en `200` bekrefter ikke at nyttelasten ble godtatt. Se på monitorens tidslinje i stedet.
- **Hendelser åpnes, men lukkes aldri** — sjekk `send_resolved: true` i Alertmanager, gjenopprettingsfeltet og -verdien på kriteriet (sammenligningen skiller mellom store og små bokstaver), og **Auto Resolve Incident** under hendelsens **Advanced Options**. To mer subtile årsaker: en nyttelast med flere unike nøkler enn **Max incidents per request** skjuler også dem forbi grensen for gjenoppretting; og hvis det nettopp er `resolved`-varslingen som droppes av sammenslåing ved ingest (nedenfor), blir hendelsen stående fast permanent, fordi Alertmanager gjentar firing-varslinger, men ikke resolved-varslinger. Lukk disse for hånd.
- **Ingen hendelser i det hele tatt, monitorstatus uendret** — grupperingsstien må begynne med det bokstavelige `requestBody.`, og bare det første `[*]` i en sti er et jokertegn. Begge feilene feiler lydløst.
- **Hendelsesteksten viser rå `{{...}}`-plassholdere** — stien ble ikke løst, og OneUptime lar uløste plassholdere stå i stedet for å tømme dem. Ulike regler setter ulike annotasjoner, så vis til felter som faktisk finnes for reglene dine (`commonAnnotations` mot `annotations` per varsel).
- **Bare én hendelse for en nyttelast full av varsler** — du grupperte etter en label som ikke varierer innenfor en varsling, oftest en som også står i rutens `group_by`. Grupper etter `requestBody.alerts[*].fingerprint` i stedet.
- **For mange hendelser** — utvid `group_by` / `group_interval` slik at Alertmanager samler beslektede varsler. Å senke **Max incidents per request** begrenser dem, men skjuler også nøklene forbi grensen for gjenoppretting.
- **Enkelte varslinger ser ut til å hoppes over ved kraftige byger** — forespørsler til samme monitor slås sammen ved ingest slik at én avsender ikke kan overvelde en monitor, noe som kan droppe en mellomliggende nyttelast når varslinger kommer tett på hverandre. Å øke `group_wait` og `group_interval` sprer dem. Sammenslåingen styres av app-containerens miljøvariabel `INCOMING_REQUEST_INGEST_COALESCE_ENABLED`, som er på som standard; selvhostende operatører som trenger at hver nyttelast vurderes, kan sette den til `false` på den containeren.

## Hvor du leser videre

- [Innkommende forespørselsmonitor](/docs/monitor/incoming-request-monitor) — monitortypen, kriteriene og hendelsesgruppering i sin helhet.
- [Oversikt over integrasjoner](/docs/integrations/index) — de innkommende og utgående mønstrene.
- [Grafana](/docs/integrations/grafana) — samme idé, med Grafana-varsling.
- [Webhook-trigger](/docs/workflows/triggers#webhook) — hvordan arbeidsflytens mottakende URL fungerer.
