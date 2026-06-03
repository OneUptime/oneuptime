# Zabbix-integrasjon

[Zabbix](https://www.zabbix.com) overvåker serverne og nettverket ditt; OneUptime håndterer hendelsesrespons, vaktordning og statussider. Koble de to sammen, og hvert Zabbix-problem blir automatisk en OneUptime-hendelse — slik at de rette personene varsles og statussiden din forblir ærlig.

Denne integrasjonen er **innkommende**: Zabbix sender problemer til OneUptime. Den bruker en Zabbix **webhook-medietype** på den ene siden og en OneUptime **[Arbeidsflyt](/docs/workflows/index)** på den andre. Ingen plugins, ingen ekstra tjenester.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## Hvordan det fungerer

1. En Zabbix-trigger endres til **PROBLEM**.
2. En Zabbix **action** ber **OneUptime**-medietypen om å sende hendelsen.
3. Medietype-skriptet POSTer en liten JSON-nyttelast til en OneUptime arbeidsflyt-URL.
4. Arbeidsflyten leser nyttelasten og oppretter en hendelse (og løser den eventuelt når Zabbix gjenopprettes).

## Forutsetninger

- En Zabbix-server du administrerer (denne veiledningen er skrevet for **Zabbix 6.0 LTS / 7.0 LTS**; webhook-medietypen fungerer det samme på 5.0+).
- Zabbix-serveren din må kunne nå OneUptime-instansen din over HTTPS.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter.

## Del 1 — Bygg OneUptime-arbeidsflyten

Gjør dette først, ettersom du trenger webhook-URL-en den genererer.

1. Åpne **Workflows → Create Workflow**. Gi den navnet `Zabbix → Incidents` og åpne **Builder**-fanen.
2. Dra en **Webhook**-trigger inn på lerretet. Klikk på den og **kopier den unike URL-en** den viser. Hold den trygg — alle med den kan starte arbeidsflyten. Gi blokken nytt navn til `Zabbix` slik at variabler leses pent.
3. Dra en **Conditions**-blokk inn på lerretet og koble triggerens utdata til den. Konfigurer:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1`  *(Zabbix sender `1` for et problem, `0` for gjenoppretting)*
4. Dra en **Create Incident**-blokk og koble den til **Yes**-utgangen på Conditions-blokken. Fyll inn:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: velg den OneUptime-hendelsesalvorlighetsgraden du ønsker (du kan finjustere dette senere med flere Conditions-grener som mapper Zabbix-alvorlighetsgrader).
5. Lagre. La **Enabled** stå *av* foreløpig — du slår det på etter en test.

> **Tips:** Å legge Zabbix `event_id` i beskrivelsen (eller en hendelseskode) gjør det mulig å finne denne hendelsen igjen senere hvis du ønsker automatisk løsning ved gjenoppretting. Se [Løse automatisk](#løse-automatisk-valgfritt).

## Del 2 — Konfigurer Zabbix

### Steg 1: Opprett OneUptime-medietypen

1. I Zabbix, gå til **Alerts → Media types** (på eldre versjoner: **Administration → Media types**).
2. Klikk **Create media type** og sett **Type** til **Webhook**.
3. **Name**: `OneUptime`.
4. Legg til disse **Parameters** (klikk *Add* for hver). Disse mapper Zabbix-[makroer](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) til en ryddig nyttelast:

   | Navn | Verdi |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. Lim inn dette i **Script**-feltet:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader('Content-Type: application/json');

   var payload = {
     source: 'zabbix',
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw 'OneUptime responded with HTTP ' + request.getStatus() + ': ' + response;
   }

   return 'OK';
   ```

6. Klikk på fanen **Message templates** og legg til en mal for **Problem** og **Problem recovery** (body-en kan være tom — nyttelasten bygges i skriptet). Dette kreves for at Zabbix skal bruke medietypen for disse hendelsestypene.
7. Klikk **Add** for å lagre medietypen.

### Steg 2: Opprett en bruker til å bære webhoken

Zabbix sender varsler *til en bruker*. Opprett en dedikert bruker slik at integrasjonen er lett å finne og deaktivere.

1. Gå til **Users → Users → Create user**. Gi den navnet `OneUptime Webhook`, gi den en rolle som kan motta varsler (f.eks. **User role**), og legg den til i en brukergruppe.
2. På **Media**-fanen, klikk **Add**:
   - **Type**: `OneUptime`
   - **Send to**: lim inn **arbeidsflyt-webhook-URL-en** du kopierte i Del 1.
   - **When active** / alvorlighetsgrader: la standardverdiene stå (eller begrens til alvorlighetsgrader du bryr deg om).
3. Klikk **Add** og **Update**.

### Steg 3: Send problemer til OneUptime med en action

1. Gå til **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (valgfritt): avgrens — for eksempel, *Trigger severity >= Warning*. La stå tom for å sende alt.
4. På **Operations**-fanen, legg til en operasjon som sender til **User: OneUptime Webhook** via **OneUptime**-medietypen.
5. For å løse hendelser ved gjenoppretting senere, fyll også inn **Recovery operations** med samme bruker/medietype.
6. Klikk **Add** for å lagre og sørg for at action-en er **Enabled**.

## Del 3 — Test det

1. Tilbake i OneUptime-arbeidsflyten, slå på **Enabled**.
2. I Zabbix, utløs et testproblem — for eksempel, senk midlertidig en triggertterskel, eller bruk et testobjekt som skifter til problemtilstand.
3. Åpne arbeidsflytens **Logs**-fane. Du bør se en kjøring med Zabbix-nyttelasten, Conditions-blokken som tar **Yes**-stien, og hendelsen som opprettes.
4. Sjekk **Incidents** i OneUptime — Zabbix-problemet er nå en hendelse.

Hvis ingenting ankommer, se [Feilsøking](#feilsøking).

## Løse automatisk (valgfritt)

Kjernarbeidsflyten ovenfor *åpner* hendelser. For også å *lukke* dem når Zabbix gjenopprettes:

1. Sørg for at Zabbix-action-en har **Recovery operations** konfigurert (Steg 3 ovenfor) slik at gjenopprettingshendelser også sendes. Ved gjenoppretting ankommer `status` som `0`.
2. I arbeidsflyten, legg til en ny **Conditions**-gren: venstre `{{Zabbix.Request Body.status}}`, operator `==`, høyre `0`.
3. Fra **Yes**-utgangen, legg til en **Find Incident**-blokk som slår opp den åpne hendelsen du opprettet tidligere — match på Zabbix `event_id` du lagret i beskrivelsen eller en kode.
4. Koble det til en **Update Incident**-blokk og flytt hendelsen til din *løst*-tilstand.

Fordi løsning avhenger av hvordan du modellerer hendelsetilstander i prosjektet ditt, hold **create**-stien som den pålitelige kjernen og legg til løsningsstien når du har bekreftet at hendelser flyter korrekt. Se [Komponenter → OneUptime-datakomponenter](/docs/workflows/components#oneuptime-data-components).

## Kartlegge Zabbix-alvorlighetsgrader (valgfritt)

Zabbix-alvorlighetsgrader (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) ankommer som `{{Zabbix.Request Body.severity}}`. For å mappe dem til OneUptime-hendelsesalvorlighetsgrader, legg til **Conditions**-grener før **Create Incident** — for eksempel, rut `Disaster` og `High` til en "Critical"-hendelse og alt annet til "Major". Bygg én **Create Incident**-blokk per gren.

## Feilsøking

**Arbeidsflyten kjører aldri.**
- Bekreft at arbeidsflytens **Enabled**-bryter er på.
- Fra Zabbix-serveren, bekreft at den kan nå URL-en: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Du bør få en rask bekreftelse.
- Sjekk **Reports → Action log** i Zabbix for leveringsfeil.

**Zabbix rapporterer en skriptfeil.**
- Åpne medietypen og bruk **Test** for å sende en eksempelnyttelast. Zabbix viser skriptets utdata eller den kastede feilen.
- Et ikke-2xx-svar fra OneUptime vises av `throw` i skriptet — sjekk at arbeidsflyt-URL-en er nøyaktig riktig.

**Hendelsen opprettes, men felt er tomme.**
- Åpne arbeidsflytens **Logs**-fane og inspiser triggerutdataene. Bekreft at feltnavnene under **Request Body** matcher det du refererer til (`name`, `host`, `severity`, `status`, `event_id`).
- Et manglende felt løses til en tom streng i stedet for en feil — se [Variabler → Gotchas](/docs/workflows/variables#gotchas).

**Alt utløses to ganger.**
- Du har sannsynligvis både en problemoperasjon og et eskaleringssteg som sender til den samme medietypen. Sjekk action-ens **Operations**-steg.

## Sikkerhetsnotes

- Behandle arbeidsflyt-webhook-URL-en som et passord. Hvis den lekker, slett triggeren og opprett en ny for å rotere URL-en.
- Begrens Zabbix-action-ens betingelser slik at du bare videresender alvorlighetsgrader som berettiger en hendelse.
- Hvis du kjører OneUptime selvhostet bak en brannmur, tillat Zabbix-serverens utgående IP å nå den over HTTPS.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — de innkommende/utgående mønstrene.
- [Webhook-trigger](/docs/workflows/triggers#webhook) — hvordan mottaks-URL-en fungerer.
- [Komponenter](/docs/workflows/components) — Conditions, Create Incident og mer.
- [Variabler](/docs/workflows/variables) — å lese Zabbix-nyttelasten i senere blokker.
