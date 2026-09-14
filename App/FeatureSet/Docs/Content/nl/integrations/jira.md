# Jira-integratie

Open een [Jira](https://www.atlassian.com/software/jira)-issue zodra er een OneUptime-incident wordt uitgeroepen, houd hem gelijk terwijl het incident verschuift, en laat Jira statuswijzigingen terugduwen naar OneUptime — allemaal met een [Workflow](/docs/workflows/index). Er is geen Jira-specifiek blok te installeren: OneUptime roept de REST API van Jira aan met het [API-component](/docs/workflows/components#api), en Jira roept terug naar een [Webhook trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Deze pagina bouwt beide richtingen. Alles tot aan de inbound-sectie is geschreven voor **Jira Cloud**; een sectie tegen het eind noemt wat er anders is op **Jira Data Center**.

> Atlassian hernoemt de laatste tijd van alles in Jira Cloud: een **project** heet in een groot deel van de UI nu een **space**, en een **issue** is een **work item**. Tenants zitten op beide woordenlijsten, dus waar de formulering hieronder uitmaakt, vind je ze allebei.

## Vereisten

- Een Jira Cloud-site (`https://your-domain.atlassian.net`) en een project om issues in te registreren. Noteer de **projectsleutel** — de `OPS` in `OPS-1234`.
- Een Jira-account dat issues in dat project kan aanmaken, en een **API-token** ervoor van [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Gebruik een serviceaccount in plaats van dat van een persoon — zo aangemaakte issues worden toegeschreven aan de eigenaar van het token.
- Rechten om automation rules in dat project aan te maken, voor de inbound-helft.
- Een OneUptime-project waar je workflows en globale variabelen kunt aanmaken.

## Stap 1 — Sla de Jira-gegevens op als een geheim

De REST API van Jira Cloud gebruikt **Basic auth**, opgebouwd uit je Atlassian-accountmail en een API-token, samen base64-gecodeerd.

1. Codeer `email:api_token` één keer:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Gebruik `printf`, niet `echo`. `echo` voegt een regelafbreking toe, die regelafbreking wordt mee gecodeerd, en Jira antwoordt met `401` om redenen die onzichtbaar zijn in de string die je hebt geplakt.

2. Ga in OneUptime naar **Workflows → Globale variabelen → Aanmaken**. Geef hem de naam `JIRA_AUTH`, plak de base64-string als **Inhoud**, en zet **Geheim** aan.
3. Voeg een tweede, niet-geheime variabele `JIRA_URL` toe met `https://your-domain.atlassian.net` zonder afsluitende slash.

Elk blok kan nu `Basic {{global.variables.JIRA_AUTH}}` als `Authorization`-header gebruiken, en het token verschijnt nooit in de workflow of de runlogboeken. Zie [Variabelen](/docs/workflows/variables).

Twee dingen over Atlassian-API-tokens die een integratie waar niemand naar kijkt vroeg of laat opbreken:

- **Ze verlopen.** Tokens worden aangemaakt met een levensduur van één dag tot één jaar, standaard één jaar, en er is geen verversing — een verlopen token moet met de hand op dezelfde pagina worden vervangen en opnieuw in `JIRA_AUTH` worden gecodeerd. Zet de vervaldatum ergens in een agenda. Begint een workflow die maandenlang werkte ineens met `401` te antwoorden, dan is dit de reden.
- **Een scoped token heeft een andere basis-URL nodig.** De tokenpagina biedt naast het klassieke **Create API token** ook **Create API token with scopes**. Scoped tokens zijn de veiligere keuze, maar ze zijn niet op je site geadresseerd: ze gaan naar `https://api.atlassian.com/ex/jira/<cloudId>`, dus `JIRA_URL` wordt dat in plaats daarvan, en elk pad hieronder hangt er onveranderd achter. Je `cloudId` staat in de JSON op `https://your-domain.atlassian.net/_edge/tenant_info`. Een scoped token dat naar `your-domain.atlassian.net` wordt gestuurd, mislukt gewoon.

Zit je organisatie op Atlassians centrale gebruikersbeheer, dan is er een derde optie die het vervalprobleem omzeilt: een [OAuth 2.0-credential voor een serviceaccount](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Die geeft je een client-id en -secret in plaats van een token, en een workflow wisselt ze aan het begin van elke run om voor een kortlevend access token — dezelfde vorm met twee blokken die de pagina [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) gebruikt, met een **API Post (JSON)**-blok dat het token ophaalt en alles daarna dat `Bearer <token>` meestuurt. Er hoeft een jaar later niets met de hand te worden vervangen. De pagina van Atlassian bevat het exacte tokenverzoek; de basis-URL van de API is `https://api.atlassian.com`.

## Stap 2 — Open een Jira-issue voor elk incident

1. Open **Workflows → Workflow maken**, geef het de naam `Incidents → Jira`, en open de **Bouwer**.
2. Klik op het gestippelde plaatshouderblok en voeg de trigger **On Create Incident** toe. Vraag in zijn **Select Fields** om de kolommen die je wilt meesturen:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Laat zijn **Identifier** op `incident-on-create-1` staan — dat is de naam waarmee latere blokken ernaar verwijzen.

3. Klik op **Component toevoegen**, voeg een **API Post (JSON)**-blok toe, en sleep van de **Succes**-stip van de trigger naar de invoerstip van het nieuwe blok. Open het, zet zijn **Identifier** op `create-issue`, en vul in:

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

   Vervang `OPS` door je projectsleutel en `Bug` door een issuetype dat in dat project bestaat. Beide kun je ook per id opgeven — `{"id": "10000"}` — wat Atlassian in zijn eigen voorbeelden doet en waar je de voorkeur aan moet geven als twee issuetypes op je site dezelfde naam hebben. De `createmeta`-aanroepen verderop geven je die id's.

De beschrijving oogt zwaar omdat de v3-API van Jira Cloud rijke tekst aanneemt als **Atlassian Document Format** — een documentboom, geen string. De vorm hierboven is het minimale geldige document: één alinea met één tekstknoop. Hetzelfde geldt voor `environment` en voor elk aangepast tekstveld met meerdere regels; aangepaste tekstvelden van één regel accepteren nog steeds een gewone string.

Zet de workflow nu aan via **Overzicht → Workflow bewerken → Ingeschakeld**, roep een testincident uit, en open **Runs & logboeken**. Het blok `create-issue` hoort een `201` te tonen en een body met de `id`, `key` en `self` van de nieuwe issue. Wijzigingen op het canvas slaan zichzelf op — er is geen opslaanknop, en een uitgeschakelde workflow kan helemaal niet draaien, ook niet met de hand.

De key van de nieuwe issue is beschikbaar voor elk blok na dit blok:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Meer velden invullen

Een paar veelgebruikte toevoegingen binnen `fields`:

- **Priority** — `"priority": { "id": "20000" }`, met een prioriteits-id van je site. Wil je OneUptime-ernstniveaus op Jira-prioriteiten mappen, zet dan een **If / Else**-blok tussen de trigger en het API-blok en vertak op `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Assignee** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identificeert mensen aan de hand van hun Atlassian-account-id; `username` en `userKey` zijn jaren geleden uit de Cloud-API verwijderd.
- **Labels** — `"labels": ["oneuptime", "sev1"]`, een platte array van strings. Labels mogen geen spaties bevatten.
- **Components** — `"components": [{ "id": "10000" }]`.
- **Aangepaste velden** — `"customfield_10034": "..."`, met de eigen id van het veld. De vorm van de waarde volgt het type van het veld: een single-select neemt `{"value": "red"}`, een multi-select een array van id's, en een tekstveld met meerdere regels een Atlassian Document Format-document.

Om te achterhalen wat een project daadwerkelijk vereist, vraag je het aan Jira in plaats van te gokken. Vraag de issuetypes in een project op, en daarna de velden voor één ervan:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

De tweede aanroep somt elk veld op dat dat issuetype accepteert, welke ervan verplicht zijn, en de exacte `customfield_NNNNN`-id's. Wil je de id's aflezen van een issue die je al hebt, haal die dan op met `?expand=names`.

## Stap 3 — Neem het incident-id mee naar Jira

Beide helften van een bidirectionele synchronisatie hebben één systeem nodig dat de identifier van het andere bewaart, en Jira is daar de betere plek voor: de kolom `customFields` van OneUptime is één JSON-blob, dus één waarde wegschrijven vanuit een workflow vervangt elk aangepast veld op dat incident.

**Met een Jira-beheerder.** Voeg een kort aangepast tekstveld toe — noem het *OneUptime Incident ID* — aan het aanmaakscherm van het project, zoek de id ervan op met `createmeta`, en zet het naast al het andere:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Zonder beheerder.** Zet het dan in een label. Labels mogen geen spaties bevatten, en een OneUptime-id is een gewone UUID, dus `oneuptime-<id>` is een geldig label:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

De inbound-workflow moet dat label dan uit de lijst vissen, wat een paar regels in een **Run Custom JavaScript**-blok kost. Het aangepaste veld is netter als je er een kunt krijgen.

Nu je toch bezig bent, is het de moeite waard om op de Jira-issue een link terug naar het incident te zetten. Een **API Post (JSON)**-blok na `create-issue`, gericht op `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, met:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

geeft iedereen in Jira een route terug met één klik. Voeg hiervoor `projectId` toe aan de **Select Fields** van de trigger. De `globalId` is wat de aanroep veilig herhaalbaar maakt: Jira werkt de link bij die die id al draagt in plaats van er een tweede toe te voegen. Omdat een update ook alles leegmaakt wat je weglaat, stuur je altijd het hele `object` mee, niet een deel ervan.

## Stap 4 — Reageren en overzetten terwijl het incident verschuift

Bouw dit als een **tweede** workflow, zodat een fout hier nooit kan verhinderen dat er issues worden geopend.

1. **Workflow maken**, geef het de naam `Incident updates → Jira`, en voeg de trigger **On Update Incident** toe.
2. Zet in **Listen on** `{"currentIncidentStateId": true}`. De trigger vuurt dan alleen af bij statuswijzigingen in plaats van bij elke bewerking. Vraag in **Select Fields** om `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Voeg een **If / Else**-blok toe: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — of hoe de opgeloste status in jouw project ook heet. Zie [Incidentstatussen en ernstniveaus](/docs/incidents/states-and-severities).

Vanaf de tak **Yes** moet je eerst de issue vinden die je in Stap 2 hebt geopend. Vraag hem bij Jira op met de id die je in Stap 3 hebt opgeslagen, via een **API Post (JSON)**-blok met als **Identifier** `find-issue`:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Heb je een aangepast veld gebruikt in plaats van een label, dan wordt de clausule `cf[10050] ~ \"...\"` met je eigen veld-id.

De issue-id is dan `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, en elk eindpunt hieronder neemt net zo graag een id als een key aan.

Drie dingen over dit eindpunt zijn het weten waard. **Post de JQL, zet hem niet in de URL** — een querystring met een `=` binnen een waarde wordt op weg naar buiten uit een workflow afgekapt, en JQL bestaat uit niets dan `=`-tekens. **De query moet afgebakend zijn**: een kaal `order by key desc` wordt afgewezen met `400`, en daarom staat de clausule `project =` erin. En `/rest/api/3/search/jql` is het huidige eindpunt — het oudere `/rest/api/3/search` is verouderd en verdwijnt, dus grijp daar niet naar.

**Een reactie achterlaten** is één **API Post (JSON)**-blok naar `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, met een Atlassian Document Format-body net als de beschrijving:

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

**De issue verplaatsen** kost twee aanroepen, omdat een transition wordt geïdentificeerd door een id die per workflow verschilt en op sommige boards zelfs per issue.

1. Een **API Get (JSON)**-blok op `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` geeft de transitions terug die beschikbaar zijn *vanaf de huidige status van de issue*, elk met een `id` en een `name`, en een `to`-object dat de status noemt waar het naartoe leidt.
2. Een **API Post (JSON)**-blok naar dezelfde URL voert er een uit:

   ```json
   { "transition": { "id": "31" } }
   ```

Een geslaagde transition antwoordt met `204` zonder body. Wil je de lijst liever niet tijdens de run uitlezen, roep hem dan één keer met de hand aan voor een issue in de juiste status en codeer de id hard — onthoud alleen dat hij aan die workflow vastzit, dus een beheerder die de Jira-workflow bewerkt kan hem stilletjes breken.

## Inbound — Jira naar OneUptime

Nu de andere richting: iemand zet de issue op Done, en het OneUptime-incident hoort te volgen.

### Bouw eerst de ontvangende workflow

1. **Workflow maken**, geef het de naam `Jira → OneUptime`, en voeg de trigger **Webhook** toe.
2. Open de **Instellingen** van die workflow en kopieer de **Webhook Secret Key**. Je URL is:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Zelfgehoste installaties gebruiken hun eigen host. Behandel de URL als een wachtwoord — iedereen die hem heeft, kan de workflow starten — en reset de sleutel vanaf diezelfde pagina als hij uitlekt.

3. Voeg een **If / Else**-blok toe dat een gedeeld geheim controleert voordat er iets anders draait. **Input 1** is `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** is `{{global.variables.JIRA_WEBHOOK_SECRET}}` — een waarde die je zelf verzint en als geheime globale variabele opslaat.
4. Voeg vanaf de tak **Yes** een **Update One Incident**-blok toe:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: wat de Jira-wijziging hier moet betekenen — meestal een statuswijziging.

   Een incident verplaatsen vereist de id van de doelstatus, die je krijgt van een **Find One Incident State**-blok met de query `{"name": "Resolved"}` als `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Schrijf die naar `currentIncidentStateId`.

Laat de workflow ingeschakeld staan. Geef Jira nu iets om aan te roepen.

### Stuur het event vanuit een Jira automation rule

1. Open in Jira de automation rules van het project: **Space settings → Automation** op nieuwere tenants, **Project settings → Automation** op oudere. Voor een regel die meerdere projecten omspant gebruik je **Settings → System → Global automation**, waarvoor je de globale permissie *Administer Jira* nodig hebt.
2. **Create rule**, en kies de trigger **Work item transitioned** — **Issue transitioned** op oudere tenants. Stel hem zo in dat hij draait wanneer de status *naar* **Done** verschuift.

   Gebruik deze trigger, niet *Work item updated*: de updatetrigger sluit statuswijzigingen bewust uit.

3. Voeg de actie **Send web request** toe en configureer hem:

   - **Web request URL**: de OneUptime-webhook-URL van hierboven.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, en `X-OneUptime-Secret` / je gedeelde geheim. Gebruik de optie **Hide** op de waarde van het geheim zodat andere regelbewerkers hem niet kunnen lezen — let op: verbergen is onomkeerbaar voor die waarde, en verborgen waarden gaan verloren als de regel wordt geëxporteerd of gedupliceerd.
   - **Web request body**: **Custom format**, zodat jij de vorm bepaalt:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Heb je in Stap 3 een label gebruikt in plaats van een aangepast veld, stuur dan `"labels": "{{issue.labels}}"` en haal de id er aan de OneUptime-kant uit met een **Run Custom JavaScript**-blok.

4. Zet de regel aan, verplaats een testissue naar Done, en controleer beide kanten: het audit log van de regel zelf in Jira, en **Runs & logboeken** in OneUptime.

Dingen die het weten waard zijn voordat je hierop vertrouwt:

- **De bestemmingspoort is beperkt.** Send web request bereikt alleen de poorten 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 en 9900. OneUptime Cloud draait op 443; een zelfgehoste installatie op een ongebruikelijke poort kan zo niet worden aangeroepen.
- **Er is geen ondertekening van verzoeken.** De actie heeft geen HMAC-optie, dus een gedeeld geheim in een header over HTTPS is het mechanisme dat Atlassian documenteert. De **If / Else**-controle in Stap 3 van de ontvangende workflow is wat dat de moeite waard maakt.
- **Regeluitvoeringen worden geteld.** Jira Cloud telt geslaagde regeluitvoeringen mee in een maandelijks tegoed dat van je abonnement afhangt — 100 op Free, 1.700 op Standard, 1.000 × gebruikers op Premium, onbeperkt op Enterprise. Een regel die bij elke transition in een druk project afvuurt, telt op.
- **Waarden worden niet voor je URL-gecodeerd.** Dat maakt alleen uit als je een form-encoded body stuurt; de JSON hierboven is prima.
- **Atlassian publiceert zijn uitgaande IP-reeksen** op [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) als je OneUptime-installatie achter een acceptatielijst zit. Ze veranderen, dus poll de feed in plaats van adressen vast te zetten.

### Of gebruik in plaats daarvan een Jira-webhook

Een Jira-beheerder kan rechtstreeks een webhook registreren onder **Settings → System → Advanced → WebHooks**, waarbij hij kiest welke events worden verstuurd en optioneel een JQL-query die beperkt welke issues hem afvuren. Vergeleken met een automation rule:

- De payload is die van Jira, niet die van jou: `webhookEvent`, `issue_event_type_name`, de volledige `issue`, en een `changelog` waarvan de `items`-array het voor en na van elk gewijzigd veld bevat. Voor een statuswijziging wil je het item waarvan `field` gelijk is aan `status`. Dat binnen een workflow uitlezen betekent meestal een **Run Custom JavaScript**-blok.
- Webhooks **kunnen** wél worden ondertekend — geef de webhook een geheim en Jira stuurt een `X-Hub-Signature`-header met een HMAC van de body van het verzoek — maar een workflow kan die niet controleren. De handtekening dekt precies de bytes die Jira verstuurde, en de Webhook trigger geeft de workflow een body die al tot JSON is geparseerd, dus er blijft niets over om te hashen. Wil je het verzoek geauthenticeerd hebben, gebruik dan een automation rule met een header met een gedeeld geheim.
- De URL moet HTTPS zijn op een poort uit Jira's eigen lijst, en dat is *niet* dezelfde lijst als die de automation-actie gebruikt — poort 80 is hier niet toegestaan.
- Aflevering wordt tot vijf keer opnieuw geprobeerd met een backoff van vijf tot vijftien minuten, dus je workflow moet ertegen kunnen dat hetzelfde event twee keer aankomt.

Webhooks die een app registreert via `/rest/api/3/webhook` zijn weer iets anders: die verlopen 30 dagen na registratie tenzij ze worden ververst. De hierboven genoemde, door een beheerder geregistreerde webhooks verlopen niet.

## Jira Data Center

Zelf beheerd Jira werkt op dezelfde manier, met een handvol vervangingen. **Jira Server** kreeg in februari 2024 zijn einde van ondersteuning en krijgt geen fixes meer, dus behandel Data Center als het zelfbeheerde doel.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — er is geen v3 op Data Center                             |
| `description` als een Atlassian Document Format-doc | `description` als een gewone string in wiki-markup                          |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| API-token van id.atlassian.com                    | **Profile → Personal access tokens → Create token** op je eigen Jira-account |
| Automation-actie **Send web request**             | Automation-actie **Send outgoing web request**                               |

Het create-issue-blok wordt dus een `POST` naar `/rest/api/2/issue` met:

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

wat eenvoudiger te templaten is — geen documentboom.

Andere verschillen om rekening mee te houden:

- **Personal access tokens** bestaan vanaf Jira Core en Jira Software 8.14 en Jira Service Management 4.15. Ze verlopen — standaard na 365 dagen — en de UI markeert er een vijf dagen van tevoren als *Expires soon*. Basic auth met een gebruikersnaam en wachtwoord werkt nog steeds op Data Center, maar een paar mislukte aanmeldingen activeren een CAPTCHA die het account volledig buitensluit van de REST API totdat een mens hem in een browser wegwerkt, en dat is een vervelende manier om een typefout te ontdekken. Geef de voorkeur aan een token.
- **Automation zit erin gebundeld** vanaf Jira Data Center 10.0. Daarvoor was het de apart te installeren app Automation for Jira. Zijn uitgaande verzoek heeft een standaardtime-out van 3000 ms, af te stellen met de eigenschap `outgoing.webhook.timeout.ms`.
- **Webhooks** registreer je op **Administration → System → Advanced → WebHooks**, en JQL-afbakening wordt ondersteund. Houd die filters smal: Jira evalueert de JQL van elke geregistreerde webhook op de thread die het event veroorzaakte, dus een dozijn losse filters vertraagt de gebruikersactie die ze in gang zette.
- **Vanaf Data Center 10.0 is webhookaflevering asynchroon** en er is geen synchrone optie, dus events kunnen in de verkeerde volgorde aankomen. Maak de ontvangende workflow idempotent.
- **Jira 10 liet de `$` in webhook-URL-variabelen vallen** — `${issue.id}` werd `{issue.id}` — en verplaatste de webhook-REST-resource van `/rest/webhooks/1.0/webhook` naar `/rest/jira-webhook/1.0/webhooks`.

## Hetzelfde doen voor alerts

Alles hierboven is rond incidenten geschreven omdat dat het gangbare geval is, maar alerts werken identiek — verwissel het recordtype en er verandert verder niets:

| Incident                                 | Alert                                       |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

Een workflow heeft precies één trigger, dus incidenten en alerts vragen elk om een eigen workflow. Zouden de twee hetzelfde werk doen, bouw dan de Jira-helft één keer en roep hem vanuit beide aan met het component **Execute Workflow**.

## Probleemoplossing

Open eerst het mislukte blok in **Runs & logboeken**. Jira geeft een JSON-body terug die precies noemt wat het afwees, en het API-component bewaart die in `response-body`.

**`401 Unauthorized`.** Hercodeer `email:api_token` met `printf` en werk `JIRA_AUTH` bij; een afsluitende regelafbreking van `echo` is de gebruikelijke oorzaak. Bevestig daarna dat het account dat het token bezit issues in dat project kan aanmaken. Controleer op Data Center of je `Bearer` verstuurt en niet `Basic`.

**`400 Bad Request` met vermelding van een veld.** Het issuetype bestaat niet in het project, of het project heeft een verplicht veld dat je niet meestuurt. Voer de `createmeta`-aanroepen hierboven uit tegen dat project en issuetype en vergelijk.

**`400` met een klacht over `description`.** Op Cloud v3 moet de beschrijving een Atlassian Document Format-document zijn, geen string. Stuur ofwel het document hierboven, ofwel schakel dat blok om naar `/rest/api/2/issue` en stuur platte tekst.

**`404 Not Found`.** Controleer de basis-URL en de API-versie — `/rest/api/3/...` op Cloud, `/rest/api/2/...` op Data Center.

**`429 Too Many Requests`.** Jira beperkt de aanroepsnelheid. Het antwoord bevat `Retry-After` in seconden en een `RateLimit-Reason` die noemt welke limiet je raakte. Schrijfacties op één issue zijn strak begrensd — in de orde van twintig in twee seconden — dus een workflow die snel achter elkaar reageert en overzet kan het al op één issue laten struikelen. Zet een **Delay**-blok tussen de aanroepen, of verplaats bulkwerk naar een geplande workflow.

**De transition-aanroep geeft `400` terug.** De transition-id is niet geldig vanaf de *huidige* status van de issue. Haal `/transitions` op voor die issue en gebruik een id uit het antwoord.

**De automation rule toont zich als geslaagd, maar er komt niets aan in OneUptime.** Controleer eerst de poort — zie de lijst met beperkingen hierboven. Stuur daarna zelf een verzoek naar de webhook-URL met `curl` en kijk of het in **Runs & logboeken** verschijnt; komt dat van jou wel aan en dat van Jira niet, dan zit het probleem aan de kant van Jira.

**De workflow draait, maar het incident verandert niet.** Een **Update One Incident**-blok meldt `Items Updated: 0` wanneer zijn query niets matchte, en dat telt als succes, niet als fout. Controleer of de id in de payload echt het OneUptime-incident-id is en of je op `_id` bevraagt.

**Een `{{...}}`-verwijzing verschijnt letterlijk in een Jira-issue.** Een niet-opgeloste verwijzing wordt als tekst doorgegeven in plaats van leeggemaakt. Het runlogboek noemt elke verwijzing die niet oploste — meestal een verkeerd getypte blok-identifier of een hernoemde variabele.

## Waar verder lezen

- [Integraties – Overzicht](/docs/integrations/index) — de inbound- en outbound-patronen en het authenticatie-spiekbriefje.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — dezelfde bouw in twee richtingen, maar dan tegen Dynamics.
- [Workflows – Overzicht](/docs/workflows/index) en [Een workflow maken](/docs/workflows/authoring) — het canvas, identifiers, en een workflow aanzetten.
- [Componenten](/docs/workflows/components) — de API-blokken, If / Else, en de OneUptime-datacomponenten.
- [Variabelen](/docs/workflows/variables) — geheimen, en de uitvoer van het ene blok in het volgende lezen.
- [Workflow-configuratie en veiligheid](/docs/workflows/configuration) — webhookbeveiliging en uitgaande netwerktoegang.
- [ServiceNow](/docs/integrations/servicenow) en [PagerDuty](/docs/integrations/pagerduty) — hetzelfde outbound-patroon voor andere tools.
