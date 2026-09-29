# Microsoft Dynamics 365-integratie

Open een **Case** in [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) zodra er een OneUptime-incident wordt uitgeroepen, houd die case gelijk terwijl het incident verschuift, en laat Dynamics casewijzigingen terugduwen naar OneUptime — allemaal met een [Workflow](/docs/workflows/index). Er is geen Dynamics-specifiek blok te installeren: OneUptime praat met de **Dataverse Web API** via het [API-component](/docs/workflows/components#api), en Dynamics praat terug via een [Webhook trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Deze pagina behandelt beide richtingen. Bouw eerst de outbound-helft — dat is de helft die de opzet in Microsoft Entra ID nodig heeft, en zodra die werkt is de inbound-helft één enkele flow.

## Vereisten

- Een **Dynamics 365**-omgeving met de tabel **Case** erin. Cases komen uit Dynamics 365 Customer Service; een Dataverse-omgeving zonder die module heeft geen `incident`-tabel om naar te schrijven.
- Het **Web API endpoint** van de omgeving. Je vindt het in het [Power Platform admin center](https://admin.powerplatform.microsoft.com/) onder **Settings → Developer resources** van je omgeving, of in **make.powerapps.com → Settings → Developer resources**. Het ziet eruit als `https://yourorg.crm.dynamics.com/api/data/v9.2/` — het regiosegment verschilt (`crm` voor Noord-Amerika, `crm2` voor Zuid-Amerika, `crm7` voor Japan, enzovoort).
- Rechten om een applicatie te registreren in **Microsoft Entra ID** en om een **application user** aan te maken in de Dynamics-omgeving. Dat zijn meestal twee verschillende beheerders.
- Een OneUptime-project waar je workflows en globale variabelen kunt aanmaken.

> Alles hieronder gebruikt de tabelnamen van Dataverse, niet de labels op de Dynamics-formulieren. Een case is de tabel **`incident`**, zijn collectie in een URL is **`incidents`**, zijn primaire sleutel is **`incidentid`**, en zijn titelkolom is **`title`**. Het casenummer dat je in de UI ziet is **`ticketnumber`**.

## Stap 1 — Registreer een applicatie in Microsoft Entra ID

OneUptime authenticeert als applicatie, niet als persoon, en gebruikt daarom de OAuth 2.0-flow **client credentials**.

1. Meld je aan bij het [Azure-portaal](https://portal.azure.com) als beheerder van dezelfde tenant als je Dynamics-omgeving, en open **Microsoft Entra ID**.
2. Ga naar **App registrations → New registration**. Geef het een naam zoals `OneUptime Integration`, laat **Supported account types** op **Accounts in this organizational directory only** staan, en kies **Register**.
3. Kopieer vanaf de pagina **Overview** van de app de **Application (client) ID** en de **Directory (tenant) ID**.
4. Ga naar **Certificates & secrets → Client secrets → New client secret**. Kopieer de **Value** van het geheim — niet zijn ID — voordat je wegnavigeert. Hij wordt nooit meer getoond. Een client secret leeft hoogstens 24 maanden, dus noteer de vervaldatum ergens waar je hem terugziet.

Twee dingen die mensen hier toevoegen en die je niet nodig hebt:

- **Geen API permissions.** In de client credentials-flow is er geen aangemelde gebruiker, dus gedelegeerde permissies doen niets. `user_impersonation` onder **Dataverse** is een gedelegeerde permissie en is alleen voor interactieve apps. Microsoft Entra ID geeft met alle plezier een token voor Dataverse uit zonder dat er ook maar één permissie is geconfigureerd — toegang wordt aan de Dynamics-kant bepaald, in Stap 2.
- **Geen admin consent-stap.** Om dezelfde reden.

Microsoft geeft voor productieapplicaties de voorkeur aan een certificaat boven een client secret. Voor die optie moet de aanroeper zelf een JWT-assertie opbouwen en ondertekenen, wat een workflow niet kan, dus een client secret is hier de praktische keuze — behandel hem daarnaar: bewaar hem in een geheime variabele en roteer hem voordat hij verloopt.

## Stap 2 — Maak de application user aan in Dynamics

Dit is de stap die wordt overgeslagen, en overslaan levert de meest verwarrende storing van deze hele integratie op: het tokenverzoek slaagt, en elke Dataverse-aanroep mislukt daarna met `403 Forbidden` en de foutcode `0x80072560` — *"The user isn't a member of the organization."* Entra ID geeft het token uit zonder ook maar iets van Dynamics te weten; Dynamics zoekt vervolgens naar een gebruikersrij die bij de applicatie hoort, en die is er niet.

1. Open het [Power Platform admin center](https://admin.powerplatform.microsoft.com/) en kies **Manage → Environments**, en daarna je omgeving.
2. Kies **Settings → Users + permissions → Application users**.
3. Kies **+ New app user**, dan **+ Add an app**, kies de registratie uit Stap 1, en kies **Add**.
4. Kies een **Business unit**, vul een **Email address** in, en gebruik daarna het bewerkicoon naast **Security roles**.
5. Wijs een **aangepaste** beveiligingsrol toe met rechten om aan te maken, te lezen en te schrijven op de tabel **Case**. Een application user kan geen van de ingebouwde rollen krijgen — Microsoft vereist een aangepaste. Heb je geen geschikte rol, kopieer dan een bestaande en snoei hem uit.
6. Kies **Save** en daarna **Create**.

Je kunt per geregistreerde applicatie maar één application user per omgeving hebben. Application users zijn niet gelicentieerd en zijn vrijgesteld van de regels voor beveiligingsgroeplidmaatschap van de omgeving.

## Stap 3 — Sla de gegevens op in OneUptime

Ga naar **Workflows → Globale variabelen → Aanmaken** en voeg deze toe, waarbij je **Geheim** aanzet voor de gemarkeerde:

| Naam                     | Waarde                                                      | Geheim |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | De Directory (tenant) ID uit Stap 1                         | Nee    |
| `DYNAMICS_CLIENT_ID`     | De Application (client) ID uit Stap 1                       | Nee    |
| `DYNAMICS_CLIENT_SECRET` | De **Value** van het client secret uit Stap 1               | Ja     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — zonder afsluitende slash | Nee   |

Plak het client secret precies zoals Entra ID het je gaf. OneUptime codeert de formulierbody voor je, dus URL-codeer hem niet met de hand.

Verwijs vanuit een blok naar elk ervan met `{{global.variables.DYNAMICS_CLIENT_ID}}`. Zie [Variabelen](/docs/workflows/variables) voor hoe geheimen uit runlogboeken worden gewist.

## Stap 4 — Haal een access token op

Elke run haalt zijn eigen token op. Tokens gaan 60–90 minuten mee en de client credentials-flow geeft nooit een refresh token uit, dus er valt niets te cachen en niets te vernieuwen — één extra HTTP-aanroep per run is de hele prijs.

1. Open **Workflows → Workflow maken**, geef het de naam `Incidents → Dynamics 365`, en open de **Bouwer**.
2. Klik op de gestippelde plaatshouder, voeg de trigger **On Create Incident** toe, en vraag in zijn **Select Fields** om de kolommen die je wilt meesturen:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Laat zijn **Identifier** op `incident-on-create-1` staan.

3. Klik op **Component toevoegen**, voeg een **API Post (JSON)**-blok toe, verbind de **Succes**-stip van de trigger ermee, en open zijn instellingen. Zet zijn **Identifier** op `get-token`, en daarna:

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

**Typ de headernaam als `Content-Type`, met exact die hoofdletters.** Dat is wat OneUptime vertelt de body als form post te versturen in plaats van als JSON, en dat is de enige vorm die het tokeneindpunt van Microsoft accepteert. `content-type` in kleine letters matcht niet, het verzoek gaat als JSON de deur uit en komt terug met `400`.

De `scope` moet je omgevings-URL zijn, gevolgd door `/.default` — dat is de vorm voor een confidential client. Een verkeerde omgevings-URL hier is de gebruikelijke oorzaak van `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

Het token is nu verderop beschikbaar als:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Stap 5 — Maak de case aan

Voeg een tweede **API Post (JSON)**-blok toe, verbind de **Succes**-stip van `get-token` ermee, en zet zijn **Identifier** op `create-case`.

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

Vervang de account-GUID door het account waar deze cases bij horen. **`customerid` is echt verplicht op een case** — het is een van de kolommen die Dataverse bij elke programmatische schrijfactie afdwingt, dus een create zonder die kolom wordt afgewezen. Omdat hij naar een account of naar een contact kan wijzen, schrijf je nooit `customerid@odata.bind`; je schrijft `customerid_account@odata.bind` of `customerid_contact@odata.bind`, en die namen zijn hoofdlettergevoelig. `title` is verplicht op een andere manier: de Dynamics-formulieren staan erop, de API niet, dus stuur hem toch mee.

`Prefer: return=representation` is wat dit bruikbaar maakt vanuit een workflow. Zonder die header antwoordt een geslaagde create met `204 No Content` en zet hij de URI van het nieuwe record in een `OData-EntityId`-responseheader, waar je dan een GUID uit zou moeten vissen. Mét die header is het antwoord `201 Created` en draagt het het record zelf, zodat het volgende blok kan lezen:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Zet de workflow nu aan — **Overzicht → Workflow bewerken → Ingeschakeld** — roep een testincident uit, en lees de run onder **Runs & logboeken**. Het blok `create-case` hoort een `201` te tonen en een body met het nieuwe `incidentid`. Wijzigingen op het canvas slaan zichzelf op; er is geen opslaanknop.

### Ernst en status mappen

Dynamics levert `severitycode` met één enkele optie, "Default Value", dus er is geen kant-en-klare ernstschaal om op te mappen. Gebruik in plaats daarvan **`prioritycode`**, en vertak met een **If / Else**-blok op `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` als je prioriteiten per ernstniveau wilt.

| Kolom            | Waarden                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` is aanpasbaar, dus een tenant kan er eigen waarden aan hebben toegevoegd. Stuur gehele getallen, geen labels.

## Stap 6 — Houd het incident en de case vanuit elkaar vindbaar

Wat je later ook doet — reageren, oplossen, terugsynchroniseren — vraagt dat één van de twee systemen de identifier van het andere bewaart. Zet die aan de Dynamics-kant.

Voeg een kolom van het type **single line of text** toe aan de tabel Case, bijvoorbeeld `new_oneuptimeincidentid`, en zet hem wanneer je de case aanmaakt:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Elke latere workflow kan de case dan met een filter vinden:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Definieer je die kolom als een **alternate key** op de tabel Case, dan kun je het opzoeken helemaal overslaan en direct `PATCH`en naar `incidents(new_oneuptimeincidentid='<id>')` — een upsert die de case aanmaakt als hij ontbreekt en bijwerkt als hij bestaat. De sleutel moet klaar zijn met bouwen (zijn status wordt **Active**) voordat hij bruikbaar is, en waarden van een alternate key mogen geen `/ < > * % & : \ ? + #` bevatten. Een OneUptime-id is een gewone UUID, dus die is veilig.

De omgekeerde richting — het Dynamics-case-id opslaan op het OneUptime-incident — kan ook, met een **Update One Incident**-blok dat naar `customFields` schrijft. Wees daar voorzichtig mee: `customFields` is één JSON-kolom, dus die wegschrijven vervangt elke waarde van elk aangepast veld op dat incident, niet alleen die van jou. De koppeling aan de Dynamics-kant houden vermijdt dat volledig.

## Stap 7 — Los de case op wanneer het incident wordt opgelost

Bouw dit als een **tweede** workflow, zodat een fout hier niet kan verhinderen dat er cases worden geopend.

1. **Workflow maken**, geef het de naam `Incident resolved → Close Dynamics case`, en voeg de trigger **On Update Incident** toe.
2. Zet in de **Listen on** van de trigger `{"currentIncidentStateId": true}` zodat de workflow alleen wakker wordt bij statuswijzigingen en niet bij elke bewerking. Vraag in **Select Fields** om `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Voeg een **If / Else**-blok toe. **Input 1** is `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** is `==`, **Input 2** is `Resolved` — of hoe de opgeloste status in jouw project ook heet. Zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).
4. Herhaal vanaf de tak **Yes** het blok `get-token` uit Stap 4.
5. Voeg een **API Get (JSON)**-blok toe, zet zijn **Identifier** op `find-case`, en geef het de `$filter`-URL uit Stap 6. Een Dataverse-query antwoordt met een `value`-array, en een workflowverwijzing kan met blokhaken in een array indexeren, dus het case-id is `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Voeg een **API Post (JSON)**-blok toe dat de case sluit:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: dezelfde als in Stap 5, maar zonder `Prefer`.
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

     `Status` is een `statuscode`-waarde binnen de status Resolved — `5` is *Problem Solved*.

     **Test deze body tegen je eigen omgeving voordat je erop vertrouwt.** `CloseIncident` neemt twee parameters aan, `IncidentResolution` en `Status`, maar Microsoft publiceert er geen HTTP-voorbeeld voor — elk officieel voorbeeld is in C#. De vorm hierboven is de gebruikelijke vertaling. Wijst jouw omgeving hem af, probeer de case dan te identificeren met een gewone eigenschap `"incidentid": "<the case id>"` in plaats van de `@odata.bind`-vorm, want zo verwijzen de andere actievoorbeelden van Microsoft naar een bestaand record.

**Waarom niet gewoon de case `PATCH`en naar `statecode: 1`?** Dat kan — Microsoft documenteert een `PATCH` van `statecode` en `statuscode` als het Web API-equivalent van het oudere SetState-bericht, en het is het juiste gereedschap om een case tussen actieve statussen te verplaatsen. Wat het niet doet, is de activiteit **Case Resolution** aanmaken die een opgeloste case in Dynamics 365 Customer Service hoort te hebben, en het wordt botweg geweigerd in een omgeving waar een beheerder aangepaste statusovergangen heeft geconfigureerd. Gebruik `CloseIncident` om op te lossen; gebruik `PATCH` voor al het andere. En schrijf je `statecode`, zet dan altijd `statuscode` in hetzelfde verzoek — anders past Dynamics stilletjes de standaardstatus van die state toe.

`CloseIncident` komt uit Dynamics 365 Customer Service en niet uit basis-Dataverse, en staat niet in de Dataverse-actiereferentie. Geeft hij `404` terug, bevestig dan dat hij in je omgeving bestaat door `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` op te halen en op `CloseIncident` te zoeken.

Voor alles wat minder ver gaat dan de case sluiten — een notitie, een prioriteitsverhoging, een titelwijziging — gebruik je een **API Patch (JSON)**-blok tegen `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` met een `If-Match: *`-header, die voorkomt dat een onbedoelde upsert een nieuwe case aanmaakt. Stuur alleen de kolommen die je wijzigt.

## Inbound — Dynamics 365 naar OneUptime

Nu de andere richting: iemand sluit de case in Dynamics, of een agent voegt een notitie toe, en OneUptime hoort dat te weten.

### Bouw eerst de ontvangende workflow

1. **Workflow maken**, geef het de naam `Dynamics 365 → OneUptime`, en voeg de trigger **Webhook** toe.
2. Open **Instellingen** op die workflow en kopieer de **Webhook Secret Key**. Je URL is:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Op een zelfgehoste installatie vul je je eigen host in. Behandel de URL als een wachtwoord — iedereen die hem heeft, kan de workflow starten. Je kunt de sleutel vanaf dezelfde pagina resetten.

3. Voeg een **If / Else**-blok toe dat een gedeeld geheim controleert voordat er iets anders gebeurt. **Input 1** is `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — een waarde die je zelf verzint en als geheime globale variabele opslaat.
4. Voeg vanaf de tak **Yes** een **Update One Incident**-blok toe:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: wat de casewijziging in OneUptime moet betekenen — een statuswijziging, een notitie, een label.

   Om het incident naar een status te verplaatsen heb je de id van die status nodig: een **Find One Incident State**-blok met de query `{"name": "Resolved"}` geeft je `{{local.components.incident-state-find-one-1.returnValues.model._id}}` om naar `currentIncidentStateId` te schrijven.

Laat hem ingeschakeld en klaarstaan. Geef Dynamics nu iets om aan te roepen.

### Optie A — een Power Automate-flow (aanbevolen)

Dit is het pad dat de meeste teams zouden moeten nemen: je bepaalt zelf de payload, en er valt niets te installeren.

1. Maak in [Power Automate](https://make.powerautomate.com) een **Automated cloud flow** aan.
2. Trigger: **Microsoft Dataverse → When a row is added, modified or deleted**.

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — iets smallers vuurt alleen af voor rijen die van jou of van je business unit zijn.
   - **Select columns**: `statecode,statuscode`. Dit is een filter dat alleen bij Update geldt, en het is de moeite waard om het goed te doen. Lookupkolommen worden hier niet ondersteund, en noem nooit een kolom die bij elke update aanwezig is (zoals de primaire sleutel), anders vuurt de flow bij elke opslagactie af.

3. Voeg **Microsoft Dataverse → Get a row by ID** toe, tabel `Cases`, rij-id uit de trigger, en een **Select columns** van `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Deze tweede aanroep is zijn prijs waard. Bij een update draagt de trigger alleen de kolommen die zijn gewijzigd, dus de identifiers waarop je moet matchen zijn er misschien gewoon niet.

4. Voeg de ingebouwde actie **HTTP** toe:

   - **Method**: `POST`
   - **URI**: de OneUptime-webhook-URL van hierboven
   - **Headers**: `Content-Type: application/json` en `X-OneUptime-Secret: <the same secret>`
   - **Body**: bouw hem op uit de uitvoer van *Get a row by ID*, bijvoorbeeld

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Sla op en zet de flow aan.

Het weten waard voordat je voor dit pad kiest:

- De **Microsoft Dataverse-connector is premium.** Voor een automated flow heeft alleen de eigenaar van de flow de licentie nodig, niet iedereen die met de case in aanraking komt — maar als de licentie van de eigenaar verloopt, stopt de flow stilletjes.
- Dataverse-triggers zijn **push, geen polling** — Dynamics registreert een callback en vuurt die af. Aflevering gebeurt normaal binnen seconden; duurt het meer dan vijf minuten, dan loopt de asynchrone service achter, wat je onder **Settings → System Jobs** in het admin center kunt zien.
- Eigen headers blijven bestaan. Power Automate haalt een aantal standaard headerfamilies uit HTTP-acties (de meeste `Accept-*`- en `Content-*`-headers, `Host`, `Origin`, `Cookie`), maar een eigen header zoals `X-OneUptime-Secret` wordt doorgegeven.
- De flow moet in dezelfde omgeving leven als de tabel die hij bekijkt.
- Verzoeken tellen mee in de Power Platform-verzoektoewijzing van je tenant, en throttling van de connector verschijnt als `429` binnen de flowrun.

### Optie B — een native Dataverse-webhook

Is Power Automate niet beschikbaar, dan kan Dataverse OneUptime rechtstreeks aanroepen. Registreer het endpoint met de [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, geef het de OneUptime-URL, kies **HttpHeader**-authenticatie, en voeg `X-OneUptime-Secret` met je geheim toe. Registreer daarna een stap op de tabel **incident** voor het bericht **Update**, met **Filtering Attributes** beperkt tot de kolommen die je interesseren, stage **PostOperation**, uitvoeringsmodus **Asynchronous**.

Neem deze route met je ogen open:

- **Alleen poort 80 en 443.** Een zelfgehoste OneUptime op elke andere poort kan niet worden geregistreerd.
- **Dataverse controleert je geheim niet.** Het stuurt de header mee; een verzoek weigeren dat hem niet draagt is volledig de taak van jouw workflow — en daar is het **If / Else**-blok in de ontvangende workflow voor.
- **De payload is geen vriendelijk JSON-object.** Het is een geserialiseerde `RemoteExecutionContext`, waarin `InputParameters` een *array* van `{key, value}`-paren is en de gewijzigde rij onder de sleutel `Target` zit, met zijn kolommen in weer een `Attributes`-array. Reken erop dat je een **Run Custom JavaScript**-blok moet toevoegen om die plat te slaan voordat iets anders hem kan lezen.
- **Alleen gewijzigde kolommen zitten erin** bij een update, dus registreer een **Post Image** als je `ticketnumber` of je OneUptime-id-kolom nodig hebt.
- **Boven 256 KB worden de interessante delen weggehaald** — `InputParameters`, `PreEntityImages` en `PostEntityImages` gaan er allemaal uit, en het verzoek draagt een `x-ms-dynamics-msg-size-exceeded`-header. `PrimaryEntityId` en `PrimaryEntityName` overleven het, dus de terugval is om de rij via de Web API terug te lezen.
- **Aflevering is bijna onvergeeflijk.** Dataverse wacht 60 seconden op een `2xx` en probeert precies één keer opnieuw, en alleen bij `502`, `503` en `504`. Al het andere — ook een `500` van jouw kant — wordt niet opnieuw geprobeerd; het belandt als mislukte System Job.
- Kies **Asynchronous**. Een synchrone stap blokkeert de opslagactie van de agent op jouw endpoint, en als de transactie daarna wordt teruggedraaid, is het verzoek al de deur uit en niet meer terug te halen.

Klassieke Dynamics-achtergrondworkflows hebben helemaal geen HTTP- of webhookstap, dus die zijn hier geen derde optie.

## Hetzelfde doen voor alerts

Alles hierboven is rond incidenten geschreven omdat dat het gangbare geval is, maar alerts werken identiek — verwissel het recordtype en er verandert verder niets:

| Incident                                                     | Alert                                               |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

Een workflow heeft precies één trigger, dus incidenten en alerts vragen elk om een eigen workflow. Zouden de twee hetzelfde werk doen, bouw dan de Dynamics-helft één keer en roep hem vanuit beide aan met het component **Execute Workflow**.

## Probleemoplossing

Lees eerst het mislukte blok in **Runs & logboeken** — beide Microsoft-eindpunten geven een verklarende JSON-body terug, en het API-component bewaart die in `response-body`.

**Het tokenverzoek mislukt met `400` en `invalid_request` of een niet-ondersteund grant type.** De `Content-Type`-header is niet precies `Content-Type: application/x-www-form-urlencoded`, waardoor de body als JSON de deur uit ging. Controleer de hoofdletters.

**`400` met `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** De `scope` is niet je omgevings-URL plus `/.default`. Kopieer de URL uit **Developer resources** en haal er elke afsluitende slash en elk `/api/data/...`-pad af.

**`401 Unauthorized` van Dynamics.** De `Authorization`-header ontbreekt, klopt niet, of het token is halverwege de run verlopen. Hij moet luiden `Bearer <token>` met één spatie.

**`403 Forbidden` met `0x80072560`, "The user isn't a member of the organization".** Stap 2 is overgeslagen, of de application user hangt aan een andere app-registratie. Het token is in orde; de gebruiker aan de Dynamics-kant is er niet.

**`403 Forbidden` met een rechtenfout.** De application user bestaat, maar zijn aangepaste beveiligingsrol mist Create, Read of Write op **Case**.

**`400 Bad Request` waarin de klant wordt genoemd.** `customerid` is verplicht. Zet `customerid_account@odata.bind` of `customerid_contact@odata.bind`, exact zo gespeld, met een URI met voorloopslash zoals `/accounts(<guid>)`.

**`404 Not Found` op `/CloseIncident`.** De actie is een actie van Dynamics 365 Customer Service. Zoek ernaar in de `$metadata` van je omgeving voordat je aanneemt dat hij beschikbaar is.

**`412 Precondition Failed` met `DuplicateRecord`.** Een regel voor duplicaatdetectie matchte. Maak de regel smaller of stop met het meesturen van het veld waarop hij matcht.

**`429 Too Many Requests`.** De service protection-limieten van Dataverse — ruwweg 6.000 verzoeken en 20 minuten uitvoeringstijd per gebruiker in elk venster van vijf minuten, per webserver. Het antwoord bevat een `Retry-After` in seconden. Zit een workflow te bursten, zet er dan een **Delay**-blok in of verplaats het werk naar een geplande workflow die batcht.

**Er komt niets aan aan de OneUptime-kant.** Stuur zelf een verzoek naar de webhook-URL met `curl` en controleer de **Runs & logboeken** van de workflow. Verschijnt jouw eigen verzoek wel en dat van Dynamics niet, dan zit het probleem stroomopwaarts: kijk voor Power Automate in de eigen runhistorie van de flow, en voor een native webhook onder **Settings → System Jobs**, gefilterd op mislukkingen.

**De workflow draait, maar het incident verandert niet.** Een **Update One Incident**-blok meldt `Items Updated: 0` wanneer de query niets matchte — dat is een succes, geen fout. Controleer of de id in de payload het OneUptime-incident-id is en of je op `_id` bevraagt.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — de inbound- en outbound-patronen en het authenticatie-spiekbriefje.
- [Jira](/docs/integrations/jira) — dezelfde bouw in twee richtingen, maar dan tegen Jira.
- [Workflows – Overzicht](/docs/workflows/index) en [Een workflow maken](/docs/workflows/authoring) — het canvas, identifiers, en een workflow aanzetten.
- [Componenten](/docs/workflows/components) — de API-blokken, If / Else, en de OneUptime-datacomponenten.
- [Variabelen](/docs/workflows/variables) — geheimen, en de uitvoer van het ene blok in het volgende lezen.
- [Workflow-configuratie en veiligheid](/docs/workflows/configuration) — webhookbeveiliging en uitgaande netwerktoegang.
- [IP-adressen](/docs/configuration/ip-addresses) — de uitgaande reeksen van OneUptime, als Dynamics achter een acceptatielijst zit.
