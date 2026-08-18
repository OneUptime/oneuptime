# Grafana-integrasjon

Gjør [Grafana](https://grafana.com)-varsler om til OneUptime-hendelser. Grafana evaluerer varslingsreglene på dashbordene dine; OneUptime registrerer, eskalerer og følger dem.

Denne integrasjonen er **innkommende**: et Grafana-**Webhook-contact point** POSTer til OneUptime. Det er to måter å motta det på.

| Fremgangsmåte                                                                            | Bruk den når                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **[Innkommende forespørselsmonitor](/docs/monitor/incoming-request-monitor)** (anbefalt) | Du vil at varsler skal bli hendelser med vakteskalering, én hendelse per varsel og automatisk løsning ved gjenoppretting. |
| **[Workflow](/docs/workflows/index) med en Webhook-trigger**                             | Du trenger rutingslogikk som OneUptime ikke gjør nativt — kalle andre systemer, omforme nyttelaster, betinget forgrening. |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafanas webhook-nyttelast følger Alertmanager-formen — `status`, en `alerts`-matrise, `commonLabels` og `commonAnnotations`, pluss praktiske toppnivå-felt `title` og `message`.

## Forutsetninger

- Grafana 9+ med [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) aktivert (standarden i moderne Grafana).
- Grafana må kunne nå OneUptime-instansen din over HTTPS.
- Et OneUptime-prosjekt der du kan opprette monitorer (eller arbeidsflyter).

## Alternativ 1 — Innkommende forespørselsmonitor

1. Gå til **Monitorer → Opprett monitor** og velg **Innkommende forespørsel**. Åpne den og klikk **Documentation** i venstremenyen for å kopiere URL-en.
2. Åpne monitorens **Criteria** og sett **Filter Type** til `JavaScript Expression` og **Value** til `"{{requestBody.status}}" === "firing"`.
3. Opprett en hendelse ved treff, velg de **On-Call Policies** som skal varsles, og slå på **Auto Resolve Incident** under **Advanced Options**.
4. Slå på **Group incidents and alerts by a payload field** under **Settings**, og sett:

   | Felt                               | Verdi                               |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Gi hendelsen tittelen `{{requestBody.commonLabels.alertname}}` og beskriv den med `{{requestBody.message}}` eller `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` inneholder selve grupperingsnøkkelen, men det er en hash — ikke noe å vise en vakthavende.)
6. Pek Grafana-contact pointet mot monitorens URL (se trinnene for contact point nedenfor).

Hver **unike** grupperingsverdi blir sin egen hendelse, og hver av dem lukkes når Grafana melder den som løst. Grafanas `fingerprint` per varsel er unik for et varsels labelsett, og derfor er det grupperingsstien ovenfor. Siden [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) går gjennom det samme oppsettet mer i detalj — nyttelastformen er den samme, så hvert steg der gjelder også her.

> **Warning:** Ikke grupper etter en label som er konstant på tvers av en varsling. Grafanas standard varslingspolicy grupperer etter `grafana_folder` og `alertname`, så hvert varsel i én webhook deler samme alertname — gruppering etter `requestBody.alerts[*].labels.alertname` ville få hele nyttelasten til å falle sammen til én hendelse. Grupperingsstiene må dessuten begynne med det bokstavelige `requestBody.`, og bare det første `[*]` i en sti er et jokertegn. Alt dette feiler lydløst.

## Alternativ 2 — Workflow

Bruk dette når du trenger logikk utover «varsel blir hendelse».

### Steg 1 — Bygg OneUptime-arbeidsflyten

1. Åpne **Arbeidsflyter → Opprett arbeidsflyt**, gi den navnet `Grafana → Incidents`, og åpne **Bygger**.
2. Legg til en **Webhook**-trigger og **kopier URL-en**. Gi blokken nytt navn til `Grafana`.
3. Legg til en **Betingelser**-blokk koblet til triggeren:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Fra **Ja**, legg til en **Opprett hendelse**-blokk:
   - **Tittel**: `{{Grafana.Request Body.title}}`
   - **Beskrivelse**: `{{Grafana.Request Body.message}}`
   - **Alvorlighetsgrad**: velg én (eller forgren på `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Lagre** (la stå deaktivert til det er testet).

## Konfigurer Grafana contact point

1. I Grafana går du til **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: lim inn monitor-URL-en fra Alternativ 1, eller arbeidsflytens webhook-URL fra Alternativ 2. **HTTP Method**: `POST`.
4. Lagre contact pointet.
5. Gå til **Alerting → Notification policies** og rut de varslene du vil ha (eller standardpolicyen) til **OneUptime**-contact pointet.

## Test det

1. Aktiver arbeidsflyten, hvis du bygde en.
2. Bruk **Test** på contact point-skjermen for å sende en eksempelvarsling, eller la en ekte varslingsregel utløses.
3. Sjekk **Hendelser**-listen din — og arbeidsflytens fane **Logger** hvis du brukte Alternativ 2.

## Løse ved gjenoppretting

Når varselet roer seg, sender Grafana enda en varsling med `status: resolved`.

Med **Alternativ 1** lukker gjenopprettingsfeltet og -verdien konfigurert ovenfor den matchende hendelsen automatisk — forutsatt at **Auto Resolve Incident** er på.

Med **Alternativ 2** legger du til en andre **Betingelser**-gren (`status == resolved`), finner den matchende hendelsen og flytter den til din løste tilstand med **Update Incident**.

## Merknader

- **Eldre varsling (Grafana 8 og tidligere)** sender en annen nyttelast (`ruleName`, `state`, `evalMatches`). Bruker du eldre varsling, vis heller til `{{Grafana.Request Body.ruleName}}` og `{{Grafana.Request Body.state}}`, og forgren på `state == alerting`.
- Du kan også hoppe helt over Grafanas varsling og la OneUptime overvåke de samme metrikkene direkte — se [Metrikk-overvåking](/docs/monitor/metrics-monitor).

## Feilsøking

- **Ingenting kommer frem** — bekreft at Grafana kan nå URL-en (sjekk Grafanas serverlogger), og for Alternativ 2 at arbeidsflyten er **Aktivert**. OneUptime svarer på hver innkommende forespørsel med en tom `200` før den valideres, så en `200` i Grafanas logger bekrefter ikke at nyttelasten ble godtatt.
- **Hendelser åpnes, men lukkes aldri** — sjekk gjenopprettingsfeltet og -verdien på kriteriet, og at **Auto Resolve Incident** er på under hendelsens **Advanced Options**. Sammenligningen skiller mellom store og små bokstaver.
- **Bare én hendelse for en nyttelast full av varsler** — du grupperte etter en label som ikke varierer innenfor en varsling. Grupper etter `requestBody.alerts[*].fingerprint` i stedet.
- **Hendelsesteksten viser rå `{{...}}`-plassholdere** — stien ble ikke løst, og uløste plassholdere blir stående i stedet for å tømmes. Vis til felter som finnes i din varslingsversjon; undersøk trigger-utdataene i fanen **Logger** hvis du brukte Alternativ 2.

## Hvor du leser videre

- [Innkommende forespørselsmonitor](/docs/monitor/incoming-request-monitor) — monitortypen, kriteriene og hendelsesgruppering i sin helhet.
- [Oversikt over integrasjoner](/docs/integrations/index) — det innkommende mønsteret.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — nært beslektet nyttelast.
- [Metrikk-overvåking](/docs/monitor/metrics-monitor) — overvåk metrikker direkte i OneUptime.
