# Microsoft Dynamics 365-integrasjon

Åpne en **Case** i [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) hver gang en OneUptime-hendelse opprettes, hold den saken i takt mens hendelsen utvikler seg, og la Dynamics sende saksendringer tilbake til OneUptime — alt sammen med en [arbeidsflyt](/docs/workflows/index). Det finnes ingen Dynamics-spesifikk blokk å installere: OneUptime snakker med **Dataverse Web API** via [API-komponenten](/docs/workflows/components#api), og Dynamics snakker tilbake gjennom en [Webhook-trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Denne siden dekker begge retningene. Bygg den utgående halvdelen først — det er den som krever oppsettet i Microsoft Entra ID, og når den virker, er den innkommende halvdelen én enkelt flyt.

## Forutsetninger

- Et **Dynamics 365**-miljø som inneholder **Case**-tabellen. Cases kommer fra Dynamics 365 Customer Service; et Dataverse-miljø uten det har ingen `incident`-tabell å skrive til.
- Miljøets **Web API endpoint**. Du finner det i [Power Platform admin center](https://admin.powerplatform.microsoft.com/) under miljøets **Settings → Developer resources**, eller i **make.powerapps.com → Settings → Developer resources**. Det ser slik ut: `https://yourorg.crm.dynamics.com/api/data/v9.2/` — regionsegmentet varierer (`crm` for Nord-Amerika, `crm2` for Sør-Amerika, `crm7` for Japan, og så videre).
- Rettigheter til å registrere en applikasjon i **Microsoft Entra ID** og til å opprette en **application user** i Dynamics-miljøet. Dette er som regel to forskjellige administratorer.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter og globale variabler.

> Alt nedenfor bruker tabellnavnene i Dataverse, ikke etikettene på Dynamics-skjemaene. En sak er **`incident`**-tabellen, samlingen dens i en URL er **`incidents`**, primærnøkkelen er **`incidentid`**, og tittelkolonnen er **`title`**. Saksnummeret du ser i grensesnittet, er **`ticketnumber`**.

## Steg 1 — Registrer en applikasjon i Microsoft Entra ID

OneUptime autentiserer seg som en applikasjon, ikke som en person, så den bruker OAuth 2.0-flyten **client credentials**.

1. Logg inn på [Azure-portalen](https://portal.azure.com) som administrator for den samme tenanten som Dynamics-miljøet ditt, og åpne **Microsoft Entra ID**.
2. Gå til **App registrations → New registration**. Gi den et navn som `OneUptime Integration`, la **Supported account types** stå på **Accounts in this organizational directory only**, og velg **Register**.
3. Fra appens **Overview**-side kopierer du **Application (client) ID** og **Directory (tenant) ID**.
4. Gå til **Certificates & secrets → Client secrets → New client secret**. Kopier hemmelighetens **Value** — ikke ID-en — før du navigerer bort. Den vises aldri igjen. En client secret kan leve i høyst 24 måneder, så noter utløpet et sted du kommer til å se det.

To ting folk legger til her som du ikke trenger:

- **Ingen API permissions.** I client credentials-flyten finnes det ingen innlogget bruker, så delegerte rettigheter gjør ingenting. `user_impersonation` under **Dataverse** er en delegert rettighet og er bare for interaktive apper. Microsoft Entra ID utsteder gjerne et token for Dataverse helt uten konfigurerte rettigheter — tilgangen avgjøres på Dynamics-siden, i Steg 2.
- **Ingen admin consent-steg.** Av samme grunn.

Microsoft foretrekker et sertifikat framfor en client secret for produksjonsapplikasjoner. Det alternativet krever at den som kaller, bygger og signerer en JWT-assertion selv, noe en arbeidsflyt ikke kan gjøre, så en client secret er det praktiske valget her — og bør behandles deretter: hold den i en hemmelig variabel, og roter den før den utløper.

## Steg 2 — Opprett application user i Dynamics

Dette er steget som blir hoppet over, og å hoppe over det gir den mest forvirrende feilen i hele denne integrasjonen: tokenforespørselen lykkes, og hvert eneste Dataverse-kall feiler deretter med `403 Forbidden` og feilkoden `0x80072560` — *«The user isn't a member of the organization.»* Entra ID utsteder tokenet uten å vite noe som helst om Dynamics; Dynamics leter så etter en brukerrad som samsvarer med applikasjonen, og det finnes ingen.

1. Åpne [Power Platform admin center](https://admin.powerplatform.microsoft.com/) og velg **Manage → Environments**, deretter miljøet ditt.
2. Velg **Settings → Users + permissions → Application users**.
3. Velg **+ New app user**, deretter **+ Add an app**, velg registreringen fra Steg 1, og velg **Add**.
4. Velg en **Business unit**, skriv inn en **Email address**, og bruk deretter redigeringsikonet ved siden av **Security roles**.
5. Tildel en **egendefinert** sikkerhetsrolle med rettighetene create, read og write på **Case**-tabellen. En application user kan ikke få en av de innebygde rollene — Microsoft krever en egendefinert. Har du ingen passende rolle, kopierer du en eksisterende og trimmer den ned.
6. Velg **Save**, deretter **Create**.

Du kan bare ha én application user per registrerte applikasjon i et miljø. Application users er ikke lisensiert og er unntatt fra miljøets regler for medlemskap i sikkerhetsgrupper.

## Steg 3 — Lagre legitimasjonen i OneUptime

Gå til **Arbeidsflyter → Globale variabler → Opprett** og legg til disse, med **Secret** slått på for dem som er merket:

| Navn                     | Verdi                                                       | Hemmelig |
| ------------------------ | ----------------------------------------------------------- | -------- |
| `DYNAMICS_TENANT_ID`     | Directory (tenant) ID fra Steg 1                            | Nei      |
| `DYNAMICS_CLIENT_ID`     | Application (client) ID fra Steg 1                          | Nei      |
| `DYNAMICS_CLIENT_SECRET` | Client secret-verdien (**Value**) fra Steg 1                | Ja       |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — uten etterfølgende skråstrek | Nei  |

Lim inn client secret nøyaktig slik Entra ID ga deg den. OneUptime koder skjemakroppen for deg, så ikke URL-kod den for hånd.

Referer til hvilken som helst av dem fra en blokk med `{{global.variables.DYNAMICS_CLIENT_ID}}`. Se [Variabler](/docs/workflows/variables) for hvordan hemmeligheter vaskes bort fra kjøreloggene.

## Steg 4 — Hent et tilgangstoken

Hver kjøring henter sitt eget token. Tokener varer i 60–90 minutter, og client credentials-flyten utsteder aldri et refresh token, så det er ingenting å mellomlagre og ingenting å fornye — ett ekstra HTTP-kall per kjøring er hele kostnaden.

1. Åpne **Arbeidsflyter → Opprett arbeidsflyt**, gi den navnet `Incidents → Dynamics 365`, og åpne **Bygger**.
2. Klikk på den stiplede plassholderen, legg til triggeren **On Create Incident**, og be i dens **Select Fields** om kolonnene du vil sende:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   La **Identifier** stå som `incident-on-create-1`.

3. Klikk **Legg til komponent**, legg til en **API Post (JSON)**-blokk, koble triggerens **Success**-prikk til den, og åpne innstillingene. Sett **Identifier** til `get-token`, og deretter:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**Skriv headernavnet som `Content-Type`, med nøyaktig den bruken av store bokstaver.** Det er den som forteller OneUptime at kroppen skal sendes som en skjemapost og ikke som JSON, og det er den eneste formen Microsofts tokenendepunkt godtar. `content-type` med små bokstaver gir ingen treff, og forespørselen går ut som JSON og kommer tilbake som `400`.

`scope` må være miljø-URL-en din etterfulgt av `/.default` — det er formen for en konfidensiell klient. En feil miljø-URL her er den vanlige årsaken til `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

Tokenet er nå tilgjengelig nedstrøms som:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Steg 5 — Opprett saken

Legg til en andre **API Post (JSON)**-blokk, koble `get-token`s **Success**-prikk til den, og sett **Identifier** til `create-case`.

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

Erstatt konto-GUID-en med kontoen disse sakene hører til. **`customerid` er virkelig påkrevd på en sak** — det er en av kolonnene Dataverse håndhever ved enhver programmatisk skriving, så en opprettelse uten den blir avvist. Fordi den kan peke på enten en account eller en contact, skriver du aldri `customerid@odata.bind`; du skriver `customerid_account@odata.bind` eller `customerid_contact@odata.bind`, og de navnene skiller mellom store og små bokstaver. `title` er påkrevd på en annen måte: Dynamics-skjemaene insisterer på den, API-et gjør det ikke, så send den likevel.

`Prefer: return=representation` er det som gjør dette brukbart fra en arbeidsflyt. Uten den svarer en vellykket opprettelse med `204 No Content` og legger den nye postens URI i en `OData-EntityId`-svarheader, som du deretter måtte plukke en GUID ut av. Med den er svaret `201 Created` og bærer selve posten, slik at neste blokk kan lese:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Slå nå på arbeidsflyten — **Oversikt → Rediger arbeidsflyt → Aktivert** — opprett en testhendelse, og les kjøringen under **Kjøringer og logger**. `create-case`-blokken bør vise en `201` og en kropp som inneholder den nye `incidentid`. Endringer på lerretet lagrer seg selv; det finnes ingen Lagre-knapp.

### Å mappe alvorlighetsgrad og status

Dynamics leveres med `severitycode` med ett eneste alternativ, «Default Value», så det finnes ingen ferdig alvorlighetsskala å mappe mot. Bruk **`prioritycode`** i stedet, og forgren med en **If / Else**-blokk på `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` hvis du vil ha prioriteter per alvorlighetsgrad.

| Kolonne          | Verdier                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` kan tilpasses, så en tenant kan ha lagt til sine egne verdier. Send heltall, ikke etiketter.

## Steg 6 — Hold hendelsen og saken søkbare fra hverandre

Uansett hva du gjør senere — kommentere, løse, synkronisere tilbake — kreves det at ett av de to systemene holder på det andres identifikator. Legg den på Dynamics-siden.

Legg til en kolonne av typen **single line of text** på Case-tabellen, for eksempel `new_oneuptimeincidentid`, og sett den når du oppretter saken:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Da kan enhver senere arbeidsflyt finne saken med et filter:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Definerer du den kolonnen som en **alternate key** på Case-tabellen, kan du hoppe over oppslaget helt og `PATCH`-e rett til `incidents(new_oneuptimeincidentid='<id>')` — en upsert som oppretter saken hvis den mangler, og oppdaterer den hvis den ikke gjør det. Nøkkelen må bli ferdig bygget (tilstanden dens blir **Active**) før den kan brukes, og verdier for alternate key kan ikke inneholde `/ < > * % & : \ ? + #`. En OneUptime-id er en ren UUID, så den er trygg.

Den motsatte retningen — å lagre Dynamics-saks-id-en på OneUptime-hendelsen — fungerer også, med en **Update One Incident**-blokk som skriver til `customFields`. Vær forsiktig med den: `customFields` er én enkelt JSON-kolonne, så å skrive til den erstatter hver eneste verdi i egendefinerte felt på den hendelsen, ikke bare din. Å holde koblingen på Dynamics-siden unngår dette helt.

## Steg 7 — Løs saken når hendelsen løses

Bygg dette som en **andre** arbeidsflyt, slik at en feil her ikke kan stoppe at saker blir åpnet.

1. **Opprett arbeidsflyt**, gi den navnet `Incident resolved → Close Dynamics case`, og legg til triggeren **On Update Incident**.
2. I triggerens **Listen on** legger du `{"currentIncidentStateId": true}` slik at arbeidsflyten bare våkner ved tilstandsendringer og ikke ved hver eneste redigering. I **Select Fields** ber du om `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Legg til en **If / Else**-blokk. **Input 1** er `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** er `==`, og **Input 2** er `Resolved` — eller hva prosjektets løste tilstand nå heter. Se [Tilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).
4. Fra **Yes**-grenen gjentar du `get-token`-blokken fra Steg 4.
5. Legg til en **API Get (JSON)**-blokk, sett **Identifier** til `find-case`, og gi den `$filter`-URL-en fra Steg 6. En Dataverse-spørring svarer med et `value`-array, og en arbeidsflytreferanse kan indeksere inn i et array med klammer, så saks-id-en er `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Legg til en **API Post (JSON)**-blokk som lukker saken:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: de samme som i Steg 5, minus `Prefer`.
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` er en `statuscode`-verdi i Resolved-tilstanden — `5` er *Problem Solved*.

     **Test denne kroppen mot ditt eget miljø før du stoler på den.** `CloseIncident` tar to parametere, `IncidentResolution` og `Status`, men Microsoft publiserer ingen HTTP-eksempler for den — alle offisielle eksempler er i C#. Formen ovenfor er den konvensjonelle oversettelsen. Avviser miljøet ditt den, kan du prøve å identifisere saken med en enkel `"incidentid": "<the case id>"`-egenskap i stedet for `@odata.bind`-formen, som er måten Microsofts andre handlingseksempler refererer til en eksisterende post på.

**Hvorfor ikke bare `PATCH`-e saken til `statecode: 1`?** Det kan du — Microsoft dokumenterer en `PATCH` av `statecode` og `statuscode` som Web API-ekvivalenten til den eldre SetState-meldingen, og det er riktig verktøy for å flytte en sak mellom aktive statuser. Det den ikke gjør, er å opprette **Case Resolution**-aktiviteten som en løst sak i Dynamics 365 Customer Service forventes å ha, og den vil bli avvist blankt i et miljø der en administrator har konfigurert egendefinerte statusoverganger. Bruk `CloseIncident` til å løse; bruk `PATCH` til alt annet. Og hver gang du skriver `statecode`, skal du sette `statuscode` i den samme forespørselen — ellers bruker Dynamics stille den tilstandens standardstatus.

`CloseIncident` kommer fra Dynamics 365 Customer Service og ikke fra grunnleggende Dataverse, og den er ikke oppført i Dataverse-referansen over handlinger. Returnerer den `404`, bekrefter du at den finnes i miljøet ditt ved å hente `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` og søke etter `CloseIncident`.

For alt som ikke er å lukke saken — et notat, en prioritetsheving, en tittelendring — bruker du en **API Patch (JSON)**-blokk mot `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` med en `If-Match: *`-header, som hindrer at en utilsiktet upsert oppretter en ny sak. Send bare kolonnene du endrer.

## Innkommende — Dynamics 365 til OneUptime

Så den andre retningen: noen lukker saken i Dynamics, eller en agent legger til et notat, og OneUptime bør få vite det.

### Bygg den mottakende arbeidsflyten først

1. **Opprett arbeidsflyt**, gi den navnet `Dynamics 365 → OneUptime`, og legg til **Webhook**-triggeren.
2. Åpne **Innstillinger** på den arbeidsflyten og kopier **Webhook Secret Key**. URL-en din er:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   På en selvhostet installasjon bytter du inn din egen vert. Behandle URL-en som et passord — alle som har den, kan starte arbeidsflyten. Du kan nullstille nøkkelen fra den samme siden.

3. Legg til en **If / Else**-blokk som sjekker en delt hemmelighet før noe annet skjer. **Input 1** er `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, og **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — en verdi du finner på selv og lagrer som en hemmelig global variabel.
4. Fra **Yes**-grenen legger du til en **Update One Incident**-blokk:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: det saksendringen skal bety i OneUptime — en tilstandsendring, et notat, en etikett.

   For å flytte hendelsen til en tilstand trenger du den tilstandens id: en **Find One Incident State**-blokk med spørringen `{"name": "Resolved"}` gir deg `{{local.components.incident-state-find-one-1.returnValues.model._id}}` å skrive inn i `currentIncidentStateId`.

La den stå aktivert og klar. Gi nå Dynamics noe å kalle.

### Alternativ A — en Power Automate-flyt (anbefalt)

Dette er veien de fleste team bør velge: du styrer nyttelasten, og det er ingenting å installere.

1. I [Power Automate](https://make.powerautomate.com) oppretter du en **Automated cloud flow**.
2. Trigger: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — alt snevrere fyrer bare for rader som eies av deg eller din business unit.
   - **Select columns**: `statecode,statuscode`. Dette er et filter som bare gjelder oppdateringer, og det er verdt å få riktig. Oppslagskolonner støttes ikke her, og du skal aldri liste opp en kolonne som er til stede ved hver oppdatering (som primærnøkkelen), ellers fyrer flyten ved hver eneste lagring.

3. Legg til **Microsoft Dataverse → Get a row by ID**, tabell `Cases`, rad-id fra triggeren, og **Select columns** satt til `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Dette andre kallet er verdt kostnaden. Ved en oppdatering bærer triggeren bare kolonnene som endret seg, så identifikatorene du trenger å matche på, er kanskje rett og slett ikke der.

4. Legg til den innebygde **HTTP**-handlingen:

   - **Method**: `POST`
   - **URI**: OneUptime-webhook-URL-en ovenfra
   - **Headers**: `Content-Type: application/json` og `X-OneUptime-Secret: <the same secret>`
   - **Body**: bygg den fra utdataene til *Get a row by ID*, for eksempel

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Lagre og slå på flyten.

Verdt å vite før du satser på denne veien:

- **Microsoft Dataverse-koblingen er premium.** For en automatisert flyt er det bare flytens eier som trenger lisensen, ikke alle saken berører — men hvis eierens lisens utløper, stopper flyten i det stille.
- Dataverse-triggere er **push, ikke polling** — Dynamics registrerer et tilbakekall og fyrer det. Levering skjer normalt innen sekunder; noe som tar over fem minutter, betyr at den asynkrone tjenesten har kø, noe du kan se under **Settings → System Jobs** i admin center.
- Egendefinerte headere overlever. Power Automate fjerner flere standardfamilier av headere fra HTTP-handlinger (de fleste `Accept-*`- og `Content-*`-headere, `Host`, `Origin`, `Cookie`), men en header du har laget selv, som `X-OneUptime-Secret`, slippes gjennom.
- Flyten må ligge i det samme miljøet som tabellen den overvåker.
- Forespørsler teller mot tenantens tildeling av Power Platform-forespørsler, og strupingen i koblingen dukker opp som `429` inne i flytkjøringen.

### Alternativ B — en nativ Dataverse-webhook

Er ikke Power Automate tilgjengelig, kan Dataverse kalle OneUptime direkte. Registrer endepunktet med [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, gi den OneUptime-URL-en, velg **HttpHeader**-autentisering, og legg til `X-OneUptime-Secret` med hemmeligheten din. Registrer deretter et steg på **incident**-tabellen for **Update**-meldingen, med **Filtering Attributes** begrenset til kolonnene du bryr deg om, stadium **PostOperation**, kjøremodus **Asynchronous**.

Ta denne veien med åpne øyne:

- **Bare portene 80 og 443.** En selvhostet OneUptime på en annen port kan ikke registreres.
- **Dataverse verifiserer ikke hemmeligheten din.** Den sender headeren; å avvise en forespørsel som ikke bærer den, er utelukkende arbeidsflytens jobb — som er nettopp det **If / Else**-blokken i den mottakende arbeidsflyten er til for.
- **Nyttelasten er ikke et vennlig JSON-objekt.** Den er en serialisert `RemoteExecutionContext`, der `InputParameters` er et *array* med `{key, value}`-par, og den endrede raden ligger under nøkkelen `Target` med kolonnene sine i et videre `Attributes`-array. Regn med å legge til en **Run Custom JavaScript**-blokk for å flate den ut før noe annet kan lese den.
- **Bare endrede kolonner er med** ved en oppdatering, så registrer et **Post Image** hvis du trenger `ticketnumber` eller din OneUptime-id-kolonne.
- **Over 256 KB strippes de interessante delene** — `InputParameters`, `PreEntityImages` og `PostEntityImages` forsvinner alle sammen, og forespørselen bærer en `x-ms-dynamics-msg-size-exceeded`-header. `PrimaryEntityId` og `PrimaryEntityName` overlever, så reserveløsningen er å lese raden tilbake gjennom Web API-et.
- **Levering er nesten tilgivelsesløs.** Dataverse venter 60 sekunder på en `2xx` og prøver på nytt nøyaktig én gang, og bare ved `502`, `503` og `504`. Alt annet — inkludert en `500` fra din side — forsøkes ikke på nytt; det havner som en mislykket System Job.
- Velg **Asynchronous**. Et synkront steg blokkerer agentens lagring på endepunktet ditt, og hvis transaksjonen rulles tilbake etterpå, har forespørselen allerede gått ut og kan ikke kalles tilbake.

Klassiske Dynamics-bakgrunnsarbeidsflyter har ikke noe HTTP- eller webhook-steg i det hele tatt, så de er ikke et tredje alternativ her.

## Å gjøre det samme for varsler

Alt ovenfor er skrevet rundt hendelser fordi det er det vanligste tilfellet, men varsler fungerer helt likt — bytt posttype, og ingenting annet endres:

| Hendelse                                                     | Varsel                                              |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

En arbeidsflyt har nøyaktig én trigger, så hendelser og varsler trenger én arbeidsflyt hver. Skal de to gjøre den samme jobben, bygger du Dynamics-halvdelen én gang og kaller den fra begge med komponenten **Execute Workflow**.

## Feilsøking

Les den feilende blokken i **Kjøringer og logger** først — begge Microsoft-endepunktene returnerer en forklarende JSON-kropp, og API-komponenten beholder den i `response-body`.

**Tokenforespørselen feiler med `400` og `invalid_request` eller en grant type som ikke støttes.** `Content-Type`-headeren er ikke nøyaktig `Content-Type: application/x-www-form-urlencoded`, så kroppen gikk ut som JSON. Sjekk bruken av store og små bokstaver.

**`400` med `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** `scope` er ikke miljø-URL-en din pluss `/.default`. Kopier URL-en fra **Developer resources** og fjern eventuell etterfølgende skråstrek og enhver `/api/data/...`-sti.

**`401 Unauthorized` fra Dynamics.** `Authorization`-headeren mangler, er feilformet, eller tokenet er utløpt midt i kjøringen. Den må lyde `Bearer <token>` med ett enkelt mellomrom.

**`403 Forbidden` med `0x80072560`, «The user isn't a member of the organization».** Steg 2 ble hoppet over, eller application user er bundet til en annen appregistrering. Tokenet er i orden; brukeren på Dynamics-siden er ikke der.

**`403 Forbidden` med en rettighetsfeil.** Application user finnes, men den egendefinerte sikkerhetsrollen mangler Create, Read eller Write på **Case**.

**`400 Bad Request` som nevner kunden.** `customerid` er påkrevd. Sett `customerid_account@odata.bind` eller `customerid_contact@odata.bind`, stavet nøyaktig, med en URI med innledende skråstrek som `/accounts(<guid>)`.

**`404 Not Found` på `/CloseIncident`.** Handlingen er en Dynamics 365 Customer Service-handling. Søk i miljøets `$metadata` etter den før du antar at den er tilgjengelig.

**`412 Precondition Failed` med `DuplicateRecord`.** En regel for duplikatoppdaging slo til. Enten snevrer du inn regelen, eller så slutter du å sende feltet den matcher på.

**`429 Too Many Requests`.** Dataverses tjenestebeskyttelsesgrenser — grovt regnet 6 000 forespørsler og 20 minutters kjøretid per bruker i et hvilket som helst femminuttersvindu, per webserver. Svaret bærer en `Retry-After` i sekunder. Kommer en arbeidsflyt i byger, legger du en **Delay**-blokk inn i den eller flytter arbeidet til en planlagt arbeidsflyt som kjører i bolker.

**Ingenting kommer fram på OneUptime-siden.** Send en forespørsel til webhook-URL-en selv med `curl` og sjekk arbeidsflytens **Kjøringer og logger**. Dukker din egen forespørsel opp mens Dynamics' ikke gjør det, ligger problemet oppstrøms: for Power Automate ser du på flytens egen kjørehistorikk; for en nativ webhook ser du på **Settings → System Jobs** filtrert på feil.

**Arbeidsflyten kjører, men hendelsen endrer seg ikke.** En **Update One Incident**-blokk rapporterer `Items Updated: 0` når spørringen ikke matchet noe — det er en suksess, ikke en feil. Sjekk at id-en i nyttelasten er OneUptime-hendelses-id-en, og at du spør på `_id`.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — de innkommende og utgående mønstrene, og autentiserings-juksearket.
- [Jira](/docs/integrations/jira) — den samme toveis-oppbyggingen mot Jira.
- [Oversikt over arbeidsflyter](/docs/workflows/index) og [Opprette en arbeidsflyt](/docs/workflows/authoring) — lerretet, identifikatorene og å slå på en arbeidsflyt.
- [Komponenter](/docs/workflows/components) — API-blokkene, If / Else og OneUptime-datakomponentene.
- [Variabler](/docs/workflows/variables) — hemmeligheter, og å lese utdataene fra én blokk i den neste.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — webhook-sikkerhet og utgående nettverkstilgang.
- [IP-adresser](/docs/configuration/ip-addresses) — OneUptimes utgående adresseområder, hvis Dynamics står bak en tillatelsesliste.
