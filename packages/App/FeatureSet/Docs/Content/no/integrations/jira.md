# Jira-integrasjon

Åpne en [Jira](https://www.atlassian.com/software/jira)-sak hver gang en OneUptime-hendelse opprettes, hold den i takt mens hendelsen utvikler seg, og la Jira sende statusendringer tilbake til OneUptime — alt sammen med en [arbeidsflyt](/docs/workflows/index). Det finnes ingen Jira-spesifikk blokk å installere: OneUptime kaller Jiras REST API med [API-komponenten](/docs/workflows/components#api), og Jira kaller tilbake inn i en [Webhook-trigger](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Denne siden bygger begge retningene. Alt fram til den innkommende seksjonen er skrevet for **Jira Cloud**; en seksjon mot slutten lister opp hva som er annerledes på **Jira Data Center**.

> Atlassian har holdt på med å døpe om ting i Jira Cloud: et **project** heter nå **space** i store deler av grensesnittet, og en **issue** er et **work item**. Tenanter finnes med begge ordforrådene, så der ordvalget betyr noe nedenfor, finner du begge.

## Forutsetninger

- Et Jira Cloud-nettsted (`https://your-domain.atlassian.net`) og et prosjekt å registrere saker i. Noter deg **prosjektnøkkelen** — `OPS`-delen i `OPS-1234`.
- En Jira-konto som kan opprette saker i det prosjektet, og et **API-token** for den fra [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Bruk en tjenestekonto framfor en persons konto — saker som opprettes på denne måten, tilskrives den som eier tokenet.
- Rettigheter til å opprette automatiseringsregler i det prosjektet, for den innkommende halvdelen.
- Et OneUptime-prosjekt der du kan opprette arbeidsflyter og globale variabler.

## Steg 1 — Lagre Jira-legitimasjonen som en hemmelighet

Jira Clouds REST API bruker **Basic auth** bygget av Atlassian-kontoens e-postadresse og et API-token, base64-kodet sammen.

1. Kod `email:api_token` én gang:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Bruk `printf`, ikke `echo`. `echo` legger til en nylinje, nylinjen kodes sammen med alt det andre, og Jira svarer `401` av grunner som er usynlige i strengen du limte inn.

2. I OneUptime går du til **Arbeidsflyter → Globale variabler → Opprett**. Gi den navnet `JIRA_AUTH`, lim inn base64-strengen som **Content**, og slå på **Secret**.
3. Legg til en andre, ikke-hemmelig variabel `JIRA_URL` som inneholder `https://your-domain.atlassian.net` uten etterfølgende skråstrek.

Nå kan enhver blokk bruke `Basic {{global.variables.JIRA_AUTH}}` som sin `Authorization`-header, og tokenet dukker aldri opp i arbeidsflyten eller kjøreloggene. Se [Variabler](/docs/workflows/variables).

To ting ved Atlassians API-tokener som før eller siden vil ramme en integrasjon ingen holder øye med:

- **De utløper.** Tokener opprettes med en levetid fra én dag til ett år, ett år som standard, og det finnes ingen fornyelse — et utløpt token må erstattes for hånd på den samme siden og kodes inn i `JIRA_AUTH` på nytt. Legg utløpsdatoen inn i en kalender et sted. Når en arbeidsflyt som har fungert i månedsvis, plutselig begynner å svare `401`, er dette grunnen.
- **Et scopet token trenger en annen basis-URL.** Tokensiden tilbyr **Create API token with scopes** i tillegg til den klassiske **Create API token**. Scopede tokener er det sikreste valget, men de er ikke adressert til nettstedet ditt: de går til `https://api.atlassian.com/ex/jira/<cloudId>`, så `JIRA_URL` blir den i stedet, og hver eneste sti nedenfor henger uendret på den. `cloudId`-en din finner du i JSON-en på `https://your-domain.atlassian.net/_edge/tenant_info`. Et scopet token sendt til `your-domain.atlassian.net` feiler ganske enkelt.

Er organisasjonen din på Atlassians sentraliserte brukeradministrasjon, finnes det et tredje alternativ som omgår utløpsproblemet: en [OAuth 2.0-legitimasjon for en tjenestekonto](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Den gir deg en klient-id og en hemmelighet i stedet for et token, og en arbeidsflyt bytter dem inn i et kortlivd tilgangstoken ved starten av hver kjøring — den samme toblokkers-formen som siden om [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) bruker, med en **API Post (JSON)**-blokk som henter tokenet og alt etter den som sender `Bearer <token>`. Ingenting må erstattes for hånd et år senere. Atlassians side har den nøyaktige tokenforespørselen; basis-URL-en for API-et er `https://api.atlassian.com`.

## Steg 2 — Åpne en Jira-sak for hver hendelse

1. Åpne **Arbeidsflyter → Opprett arbeidsflyt**, gi den navnet `Incidents → Jira`, og åpne **Bygger**.
2. Klikk på den stiplede plassholderblokken og legg til triggeren **On Create Incident**. I dens **Select Fields** ber du om kolonnene du vil sende:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   La **Identifier** stå som `incident-on-create-1` — det er navnet senere blokker refererer til den med.

3. Klikk **Legg til komponent**, legg til en **API Post (JSON)**-blokk, og dra fra triggerens **Success**-prikk til inndataprikken på den nye blokken. Åpne den, sett **Identifier** til `create-issue`, og fyll inn:

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

   Erstatt `OPS` med prosjektnøkkelen din og `Bug` med en sakstype som finnes i det prosjektet. Begge kan også oppgis med id — `{"id": "10000"}` — som er det Atlassians egne eksempler bruker, og det du bør foretrekke hvis to sakstyper på nettstedet ditt deler navn. `createmeta`-kallene lenger nede gir deg de id-ene.

Beskrivelsen ser tung ut fordi Jira Clouds v3-API tar imot rik tekst som **Atlassian Document Format** — et dokumenttre, ikke en streng. Formen ovenfor er det minste gyldige dokumentet: ett avsnitt som rommer én tekstnode. Det samme gjelder `environment` og alle flerlinjes tekstfelt av typen egendefinert felt; enlinjes egendefinerte tekstfelt tar fortsatt en vanlig streng.

Slå nå på arbeidsflyten fra **Oversikt → Rediger arbeidsflyt → Aktivert**, opprett en testhendelse, og åpne **Kjøringer og logger**. `create-issue`-blokken bør vise en `201` og en kropp som inneholder den nye sakens `id`, `key` og `self`. Endringer på lerretet lagrer seg selv — det finnes ingen Lagre-knapp, og en deaktivert arbeidsflyt kan ikke kjøre i det hele tatt, ikke engang manuelt.

Den nye saksnøkkelen er tilgjengelig for enhver blokk etter denne:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Å fylle inn flere felt

Noen vanlige tillegg inne i `fields`:

- **Prioritet** — `"priority": { "id": "20000" }`, med en prioritets-id fra nettstedet ditt. For å mappe OneUptime-alvorlighetsgrader til Jira-prioriteter legger du en **If / Else**-blokk mellom triggeren og API-blokken og forgrener på `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Ansvarlig** — `"assignee": { "id": "<accountId>" }`. Jira Cloud identifiserer folk med Atlassian-konto-id; `username` og `userKey` ble fjernet fra Cloud-API-et for flere år siden.
- **Etiketter** — `"labels": ["oneuptime", "sev1"]`, et flatt array med strenger. Etiketter kan ikke inneholde mellomrom.
- **Komponenter** — `"components": [{ "id": "10000" }]`.
- **Egendefinerte felt** — `"customfield_10034": "..."`, med feltets egen id. Verdiens form følger feltets type: en enkeltvalgsliste tar `{"value": "red"}`, en flervalgsliste et array med id-er, og et flerlinjes tekstfelt et Atlassian Document Format-dokument.

For å finne ut hva et prosjekt faktisk krever, spør du Jira i stedet for å gjette. List opp sakstypene i et prosjekt, og deretter feltene for én av dem:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

Det andre kallet lister opp hvert felt den sakstypen godtar, hvilke av dem som er påkrevd, og de nøyaktige `customfield_NNNNN`-id-ene. Vil du lese id-ene av en sak du allerede har, henter du den med `?expand=names`.

## Steg 3 — Ta med hendelses-id-en inn i Jira

Begge halvdelene av en toveissynkronisering trenger at ett av systemene holder på det andres identifikator, og Jira er det beste stedet å oppbevare den: OneUptimes `customFields`-kolonne er én enkelt JSON-klump, så å skrive én verdi fra en arbeidsflyt erstatter hvert eneste egendefinerte felt på den hendelsen.

**Med en Jira-administrator.** Legg til et kort tekstfelt av typen egendefinert felt — kall det *OneUptime Incident ID* — på prosjektets opprettelsesskjerm, finn id-en med `createmeta`, og sett den sammen med alt det andre:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Uten en.** Legg den i en etikett i stedet. Etiketter tåler ikke mellomrom, og en OneUptime-id er en ren UUID, så `oneuptime-<id>` er en gyldig etikett:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

Den innkommende arbeidsflyten må da plukke den etiketten ut av listen, noe som er et par linjer i en **Run Custom JavaScript**-blokk. Det egendefinerte feltet er ryddigere hvis du kan få det.

Mens du er i gang, er det verdt å legge en lenke på Jira-saken tilbake til hendelsen. En **API Post (JSON)**-blokk etter `create-issue`, rettet mot `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, med:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

gir alle i Jira en vei tilbake med ett klikk. Legg til `projectId` i triggerens **Select Fields** for dette. `globalId` er det som gjør kallet trygt å gjenta: Jira oppdaterer lenken som allerede bærer den id-en, i stedet for å legge til en til. Fordi en oppdatering også nuller ut alt du utelater, skal du alltid sende hele `object`, ikke en delvis oppdatering av det.

## Steg 4 — Kommentere og flytte saken mens hendelsen utvikler seg

Bygg dette som en **andre** arbeidsflyt, slik at en feil her aldri kan stoppe at saker blir åpnet.

1. **Opprett arbeidsflyt**, gi den navnet `Incident updates → Jira`, og legg til triggeren **On Update Incident**.
2. I **Listen on** legger du `{"currentIncidentStateId": true}`. Triggeren fyrer da bare ved tilstandsendringer i stedet for ved hver eneste redigering. I **Select Fields** ber du om `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Legg til en **If / Else**-blokk: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — eller hva prosjektets løste tilstand nå heter. Se [Tilstander og alvorlighetsgrader](/docs/incidents/states-and-severities).

Fra **Yes**-grenen må du først finne saken du åpnet i Steg 2. Spør Jira etter den med id-en du lagret i Steg 3, med en **API Post (JSON)**-blokk hvis **Identifier** er `find-issue`:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Brukte du et egendefinert felt i stedet for en etikett, blir klausulen `cf[10050] ~ \"...\"` med din egen felt-id.

Saks-id-en er da `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, og hvert endepunkt nedenfor tar imot en id like gjerne som en nøkkel.

Tre ting ved dette endepunktet er verdt å kjenne til. **Post JQL-en, ikke legg den i URL-en** — en spørringsstreng som inneholder `=` inne i en verdi, kappes av på vei ut av en arbeidsflyt, og JQL er ikke annet enn `=`-tegn. **Spørringen må være avgrenset**: en naken `order by key desc` avvises med `400`, som er grunnen til at `project =`-klausulen er der. Og `/rest/api/3/search/jql` er det gjeldende endepunktet — det eldre `/rest/api/3/search` er utfaset og på vei ut, så ikke grip til det.

**Å legge igjen en kommentar** er én enkelt **API Post (JSON)**-blokk mot `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, med en Atlassian Document Format-kropp akkurat som beskrivelsen:

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

**Å flytte saken** krever to kall, fordi en overgang identifiseres av en id som varierer mellom arbeidsflyter og, på enkelte tavler, mellom saker.

1. En **API Get (JSON)**-blokk mot `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` returnerer overgangene som er tilgjengelige *fra sakens nåværende status*, hver med en `id` og et `name`, og et `to`-objekt som navngir statusen den fører til.
2. En **API Post (JSON)**-blokk mot den samme URL-en utfører én av dem:

   ```json
   { "transition": { "id": "31" } }
   ```

En vellykket overgang svarer `204` uten kropp. Vil du heller slippe å lese listen under kjøring, kaller du den én gang for hånd for en sak i riktig status og hardkoder id-en — bare husk at den er knyttet til den arbeidsflyten, så en administrator som redigerer Jira-arbeidsflyten, kan ødelegge den i det stille.

## Innkommende — Jira til OneUptime

Så den andre retningen: noen flytter saken til Done, og OneUptime-hendelsen bør følge etter.

### Bygg den mottakende arbeidsflyten først

1. **Opprett arbeidsflyt**, gi den navnet `Jira → OneUptime`, og legg til **Webhook**-triggeren.
2. Åpne den arbeidsflytens **Innstillinger** og kopier **Webhook Secret Key**. URL-en din er:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Selvhostede installasjoner bruker sin egen vert. Behandle URL-en som et passord — alle som har den, kan starte arbeidsflyten — og nullstill nøkkelen fra den samme siden hvis den lekker.

3. Legg til en **If / Else**-blokk som sjekker en delt hemmelighet før noe annet kjører. **Input 1** er `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, og **Input 2** er `{{global.variables.JIRA_WEBHOOK_SECRET}}` — en verdi du finner på selv og lagrer som en hemmelig global variabel.
4. Fra **Yes**-grenen legger du til en **Update One Incident**-blokk:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: det Jira-endringen skal bety her — vanligvis en tilstandsendring.

   Å flytte en hendelse krever måltilstandens id, som en **Find One Incident State**-blokk med spørringen `{"name": "Resolved"}` gir deg som `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Skriv den inn i `currentIncidentStateId`.

La arbeidsflyten stå aktivert. Gi nå Jira noe å kalle.

### Send hendelsen fra en Jira-automatiseringsregel

1. I Jira åpner du prosjektets automatiseringsregler: **Space settings → Automation** på nyere tenanter, **Project settings → Automation** på eldre. For en regel som spenner over flere prosjekter, bruker du **Settings → System → Global automation**, som krever den globale rettigheten *Administer Jira*.
2. **Create rule**, og velg triggeren **Work item transitioned** — **Issue transitioned** på eldre tenanter. Sett den til å kjøre når statusen flyttes *til* **Done**.

   Bruk denne triggeren, ikke *Work item updated*: oppdateringstriggeren utelater statusendringer med vilje.

3. Legg til handlingen **Send web request** (send nettforespørsel) og konfigurer den:

   - **Web request URL**: OneUptime-webhook-URL-en ovenfra.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, og `X-OneUptime-Secret` / din delte hemmelighet. Bruk **Hide**-alternativet på hemmelighetens verdi så andre regelredaktører ikke kan lese den — merk at skjulingen er irreversibel for den verdien, og at skjulte verdier går tapt hvis regelen eksporteres eller dupliseres.
   - **Web request body**: **Custom format**, slik at du styrer formen:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Brukte du en etikett i stedet for et egendefinert felt i Steg 3, sender du `"labels": "{{issue.labels}}"` og trekker id-en ut med en **Run Custom JavaScript**-blokk på OneUptime-siden.

4. Slå på regelen, flytt en testsak til Done, og sjekk begge sider: regelens egen revisjonslogg i Jira, og **Kjøringer og logger** i OneUptime.

Ting som er verdt å vite før du stoler på dette:

- **Målporten er begrenset.** Send web request når bare portene 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 og 9900. OneUptime Cloud ligger på 443; en selvhostet installasjon på en uvanlig port kan ikke kalles på denne måten.
- **Det finnes ingen signering av forespørselen.** Handlingen har ingen HMAC-mulighet, så en delt hemmelighet i en header over HTTPS er mekanismen Atlassian dokumenterer. **If / Else**-sjekken i Steg 3 av den mottakende arbeidsflyten er det som gjør den verdt å ha.
- **Regelkjøringer måles.** Jira Cloud teller vellykkede regelkjøringer mot en månedlig kvote som avhenger av planen din — 100 på Free, 1 700 på Standard, 1 000 × brukere på Premium, ubegrenset på Enterprise. En regel som fyrer ved hver eneste overgang i et travelt prosjekt, samler seg fort opp.
- **Verdier URL-kodes ikke** for deg. Det betyr bare noe hvis du sender en skjemakodet kropp; JSON-en ovenfor går bra.
- **Atlassian publiserer sine utgående IP-områder** på [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com) hvis OneUptime-installasjonen din står bak en tillatelsesliste. De endrer seg, så les feeden jevnlig i stedet for å låse adresser.

### Eller bruk en Jira-webhook i stedet

En Jira-administrator kan registrere en webhook direkte under **Settings → System → Advanced → WebHooks**, velge hendelsene som skal sendes og eventuelt en JQL-spørring som snevrer inn hvilke saker som utløser den. Sammenlignet med en automatiseringsregel:

- Nyttelasten er Jiras egen, ikke din: `webhookEvent`, `issue_event_type_name`, hele `issue`, og en `changelog` hvis `items`-array holder før- og etter-verdiene for hvert endret felt. For en statusendring vil du ha oppføringen der `field` er `status`. Å lese det inne i en arbeidsflyt betyr som regel en **Run Custom JavaScript**-blokk.
- Webhooker **kan** signeres — gi webhooken en hemmelighet, så sender Jira en `X-Hub-Signature`-header som inneholder en HMAC av forespørselskroppen — men en arbeidsflyt kan ikke sjekke den. Signaturen dekker de nøyaktige bytene Jira sendte, og Webhook-triggeren gir arbeidsflyten en kropp som allerede er tolket til JSON, så det er ingenting igjen å hashe. Vil du ha forespørselen autentisert, bruker du en automatiseringsregel med en header med delt hemmelighet i stedet.
- URL-en må være HTTPS på en port fra Jiras egen liste, som *ikke* er den samme listen automatiseringshandlingen bruker — port 80 er ikke tillatt her.
- Levering forsøkes på nytt opptil fem ganger med fem til femten minutters ventetid, så arbeidsflyten din må tåle at den samme hendelsen kommer to ganger.

Webhooker som er registrert av en app gjennom `/rest/api/3/webhook`, er igjen en helt annen sak: de utløper 30 dager etter registrering med mindre de fornyes. De administratorregistrerte ovenfor utløper ikke.

## Jira Data Center

Selvadministrert Jira fungerer på samme måte med en håndfull erstatninger. **Jira Server** nådde slutten på støtteperioden i februar 2024 og får ingen rettelser, så behandle Data Center som målet for selvadministrert drift.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — det finnes ingen v3 på Data Center                       |
| `description` som et Atlassian Document Format-dokument | `description` som en vanlig streng i wiki-markering                     |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| API-token fra id.atlassian.com                    | **Profile → Personal access tokens → Create token** på din egen Jira-konto   |
| Automatiseringshandlingen **Send web request**    | Automatiseringshandlingen **Send outgoing web request**                       |

Så create-issue-blokken blir en `POST` til `/rest/api/2/issue` med:

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

som er enklere å bygge maler av — ingen dokumenttre.

Andre forskjeller du bør planlegge for:

- **Personal access tokens** finnes fra Jira Core og Jira Software 8.14 og Jira Service Management 4.15. De utløper — 365 dager som standard — og grensesnittet merker et token som *Expires soon* fem dager i forveien. Basic auth med brukernavn og passord fungerer fortsatt på Data Center, men noen få mislykkede innlogginger utløser en CAPTCHA som stenger kontoen helt ute fra REST-API-et til et menneske rydder opp i en nettleser, noe som er en dårlig måte å oppdage en skrivefeil på. Foretrekk et token.
- **Automatisering følger med** fra Jira Data Center 10.0. Før det var det den separat installerte appen Automation for Jira. Dens utgående forespørsel har en standard tidsavbrudd på 3000 ms, som kan justeres med egenskapen `outgoing.webhook.timeout.ms`.
- **Webhooker** registreres under **Administration → System → Advanced → WebHooks**, og JQL-avgrensning støttes. Hold de filtrene snevre: Jira evaluerer JQL-en til hver eneste registrerte webhook på tråden som utløste hendelsen, så et dusin løse filtre gjør brukerhandlingen som utløste dem, tregere.
- **Fra Data Center 10.0 er webhook-levering asynkron** og det finnes ikke noe synkront alternativ, så hendelser kan komme i feil rekkefølge. Gjør den mottakende arbeidsflyten idempotent.
- **Jira 10 droppet `$`-tegnet i webhook-URL-variabler** — `${issue.id}` ble `{issue.id}` — og flyttet webhookens REST-ressurs fra `/rest/webhooks/1.0/webhook` til `/rest/jira-webhook/1.0/webhooks`.

## Å gjøre det samme for varsler

Alt ovenfor er skrevet rundt hendelser fordi det er det vanligste tilfellet, men varsler fungerer helt likt — bytt posttype, og ingenting annet endres:

| Hendelse                                 | Varsel                                      |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

En arbeidsflyt har nøyaktig én trigger, så hendelser og varsler trenger én arbeidsflyt hver. Skal de to gjøre den samme jobben, bygger du Jira-halvdelen én gang og kaller den fra begge med komponenten **Execute Workflow**.

## Feilsøking

Åpne den feilende blokken i **Kjøringer og logger** først. Jira returnerer en JSON-kropp som navngir nøyaktig hva den avviste, og API-komponenten beholder den i `response-body`.

**`401 Unauthorized`.** Kod `email:api_token` på nytt med `printf` og oppdater `JIRA_AUTH`; en etterfølgende nylinje fra `echo` er den vanlige årsaken. Bekreft deretter at kontoen som eier tokenet, kan opprette saker i det prosjektet. På Data Center: sjekk at du sender `Bearer`, ikke `Basic`.

**`400 Bad Request` som navngir et felt.** Sakstypen finnes ikke i prosjektet, eller prosjektet har et påkrevd felt du ikke sender. Kjør `createmeta`-kallene ovenfor mot det prosjektet og den sakstypen, og sammenlign.

**`400` som klager på `description`.** På Cloud v3 må beskrivelsen være et Atlassian Document Format-dokument, ikke en streng. Enten sender du dokumentet vist ovenfor, eller så bytter du den blokken til `/rest/api/2/issue` og sender ren tekst.

**`404 Not Found`.** Sjekk basis-URL-en og API-versjonen — `/rest/api/3/...` på Cloud, `/rest/api/2/...` på Data Center.

**`429 Too Many Requests`.** Jira begrenser hastigheten. Svaret bærer `Retry-After` i sekunder og en `RateLimit-Reason` som navngir hvilken grense du traff. Skriveoperasjoner mot én enkelt sak er stramt begrenset — i størrelsesorden tjue i løpet av to sekunder — så en arbeidsflyt som kommenterer og flytter saken i rask rekkefølge, kan utløse den på én sak alene. Legg en **Delay**-blokk mellom kallene, eller flytt bulkarbeid til en planlagt arbeidsflyt.

**Overgangskallet returnerer `400`.** Overgangs-id-en er ikke gyldig fra sakens *nåværende* status. Hent `/transitions` for den saken og bruk en id fra svaret.

**Automatiseringsregelen vises som vellykket, men ingenting når fram til OneUptime.** Sjekk porten først — se den begrensede listen ovenfor. Send deretter en forespørsel til webhook-URL-en selv med `curl` og se om den dukker opp i **Kjøringer og logger**; kommer din fram og Jiras ikke gjør det, ligger problemet på Jiras side.

**Arbeidsflyten kjører, men hendelsen endrer seg ikke.** En **Update One Incident**-blokk rapporterer `Items Updated: 0` når spørringen ikke matchet noe, og det teller som suksess, ikke som en feil. Sjekk at id-en i nyttelasten virkelig er OneUptime-hendelses-id-en, og at du spør på `_id`.

**En `{{...}}`-referanse dukker opp bokstavelig i en Jira-sak.** En referanse som ikke lar seg løse opp, sendes videre som tekst i stedet for å blankes ut. Kjøreloggen navngir enhver referanse som ikke ble løst opp — som regel en feilskrevet blokk-identifikator eller en variabel som har fått nytt navn.

## Hvor du leser videre

- [Oversikt over integrasjoner](/docs/integrations/index) — de innkommende og utgående mønstrene, og autentiserings-juksearket.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — den samme toveis-oppbyggingen mot Dynamics.
- [Oversikt over arbeidsflyter](/docs/workflows/index) og [Opprette en arbeidsflyt](/docs/workflows/authoring) — lerretet, identifikatorene og å slå på en arbeidsflyt.
- [Komponenter](/docs/workflows/components) — API-blokkene, If / Else og OneUptime-datakomponentene.
- [Variabler](/docs/workflows/variables) — hemmeligheter, og å lese utdataene fra én blokk i den neste.
- [Konfigurasjon & sikkerhet](/docs/workflows/configuration) — webhook-sikkerhet og utgående nettverkstilgang.
- [ServiceNow](/docs/integrations/servicenow) og [PagerDuty](/docs/integrations/pagerduty) — det samme utgående mønsteret for andre verktøy.
