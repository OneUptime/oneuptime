# Google Workspace

Importer revisjonsloggene i [Google Workspace](https://workspace.google.com) til sikkerhetshendelsene i OneUptime: pålogginger og det Google flagget ved dem, endringer fra administratorer, apper som fikk tilgang til data, enkel pålogging, kontoenes egne sikkerhetsinnstillinger og, hvis du vil, filer delt utenfor organisasjonen eller lastet ned i Google Disk. Der søker du i dem ved siden av logger, sporinger og metrikker, korrelerer dem med alle andre kilder og varsler vakten om dem som betyr noe. OneUptime leser dem med en tjenestekonto som opptrer som en av administratorene dine, og endrer ingenting i Google Workspace.

:::cards
- [Sett opp tilkoblingen](#sett-opp-tilkoblingen): En tjenestekonto, domenedekkende delegering og skjemaet for tilkoblingen.
- [Hva som importeres](#hva-som-importeres): Hvilke aktiviteter, og hvordan hver blir en sikkerhetshendelse.
- [Slik fungerer polling](#slik-fungerer-polling): Vinduet hver poll leser, og hvorfor det overlapper med 2 timer.
- [Feilsøking](#feilsøking): Hva hver feil betyr, og hva du skal endre.
:::

## Slik fungerer det

```mermaid title="Fra en Google Workspace-aktivitet til en sikkerhetshendelse"
flowchart TB
    gws["Google Workspace<br/>registrerer en<br/>aktivitet"] --> poll["OneUptime poller<br/>med tilkoblingens<br/>intervall"]
    poll --> token["Tjenestekontoen<br/>opptrer som<br/>administratoren din"]
    token --> list["Den lister hver<br/>loggs aktiviteter<br/>siden sist"]
    list --> event["Hver lagres som en<br/>OCSF-hendelse av<br/>sin type"]
```

Hvert minutt poller OneUptime hver aktiverte tilkobling der pollintervallet har gått. En poll logger på som tjenestekontoen din på vegne av administratoren du oppgir, og lister aktivitetene i hver revisjonslogg siden forrige poll ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)): administrasjon, pålogginger, OAuth-tokener, SAML, kontosikkerhet og, når alternativet **Disk-aktivitet** er slått på, Disk. Hver hendelse i en aktivitet lagres som en [OCSF](https://schema.ocsf.io/)-hendelse: en pålogging som en hendelse av typen Authentication, en tildelt administratorrolle som en hendelse av typen User Access Management, en pålogging Google flagget som et Detection Finding.

## Før du begynner

- I OneUptime rollen Project Owner, Project Admin eller Security Admin. Security Member og Security Viewer kan se tilkoblinger og kjøringshistorikken deres, men ikke endre dem.
- En superadministrator i Google Workspace for å tillate domenedekkende delegering, og en administrator som tjenestekontoen opptrer som, med rettigheten Reports. En superadministrator har den.
- Et Google Cloud-prosjekt der du kan opprette en tjenestekonto og slå på Admin SDK API.
- For Disk-aktivitet: en utgave med revisjonsloggen for Disk, for eksempel Business Standard, Business Plus, Enterprise eller Education.
- Utgående HTTPS fra OneUptime-appen og -workerne til `oauth2.googleapis.com` og `admin.googleapis.com`.

## Sett opp tilkoblingen

Tilkoblingen logger på med nøkkelen til en tjenestekonto og [domenedekkende delegering](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority), med ett skrivebeskyttet omfang: `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Opprett en tjenestekonto og en nøkkel

1. I [Google Cloud-konsollen](https://console.cloud.google.com) velger du et prosjekt, åpner **APIs & Services → Library**, finner **Admin SDK API** og velger **Enable**.
2. Åpne **IAM & Admin → Service accounts → Create service account**, gi den navnet `oneuptime-security-events`, og velg **Done**. Den trenger ingen rolle i prosjektet.
3. Åpne tjenestekontoen, og kopier **Unique ID**, klient-ID-en som delegeringen navngir. På fanen **Keys** velger du **Add key → Create new key → JSON** og tar vare på filen: den er nøkkelen.

### Tillat domenedekkende delegering

1. I [Google Administrasjonskonsoll](https://admin.google.com) åpner du som superadministrator **Security → Access and data control → API controls → Manage domain-wide delegation** og velger **Add new**.
2. Skriv inn tjenestekontoens **Unique ID** som **Client ID**, og `https://www.googleapis.com/auth/admin.reports.audit.readonly` som eneste **OAuth scope**. Velg **Authorize**. Google kan bruke noen minutter på å ta det i bruk.

### Legg til tilkoblingen i OneUptime

Åpne **Produkter → Security Events → Tilkoblinger** (`/dashboard/{projectId}/security-events/connections`), klikk på **Legg til tilkobling**, velg **Google Workspace** under **Identitet**, og klikk på **Neste**. Skriv inn **Administrator email**, klikk på **Neste**, og lim inn innholdet i nøkkelfilen i **JSON for tjenestekontoen**. Slå på **Disk-aktivitet** i trinnet **Henting** for å lese Disk også.

### Test den før du lagrer

Klikk på **Test disse innstillingene** under **Test før du lagrer**. Testen logger på og leser påloggings- og administrasjonsloggene med verdiene i skjemaet, og lagrer ingenting, så en manglende delegering viser seg før tilkoblingen finnes. Klikk deretter på **Neste**, gi tilkoblingen et **Navn**, og opprett den.
:::

| Innstilling | Hva du skal skrive inn |
| --- | --- |
| **Administrator email** | Adressen til administratoren tjenestekontoen opptrer som, for eksempel `admin@example.com`. Den må ha rettigheten Reports. |
| **Disk-aktivitet** | Valgfritt, slått av som standard. Slått på leser hver poll også deling og nedlastinger i Disk. |
| **JSON for tjenestekontoen** | Hele nøkkelfilen, som inneholder `client_email` og `private_key`. Den krypteres, returneres aldri av API-et og vises aldri igjen. Erstatt den med **Oppdater påloggingsinformasjon** på tilkoblingen. |

Trinnet **Henting** har også en valgfri **Beskrivelse**, **Henteintervall (minutter)**, et heltall fra `1` til `1440` som starter på `5`, og **Aktivert**, som starter slått på.

## Hva som importeres

Hver hendelse har leverandøren `Google` og produktet `Google Workspace`. En aktivitet som inneholder flere hendelser, blir én sikkerhetshendelse for hver, og hver hendelse beholder aktivitetens felter og sine egne, som `event.name`, `event.type` og `parameters.<name>`, slik at en regel leser dem under Googles navn.

| Logg | Hendelser | OCSF-klasse | Alvorlighetsgrad |
| --- | --- | --- | --- |
| Pålogginger (`login`) | `login_success`, `login_failure` med årsaken, `login_challenge`. En utlogging leses, men importeres ikke. | Authentication (`3002`) | Informational; Low for en mislykket pålogging; Medium når Google merker den `is_suspicious` |
| Googles funn (`login`) | `suspicious_login` og variantene, `gov_attack_warning`, `account_disabled_hijacked` og de andre kontoene Google deaktiverte | Detection Finding (`2004`) | Medium; High for et statsstøttet angrep, en kapret konto eller et lekket passord |
| Administrasjon (`admin`) | Administratorrettigheter og -roller tildelt eller tilbakekalt, domenedekkende delegering, brukere opprettet, slettet eller suspendert, totrinnsbekreftelse slått av, gruppemedlemmer, innstillinger | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium for tildelt makt; Low for en slettet bruker eller totrinnsbekreftelse slått av |
| OAuth-tokener (`token`) | En app som fikk tilgang til noens data, med omfangene, eller som mistet den tilgangen | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Enkel pålogging i en app | Authentication (`3002`) | Low for en mislykket pålogging |
| Kontosikkerhet (`user_accounts`) | Endringer i totrinnsbekreftelse, passord og gjenoppretting | Account Change (`3001`) | Low når det svekker kontoen |
| Disk (`drive`), med alternativet slått på | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low for en fil delt utenfor eierens domene eller åpnet for en lenke |

Reglene i regelbiblioteket for Google Workspace leser dem slik de importeres her, som reglene for en pålogging Google flagget, tildelte administratorrettigheter og en fil gjort offentlig i Disk.

## Slik fungerer polling

- **Aktiviteter leses etter når de skjedde.** Reports API har ikke noe annet tidspunkt å liste dem etter, og Google dokumenterer at loggene kommer minutter til timer for sent.
- **Den første pollen ser 24 timer tilbake**, slik at en ny tilkobling viser de nylige aktivitetene sine med en gang.
- **Hver senere poll starter 120 minutter før den lagrede markøren**, så en aktivitet som Google gjør lesbar opptil 2 timer for sent, leses ved neste poll, og duplikater forkastes etter ID-en til hver hendelse i prosjektet. En som kommer senere enn det, leses ikke av pollingen: importer tidsrommet fra **Diagnostikk**.
- **En poll leser høyst 24 timer forbi markøren.** En tilkobling der markøren har kommet på etterskudd, tar igjen i en rekke vinduer på 24 timer.
- **Disk leses én hendelse om gangen**, siden Disk registrerer hver fil noen åpner. Når Google avviser loggen for Disk, advarer kjøringen, og de andre loggene importeres fortsatt.
- **En mislykket kjøring endrer ingenting.** Etter en nettverksfeil, eller en feilstatus fra Google, forblir markøren og vinduslengden som de var, og den neste pollen leser det samme vinduet på nytt. Det eneste unntaket er en forespørsel som fikk tidsavbrudd: markøren blir stående, men det neste vinduet er halvparten så langt, fordi et vindu som er for tungt til å bli besvart i tide, ville fått tidsavbrudd ved hvert forsøk.

### Når et vindu inneholder mer enn én poll kan lese

Hver logg har sitt eget budsjett, i sider med 1 000 aktiviteter: 10 for pålogginger, 5 hver for administrasjon, OAuth-tokener og SAML, 3 for kontosikkerhet, og 4 for hver Disk-hendelse. En poll stopper etter 4 minutter. Når et budsjett stopper en logg før slutten av vinduet, er kjøringen **Delvis**, og advarselen navngir loggen og budsjettet. Google lister de nyeste aktivitetene først, så OneUptime forkorter vinduet i stedet for å flytte markøren forbi aktiviteter den aldri nådde:

1. **Snevre inn.** Den neste pollen leser et vindu som er halvparten så langt, fra det samme startpunktet, og fortsetter å halvere til et vindu leses helt, ned til ett minutt. Kjøringens advarsel sier det: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Aktiviteter som allerede er importert fra det lengre vinduet, hoppes over som duplikater.
2. **Vokse igjen.** Når et vindu er lest helt, flyttes markøren til slutten av det, og det neste vinduet er igjen dobbelt så langt, opptil 24 timer.
3. **Gå forbi ett enkelt minutt.** Hvis selv ett minutt inneholder mer enn en poll kan lese, går pollingen forbi det, slik at nyere aktiviteter fortsetter å komme. Kjøringen forblir **Delvis**, og **Siste feil** lyder `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importer det minuttet med **Import this time range** for å hente det én kjøring kan lese.

Å endre **Henteintervall (minutter)** endrer ingenting av dette: det avgjør hvor ofte en poll starter, ikke hvor vinduet begynner.

### Kjør, forhåndsvis og importer ved behov

Klikk på **Diagnostikk** på en tilkobling for å se de siste kjøringene og arbeide med den manuelt. Alle som kan endre tilkoblingen, kan starte disse handlingene; alle som kan se den, kan lese historikken.

- **Kjør nå** starter en poll med en gang, med den vanlige markøren, også når tilkoblingen ikke er **Aktivert**.
- **Preview audit events** leser et tidsrom på opptil 7 dager og importerer ingenting.
- **Import this time range** importerer et tidsrom på opptil 7 dager, etter at du har bekreftet, uten å flytte markøren. Aktiviteter som allerede er importert, hoppes over. Google beholder 6 måneder med revisjonslogger.
- **Copy diagnostics** på en kjøring kopierer rapporten for brukerstøtte. Den inneholder aldri legitimasjon.

## Test tilkoblingen

**Test tilkoblingen** på raden til en tilkobling og **Test disse innstillingene** i skjemaet kjører i API-prosessen, ikke i en bakgrunnsworker, slik at en test også svarer når det er workerne som er problemet. Den kjører disse kontrollene i rekkefølge:

| Kontroll | Hva den kontrollerer |
| --- | --- |
| **Konfigurasjon** | Administratorens adresse og nøkkelen er riktig formatert. Ingenting kontaktes når dette mislykkes. |
| **Authenticate with Google** | Google lar tjenestekontoen opptre som administratoren: den domenedekkende delegeringen er på plass. |
| **Read the audit logs** | Påloggings- og administrasjonsloggene fra de siste 24 timene kan leses. |
| **Read Drive activity** | Bare med alternativet slått på: loggen for Disk kan leses. |
| **Activities available to import** | Hvor mange påloggings- og administrasjonsaktiviteter de siste 24 timene inneholder, høyst 1 000 av hver, så `1000+` betyr flere. Ingen er en advarsel. |
| **Background workers**, **Poll scheduler**, **Security event storage** | OneUptimes egen side: en prosess tar jobbene fra Worker-køen, poll-jobben kjører hvert minutt, og lageret for sikkerhetshendelser svarer. |
| **Scheduled polling** | For en lagret tilkobling: polling er slått på, ingen kjøring sitter fast og venter på en worker, og poller kjører i tide. |

Hver forespørsel i en test har en frist på 20 sekunder. En test importerer aldri noe og flytter aldri markøren, og hver kontroll som mislykkes, sier hva du skal endre.

## Feilsøking

**Siste feil** for tilkoblingen lagrer hele feilmeldingen, med legitimasjon maskert. Når en tilkobling har en feil, velger du **Vis feil** i kolonnen **Handlinger** for å lese den, og **Kopier feil** i dialogen for å kopiere den. Hver melding starter med `Google Workspace`, navngir deretter forespørselen som mislyktes, og siterer Googles egen årsak.

:::details Siste feil sier `token request failed`
- `unauthorized_client`: tjenestekontoen har ingen domenedekkende delegering for omfanget. Legg til **Unique ID** med `https://www.googleapis.com/auth/admin.reports.audit.readonly` under **Manage domain-wide delegation**.
- `invalid_grant` med `Invalid email or User ID`: **Administrator email** er ikke en bruker i dette Google Workspace.
- `invalid_grant` med `Invalid JWT Signature`: nøkkelen er slettet eller deaktivert. Opprett en ny nøkkel, og lagre den med **Oppdater påloggingsinformasjon**.
:::

:::details Siste feil sier `activities request failed (HTTP 403)`
- Årsak `SERVICE_DISABLED` eller `accessNotConfigured`: Admin SDK API er slått av i prosjektet til tjenestekontoen. Slå den på, og test på nytt om noen minutter.
- Årsak `forbidden`: administratoren mangler rettigheten Reports. Tildel den under **Account → Admin roles** i Google Administrasjonskonsoll, eller oppgi en superadministrator.
:::

:::details Disk-aktivitet leses ikke
Loggen for Disk krever en utgave som har den, og en administrator med rettigheten Reports. Hver kjøring advarer `Drive activity was not read`, og de andre loggene importeres fortsatt. Slå av **Disk-aktivitet** når utgaven din ikke har en logg for Disk.
:::

:::details Siste feil sier `did not complete`
Forespørselen fikk ikke svar: et tidsavbrudd, et navn som ikke kan slås opp, eller en avvist adresse. Sjekk at OneUptime-appen og -workerne kan nå `oauth2.googleapis.com` og `admin.googleapis.com`, gjennom enhver proxy du bruker.
:::

:::details Testen lykkes, men Last Polled er Never
Poll-jobben har aldri kjørt. Les kontrollene **Background workers** og **Poll scheduler**. På en selvdriftet installasjon er den vanlige årsaken `DISABLE_QUEUE_WORKERS=true` på appen, uten en separat worker-utrulling som tar jobbene: sett den til `false`, eller kjør worker-utrullingen (Helm: `worker.enabled: true`, som er `false` som standard).
:::

## Neste trinn

:::cards
- [Sikkerhetshendelser](/docs/telemetry/security-events): Søk, korreler og varsle på det du importerer.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Importer påloggingene og katalogendringene i Microsoft.
- [Google SecOps](/docs/integrations/google-secops): Hent også inn deteksjonene fra Google SecOps.
- [Oversikt over integrasjoner](/docs/integrations/index): De andre verktøyene du kan koble til.
:::
