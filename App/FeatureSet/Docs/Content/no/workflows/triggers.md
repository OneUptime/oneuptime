# Triggere

En trigger er startnoden i en arbeidsflyt. Den har ingen inngangsport — utførelsen begynner her. OneUptime støtter fire trigger-familier; hver arbeidsflyt bruker nøyaktig én.

## Manual

Kjør en arbeidsflyt på forespørsel ved å klikke **Kjør manuelt** på arbeidsflyt-siden. Du kan lime inn en valgfri JSON-payload som arbeidsflyten kan lese som `{{Manual.JSON}}`.

Bruk denne når du vil ha en knapp som trigger et stykke automatisering — en ett-klikks "roter on-call-nøkkelen" eller "bygg om søkeindeksen"-arbeidsflyt som ikke trenger en gjentakende tidsplan eller en hendelse for å trigges.

**Argumenter**: ingen.

**Returverdier**:

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| `JSON` | JSON | JSON-payloaden som ble levert ved kjøretid, eller et tomt objekt. |

## Schedule

Kjør en arbeidsflyt på en cron-tidsplan. Konfigurer takten med et standard cron-uttrykk.

Bruk denne for gjentakende jobber: nattlig opprydding, timesvis synkronisering, ukentlig eksport.

**Argumenter**:

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| `Schedule at` | CronTab | Standard 5-felts cron-uttrykk. For eksempel kjører `0 * * * *` på toppen av hver time, `*/5 * * * *` hvert femte minutt. |

**Returverdier**:

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| `executedAt` | Date | Den planlagte kjøretiden. |

Planlagte arbeidsflyter kjører på arbeidsflyt-workeren i prosjektets region. Hvis workeren er kortvarig utilgjengelig, blir kjøringen sendt når den kommer tilbake — du trenger ikke å gardere deg mot tapte tikk for korte avbrudd.

## Webhook

Eksponer en unik HTTPS-URL som et eksternt system `POST`-er til. Forespørselens headere, query-parametere og body eksponeres som returverdier for nedstrømskomponenter å lese.

Bruk denne for å motta data *inn i* OneUptime fra et tredjepartssystem: CI/CD-callbacks, varsler fra et annet overvåkingsverktøy, kundeoppmeldinger i CRM-et ditt.

**Argumenter**: ingen. URL-en tildeles automatisk når arbeidsflyten lagres og vises på trigger-noden. Behandle den som en hemmelighet — alle med URL-en kan trigge arbeidsflyten.

**Returverdier**:

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| `Request Headers` | JSON | Alle headere fra den innkommende HTTP-forespørselen. |
| `Request Query Params` | JSON | Parsede query-strenger. |
| `Request Body` | JSON | Parsed forespørsels-body. Hvis body ikke er gyldig JSON, kommer den som en streng under `raw`-nøkkelen. |

Webhooken godtar `GET` og `POST`. Svaret til kalleren er en `200 OK` med en JSON-bekreftelse så snart kjøringen er køet — selve arbeidsflyten kjører asynkront, så ikke forvent å lese resultatet av nedstrømskomponenter i HTTP-responsen.

## Modellhendelse-triggere

Nesten hver OneUptime-entitet — monitorer, hendelser, varsler, planlagt vedlikeholdshendelser, statussider, on-call-retningslinjer, team, telemetri-tjenester og mange flere — eksponerer tre triggere:

- **On Create** — trigges når en ny post av denne typen opprettes.
- **On Update** — trigges når en eksisterende post endres. Triggeren eksponerer både gamle og nye verdier.
- **On Delete** — trigges når en post slettes.

Slik bygger du "når X skjer i OneUptime, gjør Y"-automatisering uten polling.

Selve modellen eksponeres som en returverdi med de samme feltnavnene du ser på ressursen. For eksempel returnerer **Incident → On Create**-triggeren det fullstendige `Incident`-objektet slik at nedstrømsnoder kan lese `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` osv.

**Argumenter**: vanligvis ingen for create/delete. Update-triggere kan la deg innsnevre feltene du vil reagere på, slik at du ikke trigger på kosmetiske endringer.

**Returverdier** (varierer per modell):

| Navn | Type | Beskrivelse |
| --- | --- | --- |
| Modellfelt | (varierer) | Hver kolonne på entiteten — navn, status, tidsstempler, fremmednøkler. |
| `previous` (kun Update) | JSON | Posten slik den var før endringen. |

### Vanlige modell-triggere

En ikke-uttømmende liste over modellhendelsene team oftest griper til:

- **Incident** — `On Create`, `On Update` (bruk for å reagere på tilstandsendringer som Acknowledged eller Resolved), `On Delete`.
- **Alert** — samme tre hendelser på alert-modellen.
- **Monitor** — reager når en monitor legges til, redigeres eller fjernes; kombiner med betingelser for å handle kun på produksjonsmonitorer.
- **Scheduled Maintenance** — automatiser nedstrøms-kunngjøringer når et vedlikeholdsvindu opprettes eller tilstanden endres.
- **Status Page Subscriber** — trigg en velkomstflyt når noen abonnerer.
- **On-Call Duty Policy** — synkroniser tidsplanendringer til en ekstern roster.

Hvis modellen er eksponert i OneUptime API, kan den nesten helt sikkert trigge en arbeidsflyt — søk i trigger-paletten etter entitetsnavn.

## Velge riktig trigger

| Hvis du vil... | Bruk |
| --- | --- |
| Bygge en knapp på en arbeidsflyt som noen klikker | **Manual** |
| Kjøre en jobb hvert N minutt/time/dag | **Schedule** |
| La et eksternt system pushe data inn i OneUptime | **Webhook** |
| Reagere på noe som skjer *inni* OneUptime | **Modellhendelse** |

Arbeidsflyter kan bare ha én trigger. Hvis du trenger to ulike startsignaler for å dele det meste av samme logikk, faktorer du de delte trinnene inn i én arbeidsflyt og kaller den fra to tynne "wrapper"-arbeidsflyter via **Execute Workflow**-komponenten (se [Komponenter](/docs/workflows/components)).

## Les videre

- [Komponenter](/docs/workflows/components) — handlingene du kobler etter triggeren.
- [Variabler](/docs/workflows/variables) — hvordan lese trigger-returverdier fra nedstrømsnoder.
- [Kjøringer & logger](/docs/workflows/runs-and-logs) — hvordan bekrefte at triggeren din trigges.
