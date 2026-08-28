# Jira-integration

Öppna ett [Jira](https://www.atlassian.com/software/jira)-ärende varje gång en OneUptime-incident deklareras, håll det i takt när incidenten rör sig, och låt Jira skicka tillbaka statusändringar till OneUptime — allt med ett [Arbetsflöde](/docs/workflows/index). Det finns inget Jira-specifikt block att installera: OneUptime anropar Jiras REST API med [API-komponenten](/docs/workflows/components#api), och Jira anropar tillbaka till en [Webhook-utlösare](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Den här sidan bygger båda riktningarna. Allt fram till avsnittet om inkommande trafik är skrivet för **Jira Cloud**; ett avsnitt nära slutet listar vad som skiljer sig på **Jira Data Center**.

> Atlassian har döpt om saker i Jira Cloud: ett **project** heter nu **space** i stora delar av gränssnittet, och ett **issue** är ett **work item**. Tenanter finns på båda vokabulärerna, så där formuleringen spelar roll nedan hittar du båda.

## Förutsättningar

- En Jira Cloud-sajt (`https://your-domain.atlassian.net`) och ett projekt att lägga ärenden i. Notera dess **projektnyckel** — `OPS` i `OPS-1234`.
- Ett Jira-konto som kan skapa ärenden i det projektet, och en **API-token** för det från [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Använd ett tjänstekonto snarare än en persons — ärenden som skapas på det här sättet tillskrivs tokenens ägare.
- Behörighet att skapa automationsregler i det projektet, för den inkommande halvan.
- Ett OneUptime-projekt där du kan skapa arbetsflöden och globala variabler.

## Steg 1 — Spara Jira-uppgifterna som en hemlighet

Jira Clouds REST API använder **Basic auth** byggd av din Atlassian-kontos e-postadress och en API-token, base64-kodade tillsammans.

1. Koda `email:api_token` en gång:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Använd `printf`, inte `echo`. `echo` lägger till en radbrytning, radbrytningen kodas tillsammans med allt annat, och Jira svarar `401` av skäl som är osynliga i strängen du klistrade in.

2. Gå i OneUptime till **Arbetsflöden → Globala variabler → Skapa**. Namnge den `JIRA_AUTH`, klistra in base64-strängen som **Innehåll** och slå på **Hemlighet**.
3. Lägg till en andra, icke-hemlig variabel `JIRA_URL` som innehåller `https://your-domain.atlassian.net` utan avslutande snedstreck.

Vilket block som helst kan nu använda `Basic {{global.variables.JIRA_AUTH}}` som sin `Authorization`-header, och token syns aldrig i arbetsflödet eller dess körloggar. Se [Variabler](/docs/workflows/variables).

Två saker om Atlassians API-tokens som förr eller senare biter en integration som ingen håller ögonen på:

- **De upphör att gälla.** Tokens skapas med en livslängd på mellan en dag och ett år, ett år som standard, och det finns ingen förnyelse — en utgången token måste ersättas för hand på samma sida och kodas om till `JIRA_AUTH`. Lägg in utgångsdatumet i en kalender någonstans. När ett arbetsflöde som har fungerat i månader börjar svara `401` är det här orsaken.
- **En token med scopes behöver en annan bas-URL.** Tokensidan erbjuder **Create API token with scopes** vid sidan av det klassiska **Create API token**. Tokens med scopes är det säkrare valet, men de adresseras inte till din sajt: de går till `https://api.atlassian.com/ex/jira/<cloudId>`, så `JIRA_URL` blir det i stället, och varje sökväg nedan hänger oförändrad under den. Ditt `cloudId` finns i JSON:en på `https://your-domain.atlassian.net/_edge/tenant_info`. En token med scopes som skickas till `your-domain.atlassian.net` misslyckas helt enkelt.

Om din organisation använder Atlassians centraliserade användarhantering finns ett tredje alternativ som går runt utgångsproblemet: en [OAuth 2.0-uppgift för ett tjänstekonto](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Den ger dig ett klient-id och en hemlighet i stället för en token, och ett arbetsflöde växlar in dem mot en kortlivad åtkomsttoken i början av varje körning — samma tvåblocksform som sidan [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) använder, med ett **API Post (JSON)**-block som hämtar token och allt efter det som skickar `Bearer <token>`. Ingenting behöver ersättas för hand ett år senare. Atlassians sida har den exakta tokenförfrågan; API:ets bas-URL är `https://api.atlassian.com`.

## Steg 2 — Öppna ett Jira-ärende för varje incident

1. Öppna **Arbetsflöden → Skapa arbetsflöde**, namnge det `Incidents → Jira` och öppna **Byggare**.
2. Klicka på det streckade platshållarblocket och lägg till utlösaren **On Create Incident**. I dess **Select Fields**, be om kolumnerna du vill skicka:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Låt dess **Identifier** vara `incident-on-create-1` — det är namnet senare block refererar till den med.

3. Klicka på **Lägg till komponent**, lägg till ett **API Post (JSON)**-block och dra från utlösarens **Success**-punkt till det nya blockets inmatningspunkt. Öppna det, sätt dess **Identifier** till `create-issue` och fyll i:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   Ersätt `OPS` med din projektnyckel och `Bug` med en ärendetyp som finns i det projektet. Båda kan också anges med id — `{"id": "10000"}` — vilket är vad Atlassians egna exempel använder och vad du bör föredra om två ärendetyper på din sajt delar namn. `createmeta`-anropen längre ner ger dig de id:na.

Beskrivningen ser tung ut eftersom Jira Clouds v3-API tar emot rik text som **Atlassian Document Format** — ett dokumentträd, inte en sträng. Formen ovan är det minsta giltiga dokumentet: ett stycke som innehåller en textnod. Detsamma gäller `environment` och alla flerradiga anpassade textfält; enradiga anpassade textfält tar fortfarande en vanlig sträng.

Slå nu på arbetsflödet från **Översikt → Redigera arbetsflöde → Aktiverad**, deklarera en testincident och öppna **Körningar och loggar**. Blocket `create-issue` bör visa en `201` och en body som innehåller det nya ärendets `id`, `key` och `self`. Ändringar på arbetsytan sparar sig själva — det finns ingen Spara-knapp, och ett inaktiverat arbetsflöde kan inte köras alls, inte ens för hand.

Den nya ärendenyckeln är tillgänglig för alla block efter det här:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Fyll i fler fält

Några vanliga tillägg inuti `fields`:

- **Prioritet** — `"priority": { "id": "20000" }`, med ett prioritets-id från din sajt. För att mappa OneUptime-allvarlighetsgrader mot Jira-prioriteter, lägg ett **If / Else**-block mellan utlösaren och API-blocket och förgrena på `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Tilldelad** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identifierar personer med Atlassian-konto-id; `username` och `userKey` togs bort ur Cloud-API:et för flera år sedan.
- **Etiketter** — `"labels": ["oneuptime", "sev1"]`, en platt array av strängar. Etiketter kan inte innehålla mellanslag.
- **Komponenter** — `"components": [{ "id": "10000" }]`.
- **Anpassade fält** — `"customfield_10034": "..."`, med fältets eget id. Värdets form följer fältets typ: en enkelval tar `{"value": "red"}`, en flerval en array av id:n, ett flerradigt textfält ett Atlassian Document Format-dokument.

För att ta reda på vad ett projekt faktiskt kräver, fråga Jira i stället för att gissa. Lista ärendetyperna i ett projekt, och sedan fälten för en av dem:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

Det andra anropet listar varje fält som den ärendetypen accepterar, vilka av dem som är obligatoriska, och de exakta `customfield_NNNNN`-id:na. För att läsa id:na från ett ärende du redan har, hämta det med `?expand=names`.

## Steg 3 — Ta med incident-id:t in i Jira

Båda halvorna av en tvåvägssynkronisering behöver att ett system håller det andras identifierare, och Jira är den bättre platsen att förvara den på: OneUptimes kolumn `customFields` är en enda JSON-klump, så att skriva ett värde från ett arbetsflöde ersätter varje anpassat fält på den incidenten.

**Med en Jira-administratör.** Lägg till ett kort anpassat textfält — kalla det *OneUptime Incident ID* — på projektets skapandeskärm, hitta dess id med `createmeta` och sätt det vid sidan av allt annat:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Utan en.** Lägg det i en etikett i stället. Etiketter tar inga mellanslag, och ett OneUptime-id är en vanlig UUID, så `oneuptime-<id>` är en giltig etikett:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

Det inkommande arbetsflödet måste sedan plocka ut den etiketten ur listan, vilket är ett par rader i ett **Run Custom JavaScript**-block. Det anpassade fältet är snyggare om du kan få ett.

När du ändå är här är det värt att lägga till en länk på Jira-ärendet tillbaka till incidenten. Ett **API Post (JSON)**-block efter `create-issue`, riktat mot `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, med:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

ger alla i Jira en väg tillbaka med ett klick. Lägg till `projectId` i utlösarens **Select Fields** för det här. `globalId` är det som gör anropet säkert att upprepa: Jira uppdaterar länken som redan bär det id:t i stället för att lägga till en andra. Eftersom en uppdatering också nollställer allt du utelämnar ska du alltid skicka hela `object`, inte en delmängd av det.

## Steg 4 — Kommentera och byt status när incidenten rör sig

Bygg det här som ett **andra** arbetsflöde, så att ett fel här aldrig kan hindra att ärenden öppnas.

1. **Skapa arbetsflöde**, namnge det `Incident updates → Jira` och lägg till utlösaren **On Update Incident**.
2. I **Listen on**, skriv `{"currentIncidentStateId": true}`. Utlösaren utlöses då bara för tillståndsändringar i stället för varje redigering. I **Select Fields**, be om `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Lägg till ett **If / Else**-block: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — eller vad ditt projekts lösta tillstånd nu heter. Se [Incidentstatusar och allvarlighetsgrader](/docs/incidents/states-and-severities).

Från grenen **Yes** måste du först hitta ärendet du öppnade i Steg 2. Be Jira om det med id:t du sparade i Steg 3, med ett **API Post (JSON)**-block vars **Identifier** är `find-issue`:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Om du använde ett anpassat fält i stället för en etikett blir satsen `cf[10050] ~ \"...\"` med ditt eget fält-id.

Ärende-id:t är då `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, och varje endpoint nedan tar ett id lika gärna som en nyckel.

Tre saker om den här endpointen är värda att känna till. **Posta JQL:en, lägg den inte i URL:en** — en frågesträng som innehåller `=` inuti ett värde kapas på vägen ut ur ett arbetsflöde, och JQL består av inget annat än `=`-tecken. **Frågan måste vara avgränsad**: ett ensamt `order by key desc` avvisas med `400`, vilket är därför `project =`-satsen finns där. Och `/rest/api/3/search/jql` är den aktuella endpointen — den äldre `/rest/api/3/search` är utfasad och på väg bort, så sträck dig inte efter den.

**Att lämna en kommentar** är ett enda **API Post (JSON)**-block mot `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, med en Atlassian Document Format-body precis som beskrivningen:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**Att flytta ärendet** kräver två anrop, eftersom en övergång identifieras av ett id som skiljer sig mellan arbetsflöden och, på vissa tavlor, mellan ärenden.

1. Ett **API Get (JSON)**-block på `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` returnerar de övergångar som är tillgängliga *från ärendets nuvarande status*, var och en med ett `id` och ett `name`, och ett `to`-objekt som namnger statusen den leder till.
2. Ett **API Post (JSON)**-block mot samma URL utför en:

   ```json
   { "transition": { "id": "31" } }
   ```

En lyckad övergång svarar `204` utan body. Om du hellre slipper läsa listan vid körning kan du anropa den en gång för hand för ett ärende i rätt status och hårdkoda id:t — kom bara ihåg att det är bundet till det arbetsflödet, så en administratör som redigerar Jira-arbetsflödet kan bryta det utan att det märks.

## Inkommande — Jira till OneUptime

Nu den andra riktningen: någon flyttar ärendet till Done, och OneUptime-incidenten bör följa efter.

### Bygg det mottagande arbetsflödet först

1. **Skapa arbetsflöde**, namnge det `Jira → OneUptime` och lägg till utlösaren **Webhook**.
2. Öppna det arbetsflödets **Inställningar** och kopiera **Webhookens hemliga nyckel**. Din URL är:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Självhostade installationer använder sin egen värd. Behandla URL:en som ett lösenord — vem som helst som har den kan starta arbetsflödet — och återställ nyckeln från samma sida om den läcker.

3. Lägg till ett **If / Else**-block som kontrollerar en delad hemlighet innan något annat körs. **Input 1** är `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** är `{{global.variables.JIRA_WEBHOOK_SECRET}}` — ett värde du hittar på och sparar som en hemlig global variabel.
4. Från grenen **Yes**, lägg till ett **Update One Incident**-block:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: vad Jira-ändringen ska betyda här — vanligtvis en tillståndsändring.

   Att flytta en incident kräver måltillståndets id, som ett **Find One Incident State**-block med frågan `{"name": "Resolved"}` ger dig som `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Skriv in det i `currentIncidentStateId`.

Lämna arbetsflödet aktiverat. Ge nu Jira något att anropa.

### Skicka händelsen från en Jira-automationsregel

1. Öppna i Jira projektets automationsregler: **Space settings → Automation** på nyare tenanter, **Project settings → Automation** på äldre. För en regel som sträcker sig över flera projekt, använd **Settings → System → Global automation**, som kräver den globala behörigheten *Administer Jira*.
2. **Create rule**, och välj utlösaren **Work item transitioned** — **Issue transitioned** på äldre tenanter. Ställ in den på att köras när statusen flyttas *till* **Done**.

   Använd den här utlösaren, inte *Work item updated*: uppdateringsutlösaren utesluter statusändringar med flit.

3. Lägg till åtgärden **Send web request** och konfigurera den:

   - **Web request URL**: OneUptime-webhookens URL ovanifrån.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, och `X-OneUptime-Secret` / din delade hemlighet. Använd alternativet **Hide** på hemlighetens värde så att andra regelredigerare inte kan läsa det — observera att döljandet är oåterkalleligt för det värdet, och att dolda värden går förlorade om regeln exporteras eller dupliceras.
   - **Web request body**: **Custom format**, så att du styr formen:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Om du använde en etikett i stället för ett anpassat fält i Steg 3, skicka `"labels": "{{issue.labels}}"` och plocka ut id:t med ett **Run Custom JavaScript**-block på OneUptime-sidan.

4. Slå på regeln, flytta ett testärende till Done och kontrollera båda sidor: regelns egen granskningslogg i Jira, och **Körningar och loggar** i OneUptime.

Saker värda att känna till innan du förlitar dig på det här:

- **Destinationsporten är begränsad.** Send web request når bara portarna 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 och 9900. OneUptime Cloud ligger på 443; en självhostad installation på en ovanlig port kan inte anropas på det här sättet.
- **Det finns ingen signering av förfrågningar.** Åtgärden har inget HMAC-alternativ, så en delad hemlighet i en header över HTTPS är den mekanism Atlassian dokumenterar. Kontrollen med **If / Else** i Steg 3 i det mottagande arbetsflödet är det som gör den värd att ha.
- **Regelkörningar mäts.** Jira Cloud räknar lyckade regelexekveringar mot en månatlig kvot som beror på din plan — 100 på Free, 1 700 på Standard, 1 000 × användare på Premium, obegränsat på Enterprise. En regel som utlöses vid varje övergång i ett livligt projekt växer snabbt.
- **Värden URL-kodas inte** åt dig. Det spelar bara roll om du skickar en formulärkodad body; JSON:en ovan är i sin ordning.
- **Atlassian publicerar sina utgående IP-intervall** på [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) om din OneUptime-installation sitter bakom en tillåtelselista. De ändras, så hämta flödet regelbundet i stället för att låsa fast adresser.

### Eller använd en Jira-webhook i stället

En Jira-administratör kan registrera en webhook direkt under **Settings → System → Advanced → WebHooks**, välja händelserna som ska skickas och, om så önskas, en JQL-fråga som avgränsar vilka ärenden som utlöser den. Jämfört med en automationsregel:

- Payloaden är Jiras egen, inte din: `webhookEvent`, `issue_event_type_name`, hela `issue`, och en `changelog` vars `items`-array håller före-och-efter för varje ändrat fält. För en statusändring vill du ha posten där `field` är `status`. Att läsa det inuti ett arbetsflöde innebär vanligtvis ett **Run Custom JavaScript**-block.
- Webhooks **kan** signeras — ge webhooken en hemlighet så skickar Jira en `X-Hub-Signature`-header som håller en HMAC av förfrågans body — men ett arbetsflöde kan inte kontrollera den. Signaturen täcker exakt de byte Jira skickade, och Webhook-utlösaren ger arbetsflödet en body som redan har tolkats till JSON, så det finns ingenting kvar att hasha. Vill du att förfrågan ska autentiseras, använd en automationsregel med en header med delad hemlighet i stället.
- URL:en måste vara HTTPS på en port från Jiras egen lista, som *inte* är samma lista som automationsåtgärden använder — port 80 är inte tillåten här.
- Leverans görs om upp till fem gånger med fem till femton minuters fördröjning, så ditt arbetsflöde måste tåla att samma händelse kommer två gånger.

Webhooks som registreras av en app via `/rest/api/3/webhook` är återigen en annan sak: de upphör att gälla 30 dagar efter registreringen om de inte förnyas. De administratörsregistrerade ovan upphör inte att gälla.

## Jira Data Center

Självhanterat Jira fungerar på samma sätt med en handfull utbyten. **Jira Server** nådde slutet på sin support i februari 2024 och får inga rättningar, så behandla Data Center som målet för självhantering.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — det finns ingen v3 på Data Center                        |
| `description` som ett Atlassian Document Format-dokument | `description` som en vanlig sträng i wiki-märkning                     |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| API-token från id.atlassian.com                   | **Profile → Personal access tokens → Create token** på ditt eget Jira-konto  |
| Automationsåtgärden **Send web request**          | Automationsåtgärden **Send outgoing web request**                            |

Så blocket som skapar ärendet blir en `POST` till `/rest/api/2/issue` med:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

vilket är enklare att mallgöra — inget dokumentträd.

Andra skillnader att planera för:

- **Personal access tokens** finns från Jira Core och Jira Software 8.14 och Jira Service Management 4.15. De upphör att gälla — 365 dagar som standard — och gränssnittet flaggar en som *Expires soon* fem dagar innan. Basic auth med användarnamn och lösenord fungerar fortfarande på Data Center, men några misslyckade inloggningar utlöser en CAPTCHA som låser ute kontot från REST-API:et helt och hållet tills en människa löser den i en webbläsare, vilket är ett dåligt sätt att upptäcka ett stavfel. Föredra en token.
- **Automation ingår** från Jira Data Center 10.0. Innan dess var det den separat installerade appen Automation for Jira. Dess utgående förfrågan har en standardtimeout på 3000 ms, justerbar med egenskapen `outgoing.webhook.timeout.ms`.
- **Webhooks** registreras under **Administration → System → Advanced → WebHooks**, och JQL-avgränsning stöds. Håll de filtren snäva: Jira utvärderar varje registrerad webhooks JQL på tråden som väckte händelsen, så ett dussin lösa filter bromsar användaråtgärden som utlöste dem.
- **Från Data Center 10.0 är webhookleverans asynkron** och det finns inget synkront alternativ, så händelser kan komma i fel ordning. Gör det mottagande arbetsflödet idempotent.
- **Jira 10 tog bort `$` i webhookens URL-variabler** — `${issue.id}` blev `{issue.id}` — och flyttade webhookens REST-resurs från `/rest/webhooks/1.0/webhook` till `/rest/jira-webhook/1.0/webhooks`.

## Samma sak för larm

Allt ovan är skrivet kring incidenter eftersom det är det vanliga fallet, men larm fungerar likadant — byt ut posttypen och inget annat ändras:

| Incident                                 | Larm                                        |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

Ett arbetsflöde har exakt en utlösare, så incidenter och larm behöver ett arbetsflöde var. Om de två skulle göra samma arbete, bygg Jira-halvan en gång och anropa den från båda med komponenten **Execute Workflow**.

## Felsökning

Öppna det felande blocket i **Körningar och loggar** först. Jira returnerar en JSON-body som namnger exakt vad det avvisade, och API-komponenten behåller den i `response-body`.

**`401 Unauthorized`.** Koda om `email:api_token` med `printf` och uppdatera `JIRA_AUTH`; en avslutande radbrytning från `echo` är den vanliga orsaken. Bekräfta sedan att kontot som äger token kan skapa ärenden i det projektet. På Data Center, kontrollera att du skickar `Bearer`, inte `Basic`.

**`400 Bad Request` som namnger ett fält.** Ärendetypen finns inte i projektet, eller så har projektet ett obligatoriskt fält som du inte skickar. Kör `createmeta`-anropen ovan mot det projektet och den ärendetypen och jämför.

**`400` som klagar på `description`.** På Cloud v3 måste beskrivningen vara ett Atlassian Document Format-dokument, inte en sträng. Skicka antingen dokumentet som visas ovan, eller växla det blocket till `/rest/api/2/issue` och skicka vanlig text.

**`404 Not Found`.** Kontrollera bas-URL:en och API-versionen — `/rest/api/3/...` på Cloud, `/rest/api/2/...` på Data Center.

**`429 Too Many Requests`.** Jira begränsar takten. Svaret bär `Retry-After` i sekunder och en `RateLimit-Reason` som namnger vilken gräns du slog i. Skrivningar mot ett enda ärende är hårt begränsade — i storleksordningen tjugo på två sekunder — så ett arbetsflöde som kommenterar och byter status i snabb följd kan slå i taket på ett enda ärende. Lägg ett **Delay**-block mellan anropen, eller flytta massarbete till ett schemalagt arbetsflöde.

**Övergångsanropet returnerar `400`.** Övergångs-id:t är inte giltigt från ärendets *nuvarande* status. Hämta `/transitions` för det ärendet och använd ett id från svaret.

**Automationsregeln visas som lyckad men ingenting når OneUptime.** Kontrollera porten först — se den begränsade listan ovan. Skicka sedan en förfrågan till webhook-URL:en själv med `curl` och se om den dyker upp i **Körningar och loggar**; om din kommer fram men inte Jiras ligger problemet på Jiras sida.

**Arbetsflödet körs men incidenten ändras inte.** Ett **Update One Incident**-block rapporterar `Items Updated: 0` när dess fråga inte matchade något, och det räknas som en framgång, inte ett fel. Kontrollera att id:t i payloaden verkligen är OneUptime-incidentens id och att du frågar på `_id`.

**En `{{...}}`-referens dyker upp bokstavligt i ett Jira-ärende.** En olöst referens skickas vidare som text i stället för att tömmas. Körloggen namnger varje referens som inte kunde lösas — vanligtvis en felstavad blockidentifierare eller en omdöpt variabel.

## Läs vidare

- [Integrationsöversikt](/docs/integrations/index) — de inkommande och utgående mönstren, och autentiseringsfuskbladet.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — samma tvåvägsbygge mot Dynamics.
- [Översikt över arbetsflöden](/docs/workflows/index) och [Skapa ett arbetsflöde](/docs/workflows/authoring) — arbetsytan, identifierarna och att slå på ett arbetsflöde.
- [Komponenter](/docs/workflows/components) — API-blocken, If / Else och OneUptime-datakomponenterna.
- [Variabler](/docs/workflows/variables) — hemligheter, och att läsa ett blocks output från nästa.
- [Konfiguration & säkerhet](/docs/workflows/configuration) — webhook-säkerhet och utgående nätverksåtkomst.
- [ServiceNow](/docs/integrations/servicenow) och [PagerDuty](/docs/integrations/pagerduty) — samma utgående mönster för andra verktyg.
