# Grafana-integration

Lav [Grafana](https://grafana.com)-alarmer om til OneUptime-hændelser. Grafana evaluerer alarmreglerne på dine dashboards; OneUptime registrerer, eskalerer og følger dem.

Denne integration er **indgående**: et Grafana-**Webhook-contact point** POSTer til OneUptime. Der er to måder at modtage det på.

| Fremgangsmåde                                                                         | Brug den, når                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **[Indgående anmodningsmonitor](/docs/monitor/incoming-request-monitor)** (anbefalet) | Du vil have alarmer til at blive hændelser med vagt-eskalering, én hændelse per alarm og automatisk løsning ved genopretning.   |
| **[Workflow](/docs/workflows/index) med en Webhook-trigger**                          | Du har brug for routinglogik, som OneUptime ikke laver indbygget — kalde andre systemer, omforme payloads, betinget forgrening. |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafanas webhook-payload følger Alertmanager-formen — `status`, et `alerts`-array, `commonLabels` og `commonAnnotations`, plus praktiske øverste-niveau-felter `title` og `message`.

## Forudsætninger

- Grafana 9+ med [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) aktiveret (standarden i moderne Grafana).
- Grafana skal kunne nå din OneUptime-instans over HTTPS.
- Et OneUptime-projekt, hvor du kan oprette monitorer (eller workflows).

## Mulighed 1 — Indgående anmodningsmonitor

1. Gå til **Monitorer → Opret monitor** og vælg **Indgående anmodning**. Åbn den og klik på **Documentation** i menuen til venstre for at kopiere URL'en.
2. Åbn monitorens **Criteria**, og sæt **Filter Type** til `JavaScript Expression` og **Value** til `"{{requestBody.status}}" === "firing"`.
3. Opret en hændelse ved match, vælg de **On-Call Policies**, der skal tilkaldes, og slå **Auto Resolve Incident** til under **Advanced Options**.
4. Slå under **Settings** indstillingen **Group incidents and alerts by a payload field** til, og sæt:

   | Felt                               | Værdi                               |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Giv hændelsen titlen `{{requestBody.commonLabels.alertname}}` og beskriv den med `{{requestBody.message}}` eller `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` indeholder selve grupperingsnøglen, men det er et hash — ikke noget at vise en vagthavende.)
6. Peg Grafana-contact pointet mod monitorens URL (se trinnene for contact point nedenfor).

Hver **unik** grupperingsværdi bliver sin egen hændelse, og hver af dem lukkes, når Grafana melder den løst. Grafanas `fingerprint` per alarm er unik for en alarms labelsæt, og derfor er det grupperingsstien ovenfor. Siden [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) gennemgår den samme opsætning mere detaljeret — payload-formen er den samme, så hvert trin dér gælder også her.

> **Warning:** Gruppér ikke efter en label, der er konstant på tværs af en notifikation. Grafanas standard-notifikationspolitik grupperer efter `grafana_folder` og `alertname`, så hver alarm i én webhook deler samme alertname — gruppering efter `requestBody.alerts[*].labels.alertname` ville få hele payloaden til at falde sammen til én hændelse. Grupperingsstierne skal desuden begynde med det bogstavelige `requestBody.`, og kun det første `[*]` i en sti er et jokertegn. Alt dette fejler lydløst.

## Mulighed 2 — Workflow

Brug denne, når du har brug for logik ud over "alarm bliver til hændelse".

### Trin 1 — Byg OneUptime-workflowet

1. Åbn **Arbejdsgange → Opret arbejdsgang**, navngiv det `Grafana → Incidents`, og åbn **Bygger**.
2. Tilføj en **Webhook**-trigger og **kopiér dens URL**. Omdøb blokken til `Grafana`.
3. Tilføj en **Betingelser**-blok forbundet til triggeren:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Fra **Ja** tilføjer du en **Opret hændelse**-blok:
   - **Titel**: `{{Grafana.Request Body.title}}`
   - **Beskrivelse**: `{{Grafana.Request Body.message}}`
   - **Alvorlighed**: vælg én (eller forgren på `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Gem** (lad det stå deaktiveret, indtil det er testet).

## Konfigurér Grafana contact point

1. Gå i Grafana til **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: indsæt monitor-URL'en fra Mulighed 1, eller workflowets webhook-URL fra Mulighed 2. **HTTP Method**: `POST`.
4. Gem contact pointet.
5. Gå til **Alerting → Notification policies** og rut de ønskede alarmer (eller standardpolitikken) til **OneUptime**-contact pointet.

## Test det

1. Aktivér workflowet, hvis du byggede et.
2. Brug **Test** på contact point-skærmen til at sende en eksempelnotifikation, eller lad en rigtig alarmregel udløses.
3. Tjek din **Hændelser**-liste — og workflowets fane **Logfiler**, hvis du brugte Mulighed 2.

## Løsning ved genopretning

Når alarmen falder til ro, sender Grafana endnu en notifikation med `status: resolved`.

Med **Mulighed 1** lukker genopretningsfeltet og -værdien, der er konfigureret ovenfor, automatisk den matchende hændelse — forudsat at **Auto Resolve Incident** er slået til.

Med **Mulighed 2** tilføjer du en anden **Betingelser**-gren (`status == resolved`), finder den matchende hændelse og flytter den til din løste tilstand med **Update Incident**.

## Noter

- **Ældre alarmering (Grafana 8 og tidligere)** sender en anden payload (`ruleName`, `state`, `evalMatches`). Bruger du ældre alarmering, så referér til `{{Grafana.Request Body.ruleName}}` og `{{Grafana.Request Body.state}}` i stedet, og forgren på `state == alerting`.
- Du kan også springe Grafanas alarmering helt over og lade OneUptime overvåge de samme metrikker direkte — se [Metrik-monitor](/docs/monitor/metrics-monitor).

## Fejlfinding

- **Der kommer intet frem** — bekræft at Grafana kan nå URL'en (tjek Grafanas serverlogfiler), og ved Mulighed 2 at workflowet er **Aktiveret**. OneUptime svarer på hver indgående anmodning med et tomt `200`, før den valideres, så et `200` i Grafanas logfiler bekræfter ikke, at payloaden blev accepteret.
- **Hændelser åbner, men lukker aldrig** — tjek genopretningsfeltet og -værdien på kriteriet, og at **Auto Resolve Incident** er slået til under hændelsens **Advanced Options**. Sammenligningen skelner mellem store og små bogstaver.
- **Kun én hændelse for en payload fuld af alarmer** — du grupperede efter en label, der ikke varierer inden for en notifikation. Gruppér efter `requestBody.alerts[*].fingerprint` i stedet.
- **Hændelsesteksten viser rå `{{...}}`-pladsholdere** — stien blev ikke opløst, og uopløste pladsholdere lades stå i stedet for at blive tømt. Referér til felter, der findes i din alarmeringsversion; undersøg trigger-outputtet i fanen **Logfiler**, hvis du brugte Mulighed 2.

## Læs videre

- [Indgående anmodningsmonitor](/docs/monitor/incoming-request-monitor) — monitortypen, dens kriterier og hændelsesgruppering i fuld længde.
- [Oversigt over integrationer](/docs/integrations/index) — det indgående mønster.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — nært beslægtet payload.
- [Metrik-monitor](/docs/monitor/metrics-monitor) — overvåg metrikker direkte i OneUptime.
