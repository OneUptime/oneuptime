# Jira-integration

Åbn en [Jira](https://www.atlassian.com/software/jira)-sag, hver gang der erklæres en OneUptime-hændelse, hold den i trit, mens hændelsen udvikler sig, og lad Jira skubbe statusændringer tilbage til OneUptime — alt sammen med et [Workflow](/docs/workflows/index). Der er ingen Jira-specifik blok at installere: OneUptime kalder Jiras REST API med [API-komponenten](/docs/workflows/components#api), og Jira kalder tilbage til en [Webhook-trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Denne side bygger begge retninger. Alt frem til afsnittet om den indgående retning er skrevet til **Jira Cloud**; et afsnit til sidst opsummerer, hvad der er anderledes på **Jira Data Center**.

> Atlassian har omdøbt en række ting i Jira Cloud: et **project** hedder nu et **space** i store dele af brugerfladen, og et **issue** er et **work item**. Tenants kører på begge ordforråd, så hvor formuleringen betyder noget nedenfor, finder du begge.

## Forudsætninger

- Et Jira Cloud-websted (`https://your-domain.atlassian.net`) og et projekt at oprette sager i. Notér dets **projektnøgle** — `OPS` i `OPS-1234`.
- En Jira-konto, der kan oprette sager i det projekt, og et **API-token** til den fra [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Brug en servicekonto frem for en persons — sager oprettet på denne måde tilskrives tokenets ejer.
- Rettigheder til at oprette automatiseringsregler i det projekt, til den indgående halvdel.
- Et OneUptime-projekt, hvor du kan oprette workflows og globale variabler.

## Trin 1 — Gem Jira-legitimationsoplysningerne som en hemmelighed

Jira Clouds REST API bruger **Basic auth** bygget af din Atlassian-konto-email og et API-token, base64-enkodet sammen.

1. Enkod `email:api_token` én gang:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Brug `printf`, ikke `echo`. `echo` tilføjer et linjeskift, linjeskiftet enkodes sammen med alt det andet, og Jira svarer `401` af årsager, der er usynlige i den streng, du indsatte.

2. I OneUptime, gå til **Arbejdsgange → Globale variabler → Opret**. Navngiv den `JIRA_AUTH`, indsæt base64-strengen som **Content**, og slå **Secret** til.
3. Tilføj en anden, ikke-hemmelig variabel `JIRA_URL` med værdien `https://your-domain.atlassian.net` uden afsluttende skråstreg.

Enhver blok kan nu bruge `Basic {{global.variables.JIRA_AUTH}}` som sin `Authorization`-header, og tokenet optræder aldrig i workflowet eller dets kørselslogs. Se [Variabler](/docs/workflows/variables).

To ting om Atlassian API-tokens, som før eller siden bider en integration, ingen holder øje med:

- **De udløber.** Tokens oprettes med en levetid fra én dag til ét år, ét år som standard, og der findes ingen fornyelse — et udløbet token skal erstattes manuelt på den samme side og enkodes ind i `JIRA_AUTH` igen. Sæt udløbsdatoen i en kalender et sted. Når et workflow, der har virket i måneder, begynder at svare `401`, er det derfor.
- **Et scoped token kræver en anden basis-URL.** Token-siden tilbyder både **Create API token with scopes** og det klassiske **Create API token**. Scoped tokens er det mere sikre valg, men de er ikke adresseret til dit websted: de går til `https://api.atlassian.com/ex/jira/<cloudId>`, så `JIRA_URL` bliver det i stedet, og hver eneste sti nedenfor hænger uændret på den. Dit `cloudId` står i JSON'en på `https://your-domain.atlassian.net/_edge/tenant_info`. Et scoped token sendt til `your-domain.atlassian.net` fejler ganske enkelt.

Hvis din organisation kører på Atlassians centraliserede brugeradministration, findes der en tredje mulighed, der omgår udløbsproblemet: en [OAuth 2.0-legitimation til en servicekonto](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Den giver dig et klient-id og en hemmelighed frem for et token, og et workflow bytter dem til et kortlivet adgangstoken i starten af hver kørsel — den samme opbygning med to blokke, som siden om [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) bruger, hvor en **API Post (JSON)**-blok henter tokenet, og alt efter den sender `Bearer <token>`. Der er ikke noget, der skal erstattes manuelt et år senere. Atlassians side har den præcise token-forespørgsel; API'ets basis-URL er `https://api.atlassian.com`.

## Trin 2 — Åbn en Jira-sag for hver hændelse

1. Åbn **Arbejdsgange → Opret arbejdsgang**, navngiv det `Incidents → Jira`, og åbn **Bygger**.
2. Klik på den stiplede pladsholderblok og tilføj triggeren **On Create Incident**. I dens **Select Fields** beder du om de kolonner, du vil sende:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Lad dens **Identifier** blive `incident-on-create-1` — det er det navn, senere blokke refererer til den med.

3. Klik **Tilføj komponent**, tilføj en **API Post (JSON)**-blok, og træk fra triggerens **Success**-prik til den nye bloks input-prik. Åbn den, sæt dens **Identifier** til `create-issue`, og udfyld:

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

   Erstat `OPS` med din projektnøgle og `Bug` med en sagstype, der findes i det projekt. Begge kan også angives med id — `{"id": "10000"}` — hvilket er det, Atlassians egne eksempler bruger, og det, du bør foretrække, hvis to sagstyper på dit websted deler navn. `createmeta`-kaldene længere nede giver dig de id'er.

Beskrivelsen ser tung ud, fordi Jira Clouds v3-API modtager rig tekst som **Atlassian Document Format** — et dokumenttræ, ikke en streng. Formen ovenfor er det mindste gyldige dokument: ét afsnit med én tekstnode. Det samme gælder `environment` og ethvert flerlinjet brugerdefineret tekstfelt; enkeltlinjede brugerdefinerede tekstfelter tager stadig en almindelig streng.

Tænd nu for workflowet under **Oversigt → Rediger arbejdsgang → Aktiveret**, erklær en testhændelse, og åbn **Kørsler og logs**. Blokken `create-issue` bør vise en `201` og en body, der indeholder den nye sags `id`, `key` og `self`. Ændringer på lærredet gemmer sig selv — der er ingen Gem-knap, og et deaktiveret workflow kan slet ikke køre, heller ikke manuelt.

Den nye sagsnøgle er tilgængelig for enhver blok efter denne:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Udfyld flere felter

Et par almindelige tilføjelser inde i `fields`:

- **Prioritet** — `"priority": { "id": "20000" }`, med et prioritets-id fra dit websted. For at afbilde OneUptime-alvorligheder på Jira-prioriteter sætter du en **If / Else**-blok ind mellem triggeren og API-blokken og forgrener på `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Ansvarlig** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identificerer personer med Atlassian-konto-id; `username` og `userKey` blev fjernet fra Cloud-API'et for år tilbage.
- **Labels** — `"labels": ["oneuptime", "sev1"]`, et fladt array af strenge. Labels må ikke indeholde mellemrum.
- **Komponenter** — `"components": [{ "id": "10000" }]`.
- **Brugerdefinerede felter** — `"customfield_10034": "..."`, med feltets eget id. Værdiens form følger feltets type: en enkeltvalgsliste tager `{"value": "red"}`, en flervalgsliste et array af id'er, og et flerlinjet tekstfelt et Atlassian Document Format-dokument.

For at finde ud af, hvad et projekt faktisk kræver, så spørg Jira frem for at gætte. List sagstyperne i et projekt, og derefter felterne for en af dem:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

Det andet kald lister hvert eneste felt, den sagstype accepterer, hvilke af dem der er påkrævede, og de præcise `customfield_NNNNN`-id'er. For at læse id'erne af en sag, du allerede har, henter du den med `?expand=names`.

## Trin 3 — Før hændelses-id'et med over i Jira

Begge halvdele af en tovejssynkronisering kræver, at det ene system holder på det andets identifikator, og Jira er det bedste sted at gemme den: OneUptimes `customFields`-kolonne er én samlet JSON-klump, så at skrive én værdi fra et workflow erstatter alle brugerdefinerede felter på den hændelse.

**Med en Jira-administrator.** Tilføj et kort brugerdefineret tekstfelt — kald det *OneUptime Incident ID* — til projektets oprettelsesskærm, find dets id med `createmeta`, og sæt det sammen med alt det andet:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Uden en.** Læg det i en label i stedet. Labels må ikke indeholde mellemrum, og et OneUptime-id er en almindelig UUID, så `oneuptime-<id>` er en gyldig label:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

Det indgående workflow skal så plukke den label ud af listen, hvilket er et par linjer i en **Run Custom JavaScript**-blok. Det brugerdefinerede felt er pænere, hvis du kan få et.

Mens du er i gang, er det værd at tilføje et link på Jira-sagen tilbage til hændelsen. En **API Post (JSON)**-blok efter `create-issue`, rettet mod `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, med:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

giver alle i Jira en vej tilbage med ét klik. Tilføj `projectId` til triggerens **Select Fields** til dette. Det er `globalId`, der gør kaldet sikkert at gentage: Jira opdaterer det link, der allerede bærer det id, i stedet for at tilføje endnu et. Fordi en opdatering også nulstiller alt det, du udelader, skal du altid sende hele `object`, ikke en delmængde af det.

## Trin 4 — Kommentér og flyt sagen, når hændelsen ændrer sig

Byg dette som et **andet** workflow, så en fejl her aldrig kan forhindre, at der oprettes sager.

1. **Opret arbejdsgang**, navngiv det `Incident updates → Jira`, og tilføj triggeren **On Update Incident**.
2. I **Listen on** sætter du `{"currentIncidentStateId": true}`. Triggeren udløses så kun ved tilstandsændringer i stedet for ved hver redigering. I **Select Fields** beder du om `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Tilføj en **If / Else**-blok: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — eller hvad dit projekts løste tilstand nu hedder. Se [Hændelsestilstande og alvorligheder](/docs/incidents/states-and-severities).

Fra grenen **Yes** skal du først finde den sag, du oprettede i Trin 2. Bed Jira om den ved hjælp af det id, du gemte i Trin 3, med en **API Post (JSON)**-blok, hvis **Identifier** er `find-issue`:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Brugte du et brugerdefineret felt frem for en label, bliver klausulen `cf[10050] ~ \"...\"` med dit eget felt-id.

Sags-id'et er derefter `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, og hvert eneste endpoint nedenfor tager lige så gerne et id som en nøgle.

Tre ting om dette endpoint er værd at kende. **Send JQL i bodyen, læg den ikke i URL'en** — en query-streng, der indeholder `=` inde i en værdi, bliver afkortet på vej ud af et workflow, og JQL er ikke andet end `=`-tegn. **Forespørgslen skal være afgrænset**: et blot og bart `order by key desc` afvises med `400`, hvilket er grunden til, at `project =`-klausulen er der. Og `/rest/api/3/search/jql` er det aktuelle endpoint — det ældre `/rest/api/3/search` er udfaset og på vej ud, så du skal ikke gribe efter det.

**At lægge en kommentar** er en enkelt **API Post (JSON)**-blok til `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment` med en Atlassian Document Format-body ligesom beskrivelsen:

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

**At flytte sagen** kræver to kald, fordi en overgang identificeres med et id, der er forskelligt fra workflow til workflow og på nogle boards fra sag til sag.

1. En **API Get (JSON)**-blok på `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` returnerer de overgange, der er tilgængelige *fra sagens nuværende status*, hver med et `id` og et `name` samt et `to`-objekt, der navngiver den status, den fører til.
2. En **API Post (JSON)**-blok til den samme URL udfører en af dem:

   ```json
   { "transition": { "id": "31" } }
   ```

En vellykket overgang svarer `204` uden body. Vil du hellere slippe for at læse listen ved kørsel, kan du kalde den én gang manuelt for en sag i den rigtige status og hardkode id'et — husk bare, at det er bundet til det Jira-workflow, så en administrator, der redigerer Jira-workflowet, kan bryde det uden varsel.

## Indgående — Jira til OneUptime

Nu den anden retning: nogen flytter sagen til Done, og OneUptime-hændelsen skal følge med.

### Byg det modtagende workflow først

1. **Opret arbejdsgang**, navngiv det `Jira → OneUptime`, og tilføj **Webhook**-triggeren.
2. Åbn det workflows **Indstillinger** og kopiér **Webhook Secret Key**. Din URL er:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Selvhostede installationer bruger deres egen vært. Behandl URL'en som en adgangskode — enhver, der har den, kan starte workflowet — og nulstil nøglen fra den samme side, hvis den slipper ud.

3. Tilføj en **If / Else**-blok, der tjekker en delt hemmelighed, før noget andet kører. **Input 1** er `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** er `{{global.variables.JIRA_WEBHOOK_SECRET}}` — en værdi, du finder på og gemmer som en hemmelig global variabel.
4. Fra grenen **Yes** tilføjer du en **Update One Incident**-blok:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: hvad Jira-ændringen skal betyde her — som regel en tilstandsændring.

   At flytte en hændelse kræver måltilstandens id, som en **Find One Incident State**-blok med forespørgslen `{"name": "Resolved"}` giver dig som `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Skriv det ind i `currentIncidentStateId`.

Lad workflowet være aktiveret. Giv nu Jira noget at kalde.

### Send eventet fra en Jira-automatiseringsregel

1. I Jira åbner du projektets automatiseringsregler: **Space settings → Automation** på nyere tenants, **Project settings → Automation** på ældre. Til en regel, der spænder over flere projekter, bruger du **Settings → System → Global automation**, hvilket kræver den globale rettighed *Administer Jira*.
2. **Create rule**, og vælg triggeren **Work item transitioned** — **Issue transitioned** på ældre tenants. Sæt den til at køre, når statussen flyttes *til* **Done**.

   Brug denne trigger, ikke *Work item updated*: opdateringstriggeren udelader bevidst statusændringer.

3. Tilføj handlingen **Send web request** (send webforespørgsel) og konfigurér den:

   - **Web request URL**: OneUptime-webhook-URL'en ovenfra.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, og `X-OneUptime-Secret` / din delte hemmelighed. Brug **Hide**-muligheden på hemmelighedens værdi, så andre regelredaktører ikke kan læse den — bemærk, at skjulningen er uigenkaldelig for den værdi, og at skjulte værdier går tabt, hvis reglen eksporteres eller duplikeres.
   - **Web request body**: **Custom format**, så du styrer formen:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Brugte du en label i stedet for et brugerdefineret felt i Trin 3, sender du `"labels": "{{issue.labels}}"` og trækker id'et ud med en **Run Custom JavaScript**-blok på OneUptime-siden.

4. Tænd for reglen, flyt en testsag til Done, og tjek begge sider: reglens egen revisionslog i Jira og **Kørsler og logs** i OneUptime.

Ting, der er værd at vide, før du gør dig afhængig af dette:

- **Destinationsporten er begrænset.** Send web request når kun portene 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 og 9900. OneUptime Cloud kører på 443; en selvhostet installation på en usædvanlig port kan ikke kaldes på denne måde.
- **Der er ingen signering af forespørgsler.** Handlingen har ingen HMAC-mulighed, så en delt hemmelighed i en header over HTTPS er den mekanisme, Atlassian dokumenterer. **If / Else**-tjekket i trin 3 i det modtagende workflow er det, der gør den værd at have.
- **Regelkørsler måles.** Jira Cloud tæller vellykkede regeleksekveringer mod et månedligt forbrug, der afhænger af din plan — 100 på Free, 1.700 på Standard, 1.000 × brugere på Premium, ubegrænset på Enterprise. En regel, der udløses ved hver eneste overgang i et travlt projekt, løber hurtigt op.
- **Værdier bliver ikke URL-enkodet** for dig. Det betyder kun noget, hvis du sender en formularenkodet body; JSON'en ovenfor er fin.
- **Atlassian offentliggør sine udgående IP-intervaller** på [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com), hvis din OneUptime-installation ligger bag en tilladelsesliste. De ændrer sig, så hent feedet løbende frem for at fastlåse adresser.

### Eller brug en Jira-webhook i stedet

En Jira-administrator kan registrere en webhook direkte under **Settings → System → Advanced → WebHooks**, vælge de events, der skal sendes, og eventuelt en JQL-forespørgsel, der indsnævrer, hvilke sager der udløser den. Sammenlignet med en automatiseringsregel:

- Payloaden er Jiras egen, ikke din: `webhookEvent`, `issue_event_type_name`, hele `issue` og et `changelog`, hvis `items`-array indeholder før-og-efter for hvert ændret felt. Ved en statusændring vil du have det element, hvor `field` er `status`. At læse det inde i et workflow betyder som regel en **Run Custom JavaScript**-blok.
- Webhooks **kan** signeres — giv webhooken en hemmelighed, og Jira sender en `X-Hub-Signature`-header med en HMAC af forespørgslens body — men et workflow kan ikke tjekke den. Signaturen dækker præcis de bytes, Jira sendte, og Webhook-triggeren giver workflowet en body, der allerede er parset til JSON, så der er ikke noget tilbage at hashe. Vil du have forespørgslen autentificeret, så brug en automatiseringsregel med en header med en delt hemmelighed i stedet.
- URL'en skal være HTTPS på en port fra Jiras egen liste, som *ikke* er den samme liste, som automatiseringshandlingen bruger — port 80 er ikke tilladt her.
- Levering forsøges op til fem gange med fem til femten minutters ventetid, så dit workflow skal kunne tåle, at det samme event ankommer to gange.

Webhooks, som en app registrerer gennem `/rest/api/3/webhook`, er igen noget helt andet: de udløber 30 dage efter registreringen, medmindre de fornyes. De administratorregistrerede ovenfor udløber ikke.

## Jira Data Center

Selvadministreret Jira fungerer på samme måde med en håndfuld udskiftninger. **Jira Server** nåede end of support i februar 2024 og får ingen rettelser, så betragt Data Center som målet for selvadministration.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — der er ingen v3 på Data Center                           |
| `description` som et Atlassian Document Format-dokument | `description` som en almindelig streng i wiki-markup                    |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| API-token fra id.atlassian.com                    | **Profile → Personal access tokens → Create token** på din egen Jira-konto   |
| Automatiseringshandlingen **Send web request**    | Automatiseringshandlingen **Send outgoing web request**                      |

Blokken, der opretter sagen, bliver altså en `POST` til `/rest/api/2/issue` med:

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

hvilket er enklere at lave skabelon af — intet dokumenttræ.

Andre forskelle, du bør planlægge efter:

- **Personal access tokens** findes fra Jira Core og Jira Software 8.14 og Jira Service Management 4.15. De udløber — 365 dage som standard — og brugerfladen markerer et token som *Expires soon* fem dage før. Basic auth med brugernavn og adgangskode virker stadig på Data Center, men nogle få mislykkede logins udløser en CAPTCHA, der låser kontoen helt ude af REST-API'et, indtil et menneske rydder den i en browser, hvilket er en dårlig måde at opdage en tastefejl på. Foretræk et token.
- **Automation er indbygget** fra Jira Data Center 10.0. Før det var det den separat installerede app Automation for Jira. Dens udgående forespørgsel har en standardtimeout på 3000 ms, som kan justeres med egenskaben `outgoing.webhook.timeout.ms`.
- **Webhooks** registreres under **Administration → System → Advanced → WebHooks**, og JQL-afgrænsning understøttes. Hold de filtre snævre: Jira evaluerer hver eneste registreret webhooks JQL på den tråd, der rejste eventet, så et dusin løse filtre gør den brugerhandling, der udløste dem, langsommere.
- **Fra Data Center 10.0 er webhook-levering asynkron**, og der er ingen synkron mulighed, så events kan ankomme i uorden. Gør det modtagende workflow idempotent.
- **Jira 10 droppede `$`-tegnet i webhook-URL-variabler** — `${issue.id}` blev til `{issue.id}` — og flyttede webhook-REST-ressourcen fra `/rest/webhooks/1.0/webhook` til `/rest/jira-webhook/1.0/webhooks`.

## Det samme for alarmer

Alt ovenstående er skrevet omkring hændelser, fordi det er det almindelige tilfælde, men alarmer fungerer på nøjagtig samme måde — skift posttypen ud, og intet andet ændrer sig:

| Hændelse                                 | Alarm                                       |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

Et workflow har præcis én trigger, så hændelser og alarmer kræver ét workflow hver. Skal de to gøre det samme arbejde, så byg Jira-halvdelen én gang og kald den fra begge med komponenten **Execute Workflow**.

## Fejlfinding

Åbn den fejlende blok i **Kørsler og logs** først. Jira returnerer en JSON-body, der navngiver præcis det, den afviste, og API-komponenten gemmer den i `response-body`.

**`401 Unauthorized`.** Genkod `email:api_token` med `printf` og opdater `JIRA_AUTH`; et afsluttende linjeskift fra `echo` er den sædvanlige årsag. Bekræft derefter, at den konto, der ejer tokenet, kan oprette sager i det projekt. På Data Center skal du tjekke, at du sender `Bearer`, ikke `Basic`.

**`400 Bad Request`, der navngiver et felt.** Sagstypen findes ikke i projektet, eller projektet har et påkrævet felt, du ikke sender. Kør `createmeta`-kaldene ovenfor mod det projekt og den sagstype, og sammenlign.

**`400`, der brokker sig over `description`.** På Cloud v3 skal beskrivelsen være et Atlassian Document Format-dokument, ikke en streng. Send enten dokumentet vist ovenfor, eller skift den blok til `/rest/api/2/issue` og send almindelig tekst.

**`404 Not Found`.** Tjek basis-URL'en og API-versionen — `/rest/api/3/...` på Cloud, `/rest/api/2/...` på Data Center.

**`429 Too Many Requests`.** Jira begrænser hastigheden. Svaret indeholder `Retry-After` i sekunder og en `RateLimit-Reason`, der navngiver, hvilken grænse du ramte. Skrivninger mod en enkelt sag er stramt begrænsede — i størrelsesordenen tyve på to sekunder — så et workflow, der kommenterer og flytter sagen i hurtig rækkefølge, kan udløse det på én sag alene. Sæt en **Delay**-blok ind mellem kaldene, eller flyt massearbejde til et planlagt workflow.

**Overgangskaldet returnerer `400`.** Overgangs-id'et er ikke gyldigt fra sagens *nuværende* status. Hent `/transitions` for den sag og brug et id fra svaret.

**Automatiseringsreglen vises som vellykket, men intet når frem til OneUptime.** Tjek porten først — se den begrænsede liste ovenfor. Send derefter selv en forespørgsel til webhook-URL'en med `curl` og se, om den dukker op i **Kørsler og logs**; hvis din ankommer, og Jiras ikke gør, ligger problemet hos Jira.

**Workflowet kører, men hændelsen ændrer sig ikke.** En **Update One Incident**-blok melder `Items Updated: 0`, når dens forespørgsel ikke matchede noget, og det tæller som succes, ikke som en fejl. Tjek, at id'et i payloaden virkelig er OneUptime-hændelsens id, og at du forespørger på `_id`.

**En `{{...}}`-reference dukker op ordret i en Jira-sag.** En uopløst reference sendes videre som tekst frem for at blive tømt. Kørselsloggen navngiver enhver reference, der ikke blev opløst — som regel en fejlskrevet blok-identifier eller en omdøbt variabel.

## Læs videre

- [Integrationsoversigt](/docs/integrations/index) — de indgående og udgående mønstre samt autentificeringsoversigten.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — den samme tovejsopbygning mod Dynamics.
- [Workflows – Oversigt](/docs/workflows/index) og [Opret et workflow](/docs/workflows/authoring) — lærredet, identifiers og hvordan du tænder for et workflow.
- [Komponenter](/docs/workflows/components) — API-blokkene, If / Else og OneUptime-datakomponenterne.
- [Variabler](/docs/workflows/variables) — hemmeligheder og aflæsning af én bloks output i den næste.
- [Konfiguration & sikkerhed](/docs/workflows/configuration) — webhook-sikkerhed og udgående netværksadgang.
- [ServiceNow](/docs/integrations/servicenow) og [PagerDuty](/docs/integrations/pagerduty) — det samme udgående mønster for andre værktøjer.
