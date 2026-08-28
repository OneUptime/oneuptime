# Microsoft Dynamics 365-integration

Åbn en **Case** i [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365), hver gang der erklæres en OneUptime-hændelse, hold den sag i trit, mens hændelsen udvikler sig, og lad Dynamics skubbe ændringer på sagen tilbage til OneUptime — alt sammen med et [Workflow](/docs/workflows/index). Der er ingen Dynamics-specifik blok at installere: OneUptime taler med **Dataverse Web API** via [API-komponenten](/docs/workflows/components#api), og Dynamics taler tilbage gennem en [Webhook-trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Denne side dækker begge retninger. Byg den udgående halvdel først — det er den, der kræver opsætningen i Microsoft Entra ID, og når den virker, er den indgående halvdel et enkelt flow.

## Forudsætninger

- Et **Dynamics 365**-miljø, der indeholder tabellen **Case**. Cases kommer fra Dynamics 365 Customer Service; et Dataverse-miljø uden det har ingen `incident`-tabel at skrive til.
- Miljøets **Web API endpoint**. Find det i [Power Platform admin center](https://admin.powerplatform.microsoft.com/) under dit miljøs **Settings → Developer resources**, eller i **make.powerapps.com → Settings → Developer resources**. Det ser sådan her ud: `https://yourorg.crm.dynamics.com/api/data/v9.2/` — regionssegmentet varierer (`crm` for Nordamerika, `crm2` for Sydamerika, `crm7` for Japan og så videre).
- Rettigheder til at registrere en applikation i **Microsoft Entra ID** og til at oprette en **application user** i Dynamics-miljøet. Det er som regel to forskellige administratorer.
- Et OneUptime-projekt, hvor du kan oprette workflows og globale variabler.

> Alt nedenfor bruger tabelnavnene fra Dataverse, ikke etiketterne på Dynamics-formularerne. En case er tabellen **`incident`**, dens samling i en URL er **`incidents`**, dens primærnøgle er **`incidentid`**, og dens titelkolonne er **`title`**. Sagsnummeret, du ser i brugerfladen, er **`ticketnumber`**.

## Trin 1 — Registrér en applikation i Microsoft Entra ID

OneUptime autentificerer sig som en applikation, ikke som en person, så den bruger OAuth 2.0-flowet **client credentials**.

1. Log ind på [Azure-portalen](https://portal.azure.com) som administrator af den samme tenant som dit Dynamics-miljø, og åbn **Microsoft Entra ID**.
2. Gå til **App registrations → New registration**. Giv den et navn som `OneUptime Integration`, lad **Supported account types** stå på **Accounts in this organizational directory only**, og vælg **Register**.
3. Fra appens **Overview**-side kopierer du **Application (client) ID** og **Directory (tenant) ID**.
4. Gå til **Certificates & secrets → Client secrets → New client secret**. Kopiér hemmelighedens **Value** — ikke dens ID — før du navigerer væk. Den vises aldrig igen. En client secret kan højst leve 24 måneder, så notér udløbet et sted, du får det at se.

To ting, folk tilføjer her, som du ikke har brug for:

- **Ingen API-tilladelser.** I client credentials-flowet er der ingen indlogget bruger, så delegerede tilladelser gør ingenting. `user_impersonation` under **Dataverse** er en delegeret tilladelse og er kun til interaktive apps. Microsoft Entra ID udsteder gladeligt et token til Dataverse helt uden konfigurerede tilladelser — adgangen afgøres på Dynamics-siden, i Trin 2.
- **Intet admin consent-trin.** Af samme årsag.

Microsoft foretrækker et certifikat frem for en client secret til produktionsapplikationer. Den mulighed kræver, at kalderen selv bygger og signerer en JWT-assertion, hvilket et workflow ikke kan, så en client secret er det praktiske valg her — behandl den derefter: hold den i en hemmelig variabel, og rotér den, før den udløber.

## Trin 2 — Opret application user i Dynamics

Det er dette trin, der bliver sprunget over, og at springe det over giver den mest forvirrende fejl i hele denne integration: token-forespørgslen lykkes, og hvert eneste Dataverse-kald fejler så med `403 Forbidden` og fejlkoden `0x80072560` — *"The user isn't a member of the organization."* Entra ID udsteder tokenet uden at vide noget som helst om Dynamics; Dynamics leder derefter efter en brugerrække, der matcher applikationen, og der er ingen.

1. Åbn [Power Platform admin center](https://admin.powerplatform.microsoft.com/) og vælg **Manage → Environments** og derefter dit miljø.
2. Vælg **Settings → Users + permissions → Application users**.
3. Vælg **+ New app user**, derefter **+ Add an app**, vælg registreringen fra Trin 1, og vælg **Add**.
4. Vælg en **Business unit**, indtast en **Email address**, og brug derefter redigeringsikonet ved siden af **Security roles**.
5. Tildel en **brugerdefineret** sikkerhedsrolle med rettigheder til at oprette, læse og skrive på tabellen **Case**. En application user kan ikke få en af de indbyggede roller — Microsoft kræver en brugerdefineret. Har du ikke en passende rolle, så kopiér en eksisterende og skær den til.
6. Vælg **Save** og derefter **Create**.

Du kan kun have én application user pr. registreret applikation i et miljø. Application users er ikke licenserede og er undtaget fra miljøets regler for medlemskab af sikkerhedsgrupper.

## Trin 3 — Gem legitimationsoplysningerne i OneUptime

Gå til **Arbejdsgange → Globale variabler → Opret** og tilføj disse, idet du slår **Secret** til for dem, der er markeret:

| Navn                     | Værdi                                                       | Hemmelig |
| ------------------------ | ----------------------------------------------------------- | -------- |
| `DYNAMICS_TENANT_ID`     | Directory (tenant) ID fra Trin 1                            | Nej      |
| `DYNAMICS_CLIENT_ID`     | Application (client) ID fra Trin 1                          | Nej      |
| `DYNAMICS_CLIENT_SECRET` | Client secret-**værdien** fra Trin 1                        | Ja       |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — ingen afsluttende skråstreg | Nej  |

Indsæt client secret'en præcis, som Entra ID gav dig den. OneUptime enkoder formular-bodyen for dig, så du skal ikke URL-enkode den manuelt.

Referer til hvilken som helst af dem fra en blok med `{{global.variables.DYNAMICS_CLIENT_ID}}`. Se [Variabler](/docs/workflows/variables) for, hvordan hemmeligheder renses fra kørselslogs.

## Trin 4 — Hent et adgangstoken

Hver kørsel henter sit eget token. Tokens holder 60-90 minutter, og client credentials-flowet udsteder aldrig et refresh-token, så der er intet at cache og intet at forny — ét ekstra HTTP-kald pr. kørsel er hele omkostningen.

1. Åbn **Arbejdsgange → Opret arbejdsgang**, navngiv det `Incidents → Dynamics 365`, og åbn **Bygger**.
2. Klik på den stiplede pladsholder, tilføj triggeren **On Create Incident**, og bed i dens **Select Fields** om de kolonner, du vil sende:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Lad dens **Identifier** blive `incident-on-create-1`.

3. Klik **Tilføj komponent**, tilføj en **API Post (JSON)**-blok, forbind triggerens **Success**-prik til den, og åbn dens indstillinger. Sæt dens **Identifier** til `get-token`, og derefter:

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

**Skriv headernavnet som `Content-Type`, med præcis den brug af store bogstaver.** Det er det, der fortæller OneUptime, at bodyen skal sendes som en formular-post frem for som JSON, hvilket er den eneste form, Microsofts token-endpoint accepterer. `content-type` med små bogstaver matcher ikke, og så går forespørgslen ud som JSON og kommer tilbage som `400`.

`scope` skal være din miljø-URL efterfulgt af `/.default` — det er formen for en fortrolig klient. En forkert miljø-URL her er den sædvanlige årsag til `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

Tokenet er nu tilgængeligt længere nede i kæden som:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Trin 5 — Opret sagen

Tilføj endnu en **API Post (JSON)**-blok, forbind `get-token`s **Success**-prik til den, og sæt dens **Identifier** til `create-case`.

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

Erstat konto-GUID'en med den konto, sagerne hører til. **`customerid` er reelt påkrævet på en case** — det er en af de kolonner, Dataverse håndhæver ved enhver programmatisk skrivning, så en oprettelse uden den bliver afvist. Fordi den kan pege på enten en konto eller en kontakt, skriver du aldrig `customerid@odata.bind`; du skriver `customerid_account@odata.bind` eller `customerid_contact@odata.bind`, og de navne skelner mellem store og små bogstaver. `title` er påkrævet på en anden måde: Dynamics-formularerne insisterer på den, API'et gør ikke, så send den alligevel.

`Prefer: return=representation` er det, der gør dette brugbart fra et workflow. Uden den svarer en vellykket oprettelse `204 No Content` og lægger den nye posts URI i en `OData-EntityId`-svarheader, som du så skulle plukke en GUID ud af. Med den er svaret `201 Created` og bærer selve posten, så den næste blok kan læse:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Tænd nu for workflowet — **Oversigt → Rediger arbejdsgang → Aktiveret** — erklær en testhændelse, og læs kørslen under **Kørsler og logs**. Blokken `create-case` bør vise en `201` og en body, der indeholder det nye `incidentid`. Ændringer på lærredet gemmer sig selv; der er ingen Gem-knap.

### Afbildning af alvorlighed og status

Dynamics leverer `severitycode` med én enkelt valgmulighed, "Default Value", så der er ingen indbygget alvorlighedsskala at afbilde over på. Brug **`prioritycode`** i stedet, og forgren med en **If / Else**-blok på `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`, hvis du vil have prioriteter pr. alvorlighed.

| Kolonne          | Værdier                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` kan tilpasses, så en tenant kan have tilføjet sine egne værdier. Send heltal, ikke etiketter.

## Trin 6 — Hold hændelsen og sagen findbare fra hinanden

Hvad du end gør senere — kommentere, løse, synkronisere tilbage — kræver det, at det ene af de to systemer holder på det andets identifikator. Læg den på Dynamics-siden.

Tilføj en kolonne af typen **single line of text** til Case-tabellen, for eksempel `new_oneuptimeincidentid`, og sæt den, når du opretter sagen:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Ethvert senere workflow kan så finde sagen med et filter:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Definerer du den kolonne som en **alternate key** på Case-tabellen, kan du helt springe opslaget over og lave `PATCH` direkte til `incidents(new_oneuptimeincidentid='<id>')` — en upsert, der opretter sagen, hvis den mangler, og opdaterer den, hvis den ikke gør. Nøglen skal være færdigbygget (dens tilstand bliver **Active**), før den kan bruges, og værdier for en alternate key må ikke indeholde `/ < > * % & : \ ? + #`. Et OneUptime-id er en almindelig UUID, så det er sikkert.

Den modsatte retning — at gemme Dynamics-sagens id på OneUptime-hændelsen — virker også, med en **Update One Incident**-blok, der skriver til `customFields`. Vær varsom med det: `customFields` er én samlet JSON-kolonne, så at skrive til den erstatter alle værdier for brugerdefinerede felter på den hændelse, ikke kun dine. At holde forbindelsen på Dynamics-siden undgår det helt.

## Trin 7 — Løs sagen, når hændelsen løses

Byg dette som et **andet** workflow, så en fejl her ikke kan forhindre, at der oprettes sager.

1. **Opret arbejdsgang**, navngiv det `Incident resolved → Close Dynamics case`, og tilføj triggeren **On Update Incident**.
2. I triggerens **Listen on** sætter du `{"currentIncidentStateId": true}`, så workflowet kun vågner ved tilstandsændringer frem for ved hver redigering. I **Select Fields** beder du om `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Tilføj en **If / Else**-blok. **Input 1** er `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** er `==`, **Input 2** er `Resolved` — eller hvad dit projekts løste tilstand nu hedder. Se [Hændelsestilstande og alvorligheder](/docs/incidents/states-and-severities).
4. Fra grenen **Yes** gentager du `get-token`-blokken fra Trin 4.
5. Tilføj en **API Get (JSON)**-blok, sæt dens **Identifier** til `find-case`, og giv den `$filter`-URL'en fra Trin 6. En Dataverse-forespørgsel svarer med et `value`-array, og en workflow-reference kan indeksere ind i et array med kantede parenteser, så sagens id er `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Tilføj en **API Post (JSON)**-blok, der lukker sagen:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: de samme som i Trin 5, minus `Prefer`.
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

     `Status` er en `statuscode`-værdi i tilstanden Resolved — `5` er *Problem Solved*.

     **Test denne body mod dit eget miljø, før du gør dig afhængig af den.** `CloseIncident` tager to parametre, `IncidentResolution` og `Status`, men Microsoft offentliggør intet HTTP-eksempel for den — alle officielle eksempler er C#. Formen ovenfor er den gængse oversættelse. Afviser dit miljø den, så prøv at identificere sagen med en almindelig `"incidentid": "<the case id>"`-egenskab i stedet for `@odata.bind`-formen, hvilket er sådan, Microsofts øvrige action-eksempler refererer til en eksisterende post.

**Hvorfor ikke bare lave `PATCH` på sagen til `statecode: 1`?** Det kan du godt — Microsoft dokumenterer en `PATCH` af `statecode` og `statuscode` som Web API-ækvivalenten til den ældre SetState-besked, og det er det rette værktøj til at flytte en sag mellem aktive statusser. Det, den ikke gør, er at oprette den **Case Resolution**-aktivitet, som en løst sag i Dynamics 365 Customer Service forventes at have, og den bliver afvist blankt i et miljø, hvor en administrator har konfigureret brugerdefinerede statusovergange. Brug `CloseIncident` til at løse; brug `PATCH` til alt andet. Og når du skriver `statecode`, så sæt altid `statuscode` i den samme forespørgsel — ellers anvender Dynamics i stilhed den tilstands standardstatus.

`CloseIncident` kommer fra Dynamics 365 Customer Service frem for fra basis-Dataverse, og den er ikke opført i Dataverse-actionreferencen. Returnerer den `404`, så bekræft, at den findes i dit miljø, ved at hente `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` og søge efter `CloseIncident`.

Til alt, der er mindre end at lukke sagen — en note, en prioritetsforhøjelse, en titelændring — bruger du en **API Patch (JSON)**-blok mod `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` med en `If-Match: *`-header, som forhindrer, at en utilsigtet upsert opretter en ny sag. Send kun de kolonner, du ændrer.

## Indgående — Dynamics 365 til OneUptime

Nu den anden retning: nogen lukker sagen i Dynamics, eller en medarbejder tilføjer en note, og OneUptime skal vide det.

### Byg det modtagende workflow først

1. **Opret arbejdsgang**, navngiv det `Dynamics 365 → OneUptime`, og tilføj **Webhook**-triggeren.
2. Åbn **Indstillinger** på det workflow og kopiér **Webhook Secret Key**. Din URL er:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   På en selvhostet installation skifter du din egen vært ind. Behandl URL'en som en adgangskode — enhver, der har den, kan starte workflowet. Du kan nulstille nøglen fra den samme side.

3. Tilføj en **If / Else**-blok, der tjekker en delt hemmelighed, før noget andet sker. **Input 1** er `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — en værdi, du finder på og gemmer som en hemmelig global variabel.
4. Fra grenen **Yes** tilføjer du en **Update One Incident**-blok:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: hvad end ændringen på sagen skal betyde i OneUptime — en tilstandsændring, en note, en label.

   For at flytte hændelsen til en tilstand skal du bruge den tilstands id: en **Find One Incident State**-blok med forespørgslen `{"name": "Resolved"}` giver dig `{{local.components.incident-state-find-one-1.returnValues.model._id}}` at skrive ind i `currentIncidentStateId`.

Lad det være aktiveret og klar. Giv nu Dynamics noget at kalde.

### Mulighed A — et Power Automate-flow (anbefalet)

Det er den vej, de fleste teams bør tage: du styrer payloaden, og der er intet at installere.

1. I [Power Automate](https://make.powerautomate.com) opretter du et **Automated cloud flow**.
2. Trigger: **Microsoft Dataverse → When a row is added, modified or deleted** (når en række tilføjes, ændres eller slettes).

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — noget snævrere udløses kun for rækker, der ejes af dig eller din business unit.
   - **Select columns**: `statecode,statuscode`. Dette er et filter, der kun gælder ved opdateringer, og det er værd at få rigtigt. Opslagskolonner understøttes ikke her, og du må aldrig angive en kolonne, der er til stede ved hver opdatering (såsom primærnøglen), for så udløses flowet ved hver eneste gemning.

3. Tilføj **Microsoft Dataverse → Get a row by ID**, tabel `Cases`, række-id fra triggeren, og **Select columns** sat til `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Dette andet kald er sin pris værd. Ved en opdatering bærer triggeren kun de kolonner, der blev ændret, så de identifikatorer, du skal matche på, er måske slet ikke der.

4. Tilføj den indbyggede **HTTP**-handling:

   - **Method**: `POST`
   - **URI**: OneUptime-webhook-URL'en ovenfra
   - **Headers**: `Content-Type: application/json` og `X-OneUptime-Secret: <the same secret>`
   - **Body**: byg den ud fra output fra *Get a row by ID*, for eksempel

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Gem og tænd for flowet.

Værd at vide, før du binder dig til denne vej:

- **Microsoft Dataverse-connectoren er premium.** Til et automatiseret flow er det kun flowets ejer, der skal have licensen, ikke alle, som sagen berører — men hvis ejerens licens udløber, stopper flowet i stilhed.
- Dataverse-triggere er **push, ikke polling** — Dynamics registrerer et callback og udløser det. Levering sker normalt inden for få sekunder; alt over fem minutter betyder, at den asynkrone tjeneste er bagud, hvilket du kan se under **Settings → System Jobs** i admin center.
- Brugerdefinerede headere overlever. Power Automate fjerner flere standardfamilier af headere fra HTTP-handlinger (de fleste `Accept-*`- og `Content-*`-headere, `Host`, `Origin`, `Cookie`), men en header som din egen `X-OneUptime-Secret` sendes videre.
- Flowet skal ligge i det samme miljø som den tabel, det holder øje med.
- Forespørgsler tæller mod din tenants tildeling af Power Platform-forespørgsler, og connector-throttling viser sig som `429` inde i flowkørslen.

### Mulighed B — en indbygget Dataverse-webhook

Er Power Automate ikke tilgængelig, kan Dataverse kalde OneUptime direkte. Registrér endpointet med [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, giv den OneUptime-URL'en, vælg **HttpHeader**-autentificering, og tilføj `X-OneUptime-Secret` med din hemmelighed. Registrér derefter et step på tabellen **incident** for beskeden **Update**, med **Filtering Attributes** begrænset til de kolonner, du interesserer dig for, stage **PostOperation**, udførelsestilstand **Asynchronous**.

Tag denne vej med åbne øjne:

- **Kun port 80 og 443.** En selvhostet OneUptime på en hvilken som helst anden port kan ikke registreres.
- **Dataverse verificerer ikke din hemmelighed.** Den sender headeren; at afvise en forespørgsel, der ikke bærer den, er helt og holdent dit workflows opgave — hvilket er det, **If / Else**-blokken i det modtagende workflow er til for.
- **Payloaden er ikke et venligt JSON-objekt.** Det er en serialiseret `RemoteExecutionContext`, hvor `InputParameters` er et *array* af `{key, value}`-par, og den ændrede række sidder under nøglen `Target` med sine kolonner i endnu et `Attributes`-array. Regn med at tilføje en **Run Custom JavaScript**-blok, der fladgør den, før noget andet kan læse den.
- **Kun ændrede kolonner er inkluderet** ved en opdatering, så registrér et **Post Image**, hvis du har brug for `ticketnumber` eller din OneUptime-id-kolonne.
- **Over 256 KB bliver de interessante dele skåret væk** — `InputParameters`, `PreEntityImages` og `PostEntityImages` forsvinder alle, og forespørgslen bærer en `x-ms-dynamics-msg-size-exceeded`-header. `PrimaryEntityId` og `PrimaryEntityName` overlever, så nødløsningen er at læse rækken tilbage gennem Web API'et.
- **Leveringen er nærmest utilgivende.** Dataverse venter 60 sekunder på en `2xx` og prøver igen præcis én gang, kun ved `502`, `503` og `504`. Alt andet — inklusive en `500` fra din side — forsøges ikke igen; det ender som et mislykket System Job.
- Vælg **Asynchronous**. Et synkront step blokerer medarbejderens gemning på dit endpoint, og hvis transaktionen efterfølgende rulles tilbage, er forespørgslen allerede gået ud og kan ikke kaldes tilbage.

Klassiske Dynamics-baggrundsworkflows har slet ikke noget HTTP- eller webhook-trin, så de er ikke en tredje mulighed her.

## Det samme for alarmer

Alt ovenstående er skrevet omkring hændelser, fordi det er det almindelige tilfælde, men alarmer fungerer på nøjagtig samme måde — skift posttypen ud, og intet andet ændrer sig:

| Hændelse                                                     | Alarm                                               |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

Et workflow har præcis én trigger, så hændelser og alarmer kræver ét workflow hver. Skal de to gøre det samme arbejde, så byg Dynamics-halvdelen én gang og kald den fra begge med komponenten **Execute Workflow**.

## Fejlfinding

Læs den fejlende blok i **Kørsler og logs** først — begge Microsoft-endpoints returnerer en forklarende JSON-body, og API-komponenten gemmer den i `response-body`.

**Token-forespørgslen fejler med `400` og `invalid_request` eller en ikke-understøttet grant type.** `Content-Type`-headeren er ikke præcis `Content-Type: application/x-www-form-urlencoded`, så bodyen gik ud som JSON. Tjek brugen af store og små bogstaver.

**`400` med `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** `scope` er ikke din miljø-URL plus `/.default`. Kopiér URL'en fra **Developer resources** og fjern enhver afsluttende skråstreg og enhver `/api/data/...`-sti.

**`401 Unauthorized` fra Dynamics.** `Authorization`-headeren mangler, er forkert formet, eller tokenet er udløbet midt i kørslen. Den skal lyde `Bearer <token>` med ét enkelt mellemrum.

**`403 Forbidden` med `0x80072560`, "The user isn't a member of the organization".** Trin 2 blev sprunget over, eller application user er bundet til en anden app-registrering. Tokenet er fint; brugeren på Dynamics-siden er der ikke.

**`403 Forbidden` med en rettighedsfejl.** Application user findes, men dens brugerdefinerede sikkerhedsrolle mangler Create, Read eller Write på **Case**.

**`400 Bad Request`, der nævner kunden.** `customerid` er påkrævet. Sæt `customerid_account@odata.bind` eller `customerid_contact@odata.bind`, stavet præcist, med en URI med indledende skråstreg såsom `/accounts(<guid>)`.

**`404 Not Found` på `/CloseIncident`.** Handlingen er en Dynamics 365 Customer Service-action. Søg efter den i dit miljøs `$metadata`, før du går ud fra, at den er tilgængelig.

**`412 Precondition Failed` med `DuplicateRecord`.** En regel for dubletregistrering matchede. Indsnævr enten reglen eller stop med at sende det felt, den matcher på.

**`429 Too Many Requests`.** Dataverses grænser for tjenestebeskyttelse — cirka 6.000 forespørgsler og 20 minutters eksekveringstid pr. bruger inden for et vindue på fem minutter, pr. webserver. Svaret indeholder en `Retry-After` i sekunder. Kommer et workflow i byger, så sæt en **Delay**-blok ind i det, eller flyt arbejdet til et planlagt workflow, der batcher.

**Der ankommer intet på OneUptime-siden.** Send selv en forespørgsel til webhook-URL'en med `curl` og tjek workflowets **Kørsler og logs**. Hvis din egen forespørgsel dukker op, og Dynamics' ikke gør, ligger problemet opstrøms: for Power Automate skal du se på flowets egen kørselshistorik; for en indbygget webhook skal du se på **Settings → System Jobs** filtreret til fejl.

**Workflowet kører, men hændelsen ændrer sig ikke.** En **Update One Incident**-blok melder `Items Updated: 0`, når forespørgslen ikke matchede noget — det er en succes, ikke en fejl. Tjek, at id'et i payloaden er OneUptime-hændelsens id, og at du forespørger på `_id`.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — de indgående og udgående mønstre samt autentificeringsoversigten.
- [Jira](/docs/integrations/jira) — den samme tovejsopbygning mod Jira.
- [Workflows – Oversigt](/docs/workflows/index) og [Opret et workflow](/docs/workflows/authoring) — lærredet, identifiers og hvordan du tænder for et workflow.
- [Komponenter](/docs/workflows/components) — API-blokkene, If / Else og OneUptime-datakomponenterne.
- [Variabler](/docs/workflows/variables) — hemmeligheder og aflæsning af én bloks output i den næste.
- [Konfiguration & sikkerhed](/docs/workflows/configuration) — webhook-sikkerhed og udgående netværksadgang.
- [IP-adresser](/docs/configuration/ip-addresses) — OneUptimes udgående IP-intervaller, hvis Dynamics ligger bag en tilladelsesliste.
