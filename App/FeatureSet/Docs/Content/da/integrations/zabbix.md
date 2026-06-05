# Zabbix-integration

[Zabbix](https://www.zabbix.com) overvåger dine servere og dit netværk; OneUptime håndterer din hændelsesrespons, vagtplan og statussider. Forbind de to, og hvert Zabbix-problem bliver automatisk en OneUptime-hændelse — så de rette personer kontaktes, og din statusside holder sig præcis.

Denne integration er **indgående**: Zabbix sender problemer til OneUptime. Den bruger en Zabbix **webhook-medietype** på den ene side og et OneUptime **[Workflow](/docs/workflows/index)** på den anden. Ingen plugins, ingen ekstra tjenester.

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## Sådan virker det

1. En Zabbix-trigger skifter til **PROBLEM**.
2. En Zabbix **action** beder **OneUptime**-medietypen om at sende eventet.
3. Medietypens script POSTer en lille JSON-payload til en OneUptime workflow-URL.
4. Workflowet læser payloaden og opretter en hændelse (og løser den eventuelt, når Zabbix genopretter sig).

## Forudsætninger

- En Zabbix-server, som du administrerer (denne guide er skrevet til **Zabbix 6.0 LTS / 7.0 LTS**; webhook-medietypen fungerer på samme måde på 5.0+).
- Din Zabbix-server skal kunne nå din OneUptime-instans via HTTPS.
- Et OneUptime-projekt, hvor du kan oprette workflows.

## Del 1 — Byg OneUptime-workflowet

Gør dette først, fordi du skal bruge den webhook-URL, det genererer.

1. Åbn **Workflows → Create Workflow**. Navngiv det `Zabbix → Incidents` og åbn **Builder**-fanen.
2. Træk en **Webhook**-trigger ud på lærredet. Klik på den og **kopiér den unikke URL**, den viser. Opbevar den sikkert — enhver med den kan starte workflowet. Omdøb blokken til `Zabbix`, så variabler er lette at læse.
3. Træk en **Conditions**-blok ud på lærredet og forbind triggerens output til den. Konfigurér:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1`  *(Zabbix sender `1` for et problem, `0` for genopretning)*
4. Træk en **Create Incident**-blok og forbind den til **Conditions**-blokkens **Yes**-output. Udfyld:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: vælg den OneUptime-hændelsesalvorlighed, du ønsker (du kan forfine dette senere med flere Conditions-grene, der afbilder Zabbix-alvorligheder).
5. Gem. Lad **Enabled** være *slået fra* indtil videre — du tænder for det efter en test.

> **Tip:** At sætte Zabbix `event_id` i beskrivelsen (eller en hændelseslabel) giver dig mulighed for at finde denne hændelse igen senere, hvis du ønsker at auto-løse ved genopretning. Se [Automatisk løsning](#automatisk-løsning-valgfrit).

## Del 2 — Konfigurér Zabbix

### Trin 1: Opret OneUptime-medietypen

1. I Zabbix, gå til **Alerts → Media types** (på ældre versioner: **Administration → Media types**).
2. Klik **Create media type** og sæt **Type** til **Webhook**.
3. **Name**: `OneUptime`.
4. Tilføj disse **Parameters** (klik *Add* for hvert). Disse afbilder Zabbix [makroer](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) til en ren payload:

   | Name | Value |
   | --- | --- |
   | `url` | `{ALERT.SENDTO}` |
   | `event_id` | `{EVENT.ID}` |
   | `event_name` | `{EVENT.NAME}` |
   | `event_value` | `{EVENT.VALUE}` |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host` | `{HOST.NAME}` |
   | `event_date` | `{EVENT.DATE}` |
   | `event_time` | `{EVENT.TIME}` |

5. Indsæt dette i **Script**-feltet:

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

6. Klik på fanen **Message templates** og tilføj en skabelon for **Problem** og **Problem recovery** (bodyen kan være tom — payloaden bygges i scriptet). Dette er påkrævet, for at Zabbix kan bruge medietypen til disse eventtyper.
7. Klik **Add** for at gemme medietypen.

### Trin 2: Opret en bruger til at bære webhook'en

Zabbix sender notifikationer *til en bruger*. Opret en dedikeret bruger, så integrationen er let at finde og deaktivere.

1. Gå til **Users → Users → Create user**. Navngiv den `OneUptime Webhook`, giv den en rolle, der kan modtage notifikationer (f.eks. **User role**), og tilføj den til en brugergruppe.
2. På fanen **Media**, klik **Add**:
   - **Type**: `OneUptime`
   - **Send to**: indsæt den **workflow webhook-URL**, du kopierede i Del 1.
   - **When active** / alvorligheder: lad standardindstillingerne stå (eller begræns til de alvorligheder, du interesserer dig for).
3. Klik **Add** og **Update**.

### Trin 3: Send problemer til OneUptime med en action

1. Gå til **Alerts → Actions → Trigger actions → Create action**.
2. **Name**: `Notify OneUptime`.
3. **Conditions** (valgfrit): indsnævr det — for eksempel *Trigger severity >= Warning*. Lad det stå tomt for at sende alt.
4. På fanen **Operations** tilføjer du en operation, der sender til **User: OneUptime Webhook** via **OneUptime**-medietypen.
5. For at løse hændelser ved genopretning skal du også udfylde **Recovery operations** med den samme bruger/medie.
6. Klik **Add** for at gemme og sørg for, at actionen er **Enabled**.

## Del 3 — Test det

1. Tilbage i OneUptime-workflowet, slå **Enabled** til.
2. I Zabbix, udløs et testproblem — for eksempel ved midlertidigt at sænke en triggertærskel eller bruge et testobjekt, der skifter til en problemtilstand.
3. Åbn din workflows **Logs**-fane. Du bør se en kørsel med Zabbix-payloaden, Conditions-blokken, der tager **Yes**-stien, og hændelsen, der oprettes.
4. Tjek **Incidents** i OneUptime — dit Zabbix-problem er nu en hændelse.

Hvis intet ankommer, se [Fejlfinding](#fejlfinding).

## Automatisk løsning (valgfrit)

Det grundlæggende workflow ovenfor *åbner* hændelser. For også at *lukke* dem, når Zabbix genopretter sig:

1. Sørg for, at din Zabbix-action har **Recovery operations** konfigureret (Trin 3 ovenfor), så genopretningshændelser også sendes. Ved genopretning ankommer `status` som `0`.
2. I workflowet tilføjer du en anden **Conditions**-gren: venstre `{{Zabbix.Request Body.status}}`, operator `==`, højre `0`.
3. Fra dens **Yes**-output tilføjer du en **Find Incident**-blok, der slår den åbne hændelse op, du oprettede tidligere — match på det Zabbix `event_id`, du gemte i beskrivelsen eller en label.
4. Forbind det til en **Update Incident**-blok og flyt hændelsen til din *løst*-tilstand.

Fordi løsning afhænger af, hvordan du modellerer hændelsestilstande i dit projekt, skal du holde **opret**-stien som den pålidelige kerne og lægge løsningsstien til, når du har bekræftet, at events flyder korrekt. Se [Komponenter → OneUptime data-komponenter](/docs/workflows/components#oneuptime-data-components).

## Afbildning af Zabbix-alvorligheder (valgfrit)

Zabbix-alvorligheder (`Not classified`, `Information`, `Warning`, `Average`, `High`, `Disaster`) ankommer som `{{Zabbix.Request Body.severity}}`. For at afbilde dem til OneUptime-hændelsesalvorligheder tilføjer du **Conditions**-grene før **Create Incident** — for eksempel ruter du `Disaster` og `High` til en "Critical"-hændelse og alt andet til "Major". Byg én **Create Incident**-blok per gren.

## Fejlfinding

**Workflowet kører aldrig.**
- Bekræft, at workflowets **Enabled**-kontakt er slået til.
- Fra Zabbix-serveren, bekræft at den kan nå URL'en: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`. Du bør få en hurtig bekræftelse.
- Tjek **Reports → Action log** i Zabbix for leveringsfejl.

**Zabbix rapporterer en scriptfejl.**
- Åbn medietypen og brug **Test** til at sende en samplepayload. Zabbix viser scriptets output eller den kastede fejl.
- Et ikke-2xx-svar fra OneUptime afspejles af `throw` i scriptet — tjek at workflow-URL'en er helt korrekt.

**Hændelsen oprettes, men felter er tomme.**
- Åbn workflowets **Logs**-fane og inspicér trigger-outputtet. Bekræft, at feltnavnene under **Request Body** matcher dem, du refererer til (`name`, `host`, `severity`, `status`, `event_id`).
- Et manglende felt opløses til en tom streng frem for en fejl — se [Variabler → Gotchas](/docs/workflows/variables#gotchas).

**Alt fyrer to gange.**
- Du har sandsynligvis både et problem-trin og et eskaleringstrin, der sender til det samme medie. Tjek actionens **Operations**-trin.

## Sikkerhedsnoter

- Behandl workflow webhook-URL'en som en adgangskode. Hvis den lækker, slet triggeren og opret en ny for at rotere URL'en.
- Begræns Zabbix-actionens betingelser, så du kun videresender de alvorligheder, der berettiger en hændelse.
- Hvis du kører OneUptime selvhostet bag en firewall, tillad din Zabbix-servers udgående IP adgang til den via HTTPS.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — de indgående/udgående mønstre.
- [Webhook-trigger](/docs/workflows/triggers#webhook) — hvordan den modtagende URL fungerer.
- [Komponenter](/docs/workflows/components) — Conditions, Create Incident og mere.
- [Variabler](/docs/workflows/variables) — at læse Zabbix-payloaden i senere blokke.
