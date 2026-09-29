# Microsoft Dynamics 365-integration

Öppna ett **Case** i [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) varje gång en OneUptime-incident deklareras, håll det ärendet i takt när incidenten rör sig, och låt Dynamics skicka tillbaka ärendeändringar till OneUptime — allt med ett [Arbetsflöde](/docs/workflows/index). Det finns inget Dynamics-specifikt block att installera: OneUptime pratar med **Dataverse Web API** via [API-komponenten](/docs/workflows/components#api), och Dynamics pratar tillbaka genom en [Webhook-utlösare](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Den här sidan täcker båda riktningarna. Bygg den utgående halvan först — det är den som kräver konfigurationen i Microsoft Entra ID, och när den fungerar är den inkommande halvan ett enda flöde.

## Förutsättningar

- En **Dynamics 365**-miljö som innehåller tabellen **Case**. Ärenden kommer från Dynamics 365 Customer Service; en Dataverse-miljö utan det har ingen `incident`-tabell att skriva till.
- Miljöns **Web API-endpoint**. Hitta den i [Power Platform admin center](https://admin.powerplatform.microsoft.com/) under din miljös **Settings → Developer resources**, eller i **make.powerapps.com → Settings → Developer resources**. Den ser ut som `https://yourorg.crm.dynamics.com/api/data/v9.2/` — regionssegmentet varierar (`crm` för Nordamerika, `crm2` för Sydamerika, `crm7` för Japan, och så vidare).
- Rättigheter att registrera en applikation i **Microsoft Entra ID** och att skapa en **application user** i Dynamics-miljön. Det här är oftast två olika administratörer.
- Ett OneUptime-projekt där du kan skapa arbetsflöden och globala variabler.

> Allt nedan använder Dataverse-tabellnamnen, inte etiketterna på Dynamics-formulären. Ett ärende är tabellen **`incident`**, dess samling i en URL är **`incidents`**, dess primärnyckel är **`incidentid`** och dess titelkolumn är **`title`**. Ärendenumret du ser i gränssnittet är **`ticketnumber`**.

## Steg 1 — Registrera en applikation i Microsoft Entra ID

OneUptime autentiserar sig som en applikation, inte som en person, så det använder OAuth 2.0-flödet **client credentials**.

1. Logga in på [Azure-portalen](https://portal.azure.com) som administratör för samma tenant som din Dynamics-miljö, och öppna **Microsoft Entra ID**.
2. Gå till **App registrations → New registration**. Ge den ett namn som `OneUptime Integration`, lämna **Supported account types** på **Accounts in this organizational directory only** och välj **Register**.
3. Från appens **Overview**-sida, kopiera **Application (client) ID** och **Directory (tenant) ID**.
4. Gå till **Certificates & secrets → Client secrets → New client secret**. Kopiera hemlighetens **Value** — inte dess ID — innan du navigerar bort. Den visas aldrig igen. En klienthemlighet kan leva i högst 24 månader, så notera utgångsdatumet någonstans där du kommer att se det.

Två saker som folk lägger till här men som du inte behöver:

- **Inga API-behörigheter.** I flödet client credentials finns ingen inloggad användare, så delegerade behörigheter gör ingenting. `user_impersonation` under **Dataverse** är en delegerad behörighet och är bara till för interaktiva appar. Microsoft Entra ID utfärdar med glädje en token för Dataverse helt utan konfigurerade behörigheter — åtkomsten avgörs på Dynamics-sidan, i Steg 2.
- **Inget steg för administratörsmedgivande.** Samma skäl.

Microsoft föredrar ett certifikat framför en klienthemlighet för produktionsapplikationer. Det alternativet kräver att anroparen själv bygger och signerar en JWT-assertion, vilket ett arbetsflöde inte kan göra, så en klienthemlighet är det praktiska valet här — behandla den därefter: håll den i en hemlig variabel, och rotera den innan den upphör att gälla.

## Steg 2 — Skapa application user i Dynamics

Det här är steget som hoppas över, och att hoppa över det ger det mest förvirrande felet i hela den här integrationen: tokenförfrågan lyckas, och varje Dataverse-anrop misslyckas sedan med `403 Forbidden` och felkoden `0x80072560` — *"The user isn't a member of the organization."* Entra ID utfärdar token utan att veta något om Dynamics; Dynamics letar sedan efter en användarrad som matchar applikationen, och det finns ingen.

1. Öppna [Power Platform admin center](https://admin.powerplatform.microsoft.com/) och välj **Manage → Environments**, sedan din miljö.
2. Välj **Settings → Users + permissions → Application users**.
3. Välj **+ New app user**, sedan **+ Add an app**, välj registreringen från Steg 1 och välj **Add**.
4. Välj en **Business unit**, ange en **Email address**, och använd sedan redigeringsikonen bredvid **Security roles**.
5. Tilldela en **anpassad** säkerhetsroll med behörigheterna skapa, läsa och skriva på tabellen **Case**. En application user kan inte tilldelas någon av de inbyggda rollerna — Microsoft kräver en anpassad. Om du inte har någon lämplig roll, kopiera en befintlig och skala ner den.
6. Välj **Save**, sedan **Create**.

Du kan bara ha en application user per registrerad applikation i en miljö. Application users är inte licensierade och är undantagna från miljöns regler för medlemskap i säkerhetsgrupper.

## Steg 3 — Spara uppgifterna i OneUptime

Gå till **Arbetsflöden → Globala variabler → Skapa** och lägg till de här, och slå på **Hemlighet** för dem som är markerade:

| Namn                     | Värde                                                       | Hemlighet |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | Directory (tenant) ID från Steg 1                           | Nej    |
| `DYNAMICS_CLIENT_ID`     | Application (client) ID från Steg 1                         | Nej    |
| `DYNAMICS_CLIENT_SECRET` | Klienthemlighetens **Value** från Steg 1                    | Ja     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — utan avslutande snedstreck | Nej |

Klistra in klienthemligheten exakt som Entra ID gav dig den. OneUptime kodar formulärbodyn åt dig, så URL-koda den inte för hand.

Referera till vilken som helst av dem från ett block med `{{global.variables.DYNAMICS_CLIENT_ID}}`. Se [Variabler](/docs/workflows/variables) för hur hemligheter tvättas bort ur körloggarna.

## Steg 4 — Hämta en åtkomsttoken

Varje körning hämtar sin egen token. Tokens håller i 60–90 minuter och flödet client credentials utfärdar aldrig en uppdateringstoken, så det finns inget att cacha och inget att förnya — ett extra HTTP-anrop per körning är hela kostnaden.

1. Öppna **Arbetsflöden → Skapa arbetsflöde**, namnge det `Incidents → Dynamics 365` och öppna **Byggare**.
2. Klicka på den streckade platshållaren, lägg till utlösaren **On Create Incident**, och be i dess **Select Fields** om kolumnerna du vill skicka:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Låt dess **Identifier** vara `incident-on-create-1`.

3. Klicka på **Lägg till komponent**, lägg till ett **API Post (JSON)**-block, koppla utlösarens **Success**-punkt till det och öppna dess inställningar. Sätt dess **Identifier** till `get-token`, och sedan:

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

**Skriv headernamnet som `Content-Type`, med exakt den versaliseringen.** Det är det som säger åt OneUptime att skicka bodyn som en formulärpost i stället för som JSON, vilket är den enda form Microsofts token-endpoint accepterar. `content-type` med små bokstäver matchar inte, och förfrågan går ut som JSON och kommer tillbaka som `400`.

`scope` måste vara din miljö-URL följd av `/.default` — det är formen för en konfidentiell klient. En felaktig miljö-URL här är den vanliga orsaken till `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

Token är nu tillgänglig nedströms som:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Steg 5 — Skapa ärendet

Lägg till ett andra **API Post (JSON)**-block, koppla `get-token`s **Success**-punkt till det och sätt dess **Identifier** till `create-case`.

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

Ersätt konto-GUID:t med kontot som de här ärendena tillhör. **`customerid` är verkligen obligatoriskt på ett ärende** — det är en av kolumnerna som Dataverse framtvingar vid varje programmatisk skrivning, så en skapning utan den avvisas. Eftersom den kan peka på antingen ett konto eller en kontakt skriver du aldrig `customerid@odata.bind`; du skriver `customerid_account@odata.bind` eller `customerid_contact@odata.bind`, och de namnen är skiftlägeskänsliga. `title` är obligatoriskt på ett annat sätt: Dynamics-formulären insisterar på det, API:et gör det inte, så skicka det ändå.

`Prefer: return=representation` är det som gör det här användbart från ett arbetsflöde. Utan det svarar en lyckad skapning `204 No Content` och lägger den nya postens URI i en `OData-EntityId`-svarsheader, som du sedan skulle behöva plocka ut ett GUID ur. Med det är svaret `201 Created` och bär posten själv, så nästa block kan läsa:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Slå nu på arbetsflödet — **Översikt → Redigera arbetsflöde → Aktiverad** — deklarera en testincident och läs körningen under **Körningar och loggar**. Blocket `create-case` bör visa en `201` och en body som innehåller det nya `incidentid`. Ändringar på arbetsytan sparar sig själva; det finns ingen Spara-knapp.

### Mappa allvarlighetsgrad och status

Dynamics levererar `severitycode` med ett enda alternativ, "Default Value", så det finns ingen färdig allvarlighetsskala att mappa mot. Använd **`prioritycode`** i stället, och förgrena med ett **If / Else**-block på `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` om du vill ha prioriteter per allvarlighetsgrad.

| Kolumn           | Värden                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` Hög, `2` Normal, `3` Låg                                                                                                      |
| `caseorigincode` | `1` Telefon, `2` E-post, `3` Webb, `2483` Facebook, `3986` Twitter, `700610000` IoT                                               |
| `casetypecode`   | `1` Fråga, `2` Problem, `3` Begäran                                                                                               |
| `statecode`      | `0` Aktiv, `1` Löst, `2` Avbrutet                                                                                                 |
| `statuscode`     | `1` Pågår, `2` Vilande, `3` Väntar på detaljer, `4` Undersöks, `5` Problem löst, `6` Avbrutet, `1000` Information lämnad, `2000` Sammanslagen |

`statuscode` är anpassningsbar, så en tenant kan ha lagt till egna värden. Skicka heltal, inte etiketter.

## Steg 6 — Håll incidenten och ärendet sökbara från varandra

Vad du än gör senare — kommentera, lösa, synka tillbaka — kräver att ett av de två systemen håller det andras identifierare. Lägg den på Dynamics-sidan.

Lägg till en kolumn av typen **single line of text** i Case-tabellen, till exempel `new_oneuptimeincidentid`, och sätt den när du skapar ärendet:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Sedan kan vilket senare arbetsflöde som helst hitta ärendet med ett filter:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Om du definierar den kolumnen som en **alternate key** på Case-tabellen kan du hoppa över uppslagningen helt och `PATCH`:a direkt mot `incidents(new_oneuptimeincidentid='<id>')` — en upsert som skapar ärendet om det saknas och uppdaterar det om det inte gör det. Nyckeln måste bli färdigbyggd (dess tillstånd blir **Active**) innan den kan användas, och värden för alternativa nycklar får inte innehålla `/ < > * % & : \ ? + #`. Ett OneUptime-id är en vanlig UUID, så det är säkert.

Den omvända riktningen — att spara Dynamics-ärendets id på OneUptime-incidenten — fungerar också, med ett **Update One Incident**-block som skriver till `customFields`. Var försiktig med det: `customFields` är en enda JSON-kolumn, så att skriva till den ersätter varje anpassat fältvärde på den incidenten, inte bara ditt. Att hålla länken på Dynamics-sidan undviker det helt.

## Steg 7 — Lös ärendet när incidenten löses

Bygg det här som ett **andra** arbetsflöde så att ett fel här inte kan hindra att ärenden öppnas.

1. **Skapa arbetsflöde**, namnge det `Incident resolved → Close Dynamics case` och lägg till utlösaren **On Update Incident**.
2. I utlösarens **Listen on**, skriv `{"currentIncidentStateId": true}` så att arbetsflödet bara vaknar för tillståndsändringar snarare än varje redigering. I **Select Fields**, be om `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Lägg till ett **If / Else**-block. **Input 1** är `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** är `==`, **Input 2** är `Resolved` — eller vad ditt projekts lösta tillstånd nu heter. Se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).
4. Från grenen **Yes**, upprepa blocket `get-token` från Steg 4.
5. Lägg till ett **API Get (JSON)**-block, sätt dess **Identifier** till `find-case` och ge det `$filter`-URL:en från Steg 6. En Dataverse-fråga svarar med en `value`-array, och en arbetsflödesreferens kan indexera in i en array med hakparenteser, så ärende-id:t är `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Lägg till ett **API Post (JSON)**-block som stänger ärendet:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: samma som i Steg 5, minus `Prefer`.
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

     `Status` är ett `statuscode`-värde i tillståndet Resolved — `5` är *Problem Solved*.

     **Testa den här bodyn mot din egen miljö innan du förlitar dig på den.** `CloseIncident` tar två parametrar, `IncidentResolution` och `Status`, men Microsoft publicerar inget HTTP-exempel för den — varje officiellt exempel är C#. Formen ovan är den konventionella översättningen. Om din miljö avvisar den, prova att identifiera ärendet med en vanlig `"incidentid": "<the case id>"`-egenskap i stället för `@odata.bind`-formen, vilket är hur Microsofts andra åtgärdsexempel refererar till en befintlig post.

**Varför inte bara `PATCH`:a ärendet till `statecode: 1`?** Det går — Microsoft dokumenterar en `PATCH` av `statecode` och `statuscode` som Web API-motsvarigheten till det äldre SetState-meddelandet, och det är rätt verktyg för att flytta ett ärende mellan aktiva statusar. Det den inte gör är att skapa den **Case Resolution**-aktivitet som ett löst ärende i Dynamics 365 Customer Service förväntas ha, och den avvisas rakt av i en miljö där en administratör har konfigurerat anpassade statusövergångar. Använd `CloseIncident` för att lösa; använd `PATCH` för allt annat. Och när du väl skriver `statecode` ska du sätta `statuscode` i samma förfrågan — annars tillämpar Dynamics tyst det tillståndets standardstatus.

`CloseIncident` kommer från Dynamics 365 Customer Service snarare än från grundläggande Dataverse, och den är inte listad i Dataverse-åtgärdsreferensen. Om den returnerar `404`, bekräfta att den finns i din miljö genom att hämta `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` och söka efter `CloseIncident`.

För allt som inte är att stänga ärendet — en anteckning, en prioritetshöjning, en titeländring — använd ett **API Patch (JSON)**-block mot `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` med en `If-Match: *`-header, som hindrar en oavsiktlig upsert från att skapa ett nytt ärende. Skicka bara kolumnerna du ändrar.

## Inkommande — Dynamics 365 till OneUptime

Nu den andra riktningen: någon stänger ärendet i Dynamics, eller en handläggare lägger till en anteckning, och OneUptime bör få veta det.

### Bygg det mottagande arbetsflödet först

1. **Skapa arbetsflöde**, namnge det `Dynamics 365 → OneUptime` och lägg till utlösaren **Webhook**.
2. Öppna **Inställningar** på det arbetsflödet och kopiera **Webhookens hemliga nyckel**. Din URL är:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   På en självhostad installation byter du in din egen värd. Behandla URL:en som ett lösenord — vem som helst som har den kan starta arbetsflödet. Du kan återställa nyckeln från samma sida.

3. Lägg till ett **If / Else**-block som kontrollerar en delad hemlighet innan något annat händer. **Input 1** är `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — ett värde du hittar på och sparar som en hemlig global variabel.
4. Från grenen **Yes**, lägg till ett **Update One Incident**-block:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: vad ärendeändringen än ska betyda i OneUptime — en tillståndsändring, en anteckning, en etikett.

   För att flytta incidenten till ett tillstånd behöver du det tillståndets id: ett **Find One Incident State**-block med frågan `{"name": "Resolved"}` ger dig `{{local.components.incident-state-find-one-1.returnValues.model._id}}` att skriva in i `currentIncidentStateId`.

Lämna det aktiverat och redo. Ge nu Dynamics något att anropa.

### Alternativ A — ett Power Automate-flöde (rekommenderas)

Det här är vägen de flesta team bör ta: du styr payloaden, och det finns ingenting att installera.

1. Skapa ett **Automated cloud flow** i [Power Automate](https://make.powerautomate.com).
2. Utlösare: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — allt snävare utlöses bara för rader som ägs av dig eller din affärsenhet.
   - **Select columns**: `statecode,statuscode`. Det här är ett filter som bara gäller uppdateringar och det är värt att få rätt. Uppslagskolumner stöds inte här, och lista aldrig en kolumn som finns med vid varje uppdatering (som primärnyckeln) — då utlöses flödet vid varje sparning.

3. Lägg till **Microsoft Dataverse → Get a row by ID**, tabell `Cases`, rad-id från utlösaren, och **Select columns** satt till `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Det här andra anropet är värt sin kostnad. Vid en uppdatering bär utlösaren bara de kolumner som ändrades, så identifierarna du behöver matcha på kanske helt enkelt inte finns där.

4. Lägg till den inbyggda **HTTP**-åtgärden:

   - **Method**: `POST`
   - **URI**: OneUptime-webhookens URL ovanifrån
   - **Headers**: `Content-Type: application/json` och `X-OneUptime-Secret: <the same secret>`
   - **Body**: bygg den från utdata från *Get a row by ID*, till exempel

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Spara och slå på flödet.

Värt att veta innan du binder dig till den här vägen:

- **Microsoft Dataverse-kopplingen är premium.** För ett automatiserat flöde behöver bara flödets ägare licensen, inte alla som ärendet berör — men att ägarens licens går ut stoppar flödet utan att det märks.
- Dataverse-utlösare är **push, inte pollning** — Dynamics registrerar ett återanrop och utlöser det. Leverans sker normalt inom sekunder; något som tar mer än fem minuter betyder att den asynkrona tjänsten är överbelastad, vilket du kan se under **Settings → System Jobs** i admin center.
- Egna headers överlever. Power Automate tar bort flera standardheaderfamiljer från HTTP-åtgärder (de flesta `Accept-*`- och `Content-*`-headers, `Host`, `Origin`, `Cookie`), men en egen header som `X-OneUptime-Secret` skickas vidare.
- Flödet måste ligga i samma miljö som tabellen det bevakar.
- Förfrågningar räknas mot din tenants Power Platform-förfrågningskvot, och kopplingsstrypning visar sig som `429` inuti flödeskörningen.

### Alternativ B — en inbyggd Dataverse-webhook

Om Power Automate inte är tillgängligt kan Dataverse anropa OneUptime direkt. Registrera endpointen med [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, ge den OneUptime-URL:en, välj autentiseringen **HttpHeader** och lägg till `X-OneUptime-Secret` med din hemlighet. Registrera sedan ett steg på tabellen **incident** för meddelandet **Update**, med **Filtering Attributes** begränsade till kolumnerna du bryr dig om, stadiet **PostOperation**, exekveringsläget **Asynchronous**.

Ta den här vägen med öppna ögon:

- **Bara portarna 80 och 443.** En självhostad OneUptime på någon annan port kan inte registreras.
- **Dataverse verifierar inte din hemlighet.** Den skickar headern; att avvisa en förfrågan som inte bär den är helt och hållet ditt arbetsflödes uppgift — vilket är vad **If / Else**-blocket i det mottagande arbetsflödet är till för.
- **Payloaden är inte ett vänligt JSON-objekt.** Det är en serialiserad `RemoteExecutionContext`, där `InputParameters` är en *array* av `{key, value}`-par och den ändrade raden ligger under nyckeln `Target` med sina kolumner i ytterligare en `Attributes`-array. Räkna med att lägga till ett **Run Custom JavaScript**-block för att platta ut den innan något annat kan läsa den.
- **Bara ändrade kolumner ingår** vid en uppdatering, så registrera en **Post Image** om du behöver `ticketnumber` eller din OneUptime-id-kolumn.
- **Över 256 KB rensas de intressanta delarna bort** — `InputParameters`, `PreEntityImages` och `PostEntityImages` försvinner allihop, och förfrågan bär en `x-ms-dynamics-msg-size-exceeded`-header. `PrimaryEntityId` och `PrimaryEntityName` överlever, så reservlösningen är att läsa tillbaka raden via Web API:et.
- **Leveransen är närapå oförlåtande.** Dataverse väntar 60 sekunder på en `2xx` och gör exakt ett nytt försök, bara för `502`, `503` och `504`. Allt annat — inklusive en `500` från din sida — görs inte om; det hamnar som ett misslyckat System Job.
- Välj **Asynchronous**. Ett synkront steg blockerar handläggarens sparning på din endpoint, och om transaktionen rullas tillbaka efteråt har förfrågan redan gått ut och kan inte återkallas.

Klassiska Dynamics-bakgrundsarbetsflöden har inget HTTP- eller webhooksteg alls, så de är inte ett tredje alternativ här.

## Samma sak för larm

Allt ovan är skrivet kring incidenter eftersom det är det vanliga fallet, men larm fungerar likadant — byt ut posttypen och inget annat ändras:

| Incident                                                     | Larm                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

Ett arbetsflöde har exakt en utlösare, så incidenter och larm behöver ett arbetsflöde var. Om de två skulle göra samma arbete, bygg Dynamics-halvan en gång och anropa den från båda med komponenten **Execute Workflow**.

## Felsökning

Läs det felande blocket i **Körningar och loggar** först — båda Microsoft-endpointerna returnerar en förklarande JSON-body, och API-komponenten behåller den i `response-body`.

**Tokenförfrågan misslyckas med `400` och `invalid_request` eller en grant type som inte stöds.** Headern `Content-Type` är inte exakt `Content-Type: application/x-www-form-urlencoded`, så bodyn gick ut som JSON. Kontrollera versaliseringen.

**`400` med `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** `scope` är inte din miljö-URL plus `/.default`. Kopiera URL:en från **Developer resources** och ta bort eventuellt avslutande snedstreck och eventuell `/api/data/...`-sökväg.

**`401 Unauthorized` från Dynamics.** Headern `Authorization` saknas, är felformad, eller så har token gått ut mitt i körningen. Den måste lyda `Bearer <token>` med ett enda mellanslag.

**`403 Forbidden` med `0x80072560`, "The user isn't a member of the organization".** Steg 2 hoppades över, eller så är application user bunden till en annan appregistrering. Token är i sin ordning; användaren på Dynamics-sidan finns inte där.

**`403 Forbidden` med ett behörighetsfel.** Application user finns, men dess anpassade säkerhetsroll saknar Create, Read eller Write på **Case**.

**`400 Bad Request` som nämner kunden.** `customerid` är obligatoriskt. Sätt `customerid_account@odata.bind` eller `customerid_contact@odata.bind`, exakt stavat, med en URI som inleds med snedstreck, till exempel `/accounts(<guid>)`.

**`404 Not Found` på `/CloseIncident`.** Åtgärden är en Dynamics 365 Customer Service-åtgärd. Sök i din miljös `$metadata` efter den innan du antar att den är tillgänglig.

**`412 Precondition Failed` med `DuplicateRecord`.** En regel för dubblettidentifiering matchade. Antingen begränsar du regeln eller slutar skicka fältet den matchar på.

**`429 Too Many Requests`.** Dataverses tjänsteskyddsgränser — ungefär 6 000 förfrågningar och 20 minuters exekveringstid per användare under ett femminutersfönster, per webbserver. Svaret bär en `Retry-After` i sekunder. Om ett arbetsflöde skickar i skurar, lägg ett **Delay**-block i det eller flytta arbetet till ett schemalagt arbetsflöde som batchar.

**Ingenting kommer fram på OneUptime-sidan.** Skicka en förfrågan till webhook-URL:en själv med `curl` och kontrollera arbetsflödets **Körningar och loggar**. Om din egen förfrågan dyker upp men inte Dynamics ligger problemet uppströms: för Power Automate, titta på flödets egen körhistorik; för en inbyggd webhook, titta under **Settings → System Jobs** filtrerat på misslyckanden.

**Arbetsflödet körs men incidenten ändras inte.** Ett **Update One Incident**-block rapporterar `Items Updated: 0` när frågan inte matchade något — det är en framgång, inte ett fel. Kontrollera att id:t i payloaden är OneUptime-incidentens id och att du frågar på `_id`.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — de inkommande och utgående mönstren, och autentiseringsfuskbladet.
- [Jira](/docs/integrations/jira) — samma tvåvägsbygge mot Jira.
- [Översikt över arbetsflöden](/docs/workflows/index) och [Skapa ett arbetsflöde](/docs/workflows/authoring) — arbetsytan, identifierarna och att slå på ett arbetsflöde.
- [Komponenter](/docs/workflows/components) — API-blocken, If / Else och OneUptime-datakomponenterna.
- [Variabler](/docs/workflows/variables) — hemligheter, och att läsa ett blocks output från nästa.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — webhook-säkerhet och utgående nätverksåtkomst.
- [IP-adresser](/docs/configuration/ip-addresses) — OneUptimes utgående intervall, om Dynamics sitter bakom en tillåtelselista.
